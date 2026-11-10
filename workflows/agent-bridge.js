#!/usr/bin/env node
'use strict';
// The host launches agents; this CLI preserves the existing prompt/schema and journal contracts.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function validate(value, schema, at = '$') {
  if (schema.enum && !schema.enum.includes(value)) throw Error(`${at}: outside enum`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${at}: expected object`);
    for (const k of schema.required || []) if (!(k in value)) throw Error(`${at}.${k}: required`);
    for (const [k, v] of Object.entries(value)) {
      if (!schema.properties?.[k]) { if (schema.additionalProperties === false) throw Error(`${at}.${k}: unexpected`); }
      else validate(v, schema.properties[k], `${at}.${k}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw Error(`${at}: expected array`);
    if (value.length < (schema.minItems || 0) || value.length > (schema.maxItems ?? Infinity)) throw Error(`${at}: wrong length`);
    value.forEach((v, i) => validate(v, schema.items, `${at}[${i}]`));
  } else if (schema.type && (typeof value !== schema.type || (schema.type === 'number' && !Number.isFinite(value)))) throw Error(`${at}: expected ${schema.type}`);
}
function contracts(repo, stage, cfg) {
  const research = stage === 'research';
  const file = path.join(repo, 'workflows', research ? 'generate.js' : 'audit.js');
  const source = fs.readFileSync(file, 'utf8');
  const marker = research ? "phase('Research')" : "phase('Audit')";
  const end = source.indexOf(marker);
  if (end < 0) throw Error('Workflow phase boundary missing');
  const prefix = source.slice(0, end).replace('export const meta', 'const meta');
  const names = research ? '{prompt:researchPrompt,schema:DOSSIER_SCHEMA}' : '{prompt:auditPrompt,schema:AUDIT_SCHEMA,skepticPrompt,verdictSchema:VERDICT_SCHEMA}';
  return vm.runInNewContext(prefix + '\n;(' + names + ')', { args: cfg }, { timeout: 1000 });
}
function plan({ repo, stage, input, verifiedDate, dateModified }) {
  repo = path.resolve(repo);
  if (!['research', 'audit'].includes(stage)) throw Error('stage must be research or audit');
  if (!Array.isArray(input) || !input.length) throw Error('nonempty input array required');
  if (stage === 'research') {
    const bad = require(path.join(repo, 'tools/et-date')).checkWaveDates(verifiedDate, dateModified);
    if (bad) throw Error(bad);
  }
  const cfg = stage === 'research' ? { items: input, verifiedDate, dateModified } : { pages: input, repo };
  const c = contracts(repo, stage, cfg);
  const sourceFiles = ['generate.js', 'audit.js'];
  const sourceHashes = Object.fromEntries(sourceFiles.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, 'workflows', f))).digest('hex')]));
  return { version: 1, runtime: 'codex-agents', stage, repo, verifiedDate, dateModified, sourceHashes, schema: c.schema,
    tasks: input.map((item, id) => ({ id, item, prompt: c.prompt(item) })) };
}
function collect(p, groups) {
  const rows = groups.flat();
  const expected = new Map(p.tasks.map(t => [t.id, t]));
  const seen = new Set();
  const journal = [];
  for (const row of rows) {
    if (!expected.has(row.id) || seen.has(row.id)) throw Error(`unexpected or duplicate task id ${row.id}`);
    seen.add(row.id);
    if (!row.agent || !row.completedAt || !Number.isFinite(Date.parse(row.completedAt))) throw Error(`task ${row.id}: agent identity and completion timestamp required`);
    const result = row.result || row.dossier || row.audit;
    validate(result, p.schema);
    const task = expected.get(row.id);
    if (p.stage === 'audit' && result.page !== `${task.item.slug}/index.html`) throw Error(`task ${row.id}: audit page mismatch`);
    if (p.stage === 'audit' && result.verdict !== (result.issues.some(i => ['high','blocker'].includes(i.severity)) ? 'FAIL' : 'PASS')) throw Error(`task ${row.id}: inconsistent audit verdict`);
    journal.push({ type: 'started', id: row.id, runtime: p.runtime, agent: row.agent, planned: true });
    journal.push({ type: 'result', id: row.id, runtime: p.runtime, agent: row.agent, completedAt: row.completedAt, result });
  }
  const missing = [...expected.keys()].filter(id => !seen.has(id));
  if (missing.length) throw Error(`missing task ids: ${missing.join(', ')}`);
  return journal;
}
function main(argv) {
  const [command, ...rest] = argv;
  const arg = (n, fallback) => { const i = rest.indexOf('--' + n); return i < 0 ? fallback : rest[i + 1]; };
  const out = arg('out');
  if (!out) throw Error('--out required');
  if (command === 'plan') {
    const p = plan({ repo: arg('repo', process.cwd()), stage: arg('stage'), input: read(arg('input')), verifiedDate: arg('verified-date'), dateModified: arg('date-modified') });
    fs.writeFileSync(out, JSON.stringify(p, null, 2) + '\n');
    console.log(`${p.stage}: ${p.tasks.length} tasks → ${out}`);
  } else if (command === 'collect') {
    const p = read(arg('plan'));
    const files = arg('results', '').split(',').filter(Boolean);
    if (!files.length) throw Error('--results file[,file] required');
    const j = collect(p, files.map(read));
    // Only completed, validated artifacts become an adapter journal. Never append to a live journal.
    fs.writeFileSync(out, j.map(x => JSON.stringify(x)).join('\n') + '\n', { flag: 'wx' });
    console.log(`${p.stage}: ${j.length / 2} completed tasks → ${out}`);
  } else throw Error('usage: agent-bridge.js plan|collect --out FILE (see workflows/CODEX-WAVE.md)');
}
module.exports = { validate, contracts, plan, collect };
if (require.main === module) { try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; } }
