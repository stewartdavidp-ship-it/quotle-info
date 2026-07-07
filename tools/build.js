#!/usr/bin/env node
'use strict';
/*
 * build.js — render every verified quote record into a prerendered static page.
 *
 *   data/quotes/{slug}.json  ──renderPage──▶  who-said/{slug}/index.html
 *                            └──────────────▶  data/manifest.json  (dayNumber → quoteSlug lookup)
 *
 * Clean-path URLs: writing who-said/{slug}/index.html makes quotle.info/who-said/{slug}
 * resolve with no extension and no query param on GitHub Pages / any static host.
 *
 * Usage:  node tools/build.js            (build)
 *         node tools/build.js --check    (build to memory, verify, don't write)
 */

const fs = require('fs');
const path = require('path');
const { renderPage, canonicalUrl } = require('./template');

const ROOT = path.resolve(__dirname, '..');
const QUOTES_DIR = path.join(ROOT, 'data', 'quotes');
const OUT_DIR = path.join(ROOT, 'who-said');
const MANIFEST = path.join(ROOT, 'data', 'manifest.json');
const CHECK = process.argv.includes('--check');

function loadRecords() {
  if (!fs.existsSync(QUOTES_DIR)) { console.error('no data/quotes dir'); process.exit(1); }
  return fs.readdirSync(QUOTES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const rec = JSON.parse(fs.readFileSync(path.join(QUOTES_DIR, f), 'utf8'));
      const expected = f.replace(/\.json$/, '');
      if (rec.quoteSlug !== expected) {
        throw new Error(`${f}: quoteSlug "${rec.quoteSlug}" must equal filename "${expected}"`);
      }
      return rec;
    });
}

function validateCorpus(records) {
  const slugs = new Set(records.map((r) => r.quoteSlug));
  const problems = [];
  const days = new Map();
  for (const r of records) {
    // slug collisions already impossible (filename-keyed); check dayNumber uniqueness
    if (r.dayNumber != null) {
      if (days.has(r.dayNumber)) problems.push(`dayNumber ${r.dayNumber} used by both ${days.get(r.dayNumber)} and ${r.quoteSlug}`);
      else days.set(r.dayNumber, r.quoteSlug);
    }
    // dangling internal references are allowed (target may not be built yet) but reported
    const refs = [];
    (r.related || []).forEach((x) => refs.push(x.slug));
    if (r.pager && r.pager.prev) refs.push(r.pager.prev.slug);
    if (r.pager && r.pager.next) refs.push(r.pager.next.slug);
    for (const ref of refs) if (!slugs.has(ref)) problems.push(`${r.quoteSlug}: internal link → /who-said/${ref} (not yet built)`);
  }
  return problems;
}

function build() {
  const records = loadRecords();
  console.log(`Loaded ${records.length} verified record(s).`);

  const problems = validateCorpus(records);
  const dangling = problems.filter((p) => p.includes('not yet built'));
  const hard = problems.filter((p) => !p.includes('not yet built'));
  if (hard.length) { hard.forEach((p) => console.error('  ✗ ' + p)); process.exit(1); }
  if (dangling.length) {
    console.log('  ℹ internal links awaiting future pages (not an error):');
    dangling.forEach((p) => console.log('     · ' + p.split(': ')[1]));
  }

  const manifest = [];
  for (const r of records) {
    const html = renderPage(r);
    manifest.push({
      dayNumber: r.dayNumber ?? null,
      quote: r.displayQuote,
      author: (r.author && r.author.name) || null,
      quoteSlug: r.quoteSlug,
      confidence: r.confidence,
      url: canonicalUrl(r.quoteSlug),
    });
    if (!CHECK) {
      const dir = path.join(OUT_DIR, r.quoteSlug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), html);
      console.log(`  ✓ who-said/${r.quoteSlug}/index.html  [${r.confidence}]`);
    } else {
      console.log(`  ✓ (check) ${r.quoteSlug}  [${r.confidence}]  ${html.length} bytes`);
    }
  }

  manifest.sort((a, b) => (a.dayNumber ?? 1e9) - (b.dayNumber ?? 1e9) || a.quoteSlug.localeCompare(b.quoteSlug));
  if (!CHECK) {
    fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`  ✓ data/manifest.json (${manifest.length} entries)`);
  }
  console.log('Done.');
}

build();
