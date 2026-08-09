#!/usr/bin/env node
'use strict';
/*
 * rank-backlog.js — order the harvest queue by DEMAND, so waves get built most-checked-first.
 *
 * Why: quotle.info does not compete with Wikiquote on breadth — the /check flow refers the long
 * tail there. Our job is primary-source validation and correct attribution for the lines people
 * ACTUALLY use, because those are the lines people actually come to check. A 1,000-entry queue
 * worked in arbitrary order builds 9 Coco Chanel pages (2.3K annual lookups) before 6 Einstein
 * ones (88K). This scores every pending candidate so that can't happen.
 *
 * Signal: Wikimedia pageviews for the magnet author's en.wikiquote page over the last 12 months
 * (falls back to en.wikipedia). That is a direct, public measure of "how often do people look up
 * what this person said" — the closest honest proxy for check-demand we can get without a
 * keyword tool. Weighted by category, because a line someone suspects is fake gets checked far
 * more than one nobody doubts.
 *
 * Writes `demandViews`, `demandScore`, `demandRank` back onto each queued candidate, caches the
 * per-author view counts in data/demand-cache.json, and prints the top of the worklist.
 *
 *   node tools/rank-backlog.js            # rank (uses cache where present)
 *   node tools/rank-backlog.js --refresh  # ignore cache, re-fetch every author
 */
const fs = require('fs');
const path = require('path');
const { save } = require('./harvest');

const ROOT = path.resolve(__dirname, '..');
const QUEUE = path.join(ROOT, 'data', 'harvest-queue.json');
const CACHE = path.join(ROOT, 'data', 'demand-cache.json');
const UA = 'quotle.info-backlog-ranking/1.0 (+https://quotle.info; stewartd@runmast.com)';
const REFRESH = process.argv.includes('--refresh');

// People check what they doubt. A famous-but-undisputed line is looked up less often than one
// carrying a suspicious attribution, so misattributions earn a premium on the same author demand.
const CATEGORY_WEIGHT = {
  'misattributed': 1.5,
  'science-tech-misattribution': 1.45,
  'disputed': 1.4,
  'film-misquote': 1.3,
  'scripture-misquote': 1.3,
  'genuine-famous': 1.0,
};

const FROM = '2025070100', TO = '2026063000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function viewsFor(name, project) {
  const page = encodeURIComponent(String(name).trim().replace(/\s+/g, '_'));
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${project}/all-access/user/${page}/monthly/${FROM}/${TO}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || !Array.isArray(d.items)) return null;
    return d.items.reduce((a, b) => a + (b.views || 0), 0);
  } catch (_) { return null; }
}

(async () => {
  const queue = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  const cache = fs.existsSync(CACHE) && !REFRESH ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

  const pending = queue.candidates.filter((c) => c.status === 'queued');
  const authors = [...new Set(pending.map((c) => c.magnetAuthor).filter((a) => a && a !== '?'))];
  const missing = authors.filter((a) => !(a in cache));
  console.log(`Pending candidates: ${pending.length} · distinct magnet authors: ${authors.length} · to fetch: ${missing.length}`);

  for (let i = 0; i < missing.length; i++) {
    const a = missing[i];
    let v = await viewsFor(a, 'en.wikiquote.org');
    let src = 'wikiquote';
    if (v == null) { v = await viewsFor(a, 'en.wikipedia.org'); src = v == null ? 'none' : 'wikipedia'; }
    // A Wikipedia page is a weaker signal of quote-lookup intent than a Wikiquote page, so
    // discount it rather than letting a merely-famous subject outrank a heavily-quoted one.
    cache[a] = { views: v || 0, source: src, scaled: src === 'wikipedia' ? Math.round((v || 0) * 0.15) : (v || 0) };
    if ((i + 1) % 20 === 0 || i === missing.length - 1) console.log(`  fetched ${i + 1}/${missing.length}`);
    await sleep(110); // be polite to the Wikimedia API
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));

  for (const c of pending) {
    const hit = cache[c.magnetAuthor];
    const views = hit ? hit.scaled : 0;
    c.demandViews = views;
    c.demandScore = Math.round(views * (CATEGORY_WEIGHT[c.category] || 1));
  }
  // Tie-break on slug, or demandRank is not reproducible. Demand is heavily tied — the score is an
  // author-level pageview count, so every quote by one author scores identically: 127 tied groups
  // here, the largest holding 60 candidates. Sorting on score ALONE leaves those in array order, so
  // once save() reorders the file the next run assigns them different ranks and the queue churns
  // forever. Surfaced the moment this script started writing through save(); it was masked before
  // only because rank-backlog re-read the order it had itself written.
  const ranked = [...pending].sort((a, b) =>
    b.demandScore - a.demandScore ||
    String(a.slug).localeCompare(String(b.slug)));
  ranked.forEach((c, i) => { c.demandRank = i + 1; });

  // Write through harvest.js's save(), NOT a bare writeFileSync. demandScore is the FIRST key the
  // canonical sort orders on, so ranking necessarily changes the queue's order — and this used to
  // write the file without applying that sort, refreshing the derived meta counts, or rebuilding the
  // digest and backlog-index. A harvest-only run stops right here, so the non-canonical order got
  // committed and the next harvest.js command rewrote three files (PR #336, one red CI run).
  // A normal wave hid it: rank is followed by select/batch, which calls save() and absorbs it.
  save(queue);

  const unresolved = pending.filter((c) => !c.demandViews).length;
  console.log(`\nRanked ${pending.length} pending candidates (${unresolved} with no demand signal — need a manual look).\n`);
  console.log('TOP 30 — build these first:');
  ranked.slice(0, 30).forEach((c) => {
    const cat = (c.category || '').padEnd(14);
    console.log(`  ${String(c.demandRank).padStart(3)}. ${String(c.demandScore).padStart(7)}  ${cat} ${(c.magnetAuthor || '?').padEnd(20).slice(0, 20)} "${String(c.quote).slice(0, 52)}"`);
  });
})();
