#!/usr/bin/env node
'use strict';
/*
 * harvest-dedup.js — turn a harvest-candidates workflow output into a prioritized,
 * deduped candidate queue for the ingestion pipeline.
 *
 *   node harvest-dedup.js <harvest-output.json> [--out queue.json]
 *
 * Reads result.candidates[], dedups (a) against the live corpus in
 * <repo>/data/quotes/*.json by slug AND normalized text, and (b) within the harvest
 * itself; prioritizes (misattributed/disputed before genuine-famous; then by rights/
 * confidence value); prints a human-readable queue and writes queue.json.
 */
const fs = require('fs');
const path = require('path');

const REPO = '/Users/davidstewart/Developer/quotle-info';
const QUOTES_DIR = path.join(REPO, 'data', 'quotes');

const src = process.argv[2];
if (!src) { console.error('usage: node harvest-dedup.js <harvest-output.json> [--out queue.json]'); process.exit(1); }
const outIdx = process.argv.indexOf('--out');
const outPath = outIdx > -1 ? process.argv[outIdx + 1] : path.join(path.dirname(src), 'harvest-queue.json');

// --- same slugify the records were built with (so a match means an existing page) ---
// Resolved from __dirname, not REPO: REPO is a hardcoded absolute path, so a checkout elsewhere
// (e.g. a git worktree) would load the wrong copy of this file — or fail to find it at all.
const { slugify } = require(path.join(__dirname, '..', 'tools', 'slugify.js'));
// looser normalization for fuzzy text-equality dedup (ignores length cap + all punctuation)
function norm(text) {
  return String(text).toLowerCase()
    .replace(/[’'‘`"“”]/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().replace(/\s+/g, ' ');
}

// --- load existing corpus ---
const existingSlugs = new Set();
const existingNorms = new Set();
for (const f of fs.readdirSync(QUOTES_DIR)) {
  if (!f.endsWith('.json')) continue;
  existingSlugs.add(f.replace(/\.json$/, ''));
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(QUOTES_DIR, f), 'utf8'));
    if (rec.displayQuote) existingNorms.add(norm(rec.displayQuote));
  } catch (_) {}
}

// --- load harvest output ---
const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const candidates = Array.isArray(raw) ? raw
  : Array.isArray(raw.candidates) ? raw.candidates
  : (raw.result && Array.isArray(raw.result.candidates)) ? raw.result.candidates
  : null;
if (!candidates) { console.error('no candidates[] found in ' + src); process.exit(1); }

// --- dedup ---
const seen = new Set();
const kept = [];
const dropped = { corpus: 0, intra: 0 };
for (const c of candidates) {
  const q = (c.quote || '').trim().replace(/^["“]|["”]$/g, '');
  if (!q) continue;
  const slug = slugify(q.replace(/\s*\.\s*$/, ''));
  const n = norm(q);
  if (existingSlugs.has(slug) || existingNorms.has(n)) { dropped.corpus++; continue; }
  if (seen.has(n)) { dropped.intra++; continue; }
  seen.add(n);
  kept.push({ ...c, quote: q, slug });
}

// --- prioritize ---
const catRank = { misattributed: 0, disputed: 1, 'genuine-famous': 2 };
const rightsRank = { 'public-domain': 0, uncertain: 1, 'in-copyright': 2 };
kept.sort((a, b) =>
  (catRank[a.category] ?? 3) - (catRank[b.category] ?? 3) ||
  (rightsRank[a.rightsEra] ?? 3) - (rightsRank[b.rightsEra] ?? 3) ||
  String(a.magnetAuthor).localeCompare(String(b.magnetAuthor))
);

fs.writeFileSync(outPath, JSON.stringify(kept, null, 2) + '\n');

// --- report ---
const byCat = kept.reduce((m, c) => (m[c.category] = (m[c.category] || 0) + 1, m), {});
const byRights = kept.reduce((m, c) => (m[c.rightsEra] = (m[c.rightsEra] || 0) + 1, m), {});
console.log(`\n=== HARVEST QUEUE (${kept.length} candidates) ===`);
console.log(`dropped: ${dropped.corpus} already-in-corpus, ${dropped.intra} intra-harvest dupes`);
console.log(`category: ${JSON.stringify(byCat)}   rights-era: ${JSON.stringify(byRights)}\n`);
kept.forEach((c, i) => {
  console.log(`${String(i + 1).padStart(2)}. [${c.category}/${c.likelyConfidence}/${c.rightsEra}] "${c.quote}"`);
  console.log(`    magnet: ${c.magnetAuthor}${c.trueOrigin ? `  → true origin: ${c.trueOrigin}` : ''}`);
  console.log(`    why: ${c.whyNotable}`);
  console.log(`    doc: ${c.documentedAt}`);
});
console.log(`\nqueue written to ${outPath}`);
