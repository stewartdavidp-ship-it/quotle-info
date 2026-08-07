#!/usr/bin/env node
'use strict';
/*
 * _ingest-cites.js — write MLA/APA citations + original-language flags from a cite-styles workflow
 * run into the records. Reads the workflow journal (one {type:result} line per completed agent, each
 * carrying {results:[{slug,mla,apa,inLanguage,translated}]}). Normalizes the agents' occasional
 * double-escaping so cite.mla/cite.apa are RAW HTML (<em>…</em>, single &amp; entities) the template
 * can drop straight into the page. Idempotent; re-run after a resume to fold in the rest.
 *
 *   node tools/_ingest-cites.js --journal <transcriptDir>/journal.jsonl [--expect <slugs.json>]
 *
 * --expect takes the SAME slug array that was passed to cite-styles.js. cite-styles.js chunks that
 * array across agents, so a chunk that returns 11 of its 12 leaves no trace in the journal — the same
 * silent-loss shape that cost r32 and r33 a record each in the theme tagger (see
 * workflows/apply-tags.js, where the manifest is mandatory for exactly this reason). cite-styles.js
 * already returns {requested, got}, so the caller HAS the number; this makes the check mechanical and
 * names the slugs. Optional here rather than required only because this is an ad-hoc backfill tool
 * with no runbook step to update — pass it, though: a count you have to notice is a count that gets
 * missed.
 */
const fs = require('fs');
const path = require('path');
function arg(n) { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : null; }
const JOURNAL = arg('journal');
const EXPECT = arg('expect');
if (!JOURNAL) { console.error('usage: _ingest-cites.js --journal <journal.jsonl> [--expect <slugs.json>]'); process.exit(1); }
const DIR = path.join(__dirname, '..', 'data', 'quotes');

// Undo one level of over-escaping the agents sometimes apply: &lt;em&gt; → <em>, and ANY double-escaped
// entity &amp;NAME; / &amp;#NNN; → &NAME; / &#NNN; (catches &amp;euml;, &amp;eacute;, &amp;amp;, etc.).
// Safe because a literal ampersand ("Ticknor &amp; Fields") has no trailing ";" and won't match.
function normEsc(s) {
  return String(s || '')
    .replace(/&lt;(\/?)em&gt;/g, '<$1em>')
    .replace(/&amp;(#?[a-zA-Z0-9]+);/g, '&$1;');
}

const rows = [];
for (const l of fs.readFileSync(JOURNAL, 'utf8').trim().split('\n')) {
  let j; try { j = JSON.parse(l); } catch (_) { continue; }
  const r = j.result;
  const results = r && Array.isArray(r.results) ? r.results : null;
  if (results) for (const x of results) if (x && x.slug) rows.push(x);
}

let wrote = 0, missing = 0;
const seen = new Set();
for (const x of rows) {
  if (seen.has(x.slug)) continue; seen.add(x.slug);
  const p = path.join(DIR, x.slug + '.json');
  if (!fs.existsSync(p)) { missing++; continue; }
  const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
  rec.cite = rec.cite || {};
  if (x.mla) rec.cite.mla = normEsc(x.mla);
  if (x.apa) rec.cite.apa = normEsc(x.apa);
  rec.source = rec.source || {};
  if (x.inLanguage && x.inLanguage !== 'en') rec.source.inLanguage = x.inLanguage;
  if (x.translated === true) rec.source.translated = true;
  fs.writeFileSync(p, JSON.stringify(rec, null, 2) + '\n');
  wrote++;
}
console.log(`cites ingested: ${wrote} records (${seen.size} unique slugs; ${missing} missing on disk)`);

if (!EXPECT) {
  console.log('  (no --expect: completeness NOT checked — a chunk that returned short is invisible here)');
} else {
  const want = JSON.parse(fs.readFileSync(EXPECT, 'utf8'));
  const expected = (Array.isArray(want) ? want : want.slugs || []).filter(Boolean);
  // Checked against the RECORD, not against this run's rows, so a re-run after a partial pass reports
  // what is still missing rather than re-failing on records already written.
  const lost = expected.filter((s) => {
    const p = path.join(DIR, s + '.json');
    if (!fs.existsSync(p)) return false;
    const r = JSON.parse(fs.readFileSync(p, 'utf8'));
    return !(r.cite && (r.cite.mla || r.cite.apa));
  });
  console.log(`expected: ${expected.length} slugs | ${expected.length - lost.length} now carry a cite.mla/apa`);
  if (lost.length) {
    const out = EXPECT.replace(/(\.json)?$/, '-missing.json');
    fs.writeFileSync(out, JSON.stringify(lost, null, 2) + '\n');
    console.error(`\n*** ${lost.length} of ${expected.length} REQUESTED SLUGS GOT NO CITATION — a chunk returned short.\n${lost.slice(0, 20).map((s) => `      · ${s}`).join('\n')}${lost.length > 20 ? `\n      … +${lost.length - 20} more` : ''}\n\n    Re-run list written: ${out}\n`);
    process.exit(1);
  }
  console.log('  ✓ every requested slug has a citation.');
}
