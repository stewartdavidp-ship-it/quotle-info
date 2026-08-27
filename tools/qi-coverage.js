#!/usr/bin/env node
'use strict';
/*
 * qi-coverage.js — how much of Quote Investigator do we have, and what is still missing?
 *
 * WHY THIS EXISTS
 * The stated goal is that quotle.info eventually carries every quote Quote Investigator has,
 * plus more. That is only a goal if it is a number, and until 2026-08-27 nobody had computed it.
 * The answer that day: QI had 2,444 articles, we cited 614 of them (25.1%), and 1,810 were
 * missing entirely. Re-run this whenever you want the real figure instead of a feeling.
 *
 * THE GAP LIST IS ALSO A BACKLOG RANKING
 * QI's corpus IS the demand curve for contested attribution — fifteen years of Garson O'Toole
 * choosing which quotes people actually argue about. Our own backlog (data/demand-cache.json)
 * ranks by AUTHOR FAME, which is a different and worse signal: the pages that actually earn
 * AI-assistant referrals are famous MISATTRIBUTIONS, not famous authors. So `--gap` is not just
 * a deficit report, it is a ready-made work queue ordered by someone else's editorial judgment.
 *
 * WHY CITATION COUNT IS A FAIR PROXY FOR COVERAGE
 * "We cite the QI article" is not literally "we have a page for that quote" — a record can cite
 * QI as supporting evidence for a different quote, and we could cover a QI quote while citing
 * Wikiquote instead. Both directions were tested on 2026-08-27 by pulling titles for 30 random
 * gap articles and token-matching them against every displayQuote in the corpus: 27 of 27 fetched
 * were genuine gaps, none were quotes we already had under another citation. The proxy holds.
 * If that ever stops being true you will see it as a gap list full of quotes you recognise.
 *
 * URL NORMALISATION IS THE WHOLE GAME
 * Records cite QI in several shapes: with and without protocol, with and without www, with a
 * trailing sentence period glued on ("...permanent-link/."), with #anchors and ?query. A naive
 * grep reports ~1,486 "distinct" URLs where there are 710. Everything funnels through norm().
 *
 * USAGE
 *   node tools/qi-coverage.js            # the coverage table + gap by publication year
 *   node tools/qi-coverage.js --refresh  # re-fetch QI's sitemap first (writes the cache)
 *   node tools/qi-coverage.js --gap      # print the missing QI URLs, one per line
 *   node tools/qi-coverage.js --stale    # print QI URLs we cite that QI no longer lists
 *   node tools/qi-coverage.js --json     # machine-readable
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QDIR = path.join(ROOT, 'data/quotes');
const CACHE = path.join(ROOT, 'data/qi-sitemap.json');
const QUEUE = path.join(ROOT, 'data/harvest-queue.json');

// WordPress core sitemap. QI's /sitemap.xml 301s into nothing and /sitemap_index.xml is a 404 —
// this is the only index that actually resolves. It paginates at 2,000 posts per file.
const INDEX = 'https://quoteinvestigator.com/wp-sitemap.xml';
const UA = 'quotle.info coverage audit (+https://quotle.info/)';
const STALE_DAYS = 30;

// Any QI reference -> one canonical string. Protocol optional because harvest-queue.json stores
// them bare ("quoteinvestigator.com/2013/06/12/before-dark/") while records store them absolute.
const RE = /(?:https?:\/\/)?(?:www\.)?quoteinvestigator\.com\/[^"'\s\\)]*/g;

function norm(u) {
  let x = u.trim();
  if (!/^https?:/.test(x)) x = 'https://' + x;
  x = x.replace(/^http:/, 'https:').replace(/\/\/www\./, '//');
  x = x.split('#')[0].split('?')[0];
  x = x.replace(/[.,;:)\]]+\/?$/, '');   // trailing sentence punctuation captured by the regex
  if (!x.endsWith('/')) x += '/';
  return x.toLowerCase();
}

// Articles only. QI's sitemap is all dated posts, but category/tag/about URLs turn up in our
// records and must not be counted as coverage of anything.
const isArticle = (u) => /^https:\/\/quoteinvestigator\.com\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/$/.test(u);

const qiRefs = (text) => (text.match(RE) || []).map(norm).filter(isArticle);

async function fetchSitemap() {
  const get = async (url) => {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
    return res.text();
  };
  const index = await get(INDEX);
  const parts = [...index.matchAll(/<loc>([^<]*posts-post[^<]*)<\/loc>/g)].map((m) => m[1]);
  if (!parts.length) throw new Error(`no post sitemaps in ${INDEX} — QI changed their sitemap layout`);
  const urls = [];
  for (const p of parts) {
    const xml = await get(p);
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(m[1]);
  }
  const posts = [...new Set(urls.map(norm).filter(isArticle))].sort();
  fs.writeFileSync(CACHE, JSON.stringify({ fetchedAt: new Date().toISOString(), source: INDEX, posts }, null, 0) + '\n');
  return posts;
}

function loadCache() {
  if (!fs.existsSync(CACHE)) return null;
  return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);

  let cache = has('--refresh') ? null : loadCache();
  if (!cache) {
    if (!has('--json')) process.stderr.write('fetching QI sitemap...\n');
    const posts = await fetchSitemap();
    cache = loadCache() || { fetchedAt: new Date().toISOString(), posts };
  }
  const theirs = new Set(cache.posts);
  const ageDays = Math.round((Date.now() - Date.parse(cache.fetchedAt)) / 86400000);

  // --- ours: shipped records ---
  const cited = new Set();
  let recordCount = 0, recordsCitingQI = 0;
  for (const f of fs.readdirSync(QDIR)) {
    if (!f.endsWith('.json')) continue;
    recordCount++;
    const refs = qiRefs(fs.readFileSync(path.join(QDIR, f), 'utf8'));
    if (refs.length) recordsCitingQI++;
    refs.forEach((u) => cited.add(u));
  }

  // --- queued: harvest backlog not yet ingested ---
  const queued = new Set();
  if (fs.existsSync(QUEUE)) {
    const q = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
    const open = (q.candidates || []).filter((c) => c.status !== 'ingested');
    qiRefs(JSON.stringify(open)).forEach((u) => { if (!cited.has(u)) queued.add(u); });
  }

  const covered = [...theirs].filter((u) => cited.has(u));
  const inQueue = [...theirs].filter((u) => !cited.has(u) && queued.has(u));
  const gap = [...theirs].filter((u) => !cited.has(u) && !queued.has(u)).sort();
  // A QI URL we cite that QI no longer lists: renamed permalink (they 301) or a dead reference.
  const stale = [...cited].filter((u) => !theirs.has(u)).sort();

  if (has('--gap')) { console.log(gap.join('\n')); return; }
  if (has('--stale')) { console.log(stale.join('\n')); return; }

  const pct = (n) => ((100 * n) / theirs.size).toFixed(1) + '%';
  const target = theirs.size + (recordCount - covered.length);

  if (has('--json')) {
    console.log(JSON.stringify({
      fetchedAt: cache.fetchedAt, qiArticles: theirs.size, records: recordCount, recordsCitingQI,
      covered: covered.length, queued: inQueue.length, gap: gap.length, stale, targetCorpus: target,
    }, null, 2));
    return;
  }

  console.log(`\nQuote Investigator coverage  (sitemap fetched ${cache.fetchedAt.slice(0, 10)}, ${ageDays}d ago)\n`);
  console.log(`  QI articles:        ${String(theirs.size).padStart(5)}`);
  console.log(`  quotle.info records:${String(recordCount).padStart(5)}   (${recordsCitingQI} cite QI)\n`);
  console.log(`  COVERED  we cite the article   ${String(covered.length).padStart(5)}  ${pct(covered.length)}`);
  console.log(`  QUEUED   in harvest backlog    ${String(inQueue.length).padStart(5)}  ${pct(inQueue.length)}`);
  console.log(`  GAP      neither               ${String(gap.length).padStart(5)}  ${pct(gap.length)}`);
  console.log(`\n  Records citing no QI article: ${recordCount - recordsCitingQI}  <- territory QI does not cover`);
  console.log(`  "everything QI has + more" =  ${target} records; we are at ${recordCount}.`);
  if (stale.length) {
    console.log(`\n  ${stale.length} stale cite(s) — QI no longer lists these (renamed permalink?). --stale to list.`);
  }

  const year = (u) => (u.match(/\.com\/(\d{4})\//) || [])[1];
  const gapBy = {}, allBy = {};
  gap.forEach((u) => { gapBy[year(u)] = (gapBy[year(u)] || 0) + 1; });
  [...theirs].forEach((u) => { allBy[year(u)] = (allBy[year(u)] || 0) + 1; });
  console.log('\n  Gap by QI publication year (missing / total / % held):');
  Object.keys(allBy).sort().forEach((y) => {
    const g = gapBy[y] || 0, t = allBy[y];
    const held = Math.round((100 * (t - g)) / t);
    console.log(`    ${y}  ${String(g).padStart(4)} / ${String(t).padStart(4)}   ${String(held).padStart(3)}%  ${'#'.repeat(Math.round(held / 4))}`);
  });

  if (ageDays > STALE_DAYS) {
    console.log(`\n  ! Sitemap cache is ${ageDays} days old. QI publishes ~10/month — run --refresh.`);
  }
  console.log('');
}

main().catch((e) => { console.error('qi-coverage: ' + e.message); process.exit(1); });
