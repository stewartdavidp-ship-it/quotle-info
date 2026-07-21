#!/usr/bin/env node
'use strict';
/*
 * audit-pages.js — post-build render audit. Run BEFORE pushing a wave.
 *
 * Why this exists: "JSON parses + build succeeded + verify-index verdict is right" does NOT prove
 * the HTML rendered correctly. This project has already shipped one real bug in exactly that gap
 * (esc() over-escaping trusted prose, so `<em>` surfaced as literal &lt;em&gt; on live pages —
 * fixed by escEm). Manual spot-checking drifts as waves get bigger: the first waves of 2026-07-20
 * got a full render check, the last four got none. This encodes the check so it can't quietly lapse.
 *
 * Checks each generated page for:
 *   1. the page exists at all
 *   2. every JSON-LD block parses, and a Quotation block is present (a CLAUDE.md RULE)
 *   3. no DOUBLE-escaped entities (&amp;mdash; etc.) — the escEm bug class
 *   4. no literal &lt;em&gt; leaking into visible output
 *   5. the displayQuote's distinctive words actually appear
 *   6. the named real author appears (skipped when the author is "Unknown")
 *
 *   node tools/audit-pages.js                 # audit every page in the corpus
 *   node tools/audit-pages.js --since 472     # only records with dayNumber >= 472 (a wave)
 *   node tools/audit-pages.js --slug foo,bar  # specific slugs
 *
 * Exits non-zero if anything fails, so it can gate a push.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const argOf = (flag) => { const i = argv.indexOf(flag); return i > -1 ? argv[i + 1] : null; };
const since = argOf('--since') ? Number(argOf('--since')) : null;
const slugs = argOf('--slug') ? argOf('--slug').split(',').map((s) => s.trim()) : null;

const DOUBLE_ESC = /&amp;(mdash|ndash|rsquo|lsquo|ldquo|rdquo|hellip|middot|nbsp|amp|eacute|egrave|uuml|ouml|auml|szlig|ccedil|sect|copy|reg);/g;

let recs = fs.readdirSync(path.join(ROOT, 'data', 'quotes'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'quotes', f), 'utf8')));
if (since != null) recs = recs.filter((r) => Number(r.dayNumber) >= since);
if (slugs) recs = recs.filter((r) => slugs.includes(r.quoteSlug));
recs.sort((a, b) => (a.dayNumber ?? 0) - (b.dayNumber ?? 0));

let failed = 0;
for (const r of recs) {
  const rel = path.join('who-said', r.quoteSlug, 'index.html');
  const abs = path.join(ROOT, rel);
  const problems = [];

  if (!fs.existsSync(abs)) {
    console.log(`✗ ${r.quoteSlug}\n     - page not generated (${rel})`);
    failed++;
    continue;
  }
  const html = fs.readFileSync(abs, 'utf8');

  // 2. JSON-LD
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  let parsed = 0, quotation = false;
  for (const b of blocks) {
    try {
      const j = JSON.parse(b[1]);
      parsed++;
      if (JSON.stringify(j).includes('Quotation')) quotation = true;
    } catch (e) { problems.push(`unparseable JSON-LD block: ${e.message}`); }
  }
  if (!parsed) problems.push('no JSON-LD block found');
  else if (!quotation) problems.push('no Schema.org Quotation in JSON-LD (CLAUDE.md RULE)');

  // 3. double-escaped entities
  const dbl = html.match(DOUBLE_ESC) || [];
  if (dbl.length) problems.push(`double-escaped entities x${dbl.length} (e.g. ${dbl[0]})`);

  // 4. literal em tags visible
  if (html.includes('&lt;em&gt;')) problems.push('literal &lt;em&gt; leaking into output');

  // 5. displayQuote words present
  const words = String(r.displayQuote || '').replace(/[^A-Za-z ]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 4).slice(0, 3);
  const missing = words.filter((w) => !html.includes(w));
  if (missing.length) problems.push(`displayQuote words absent from page: ${missing.join(', ')}`);

  // 6. real author present
  const real = (r.answer && r.answer.authorName) || '';
  if (real && real !== 'Unknown' && !html.includes(real.split(' ')[0])) {
    problems.push(`author name absent from page: ${real}`);
  }

  if (problems.length) {
    failed++;
    console.log(`✗ ${r.quoteSlug}`);
    problems.forEach((p) => console.log(`     - ${p}`));
  } else {
    console.log(`✓ ${String(r.dayNumber ?? '—').padStart(4)}  ${r.quoteSlug.slice(0, 56)}`);
  }
}

console.log('');
if (failed) {
  console.log(`*** ${failed} of ${recs.length} page(s) FAILED — do not push ***`);
  process.exit(1);
}
console.log(`All ${recs.length} page(s) clean.`);
