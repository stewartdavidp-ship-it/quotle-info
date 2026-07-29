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
 * The log is committed JSONL, diffable in a PR. It is not derived from anything and nothing
 * regenerates it, so a routine that fails to record leaves a visible gap rather than a silent zero.
 *
 * ONE FILE PER RUN, in data/routine-log/. It was a single append-only file until 2026-07-29, when
 * that turned out to be the only thing blocking two PRs from merging — see the LEGACY comment below.
 * --report reads the old file and the new directory together, so the history is continuous.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// LEGACY, read-only from 2026-07-29. Every run used to append a line here, and five routines share
// one file across five branches all cut from the same `main` — so any two runs on the same day
// conflicted on the tail line. Measured that day with `git merge-tree`: #221 and #224 conflicted
// with main on this file and NOTHING else, not one of #224's 31 generated HTML/JSON files. It was
// the only thing blocking either PR, and it is invisible to every content gate because a log line
// is not content.
//
// Kept and still read by --report so the existing history survives; nothing appends to it now.
const LEGACY = path.join(ROOT, 'data', 'routine-log.jsonl');
// ONE FILE PER RUN. Two runs never write the same path, so there is no merge to get wrong — this
// needs no union driver, no .gitattributes, and no cooperation from GitHub's server-side merge.
// The timestamp makes it unique even when one routine runs twice in a day (daily-review did, on
// 2026-07-28), and a missing run is now a missing FILE rather than a missing line, which is more
// visible, not less.
const LOGDIR = path.join(ROOT, 'data', 'routine-log');

const argv = process.argv.slice(2);
const flag = (f, d = null) => { const i = argv.indexOf(f); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const num = (f) => { const v = flag(f); return v == null ? undefined : Number(v); };

// Reads the legacy single file AND every per-run file, so --report spans the format change and no
// history is orphaned. Sorted by date so the report reads chronologically regardless of filename.
const parseLines = (text) => text.trim().split('\n').filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);

const read = () => {
  const rows = [];
  try { rows.push(...parseLines(fs.readFileSync(LEGACY, 'utf8'))); } catch (_) { /* may not exist */ }
  try {
    for (const f of fs.readdirSync(LOGDIR).filter((n) => n.endsWith('.jsonl')).sort()) {
      try { rows.push(...parseLines(fs.readFileSync(path.join(LOGDIR, f), 'utf8'))); } catch (_) {}
    }
  } catch (_) { /* dir may not exist yet */ }
  return rows.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
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

// Filename carries the run's identity: timestamp + routine. Unique per run by construction, so two
// branches can never write the same path and there is nothing to conflict on.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const safe = String(routine).replace(/[^a-z0-9-]/gi, '-');
const out = path.join(LOGDIR, `${stamp}-${safe}.jsonl`);
fs.mkdirSync(LOGDIR, { recursive: true });
fs.writeFileSync(out, JSON.stringify(entry) + '\n');
console.log(`routine-log: recorded ${routine} / ${outcome} → data/routine-log/${path.basename(out)}`);
