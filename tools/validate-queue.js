#!/usr/bin/env node
'use strict';
/*
 * validate-queue.js — the SAFETY GATE ON data/harvest-queue.json.
 *
 * WHY THIS EXISTS
 * `html-safety.js` was written for exactly one threat: "attacker's web page -> agent -> record ->
 * every rendered page". It was wired into `validate-records.js` (data/quotes) and
 * `validate-songs.js` (data/songs) — and nowhere else. `data/harvest-queue.json` is written by the
 * same harvest agents, from the same fetched web pages, and passed through NO gate at any stage.
 *
 * That mattered, because queued candidates are PUBLISHED, not private: they render into
 * /under-review/ (build-index.js), embed into /flagged/ (build-flagged.js) and index into
 * search.json (build-search.js). Two sinks were interpolating candidate fields raw:
 *   - build-index.js put `category` into a class attribute unescaped, while escaping every sibling
 *     field beside it — so `x" onmouseover=...` broke out of the attribute.
 *   - build-flagged.js put `documentedAt` into an href through an escaper that does not escape the
 *     double quote and did no scheme check — so `javascript:` was clickable.
 * Both sinks are now escaped/allowlisted. This gate closes the same hole AT THE SOURCE, so a third
 * sink added later cannot reopen it.
 *
 * Found by an adversarial review, 2026-07-28. Reuses the existing scanner deliberately — a second
 * safety implementation would be a second answer to one question.
 *
 *   node tools/validate-queue.js            report and exit 1 on any violation
 *   node tools/validate-queue.js --quiet    only print failures (used by build.js)
 */
const fs = require('fs');
const path = require('path');
const { scanRecord } = require('./html-safety');

const ROOT = path.resolve(__dirname, '..');
const QUEUE = path.join(ROOT, 'data', 'harvest-queue.json');
const quiet = process.argv.includes('--quiet');

// Fields that reach an HTML ATTRIBUTE (class, data-*, href) rather than a text node. An attribute
// sink is stricter than a text sink: a bare double quote is enough to escape it, and a scheme is
// enough to make a link execute. scanRecord covers tags/attrs/schemes in prose; these two need the
// narrower rule, and they need it here rather than at each sink.
const ATTR_FIELDS = ['category', 'documentedAt', 'rightsEra'];
const SAFE_TOKEN = /^[a-zA-Z0-9 _.,:;()'’&/-]*$/;

let candidates = [];
try {
  const raw = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  candidates = Array.isArray(raw) ? raw : (raw.candidates || raw.quotes || []);
} catch (e) {
  console.error(`  ✗ validate-queue: cannot read ${path.relative(ROOT, QUEUE)} — ${e.message}`);
  process.exit(1);
}

const problems = [];
for (const c of candidates) {
  const id = c.quoteSlug || (c.quote || '').slice(0, 42) || '(unnamed)';
  // 1. the shared scanner — same rules as records
  scanRecord(c).forEach((m) => problems.push(`${id}: UNSAFE HTML — ${m}`));
  // 2. attribute-bound fields: no quotes, no angle brackets, no scheme
  for (const f of ATTR_FIELDS) {
    const v = c[f];
    if (typeof v !== 'string' || !v) continue;
    if (f === 'documentedAt') {
      // Only the DOUBLE quote and angle brackets can break a double-quoted attribute. A single
      // quote cannot, and banning it is wrong: Wikiquote fragments legitimately carry one
      // (#The_Innovator's_Dilemma). Caught by running this gate against the real queue — the first
      // version rejected a valid citation, which is a gate that trains you to ignore it.
      if (!/^https?:\/\//i.test(v)) problems.push(`${id}: ${f} is not an http(s) URL — it is rendered into an href ("${v.slice(0, 60)}")`);
      else if (/["<>]/.test(v)) problems.push(`${id}: ${f} contains a double quote or angle bracket — it is rendered into an href ("${v.slice(0, 60)}")`);
    } else if (!SAFE_TOKEN.test(v)) {
      problems.push(`${id}: ${f} contains characters that break an HTML attribute ("${v.slice(0, 60)}")`);
    }
  }
}

if (problems.length) {
  console.error(`\n  ✗ validate-queue: ${problems.length} unsafe value(s) in the harvest queue — these render into public pages:\n`);
  problems.slice(0, 25).forEach((p) => console.error(`     - ${p}`));
  if (problems.length > 25) console.error(`     … and ${problems.length - 25} more`);
  process.exit(1);
}
if (!quiet) console.log(`  ✓ harvest queue safe (${candidates.length} candidates, ${ATTR_FIELDS.length} attribute-bound fields checked)`);
