#!/usr/bin/env node
'use strict';
/*
 * build-search.js — emit /search.json, the single index behind the universal search on every
 * page (see chrome.js). One flat array spanning all three domains:
 *   { t:'q', x:<quote>,  a:<author>, c:<confidence>, u:/who-said/{slug}/ }   verified quotes
 *   { t:'a', x:<name>,   n:<count>,               u:/authors/{slug}/ }        authors
 *   { t:'b', x:<quote>,  a:<author>, c:<category>, u:/flagged/?q={slug} }     under-review candidates
 * Kept lean (no precomputed lowercase — the client lowercases x+a on input). Run by build.js.
 */
const fs = require('fs');
const path = require('path');
const { hasAuthorPage } = require('./authors');
const { THEMES, isTheme } = require('./themes');
const ROOT = path.resolve(__dirname, '..');

const kebab = (s) => String(s).toLowerCase().replace(/[’'‘`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));

const entries = [];

// verified/attributed/disputed quotes
for (const m of manifest) entries.push({ t: 'q', x: m.quote, a: m.author, c: m.confidence, u: `/who-said/${m.quoteSlug}/` });

// authors (grouped from the manifest; skip anonymous/unknown placeholders that get no page)
const byAuthor = {};
for (const m of manifest) {
  const slug = kebab(m.author || '');
  if (!slug) continue;
  (byAuthor[slug] = byAuthor[slug] || { name: m.author, slug, n: 0 }).n++;
}
for (const slug of Object.keys(byAuthor)) {
  if (!hasAuthorPage(slug)) continue;
  const a = byAuthor[slug];
  entries.push({ t: 'a', x: a.name, n: a.n, u: `/authors/${a.slug}/` });
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
console.log(`  ✓ search.json (${entries.length}: ${n.q || 0} quotes, ${n.t || 0} themes, ${n.a || 0} authors, ${n.b || 0} under-review)`);
