#!/usr/bin/env node
'use strict';
/*
 * search-log.js — the SEARCH PROGRESS LOG. A fixed baseline plus one reading per day, so
 * "are we making progress?" is answered against a committed record instead of a moving report.
 *
 * WHY THIS EXISTS
 * Google Search Console is a moving instrument and it has burned this project repeatedly:
 *   - The Page indexing report sat on a stale snapshot for weeks (a Google-side reporting outage).
 *     The same numbers (289/142/82/13/2/45) were read three times and reported as "flat", when they
 *     were one frozen snapshot being re-read. Nothing was measured.
 *   - Every performance figure to date describes the Jul 7-10 cohort, because until 2026-07-25
 *     Google had never once read the sitemap and the newer pages had no discovery path. Reading
 *     those numbers as a verdict on the site meant grading ~500 old pages and calling it 2,048.
 *
 * So: readings are APPENDED, never overwritten, each stamped with the date of the DATA (not the
 * date it was pulled — GSC lags ~2 days). Deltas are computed against the previous reading and
 * against the baseline. A number you cannot diff against a committed prior value is not a
 * measurement, it is an impression.
 *
 * THE COHORT SPLIT IS THE POINT
 * `legacy` = records created 2026-07-07..07-10 (518). Different content shape; NOT comparable to
 * what the site is now, and the operator has said so explicitly. `current` = created 2026-07-14 or
 * later (695), which is the product as it stands. Aggregate site totals blend the two and are
 * therefore close to meaningless right now — always read the cohort split, and expect `current` to
 * start at ~0 because discovery only began 2026-07-25.
 *
 * Membership is FROZEN into data/search-log.json rather than recomputed from git on each run, so a
 * rebase, a squash, or a file move can never silently reshuffle which pages count as "new".
 *
 * USAGE
 *   node tools/search-log.js                  # print the log + deltas (the everyday command)
 *   node tools/search-log.js add <reading>    # append a reading from a JSON file or inline JSON
 *   node tools/search-log.js cohorts          # re-freeze cohort membership from git (rare)
 *
 * A reading is whatever you can actually pull; every field is optional except `date`:
 *   { "date":"2026-07-25", "totals":{"clicks":5,"impressions":3510,"avgPosition":23.6},
 *     "pagesWithImpressions":207, "queries":667,
 *     "cohort":{"current":{"impressions":0,"clicks":0}, "legacy":{...}},
 *     "sitemap":{"discovered":2048,"status":"Success"}, "notes":"..." }
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOG = path.join(ROOT, 'data', 'search-log.json');

const read = () => JSON.parse(fs.readFileSync(LOG, 'utf8'));
const write = (d) => fs.writeFileSync(LOG, JSON.stringify(d, null, 2) + '\n');

// ---- cohorts: first-commit date per record, frozen into the log ----
// LEGACY_THROUGH is the last day of the old content shape. Records created after it are the
// current product. The gap (no records 07-11..07-13) is why this boundary is unambiguous.
const LEGACY_THROUGH = '2026-07-10';

function computeCohorts() {
  const { execFileSync } = require('child_process');
  const out = execFileSync(
    'git',
    ['log', '--diff-filter=A', '--format=COMMIT %ad', '--date=short', '--name-only', '--', 'data/quotes', 'data/songs'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  const born = {};
  let d = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('COMMIT ')) { d = line.slice(7).trim(); continue; }
    const m = line.match(/^data\/(quotes|songs)\/(.+)\.json$/);
    // --diff-filter=A walks newest-first, so the LAST date seen for a slug is its true birth.
    if (m && d) born[m[2]] = { kind: m[1], date: d };
  }
  const legacy = [], current = [];
  for (const [slug, b] of Object.entries(born)) (b.date <= LEGACY_THROUGH ? legacy : current).push(slug);
  legacy.sort(); current.sort();
  return {
    definition: `legacy = created on/before ${LEGACY_THROUGH}; current = created after it`,
    frozenAt: null, // set by the caller — this file must not call Date.now() implicitly
    legacy: { label: 'Jul 7-10 (old content shape)', count: legacy.length, slugs: legacy },
    current: { label: 'Jul 14+ (current product)', count: current.length, slugs: current },
  };
}

// ---- reporting ----
const n = (v) => (v == null ? '—' : typeof v === 'number' ? String(v) : v);
const delta = (cur, prev) => {
  if (cur == null || prev == null) return '';
  const d = +(cur - prev).toFixed(1);
  if (d === 0) return '  ±0';
  return (d > 0 ? '  +' : '  ') + d;
};

function report() {
  const log = read();
  const rs = log.readings;
  if (!rs.length) { console.log('No readings yet.'); return; }

  console.log(`\nquotle.info — search progress log   (${rs.length} reading${rs.length === 1 ? '' : 's'})`);
  console.log(`cohorts: legacy ${log.cohorts.legacy.count} · current ${log.cohorts.current.count}   [${log.cohorts.definition}]\n`);

  const base = rs[0];
  const hdr = ['data date', 'impr', 'clicks', 'avg pos', 'pages w/ impr', 'current-cohort impr'];
  console.log('  ' + hdr.join('   |   '));
  console.log('  ' + '-'.repeat(88));
  rs.forEach((r, i) => {
    const p = i ? rs[i - 1] : null;
    const cc = r.cohort && r.cohort.current ? r.cohort.current.impressions : null;
    const pc = p && p.cohort && p.cohort.current ? p.cohort.current.impressions : null;
    console.log(
      `  ${r.date}  ` +
      `${n(r.totals && r.totals.impressions).padStart(6)}${delta(r.totals && r.totals.impressions, p && p.totals && p.totals.impressions).padStart(7)}  ` +
      `${n(r.totals && r.totals.clicks).padStart(4)}${delta(r.totals && r.totals.clicks, p && p.totals && p.totals.clicks).padStart(6)}  ` +
      `${n(r.totals && r.totals.avgPosition).padStart(6)}  ` +
      `${n(r.pagesWithImpressions).padStart(6)}  ` +
      `${n(cc).padStart(8)}${delta(cc, pc)}`
    );
  });

  const last = rs[rs.length - 1];
  if (rs.length > 1) {
    console.log('\n  vs baseline ' + base.date + ':');
    const pairs = [
      ['impressions', last.totals && last.totals.impressions, base.totals && base.totals.impressions],
      ['clicks', last.totals && last.totals.clicks, base.totals && base.totals.clicks],
      ['pages with impressions', last.pagesWithImpressions, base.pagesWithImpressions],
      ['current-cohort impressions', last.cohort && last.cohort.current && last.cohort.current.impressions,
        base.cohort && base.cohort.current && base.cohort.current.impressions],
    ];
    pairs.forEach(([label, a, b]) => {
      if (a == null || b == null) return;
      console.log(`    ${label.padEnd(28)} ${b} → ${a}   (${delta(a, b).trim()})`);
    });
  }

  // THE number to watch. Everything else blends cohorts and will mislead.
  const cc = last.cohort && last.cohort.current;
  console.log(
    '\n  ► The signal: current-cohort impressions. ' +
    (cc && cc.impressions ? `now ${cc.impressions}.` : 'still ~0 — discovery began 2026-07-25; expect ~4d publish→index latency.')
  );
  if (last.notes) console.log(`  note (${last.date}): ${last.notes}`);
  console.log('');
}

// ---- add ----
function add(arg) {
  if (!arg) { console.error('usage: node tools/search-log.js add <file.json | inline-json>'); process.exit(1); }
  const raw = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg;
  const reading = JSON.parse(raw);
  if (!reading.date) { console.error('reading needs a "date" — the date of the DATA, not of the pull (GSC lags ~2 days)'); process.exit(1); }
  const log = read();
  const at = log.readings.findIndex((r) => r.date === reading.date);
  if (at >= 0) { log.readings[at] = reading; console.log(`  replaced reading for ${reading.date}`); }
  else { log.readings.push(reading); log.readings.sort((a, b) => a.date.localeCompare(b.date)); console.log(`  added reading for ${reading.date}`); }
  write(log);
  report();
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'add') add(arg);
else if (cmd === 'cohorts') {
  const log = fs.existsSync(LOG) ? read() : { readings: [] };
  const c = computeCohorts();
  c.frozenAt = log.cohorts && log.cohorts.frozenAt ? log.cohorts.frozenAt : (arg || 'unset');
  log.cohorts = c;
  write(log);
  console.log(`  froze cohorts — legacy ${c.legacy.count}, current ${c.current.count}`);
} else report();
