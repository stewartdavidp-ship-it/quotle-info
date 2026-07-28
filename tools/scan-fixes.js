#!/usr/bin/env node
'use strict';
/*
 * scan-fixes.js — route TIER 1 straight to TIER 3, skipping the audit.
 *
 *   node tools/scan-fixes.js --out workflows/.scratch/current-fixes.json
 *   node tools/scan-fixes.js --dry            # print the work list, write nothing
 *   node tools/scan-fixes.js --detector <id>  # only findings from one detector
 *
 * WHY SKIP TIER 2. Measured on this corpus: the audit costs 205K tokens a record and the fix costs
 * 83K — the audit is 2.46x the stage it is supposed to be protecting. Filtering 44% of an 83K stage
 * saves ~37K a record at a cost of 205K, so tier 2 cannot pay for itself as triage. And on
 * tier-1-flagged input it filters nothing: run on the two flagged records it returned 0 PASS /
 * 2 FAIL, with 4 skeptic checks and 0 refuted. That is the expected result, not bad luck — a
 * mechanical detector has ALREADY established the defect exists. The audit was re-deriving, at
 * 205K a record, a conclusion tier 1 had proved for free.
 *
 * So tier 2 is not triage. It is the RESEARCHER: the only stage that finds classes nobody has a
 * detector for (37-46% PASS on new records in waves s2/s3 is discovery, not saving). Spend it on a
 * SAMPLE OF UNFLAGGED records, where it can find something new. Do not spend it confirming a flag.
 *
 * HOW. No change to workflows/fix.js. It reads a per-slug issue map from a durable file, and
 * workflows/parse-audit.js is simply one producer of that file. This is a second producer with the
 * same contract, built from data/scan-state.json instead of an audit journal — so the two routes
 * into tier 3 stay interchangeable and fix.js keeps its guardrails (re-verify every factual
 * replacement against the cited source; never touch the generator; report what it could not fix).
 *
 * The detector's `remedy` becomes the issue's `fix` line. That is the field that makes this route
 * viable at all: an audit issue tells the agent what to do, and a bare detector id does not. Every
 * remedy is written to be REFUSABLE — it says what to check before editing, and what to do when the
 * check fails — because tier 3 is now the only stage looking, and an instruction it cannot argue
 * with is one that will be followed when it is wrong.
 */
const fs = require('fs');
const path = require('path');
const { DETECTORS, runDetector } = require('./detectors');

const ROOT = path.resolve(__dirname, '..');
const QDIR = path.join(ROOT, 'data', 'quotes');
const STATE = path.join(ROOT, 'data', 'scan-state.json');

const argv = process.argv.slice(2);
const arg = (f) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const ONLY = arg('--detector');
const OUT = arg('--out');

let state;
try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (_) {
  console.error('no data/scan-state.json — run `node tools/scan.js` first'); process.exit(1);
}

const byId = Object.fromEntries(DETECTORS.map((d) => [d.id, d]));
const out = {};
let slugs = 0, issues = 0, stale = 0;

for (const [slug, row] of Object.entries(state.records || {})) {
  const ids = (row.f || []).filter((id) => (!ONLY || id === ONLY));
  if (!ids.length) continue;
  const file = path.join(QDIR, `${slug}.json`);
  if (!fs.existsSync(file)) continue;
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = [];
  for (const id of ids) {
    const d = byId[id];
    if (!d) { stale++; continue; }         // detector retired since the scan; scan.js prunes these
    // Re-run the detector NOW rather than trusting the stored flag. The record may have been fixed
    // since the scan, and handing tier 3 a stale finding wastes an 83K agent on nothing.
    const f = runDetector(d, rec);
    if (!f) continue;
    list.push({
      severity: d.severity || 'medium',
      location: `record field: ${d.field || 'see detail'}`,
      problem: `${d.title}. ${f.detail}`,
      fix: d.remedy || 'No remedy recorded for this detector — investigate before editing.',
    });
    issues++;
  }
  if (list.length) { out[slug] = list; slugs++; }
}

if (DRY || !OUT) {
  for (const [slug, list] of Object.entries(out)) {
    console.log(`  ${slug}`);
    for (const i of list) console.log(`    [${i.severity}] ${i.problem.slice(0, 110)}`);
  }
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
}

console.log(`\nscan-fixes: ${issues} issue(s) across ${slugs} record(s)${stale ? ` · ${stale} stale flag(s) skipped` : ''}${OUT && !DRY ? ` → ${OUT}` : ' (dry)'}`);
if (slugs) {
  console.log(`  next: Workflow fix.js args={ slugs: ${JSON.stringify(Object.keys(out))}, repo: "${ROOT}", kind: "quote" }`);
  console.log('        then: node tools/build.js && node tools/scan.js   (the flag should clear)');
  console.log('        and:  node tools/review.js stamp <slugs>          (records the review)');
}
