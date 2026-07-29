#!/usr/bin/env node
'use strict';
/*
 * scan.js — LAYER 1 of the review spine. Cheap, deterministic, incremental.
 *
 *   node tools/scan.js            incremental: only what is actually stale
 *   node tools/scan.js --all      force every detector over every record
 *   node tools/scan.js --report   print current findings, scan nothing
 *   node tools/scan.js --json     machine-readable findings on stdout
 *
 * WHAT IT IS NOT. It does not audit, research, fetch, or judge whether a claim is true about the
 * world — workflows/audit.js does that, chosen by tools/review.js. This layer only says "two
 * things we published disagree; someone should look." So it MUST NOT touch answer.lastVerified or
 * review.lastReviewedOn. It has reviewed nothing. Those dates are claims about depth, and only a
 * pass that actually did the depth may move them.
 *
 * THE STALENESS MODEL — per (record, detector), not per record.
 * The naive version ("skip records already scanned") is wrong in a way that matters: the detector
 * catalogue GROWS. Every bug we find becomes a permanent detector, and a record scanned last month
 * under 4 detectors has never been tested against the 5th. Marking it "scanned" would hide the new
 * signal on exactly the records most likely to carry it — the old ones.
 *
 * So state is a matrix. A detector runs on a record when ANY of:
 *   · the record's content hash changed  → clear its row, re-run everything (the record is new work)
 *   · the detector id is absent for it   → a NEW signal; sweep it across the corpus
 *   · the recorded version differs       → the detector's LOGIC changed; its old verdict is void
 * and otherwise it is skipped. Adding a detector therefore costs one sweep of that detector alone,
 * never a full re-scan; editing a record costs a full re-scan of that record alone.
 *
 * State lives in data/scan-state.json — committed and diffable, like data/corpus-state.json, so a
 * new finding shows up in a PR as a reviewable line rather than as invisible local state. The file
 * is rewritten ONLY when its substance changes (see the write block below), so running this on an
 * unchanged corpus leaves the tree clean and it is safe to run in CI. It is
 * NOT written into the records themselves: that would dirty 1,158 files on every scan and churn
 * the built-HTML diff for what is only a to-do list.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DETECTORS, CATALOGUE, runDetector } = require('./detectors');

const ROOT = path.resolve(__dirname, '..');
const QDIR = path.join(ROOT, 'data', 'quotes');
const STATE = path.join(ROOT, 'data', 'scan-state.json');

const argv = process.argv.slice(2);
const ALL = argv.includes('--all');
const REPORT = argv.includes('--report');
const JSON_OUT = argv.includes('--json');

const today = () => new Date().toISOString().slice(0, 10);
const hashOf = (obj) => crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 12);

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (s && typeof s === 'object' && s.records) return s;
  } catch (_) { /* first run */ }
  return { updated: null, catalogue: {}, records: {} };
}

const state = loadState();
// A detector can be DELETED — one was, the day this shipped, after a single scan proved it was the
// same 0/11-precision candidate under a new name. Its verdicts must not outlive it: a stale id in
// `f` keeps a record flagged forever for a check nobody runs any more, and no amount of rescanning
// clears it because the detector is gone.
const KNOWN = new Set(DETECTORS.map((d) => d.id));
const files = fs.readdirSync(QDIR).filter((f) => f.endsWith('.json'));

let scanned = 0, skipped = 0, newRecords = 0, changedRecords = 0, newSignals = 0;
const findings = [];
const perDetector = {};

// A detector id that is new or version-bumped relative to the stored catalogue is a NEW SIGNAL and
// will sweep every record. Counted up front so the run can SAY that is what it is doing — a sweep
// looks identical to a broken cache from the outside otherwise.
for (const d of DETECTORS) if (state.catalogue[d.id] !== d.version) newSignals++;

for (const file of files) {
  const rec = JSON.parse(fs.readFileSync(path.join(QDIR, file), 'utf8'));
  const slug = rec.quoteSlug || file.replace(/\.json$/, '');
  const h = hashOf(rec);

  let row = state.records[slug];
  if (!row) { row = { h, d: {}, f: [] }; state.records[slug] = row; newRecords++; }
  else if (row.h !== h) { row.h = h; row.d = {}; row.f = []; changedRecords++; }  // record edited → all bets off

  const fired = new Set(row.f || []);
  for (const d of DETECTORS) {
    const due = ALL || row.d[d.id] !== d.version;
    if (!due) { skipped++; continue; }
    const finding = runDetector(d, rec);
    scanned++;
    row.d[d.id] = d.version;
    if (finding) { fired.add(d.id); findings.push({ slug, ...finding }); }
    else fired.delete(d.id);
  }
  // Findings from detectors that did NOT re-run this pass must survive — they are still true.
  for (const id of (row.f || [])) if (KNOWN.has(id) && row.d[id] != null && !ALL) fired.add(id);
  for (const id of Object.keys(row.d)) if (!KNOWN.has(id)) delete row.d[id];
  row.f = [...fired].filter((id) => KNOWN.has(id)).sort();
  for (const id of row.f) perDetector[id] = (perDetector[id] || 0) + 1;
}

// Drop rows for records that no longer exist, so a deleted record cannot haunt the flag queue.
let removed = 0;
const live = new Set(files.map((f) => f.replace(/\.json$/, '')));
for (const slug of Object.keys(state.records)) if (!live.has(slug)) { delete state.records[slug]; removed++; }

// WRITE ONLY WHEN SOMETHING ACTUALLY CHANGED — and `updated` is not "something".
//
// This used to stamp state.updated = today() on every non---report run and write unconditionally.
// data/scan-state.json is committed, so the day after the last commit `node tools/scan.js` made the
// tree dirty with a one-line date change and nothing else. That is fine by hand and fatal in CI:
// verify.yml's third step fails on a non-empty `git status --porcelain`, so scanning in CI would
// have gone red every day with the misleading message "committed output is stale".
//
// The alternative — exempting scan-state.json from the dirty check — was rejected. That is
// weakening a gate to make a build pass, which is how validate-records.js sat unused for months.
//
// So the write is content-driven: serialise canonically (key order is an artefact of readdir order,
// not information) and compare against what is on disk, ignoring `updated` entirely. Identical
// content → no write, no timestamp, clean tree. A genuine change → the date moves with it, which is
// the only time the date meant anything anyway.
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
};
const substance = (s) => JSON.stringify(canon({ catalogue: s.catalogue || {}, records: s.records || {} }));

let wrote = false;
if (!REPORT) {
  state.catalogue = { ...CATALOGUE };
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (_) { /* first run */ }
  if (!prev || substance(prev) !== substance(state)) {
    state.updated = today();
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
    wrote = true;
  }
}

const flagged = Object.values(state.records).filter((r) => r.f && r.f.length).length;

if (JSON_OUT) {
  console.log(JSON.stringify({ flagged, perDetector, findings }, null, 2));
} else {
  const work = ALL ? 'FULL RESCAN' : (newSignals ? `${newSignals} new/updated detector(s) → sweeping those across the corpus` : 'incremental');
  console.log(`scan: ${files.length} records · ${DETECTORS.length} detectors · ${work}`);
  console.log(`  ran ${scanned} checks, skipped ${skipped} already settled` +
    `${newRecords ? ` · ${newRecords} new record(s)` : ''}${changedRecords ? ` · ${changedRecords} changed record(s)` : ''}${removed ? ` · dropped ${removed} deleted` : ''}`);
  console.log(`  flagged: ${flagged} record(s)` + (Object.keys(perDetector).length
    ? ' — ' + Object.entries(perDetector).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') : ''));
  const show = (REPORT ? allFindings() : findings).slice(0, 20);
  for (const f of show) console.log(`    [${f.severity || '?'}] ${f.slug.slice(0, 44).padEnd(46)}${f.id}`);
  if (!REPORT && !findings.length && flagged) console.log('    (no NEW findings this pass; use --report to list the standing ones)');
  if (!REPORT) console.log(`  state: ${wrote ? 'data/scan-state.json updated — commit it' : 'unchanged, nothing written'}`);
  console.log('\n  next: node tools/review.js due   — flagged records are prioritised for audit');
}

function allFindings() {
  const out = [];
  for (const [slug, row] of Object.entries(state.records)) {
    for (const id of (row.f || [])) {
      const d = DETECTORS.find((x) => x.id === id);
      out.push({ slug, id, severity: d ? d.severity : '?' });
    }
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}
