#!/usr/bin/env node
'use strict';
/*
 * _ingest-songs.js — write generated song records into data/songs/.
 * The songs equivalent of tools/_ingest.js.
 *
 *   node tools/_ingest-songs.js <records.json>          # from workflows/prep-songs.js
 *   node tools/_ingest-songs.js <records.json> --force  # allow overwriting existing records
 *
 * Accepts a bare array, {records:[...]}, or a Workflow return persisted as {result:{records:[...]}}.
 * It does NOT build — run `node tools/build.js` after (which runs validate-songs.js as a gate).
 *
 * WHY --force EXISTS AND IS NOT THE DEFAULT: all 27 original song records were written straight into
 * data/songs/ by agents, and a wave that silently overwrote a reviewed page would be invisible in a
 * green build. An existing slug is a STOP by default; re-running a wave to fix one song is an
 * explicit act.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SONGS_DIR = path.join(ROOT, 'data', 'songs');

const src = process.argv[2];
const FORCE = process.argv.includes('--force');
if (!src) { console.error('usage: node tools/_ingest-songs.js <records.json> [--force]'); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const records = Array.isArray(raw) ? raw
  : Array.isArray(raw.records) ? raw.records
  : (raw.result && Array.isArray(raw.result.records)) ? raw.result.records
  : null;
if (!records) { console.error('could not find a records[] array in ' + src); process.exit(1); }

// The template wraps these fields in block tags. A model sometimes includes its own wrapper too,
// producing <li><li>… . Strip a single fully-enclosing outer <li>/<p> so the renderer's wrapper is
// the only one. Inline tags (<a>/<em>/<strong>) are left alone.
function unwrap(s, tag) {
  if (typeof s !== 'string') return s;
  const m = s.match(new RegExp('^\\s*<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*)</' + tag + '>\\s*$'));
  return m ? m[1].trim() : s;
}

const { slugify } = require('./slugify');

function normalize(rec) {
  const o = rec.original;
  if (o) {
    if (Array.isArray(o.trail)) o.trail = o.trail.map((t) => unwrap(unwrap(t, 'li'), 'p'));
    if (typeof o.released === 'string') o.released = unwrap(o.released, 'p');
    // sourceLink.text must not carry its own arrow — the renderer appends one, and two arrows on a
    // link is the exact defect the quote pipeline documents for source.sourceLink.
    if (o.sourceLink && typeof o.sourceLink.text === 'string') o.sourceLink.text = o.sourceLink.text.replace(/\s*[↗→]\s*$/, '').trim();
  }
  if (rec.answer && typeof rec.answer.sourceLine === 'string') rec.answer.sourceLine = unwrap(rec.answer.sourceLine, 'p');
  const c = rec.context;
  if (c) {
    if (Array.isArray(c.lead)) c.lead = c.lead.map((p) => unwrap(p, 'p'));
    if (Array.isArray(c.detailsBody)) c.detailsBody = c.detailsBody.map((p) => unwrap(p, 'p'));
  }
  const m = rec.misattribution;
  if (m && Array.isArray(m.items)) m.items.forEach((it) => { if (typeof it.why === 'string') it.why = unwrap(it.why, 'p'); });
  if (Array.isArray(rec.externalLinks)) rec.externalLinks.forEach((l) => { if (typeof l.what === 'string') l.what = unwrap(l.what, 'p'); });
  if (Array.isArray(rec.authors)) rec.authors.forEach((a) => {
    if (typeof a.bio === 'string') a.bio = unwrap(a.bio, 'p');
    // Re-derive the slug rather than trusting the field: an entity-blind slug silently broke
    // authorHref for every accented author in the quote pipeline before it was centralised.
    if (a.name) a.slug = slugify(a.name);
  });
  if (rec.answer && rec.answer.originalArtist) rec.answer.originalArtistSlug = slugify(rec.answer.originalArtist);
  return rec;
}

fs.mkdirSync(SONGS_DIR, { recursive: true });
let written = 0, skipped = 0;
const problems = [];
for (let rec of records) {
  if (!rec || typeof rec !== 'object') { problems.push('non-object record skipped'); continue; }
  const slug = rec.songSlug;
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) { problems.push(`bad/missing songSlug: ${JSON.stringify(slug)}`); continue; }
  const out = path.join(SONGS_DIR, slug + '.json');
  if (fs.existsSync(out) && !FORCE) {
    problems.push(`${slug}: a record already exists — refusing to overwrite (pass --force if that is what you mean)`);
    skipped++; continue;
  }
  rec = normalize(rec);
  fs.writeFileSync(out, JSON.stringify(rec, null, 2) + '\n');
  console.log(`  wrote data/songs/${slug}.json  [${rec.confidence}]`);
  written++;
}
console.log(`Ingested ${written}/${records.length} song record(s)${skipped ? ` · ${skipped} skipped (already exist)` : ''}.`);
console.log('Next: node tools/build.js   (runs validate-songs.js as a gate), then `node tools/songs.js sync` to sweep the queue.');
if (problems.length) { console.error('Problems:'); problems.forEach((p) => console.error('  ✗ ' + p)); process.exit(1); }
