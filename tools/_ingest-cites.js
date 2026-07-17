#!/usr/bin/env node
'use strict';
/*
 * _ingest-cites.js — write MLA/APA citations + original-language flags from a cite-styles workflow
 * run into the records. Reads the workflow journal (one {type:result} line per completed agent, each
 * carrying {results:[{slug,mla,apa,inLanguage,translated}]}). Normalizes the agents' occasional
 * double-escaping so cite.mla/cite.apa are RAW HTML (<em>…</em>, single &amp; entities) the template
 * can drop straight into the page. Idempotent; re-run after a resume to fold in the rest.
 *
 *   node tools/_ingest-cites.js --journal <transcriptDir>/journal.jsonl
 */
const fs = require('fs');
const path = require('path');
function arg(n) { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : null; }
const JOURNAL = arg('journal');
if (!JOURNAL) { console.error('usage: _ingest-cites.js --journal <journal.jsonl>'); process.exit(1); }
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
