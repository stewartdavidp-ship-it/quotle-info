#!/usr/bin/env node
'use strict';
/*
 * routine-log.js — what the scheduled routines actually DID, so cost stops being a guess.
 *
 *   node tools/routine-log.js --routine daily-review --outcome no-op --scanned 1158 --flagged 0
 *   node tools/routine-log.js --routine daily-wave --outcome pr --built 5 --pr https://…/183
 *   node tools/routine-log.js --report                 # recent runs + totals
 *   node tools/routine-log.js --report --tokens 15.2M  # …and cost per unit of work
 *
 * WHY. Three cost figures quoted confidently during this system's design turned out to be wrong:
 * tier 3 was called 4.4x cheaper than tier 2 on a single datapoint from the simplest possible
 * record; a "cheap discovery read" was priced by reusing that same borrowed number; and the whole
 * tier-2-as-filter argument rested on a 44% pass rate measured on a different population. Every one
 * of them was an inference presented as a measurement.
 *
 * A cloud routine cannot report its own token usage. But it can report its WORK — records scanned,
 * flagged, built, audited — and the weekly usage figure supplies the other half. Divide and the
 * per-record cost falls out. That is the whole idea: stop estimating the numerator.
 *
 * The log is committed JSONL. Append-only, one line per run, diffable in a PR. It is not derived
 * from anything and nothing regenerates it, so a routine that fails to write its line leaves a
 * visible gap rather than a silent zero.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOG = path.join(ROOT, 'data', 'routine-log.jsonl');

const argv = process.argv.slice(2);
const flag = (f, d = null) => { const i = argv.indexOf(f); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const num = (f) => { const v = flag(f); return v == null ? undefined : Number(v); };

const read = () => {
  try {
    return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) { return []; }
};

// "15.2M" / "820k" / "1234567" → number. The weekly usage figure is read off a dashboard, so accept
// the shape a human actually types.
const parseTokens = (s) => {
  if (!s) return null;
  const m = /^([\d.]+)\s*([kmKM])?$/.exec(String(s).trim());
  if (!m) return null;
  const mult = m[2] ? ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()]) : 1;
  return Math.round(Number(m[1]) * mult);
};

if (argv.includes('--report')) {
  const rows = read();
  if (!rows.length) { console.log('routine-log: empty — no runs recorded yet'); process.exit(0); }
  const recent = rows.slice(-14);
  console.log(`routine-log: ${rows.length} run(s) recorded, showing last ${recent.length}\n`);
  for (const r of recent) {
    const work = ['scanned', 'flagged', 'processed', 'built', 'sampled', 'findings', 'proposals']
      .filter((k) => r[k] != null).map((k) => `${k}=${r[k]}`).join(' ');
    console.log(`  ${r.date}  ${String(r.routine).padEnd(18)}${String(r.outcome).padEnd(10)}${work}${r.pr ? `  ${r.pr}` : ''}`);
    if (r.note) console.log(`      ${String(r.note).slice(0, 100)}`);
  }
  // Totals per routine — the denominator for any cost question.
  const by = {};
  for (const r of rows) {
    const b = (by[r.routine] = by[r.routine] || { runs: 0, noop: 0, processed: 0, built: 0, sampled: 0 });
    b.runs++;
    if (r.outcome === 'no-op') b.noop++;
    b.processed += r.processed || 0; b.built += r.built || 0; b.sampled += r.sampled || 0;
  }
  console.log('\n  totals');
  for (const [name, b] of Object.entries(by)) {
    console.log(`    ${name.padEnd(18)}${b.runs} run(s), ${b.noop} no-op · records: ${b.processed + b.built + b.sampled}`);
  }
  const tok = parseTokens(flag('--tokens'));
  if (tok) {
    const units = Object.values(by).reduce((n, b) => n + b.processed + b.built + b.sampled, 0);
    console.log(`\n  ${tok.toLocaleString()} tokens over ${units} record(s) of work`);
    console.log(units ? `    ≈ ${Math.round(tok / units).toLocaleString()} tokens per record — MEASURED, not estimated`
      : '    (no record-level work logged in this window, so nothing to divide by)');
    console.log('    Note: this is every routine combined. For a per-routine figure, log a window');
    console.log('    where only one ran, or read the per-run costs from the routine history.');
  }
  process.exit(0);
}

const routine = flag('--routine');
const outcome = flag('--outcome');
if (!routine || !outcome) {
  console.error('usage: routine-log.js --routine <name> --outcome <no-op|pr|error> [--scanned N]');
  console.error('       [--flagged N] [--processed N] [--built N] [--sampled N] [--findings N]');
  console.error('       [--proposals N] [--pr URL] [--note "..."]      or: --report [--tokens 15.2M]');
  process.exit(1);
}

const entry = {
  date: new Date().toISOString().slice(0, 10),
  routine, outcome,
  scanned: num('--scanned'), flagged: num('--flagged'), processed: num('--processed'),
  built: num('--built'), sampled: num('--sampled'), findings: num('--findings'),
  proposals: num('--proposals'),
  pr: flag('--pr') || undefined,
  note: flag('--note') || undefined,
};
for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];

fs.mkdirSync(path.dirname(LOG), { recursive: true });
fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
console.log(`routine-log: recorded ${routine} / ${outcome}`);
