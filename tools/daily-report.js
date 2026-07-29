#!/usr/bin/env node
'use strict';
/*
 * daily-report.js — gather the night's FACTS so the 08:00 pass can spend its judgement on meaning.
 *
 * WHY A TOOL AND NOT JUST A PROMPT. The report has to be trustworthy on the mornings nobody reads it
 * carefully, which means the numbers must not be re-derived by a model each time. Everything here is
 * mechanical: what ran, what merged, what is still open, what CI says, what the queues hold. The
 * routine's job is to say which of it MATTERS — a thing no script can do — and it should not also be
 * counting.
 *
 * It is also the answer to a specific failure: every environment problem this system hit presented as
 * "nothing happened". A routine that did not run at all and a routine that ran and found nothing look
 * identical in a chat log. They do not look identical here — a missing shard is a missing FILE.
 *
 *   node tools/daily-report.js            human-readable
 *   node tools/daily-report.js --json     machine-readable, for the routine to reason over
 *   node tools/daily-report.js --since 2026-07-29
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const SINCE = arg('--since', new Date().toISOString().slice(0, 10));
const JSON_OUT = argv.includes('--json');

const sh = (c, a) => { try { return execFileSync(c, a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const j = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// EVERY routine that is supposed to run, so a SILENT ABSENCE is reportable. This is the whole point:
// a routine that never fired leaves no log line, and without an expected-set to compare against,
// "no line" is indistinguishable from "quiet night".
const EXPECTED = [
  { routine: 'daily-wave', when: '03:00', daily: true },
  { routine: 'daily-reports', when: '04:00', daily: true },
  { routine: 'daily-review', when: '05:00', daily: true },
  { routine: 'daily-merge', when: '07:00', daily: true },
  { routine: 'weekly-discovery', when: 'Mon 02:00', daily: false },
];

// ---- what ran ----
const shards = [];
try {
  const dir = path.join(ROOT, 'data', 'routine-log');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n')) {
      const e = j(line, null); if (e) shards.push({ ...e, shard: f });
    }
  }
} catch (_) {}
const todays = shards.filter((s) => s.date === SINCE);

const ran = EXPECTED.map((e) => {
  const runs = todays.filter((s) => s.routine === e.routine);
  return {
    ...e,
    runs: runs.length,
    outcomes: runs.map((r) => r.outcome),
    notes: runs.map((r) => r.note).filter(Boolean),
    prs: runs.map((r) => r.pr).filter(Boolean),
    work: runs.reduce((n, r) => n + (r.built || 0) + (r.processed || 0) + (r.sampled || 0), 0),
    missing: runs.length === 0 && e.daily,
  };
});

// ---- what merged / what is stuck ----
const merged = j(sh('gh', ['pr', 'list', '--state', 'merged', '--limit', '60', '--json', 'number,title,mergedAt']), [])
  .filter((p) => (p.mergedAt || '') >= SINCE);
const open = j(sh('gh', ['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName,mergeStateStatus,isDraft,createdAt']), []);

// ---- health ----
const ci = j(sh('gh', ['run', 'list', '--branch', 'main', '--limit', '1', '--json', 'conclusion,displayTitle']), [])[0] || {};
const corpus = j(fs.existsSync(path.join(ROOT, 'data/corpus-state.json')) ? fs.readFileSync(path.join(ROOT, 'data/corpus-state.json'), 'utf8') : '', {});
const scan = j(fs.existsSync(path.join(ROOT, 'data/scan-state.json')) ? fs.readFileSync(path.join(ROOT, 'data/scan-state.json'), 'utf8') : '', { records: {} });
const flagged = Object.values(scan.records || {}).filter((r) => r.f && r.f.length).length;
const queue = j(fs.existsSync(path.join(ROOT, 'data/report-queue.json')) ? fs.readFileSync(path.join(ROOT, 'data/report-queue.json'), 'utf8') : '', {});
const dirty = sh('git', ['status', '--porcelain']);

const out = {
  date: SINCE,
  ran,
  merged: merged.map((p) => ({ number: p.number, title: p.title })),
  open: open.map((p) => ({ number: p.number, branch: p.headRefName, state: p.mergeStateStatus, draft: p.isDraft, title: p.title, age_days: Math.floor((Date.now() - Date.parse(p.createdAt)) / 86400000) })),
  health: {
    ci: ci.conclusion || 'unknown',
    records: (corpus.figures && corpus.figures.quotes && corpus.figures.quotes.total) || null,
    flagged,
    ladder: queue.mode || null,
    unjudged_runs: (queue.runs || []).filter((r) => !r.judged).length,
    deferred: (queue.deferred || []).length,
    tree_dirty: dirty ? dirty.split('\n').length : 0,
  },
};

if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

console.log(`\n  quotle.info — ${SINCE}\n`);
console.log('  ROUTINES');
for (const r of out.ran) {
  const mark = r.missing ? '✗' : (r.runs ? '✓' : '·');
  const what = r.missing ? 'DID NOT RUN' : (r.runs ? `${r.runs} run(s): ${r.outcomes.join(', ')}${r.work ? ` · ${r.work} record(s)` : ''}` : 'not scheduled today');
  console.log(`    ${mark} ${r.when.padEnd(10)} ${r.routine.padEnd(18)} ${what}`);
}
console.log(`\n  MERGED (${out.merged.length})`);
for (const p of out.merged.slice(0, 12)) console.log(`      #${p.number} ${p.title.slice(0, 84)}`);
console.log(`\n  OPEN (${out.open.length})`);
if (!out.open.length) console.log('      none');
for (const p of out.open) console.log(`      #${p.number} ${String(p.state).padEnd(9)} ${p.branch.slice(0, 28).padEnd(30)} ${p.age_days}d  ${p.title.slice(0, 40)}`);
const h = out.health;
console.log(`\n  HEALTH`);
console.log(`      CI on main       ${h.ci}`);
console.log(`      records          ${h.records}`);
console.log(`      flagged          ${h.flagged}`);
console.log(`      report ladder    ${h.ladder}${h.unjudged_runs ? ` (${h.unjudged_runs} run(s) awaiting the operator's verdict)` : ''}`);
console.log(`      deferred items   ${h.deferred}`);
console.log(`      working tree     ${h.tree_dirty ? `${h.tree_dirty} DIRTY` : 'clean'}`);
const alarms = [];
if (h.ci !== 'success') alarms.push(`CI on main is ${h.ci}`);
for (const r of out.ran) if (r.missing) alarms.push(`${r.routine} did not run`);
for (const p of out.open) if (p.age_days >= 1) alarms.push(`#${p.number} open ${p.age_days}d (${p.state})`);
if (h.tree_dirty) alarms.push('working tree dirty');
console.log(alarms.length ? `\n  NEEDS ATTENTION\n${alarms.map((a) => `      · ${a}`).join('\n')}\n` : '\n  nothing obviously wrong\n');
