#!/usr/bin/env node
'use strict';
/*
 * vocab-sweep.js — DISCOVERY. Finds defect classes nobody has written a detector for yet.
 *
 * WHY THIS EXISTS. The review spine could not find its own gaps. Layer 1 checks a catalogue of
 * KNOWN patterns, so a class nobody has met is invisible to it. Layer 2 discovers new classes but
 * costs ~205K tokens a record and only runs on what is already flagged or due — 2 of 1,158 records
 * so far, producing 2 proposals, both correctly rejected. Net new detectors from the loop: zero.
 * The loop is closed and starved: reactive all the way down, with no route in for the unseen.
 *
 * The `genuine` gap was found by a human reading a backfill's tail output. That is exactly the
 * manual discovery step the loop was supposed to remove.
 *
 * THE IDEA. The generator is the SPEC. tools/template.js branches on record values through keyed
 * lookup tables — MIS_MARK, RIGHTS, CONFIDENCE — and each table's keys are the complete legal
 * vocabulary for that field. So a key the generator can render but records almost never set is
 * either dead vocabulary or a systematic gap, and telling those apart is a cheap human question
 * with a mechanical trigger. This asks a different question from layer 1: not "does this record
 * contradict itself?" but "does the corpus use everything the generator can express?"
 *
 * It found the gap it was written for on its first run — MIS_MARK.genuine at 6/2913, i.e. 65 rows
 * that state the TRUE attribution were rendering the ✕ that means "this credit is refuted", marking
 * the correct answer as false — plus RIGHTS.licensed at 0/737, which nothing had noticed.
 *
 *   node tools/vocab-sweep.js           report
 *   node tools/vocab-sweep.js --json    machine-readable, for feeding proposals to the gate
 *
 * NOT A GATE. It reports; it never fails a build. Low usage is a QUESTION ("is this dead or
 * missing?"), and a build must not block on a question. Findings become detector proposals and go
 * through tools/propose-detector.js like anything else — measured, skeptic-judged, then admitted.
 *
 * TABLES ARE DISCOVERED FROM SOURCE, NOT LISTED HERE. Every hand-maintained parallel list in this
 * repo has drifted from the thing it mirrored: harvest.js CAT_RANK knew 3 categories while the
 * harvesters emitted 9, build-index.js chipped 3 of 6, and the popularizer check landed in two
 * files an hour apart. So this parses `const NAME = {` blocks out of template.js and reports any
 * table it finds WITHOUT a coverage mapping below — a new vocabulary cannot be added to the
 * generator and quietly escape the sweep.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QDIR = path.join(ROOT, 'data', 'quotes');
const TEMPLATE = path.join(__dirname, 'template.js');
const JSON_OUT = process.argv.includes('--json');
const RARE = 0.01; // under 1% of uses — the threshold is a prompt to look, not a verdict

// How to read each vocabulary out of a record. `dflt` is what the generator falls back to when the
// field is unset, which matters: an unset field is not "no value", it is silently the default, and
// that is precisely how 2,580 rows came to carry a refutation mark nobody chose.
const COVERAGE = {
  MIS_MARK: { field: 'misattribution.items[].kind', dflt: 'refuted',
    read: (r) => (((r.misattribution || {}).items) || []).map((i) => i.kind || 'refuted') },
  CONFIDENCE: { field: 'confidence', read: (r) => [r.confidence].filter(Boolean) },
  RIGHTS: { field: 'source.rights', read: (r) => [(r.source || {}).rights].filter(Boolean) },
  REUSE_CHIP: { field: 'source.rights', dflt: 'uncertain',
    read: (r) => [(r.source || {}).rights || 'uncertain'] },
  USE: { field: 'source.rights', read: (r) => [(r.source || {}).rights].filter(Boolean) },
  // Not a record vocabulary: an HTML-entity decode table, keyed on prose, not on a field.
  NAMED_ENTITIES: null,
};

// ---- discover the tables the generator actually declares ----
const src = fs.readFileSync(TEMPLATE, 'utf8');
const tables = {};
for (const m of src.matchAll(/^const ([A-Z][A-Z0-9_]+) = \{\n([\s\S]*?)^\};?$/gm)) {
  const [, name, body] = m;
  const keys = [...body.matchAll(/^\s{2}'?([a-zA-Z][a-zA-Z0-9-]*)'?\s*:/gm)].map((k) => k[1]);
  if (keys.length) tables[name] = keys;
}

const recs = fs.readdirSync(QDIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(QDIR, f), 'utf8')));

const findings = [];
const unmapped = [];
for (const [name, keys] of Object.entries(tables)) {
  if (!(name in COVERAGE)) { unmapped.push({ name, keys }); continue; }
  const cov = COVERAGE[name];
  if (!cov) continue;                                   // explicitly declared not-a-vocabulary
  const use = Object.fromEntries(keys.map((k) => [k, 0]));
  let foreign = 0;
  for (const r of recs) for (const v of cov.read(r)) {
    if (v in use) use[v]++; else if (v) foreign++;
  }
  const total = Object.values(use).reduce((a, b) => a + b, 0) + foreign;
  const rare = keys.filter((k) => total && use[k] / total < RARE);
  findings.push({ table: name, field: cov.field, dflt: cov.dflt || null, total, use, foreign, rare });
}

if (JSON_OUT) { console.log(JSON.stringify({ findings, unmapped }, null, 2)); process.exit(0); }

const seen = new Set();
console.log(`vocab-sweep: ${Object.keys(tables).length} vocabulary tables in template.js · ${recs.length} records\n`);
for (const f of findings) {
  console.log(`  ${f.table}  (${f.field}${f.dflt ? `, default "${f.dflt}"` : ''})`);
  console.log(`    ${Object.entries(f.use).map(([k, v]) => `${k}=${v}`).join('  ')}${f.foreign ? `  · ${f.foreign} value(s) outside the vocabulary` : ''}`);
  for (const k of f.rare) {
    // DEDUPE BY (field, key). Three tables key on source.rights, so an unused rights value was
    // printing the same warning three times — four findings that were really two. A report that
    // repeats itself is the "inbox nobody reads" failure at small scale, which is the exact thing
    // this whole layer exists to avoid. The other tables that share the field are named instead.
    const key = `${f.field}::${k}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const alsoIn = findings.filter((o) => o.field === f.field && o.table !== f.table && o.rare.includes(k)).map((o) => o.table);
    console.log(`    ⚠ "${k}" used ${f.use[k]}/${f.total} (<1%) — the generator can render it and records almost never set it.`);
    if (alsoIn.length) console.log(`      (same field also rendered by ${alsoIn.join(', ')})`);
    console.log('      Dead vocabulary, or a systematic gap? If a gap, write a detector and run it through propose-detector.js.');
  }
  console.log('');
}
if (unmapped.length) {
  console.log('  ⚠ vocabulary tables with NO coverage mapping — add them to COVERAGE in this file:');
  for (const u of unmapped) console.log(`      ${u.name}  keys: ${u.keys.slice(0, 6).join(', ')}${u.keys.length > 6 ? ' …' : ''}`);
  console.log('    (a table with no mapping is a vocabulary nothing is checking)\n');
}
const flagged = seen.size;
console.log(`  ${flagged} under-used key(s)${unmapped.length ? `, ${unmapped.length} unmapped table(s)` : ''}. This REPORTS; it never fails a build — low usage is a question, not a verdict.`);
