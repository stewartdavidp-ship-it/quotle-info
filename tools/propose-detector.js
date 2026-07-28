#!/usr/bin/env node
'use strict';
/*
 * propose-detector.js — THE GATE between tier 3 and tier 1.
 *
 * The loop this closes: the full lifecycle (research → audit → fix) finds a problem, fixes it, and
 * that class of problem becomes a permanent tier-1 detector so it can never go unnoticed again.
 * Without this step the catalogue only grows when a human happens to remember; with it, every
 * audit wave can hand back the signal it learned.
 *
 *   node tools/propose-detector.js <file.js>        measure a candidate against the whole corpus
 *   node tools/propose-detector.js <file.js> --show print every hit, not a sample
 *
 * The file must export { id, severity, title, test } — the same shape as an entry in detectors.js.
 *
 * WHY A GATE AND NOT AN AUTO-ADD. A proposal arrives from an agent that has just seen ONE record
 * and is, correctly, pattern-matching from it. The corpus is 1,158 records, and the failure mode is
 * not a detector that misses — it is a detector that fires on the job description. Measured
 * rejections already on file: `claimant-not-a-person` 130 hits (11.2%) on legitimate prose;
 * `credited-equals-realauthor` 11 hits at 0/11 precision; an "absolute negatives" draft at 703/1158.
 * Each looked reasonable written down. None survived being run.
 *
 * So nothing enters the catalogue without a number next to it. This prints that number, a sample to
 * hand-check, and a verdict — and for anything above the noise floor it refuses, loudly. A tier-1
 * detector that cries wolf is worse than no detector, because it turns the flag queue into a second
 * inbox nobody reads, and the real findings drown with it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QDIR = path.join(ROOT, 'data', 'quotes');
const argv = process.argv.slice(2);
const SHOW_ALL = argv.includes('--show');
const ACCEPT = argv.includes('--accept');
const file = argv.find((a) => !a.startsWith('--'));

if (!file) {
  console.error('usage: node tools/propose-detector.js <candidate.js> [--show]');
  console.error('  candidate must export { id, severity, title, test(record) -> null | string }');
  process.exit(1);
}

let cand;
try { cand = require(path.resolve(file)); } catch (e) {
  console.error(`could not load ${file}: ${e.message}`); process.exit(1);
}
for (const k of ['id', 'title', 'test']) {
  if (!cand[k]) { console.error(`candidate is missing \`${k}\``); process.exit(1); }
}

const { DETECTORS } = require('./detectors');
if (DETECTORS.some((d) => d.id === cand.id)) {
  console.error(`✗ id "${cand.id}" is already in the catalogue. Never reuse an id for new logic —`);
  console.error('  pick a new id, or bump the existing detector\'s `version` so scan.js re-sweeps it.');
  process.exit(1);
}

const files = fs.readdirSync(QDIR).filter((f) => f.endsWith('.json'));
const hits = [];
let threw = 0;
for (const f of files) {
  const rec = JSON.parse(fs.readFileSync(path.join(QDIR, f), 'utf8'));
  let detail = null;
  try { detail = cand.test(rec); } catch (e) { threw++; detail = `THREW: ${e.message}`; }
  if (detail) hits.push({ slug: rec.quoteSlug || f, detail: String(detail) });
}

const rate = hits.length / files.length * 100;
// Thresholds are the ones detectors.js already documents, made executable. They are about NOISE,
// not importance: a real defect class in a curated corpus is rare, so a common match is evidence
// the rule has caught something normal rather than something wrong.
// KIND changes what a high rate MEANS. For a 'record' proposal every hit needs its own judgement,
// so a common match is evidence the rule caught something normal. For a 'backfill' every hit takes
// the same remedy, so a high count is the SIZE OF THE JOB, not noise — and after the sweep the same
// rule becomes a 0-hit tripwire. That distinction was learned the hard way: a proposal at 7.4% was
// refused here as noise when it was a 301-row backfill across 274 records.
// KIND IS DERIVED, NOT DECLARED. An agent that has just fixed one record knows what it set but
// routinely misreads WHERE the defect lives — a real proposal blamed tools/template.js when the
// renderer was correct and 301 records were missing a field. From inside one record those look
// identical. So if the proposal names the `field` its fix sets, count how many records already set
// it and decide mechanically:
//     some already set it → the generator HAS the hook, the records lag  → BACKFILL
//     none set it         → there is no hook to set                      → GENERATOR
// (`misattribution.items[].kind` measured 32/2913 before its backfill — non-zero, so the answer was
// derivable the whole time.) cand.kind is used only when no field is given.
function coverage(fieldPath) {
  if (!fieldPath) return null;
  const m = /^([a-zA-Z.]+?)(\[\])?\.([a-zA-Z]+)$/.exec(String(fieldPath).trim());
  if (!m) return null;
  const [, base, isArray, leaf] = m;
  let set = 0, total = 0;
  for (const f of files) {
    const rec = JSON.parse(fs.readFileSync(path.join(QDIR, f), 'utf8'));
    let node = rec;
    for (const seg of base.split('.')) node = node && node[seg];
    const list = isArray ? (Array.isArray(node) ? node : []) : (node ? [node] : []);
    for (const it of list) { total++; if (it && it[leaf]) set++; }
  }
  return { set, total };
}
const cov = coverage(cand.field);
const KIND = cov ? (cov.set > 0 ? 'backfill' : 'generator') : (cand.kind || 'record');
const verdict = KIND === 'backfill'
  ? { ok: true, word: `BACKFILL — ${hits.length} rows/records to sweep`, why: 'every hit takes the same remedy, so the count is the size of the job. Sweep it, wire the rule into prep-wave.js so it cannot re-accumulate, THEN add this as a tripwire (it should measure ~0).' }
  : KIND === 'generator'
    ? { ok: false, word: 'NOT A DETECTOR — central fix', why: 'a defect in a shared generator is one edit, not 1,158 flags. Apply it once in tools/, as its own commit, then propose a 0-hit tripwire so it cannot regress.' }
    : rate === 0
  ? { ok: true, word: 'ACCEPT (tripwire)', why: 'fires on nothing today — a guard against a regression that has not happened yet' }
  : rate <= 2
    ? { ok: true, word: 'ACCEPT (after hand-check)', why: 'below the 2% noise floor — read the sample below and confirm each is genuinely wrong before adding' }
    : rate <= 5
      ? { ok: false, word: 'REVIEW', why: 'between 2% and 5% — plausible, but hand-check EVERY hit before this goes in' }
      : { ok: false, word: 'REJECT', why: 'above 5% — this is matching something normal. Narrow it, or accept that it belongs in layer 2 where a skeptic can judge it' };

console.log(`candidate: ${cand.id}  (${cand.severity || 'severity unset'})`);
console.log(`  ${cand.title}\n`);
if (cov) console.log(`  field ${cand.field}: set on ${cov.set}/${cov.total} → kind DERIVED as ${KIND}${cand.kind && cand.kind !== KIND ? ` (proposal said "${cand.kind}")` : ''}`);
console.log(`  corpus ${files.length} records · ${hits.length} hits · ${rate.toFixed(1)}%${threw ? ` · ${threw} THREW` : ''}`);
console.log(`  verdict: ${verdict.word}\n    ${verdict.why}\n`);

const sample = SHOW_ALL ? hits : hits.slice(0, 8);
if (sample.length) {
  console.log(`  ${SHOW_ALL ? 'all' : 'sample of'} ${sample.length}:`);
  for (const h of sample) console.log(`    ${h.slug.slice(0, 44).padEnd(46)}${h.detail.slice(0, 76)}`);
  if (!SHOW_ALL && hits.length > sample.length) console.log(`    … ${hits.length - sample.length} more (--show for all)`);
  console.log('');
}

if (verdict.ok) {
  console.log('  If the sample holds up, add it to tools/detectors.js with version: 1 and a comment');
  console.log(`  recording TODAY'S measurement (${hits.length} hits, ${rate.toFixed(1)}%) — the next person needs to know`);
  console.log('  what it looked like when it was accepted. Then: node tools/scan.js  (sweeps the new signal only).');
} else {
  console.log('  Do NOT add this as-is. A detector that cries wolf turns the flag queue into a second');
  console.log('  inbox nobody reads, and the real findings drown with it.');
}
// --accept appends the detector to the catalogue with TODAY'S measurement baked into its comment,
// so the next reader sees what it looked like when it was admitted. Refuses unless the verdict is
// ok, so it cannot be used to smuggle a rejected rule in. This exists because "paste it in
// yourself" was the last manual step in an otherwise closed loop.
if (ACCEPT) {
  if (!verdict.ok) { console.error('\n  --accept refused: verdict is not ok.'); process.exit(1); }
  const DET = path.join(__dirname, 'detectors.js');
  let src = fs.readFileSync(DET, 'utf8');
  const entry = `  {
    id: ${JSON.stringify(cand.id)},
    version: 1,
    severity: ${JSON.stringify(cand.severity || 'medium')},
    title: ${JSON.stringify(cand.title)},
    // ADMITTED ${new Date().toISOString().slice(0, 10)} by tools/propose-detector.js --accept.
    // Measured at admission: ${hits.length} hits / ${rate.toFixed(1)}% of ${files.length} records${cov ? `; field ${cand.field} covered ${cov.set}/${cov.total} → ${KIND}` : ''}.
    // ${String(cand.rationale || '').replace(/\s+/g, ' ').slice(0, 300)}
    test: ${String(cand.test)},
  },
];`;
  src = src.replace(/\n\];\n/, `\n${entry}\n`);
  fs.writeFileSync(DET, src);
  console.log(`\n  ✓ appended ${cand.id} to tools/detectors.js — run: node tools/scan.js`);
}
process.exit(verdict.ok ? 0 : 1);
