#!/usr/bin/env node
'use strict';
/*
 * build-search.js — emit /search.json, the single index behind the universal search on every
 * page (see chrome.js). One flat array spanning every domain:
 *   { t:'q', x:<quote>,  a:<author>, c:<confidence>,      u:/who-said/{slug}/ }      verified quotes
 *   { t:'s', x:<title>,  a:<credited/original blurb>,     u:/who-recorded/{slug}/ }  song misattributions
 *   { t:'a', x:<name>,   n:<quotes>, ns:<songs>,          u:/authors/{slug}/ }       authors (quotes + songs)
 *   { t:'b', x:<quote>,  a:<author>, c:<category>,        u:/flagged/?q={slug} }     under-review candidates
 * Kept lean (no precomputed lowercase — the client lowercases x+a on input). Run by build.js.
 */
const fs = require('fs');
const path = require('path');
const { THEMES, isTheme } = require('./themes');
const ROOT = path.resolve(__dirname, '..');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
// Records, songs and the author aggregation come from corpus.js — the SAME objects build-authors
// renders pages from, so a search result can never point at a hub that was not built, and the
// index's author count can never disagree with the site's. (Counting authors here independently,
// from the manifest, is precisely what produced "526" in search against 593 real hubs.)
const { records, songs, authors: hubAuthors } = require('./corpus');

const entries = [];

// verified/attributed/disputed quotes
for (const m of manifest) entries.push({ t: 'q', x: m.quote, a: m.author, c: m.confidence, u: `/who-said/${m.quoteSlug}/` });

// song misattributions (a is the credited/original blurb so the song is findable by either artist)
const stripTags = (s) => String(s == null ? '' : s).replace(/<[^>]+>/g, '');
for (const s of songs) {
  const orig = (s.answer && s.answer.originalArtist) || '';
  entries.push({ t: 's', x: s.title, a: stripTags(`Credited to ${s.creditedTo} · first recorded by ${orig}`), u: `/who-recorded/${s.songSlug}/` });
}

// authors (quotes + songs) — from the authoritative hub aggregation; carries a quote count (n) and a song count (ns)
for (const a of hubAuthors) {
  entries.push({ t: 'a', x: a.name, n: a.quotes.length, ns: a.songs.length, u: `/authors/${a.slug}/` });
}

// themes (count usable = verified+attributed quotes per theme, from the records' themes[])
const themeCount = {};
try {
  const QDIR = path.join(ROOT, 'data', 'quotes');
  for (const f of fs.readdirSync(QDIR)) {
    if (!f.endsWith('.json')) continue;
    const r = JSON.parse(fs.readFileSync(path.join(QDIR, f), 'utf8'));
    if (r.confidence === 'disputed' || !Array.isArray(r.themes)) continue;
    for (const th of r.themes) if (isTheme(th)) themeCount[th] = (themeCount[th] || 0) + 1;
  }
} catch (_) { /* records optional */ }
for (const t of THEMES) {
  if (!themeCount[t.slug]) continue;
  entries.push({ t: 't', x: t.label, n: themeCount[t.slug], u: `/themes/${t.slug}/` });
}

// under-review candidates
try {
  const hq = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'harvest-queue.json'), 'utf8'));
  for (const c of (hq.candidates || [])) {
    if (c.status !== 'queued' || !c.slug) continue;
    entries.push({ t: 'b', x: c.quote, a: c.magnetAuthor || '', c: c.category, u: `/flagged/?q=${c.slug}` });
  }
} catch (_) { /* backlog optional */ }

fs.writeFileSync(path.join(ROOT, 'search.json'), JSON.stringify(entries));
const n = entries.reduce((m, e) => (m[e.t] = (m[e.t] || 0) + 1, m), {});
console.log(`  ✓ search.json (${entries.length}: ${n.q || 0} quotes, ${n.s || 0} songs, ${n.t || 0} themes, ${n.a || 0} authors, ${n.b || 0} under-review)`);
