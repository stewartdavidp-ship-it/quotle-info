#!/usr/bin/env node
'use strict';
/*
 * backfill-mis-kind.js — set `kind: "context"` on misattribution rows whose tag states a
 * non-authorship ROLE, so they stop rendering the ✕ that means "this credit is refuted".
 *
 *   node tools/backfill-mis-kind.js --dry     report only
 *   node tools/backfill-mis-kind.js           write
 *
 * The rule lives in tools/mis-kind.js and is shared with workflows/prep-wave.js, so new waves set
 * it at ingest and this backlog cannot re-accumulate. Rows the rule does not recognise keep the
 * default ✕ and are printed as a review tail — deliberately, because marking a genuine refutation
 * as context softens a debunk, and the page exists to refute.
 */
const fs = require('fs');
const path = require('path');
const { kindForRow } = require('./mis-kind');
const DIR = path.join(path.resolve(__dirname, '..'), 'data', 'quotes');
const DRY = process.argv.includes('--dry');

let rows = 0, recs = 0; const tail = {}; const byKind = {};
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const p = path.join(DIR, f);
  const r = JSON.parse(fs.readFileSync(p, 'utf8'));
  const items = ((r.misattribution || {}).items) || [];
  let touched = 0;
  for (const it of items) {
    if (it.kind) continue;
    const t = String(it.tag || '').replace(/<[^>]+>/g, '').trim();
    const k = kindForRow(it);
    if (k) { it.kind = k; rows++; touched++; byKind[k] = (byKind[k] || 0) + 1; }
    else if (t) tail[t] = (tail[t] || 0) + 1;
  }
  if (touched) { recs++; if (!DRY) fs.writeFileSync(p, JSON.stringify(r, null, 2) + '\n'); }
}
console.log(`${DRY ? '[dry] ' : ''}kind set on ${rows} rows across ${recs} records — ${Object.entries(byKind).map(([k, v]) => `${k}:${v}`).join(', ') || 'none'}`);
const e = Object.entries(tail).sort((a, b) => b[1] - a[1]).filter(([k]) =>
  /not (the )?(author|origin|coiner|originator)|quoter|anthology|compilation|translator|reuse|speaker/i.test(k));
if (e.length) {
  console.log(`\nREVIEW TAIL — ${e.length} tag(s) that read like context but the rule declined:`);
  for (const [k, v] of e) console.log(`  ${String(v).padStart(3)}  ${k.slice(0, 70)}`);
  console.log('  Decide each by hand. Add a pattern to mis-kind.js only if it states a ROLE.');
}
