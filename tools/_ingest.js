#!/usr/bin/env node
'use strict';
/*
 * _ingest.js — write generated records from a Workflow output file into data/quotes/.
 *
 *   node tools/_ingest.js <workflow-output.json>
 *
 * The workflow returns { records: [ <record>, ... ] }; its full return is persisted to the
 * task output file as { ..., result: { records: [...] } }. This reads result.records (or a bare
 * array / {records:[]}), validates each record is JSON-clean with a kebab quoteSlug, and writes
 * data/quotes/{quoteSlug}.json. It does NOT build — run `node tools/build.js` after.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QUOTES_DIR = path.join(ROOT, 'data', 'quotes');

const src = process.argv[2];
if (!src) { console.error('usage: node tools/_ingest.js <workflow-output.json>'); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const records = Array.isArray(raw) ? raw
  : Array.isArray(raw.records) ? raw.records
  : (raw.result && Array.isArray(raw.result.records)) ? raw.result.records
  : null;
if (!records) { console.error('could not find a records[] array in ' + src); process.exit(1); }

// The template wraps these fields in block tags (<li>, <p class=...>). A model sometimes
// includes its own wrapper too, producing <li><li>… . Strip a single fully-enclosing outer
// <li>/<p> so the renderer's wrapper is the only one. Inline tags (<a>/<em>/<strong>) untouched.
function unwrap(s, tag) {
  if (typeof s !== 'string') return s;
  const re = new RegExp('^\\s*<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*)</' + tag + '>\\s*$');
  const m = s.match(re);
  return m ? m[1].trim() : s;
}
// copyAttribution is written to the clipboard / share sheet as PLAIN TEXT (template.js embeds it
// via JSON.stringify into JS, never HTML-decoded), so it must carry literal Unicode, not tags/entities.
function plainText(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&lsquo;/g, '‘').replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&hellip;/g, '…').replace(/&middot;/g, '·')
    .replace(/&nbsp;/g, ' ').replace(/&#8599;/g, '↗').replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
const kebab = (s) => String(s).toLowerCase().replace(/[’'‘`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function normalize(rec) {
  if (typeof rec.copyAttribution === 'string') rec.copyAttribution = plainText(rec.copyAttribution);
  // The Layer-1 name links to /authors/{slug} ONLY when the hero IS that author. On disputed/anonymous
  // pages the hero reads "Unknown"/"No verified author" while the author card documents the credited-
  // but-not-author figure; linking the hero to that hub is a name↔destination mismatch, so drop it.
  if (rec.answer && rec.answer.authorHref && rec.author) {
    const heroSlug = kebab(rec.answer.authorName || '');
    if (heroSlug !== (rec.author.slug || kebab(rec.author.name || ''))) delete rec.answer.authorHref;
  }
  const src = rec.source || {};
  if (Array.isArray(src.trail)) src.trail = src.trail.map((t) => unwrap(unwrap(t, 'li'), 'p'));
  if (typeof src.excerptNote === 'string') src.excerptNote = unwrap(src.excerptNote, 'p');
  if (rec.answer && typeof rec.answer.sourceLine === 'string') rec.answer.sourceLine = unwrap(rec.answer.sourceLine, 'p');
  const ctx = rec.context;
  if (ctx) {
    if (Array.isArray(ctx.lead)) ctx.lead = ctx.lead.map((p) => unwrap(p, 'p'));
    if (Array.isArray(ctx.detailsBody)) ctx.detailsBody = ctx.detailsBody.map((p) => unwrap(p, 'p'));
  }
  const m = rec.misattribution;
  if (m && Array.isArray(m.items)) m.items.forEach((it) => { if (typeof it.why === 'string') it.why = unwrap(it.why, 'p'); });
  if (Array.isArray(rec.externalLinks)) rec.externalLinks.forEach((l) => { if (typeof l.what === 'string') l.what = unwrap(l.what, 'p'); });
  return rec;
}

fs.mkdirSync(QUOTES_DIR, { recursive: true });
let written = 0;
const problems = [];
for (let rec of records) {
  if (!rec || typeof rec !== 'object') { problems.push('non-object record skipped'); continue; }
  rec = normalize(rec);
  const slug = rec.quoteSlug;
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) { problems.push(`bad/missing quoteSlug: ${JSON.stringify(slug)}`); continue; }
  const out = path.join(QUOTES_DIR, slug + '.json');
  fs.writeFileSync(out, JSON.stringify(rec, null, 2) + '\n');
  console.log(`  wrote data/quotes/${slug}.json  [${rec.confidence}]`);
  written++;
}
console.log(`Ingested ${written}/${records.length} record(s).`);
if (problems.length) { console.error('Problems:'); problems.forEach((p) => console.error('  ✗ ' + p)); process.exit(1); }
