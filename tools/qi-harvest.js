#!/usr/bin/env node
'use strict';
/*
 * qi-harvest.js — turn the Quote Investigator coverage gap into harvest candidates.
 *
 * WHY THIS EXISTS
 * tools/qi-coverage.js measures the gap (2026-08-27: 2,444 QI articles, 1,809 we do not cite).
 * That list is the best backlog ranking available to this project — fifteen years of Garson
 * O'Toole choosing which attributions people actually argue over — but a list of URLs is not a
 * work queue. This turns it into one, in the shape tools/harvest.js sync already accepts.
 *
 * It matters now because the queue ran out of the good stuff. After wave r45 the backlog holds
 * 160 candidates: 26 contested and 134 genuine-famous residue. Measured against real traffic,
 * disputed pages take 80.3% of quote-page visits on 52.6% of the corpus while verified pages take
 * 14.7% on 35.7% — so building the residue is building the weak half. QI's corpus is ~all
 * contested by construction, which is exactly the missing supply.
 *
 * NO AGENT PASS, AND THAT IS DELIBERATE
 * Everything needed is in each article's own markup, so this is plain fetch-and-parse:
 *   - <title>              → the quote        ("Quote Origin: <QUOTE> – Quote Investigator®")
 *   - rel="category tag"   → the people involved (QI tags every article with them)
 *   - "In conclusion, …"   → who QI says should get the credit
 * An agent pass here would cost a wave of tokens to re-read pages that already say this in
 * structured form, and would introduce hallucination risk into a file whose whole job is to be a
 * faithful index of someone else's work.
 *
 * THE FIELDS ARE HINTS, NOT FINDINGS
 * category / likelyConfidence / trueOrigin are inferred from that markup to drive SELECTION ORDER
 * (rank-backlog.js weights misattributed 1.5x) — they are not published. The ingestion agent does
 * the real research and is handed `documentedAt` = the QI URL so it starts at the source. Anything
 * not confidently derivable is left EMPTY rather than guessed; an empty field is honest and a
 * wrong one silently mis-ranks a wave.
 *
 * TITLE CASE IS NOT A BUG HERE
 * QI titles are Title Cased, so the `quote` this emits is too. harvest.js norm() lowercases before
 * deduping and prep-wave takes the record's displayQuote from the ingestion agent, not from the
 * batch text, so casing does not propagate to a page. Do not "fix" it with a de-title-caser —
 * that would corrupt proper nouns for no gain.
 *
 * !! FUZZY DEDUP IS THE POINT OF THIS FILE, NOT A FEATURE OF IT
 * harvest.js sync dedupes on norm(), which is exact after case/punctuation folding. Wording
 * variants sail straight through. Wave r45 shipped
 * "He who has a why to live can bear WITH almost any how" against an existing
 * "...can bear almost any how" — two canonical pages for one aphorism publishing OPPOSITE
 * confidence values. That was ONE variant from a hand-drawn wave; this file can propose 1,809 at
 * once, and QI titles are wording variants by nature. So candidates are token-overlap checked
 * against the corpus AND the backlog before emission.
 * Near-misses are WRITTEN TO A REPORT, never silently dropped — a wording variant is sometimes a
 * legitimately distinct popular form (the corpus deliberately carries both "we're/you're gonna
 * need a bigger boat"). Review the report; the tool does not get to decide that.
 *
 * USAGE
 *   node tools/qi-harvest.js --status          # fetched vs remaining in the gap
 *   node tools/qi-harvest.js --fetch 100       # fetch the next N uncached gap articles (polite, resumable)
 *   node tools/qi-harvest.js --emit            # cache → harvest-input JSON + near-miss report
 *   node tools/qi-harvest.js --emit --contested --limit 300   # the usual call: bounded + contested-first
 * Then:  node tools/harvest.js sync <the emitted file>  &&  node tools/rank-backlog.js
 *
 * !! THE CACHE IS THE RESERVOIR; THE QUEUE IS A WORKING SET. Do not sync all 1,809 at once.
 * under-review/ renders the WHOLE queue as one page: syncing the full gap took it from 233 KB to
 * 2.1 MB (9x) and search.json from 509 KB to 822 KB. This site's stated rule is being clean and
 * fast, so a 2.1 MB page is a regression, not a milestone. Keep the queue a few hundred deep and
 * top up as waves drain it — data/qi-articles.json is committed, so a top-up is --emit + sync with
 * no re-fetch of anyone's server.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'qi-articles.json');   // fetched article metadata
const SITEMAP = path.join(ROOT, 'data', 'qi-sitemap.json');
const QUOTES = path.join(ROOT, 'data', 'quotes');
const BACKLOG = path.join(ROOT, 'data', 'harvest-queue.json');
const UA = 'quotle.info coverage audit (+https://quotle.info/)';
const DELAY_MS = 1100;   // be a good citizen; QI is one person's site

const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const has = (f) => process.argv.includes(f);

// ---------- shared text helpers ----------
const ENT = { '&#8211;': '-', '&#8212;': '—', '&#8217;': "'", '&#8216;': "'", '&#8220;': '"', '&#8221;': '"', '&amp;': '&', '&#038;': '&', '&quot;': '"', '&#8230;': '…', '&nbsp;': ' ', '&lt;': '<', '&gt;': '>' };
const decode = (s) => String(s || '')
  .replace(/&#8\d{3};|&amp;|&#038;|&quot;|&nbsp;|&lt;|&gt;/g, (m) => ENT[m] ?? m)
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/\s+/g, ' ').trim();

const STOP = new Set(['the','a','an','of','to','is','in','and','that','it','you','for','with','be','not','on','as','but','are','was','his','her','their','they','i','we','he','she','have','has','had','will','can','do','does','at','by','from','or','if','this','there','what','who','when','all','more','than','so','my','your','one','no','any','been','were','would','about']);
const bag = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
// Overlap as intersection/min(sizes), with TWO floors that are not optional.
// Without them this measure is worthless on short quotes: "The way to do is to be" reduces to the
// single token {way}, so min(size)=1 and EVERY candidate containing "way" scores a perfect 1.00.
// On the first 60-article tranche that produced 3 false duplicates out of 5 and all 4 review
// flags — i.e. it would have silently discarded real candidates at scale. Require both bags to
// carry real content AND require an absolute number of shared tokens, so a match has to be earned
// by substance rather than by one side being nearly empty.
const MIN_BAG = 4, MIN_SHARED = 4;
const overlap = (a, b) => {
  if (a.size < MIN_BAG || b.size < MIN_BAG) return 0;
  let i = 0; a.forEach((w) => { if (b.has(w)) i++; });
  if (i < MIN_SHARED) return 0;
  return i / Math.min(a.size, b.size);
};

// ---------- gap (mirrors qi-coverage.js) ----------
function gapUrls() {
  if (!fs.existsSync(SITEMAP)) { console.error('qi-harvest: data/qi-sitemap.json missing — run `node tools/qi-coverage.js --refresh` first.'); process.exit(1); }
  const out = execFileSync('node', [path.join(__dirname, 'qi-coverage.js'), '--gap'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

const loadCache = () => (fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : { fetchedAt: null, articles: {} });
const saveCache = (c) => fs.writeFileSync(CACHE, JSON.stringify(c, null, 0) + '\n');

// ---------- parse one article ----------
// Derived at EMIT time, not fetch time, so tuning the extraction never means re-fetching QI.
// The cache holds the raw <title>; this turns it into the quote.
// "Quote Origin: X – Quote Investigator®" → X.
// QI labels articles with 29+ distinct kinds — Quote, Dialogue, Anecdote, Joke, Maxim, Motto,
// Epitaph, Fable, Adage, Quip, Repartee, Palindrome, "Quiz Question", "Diet Advice"… An enumerated
// whitelist was tried and missed 7 of them, leaving text like "Quiz Question Origin: Who Is Buried
// in Grant's Tomb?" as the quote itself. Match the SHAPE instead: capitalised words followed by
// " Origin:" at the very start. A real quote opening that way is not a thing.
const KIND_RE = /^([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,2})\s+Origin:\s*/;
const quoteFromTitle = (title) => String(title || '')
  .replace(KIND_RE, '')
  .replace(/\s*[-–—]\s*Quote Investigator.*$/i, '')
  // QI splits long investigations across posts; the suffix is filing, not part of the quote.
  .replace(/\s*[-–—]\s*Part\s*\d+\s*$/i, '')
  .trim();

function parse(html, url) {
  const title = decode((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
  const kindMatch = title.match(KIND_RE);
  const kind = kindMatch ? kindMatch[1].toLowerCase() : '';
  const quote = quoteFromTitle(title);
  // QI tags every article with the people involved.
  const people = [...new Set([...html.matchAll(/rel="category tag">([^<]+)</g)].map((m) => decode(m[1])))]
    .filter((p) => p && !/^uncategori[sz]ed$/i.test(p));
  const concl = decode(((html.match(/In conclusion[,:]?\s*([\s\S]{0,400}?)<\/p>/i) || [])[1] || '').replace(/<[^>]*>/g, ' '));
  return { url, title, kind, quote, people, conclusion: concl };
}

// ---------- infer the ranking hints ----------
// A QI conclusion names the FALSE claimant as well as the real author — "crafted by screenwriter
// Larry Ferguson and NOT Christopher Columbus". Treating every mentioned name as "credited" therefore
// classified Columbus as credited and left McTiernan — merely the director who disclosed the
// fabrication — as the only "other", so he became the magnet. Wave r46 shipped that as a blocker: a
// ClaimReview rating false a claim nobody makes, with the real one absent.
//
// So: a name sitting immediately after a denial is NOT evidence that it is credited.
// This is deliberately the NARROWEST fix that removes the demonstrated failure. A fuller attempt —
// also inferring trueOrigin from credit verbs — was written, measured against all 544 multi-person
// articles, and REJECTED: it moved 139 magnets, fixing some and breaking others ("Warner crafted the
// weather maxim" puts the name before the verb, so Twain stopped being the magnet), and there is no
// way to tell fixes from regressions at that volume. This version moves 4 of 544, two of them the
// cases that were provably wrong. The rest of the ambiguity is handled by a GATE, not a guess:
// validate-records.js now warns when creditedTo disagrees with the page's own "Not X" label.
const NEGATED_BEFORE = /\b(?:not|never|rather than|instead of|nor)\b[^.;]{0,30}$/i;
function mentionedAsCredited(conclusion, person) {
  const surname = person.split(/\s+/).pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(surname, 'gi');
  let m, affirmed = false;
  while ((m = re.exec(conclusion))) {
    if (!NEGATED_BEFORE.test(conclusion.slice(Math.max(0, m.index - 60), m.index))) affirmed = true;
  }
  return affirmed;
}

function infer(a) {
  const credited = a.people.filter((p) => a.conclusion && mentionedAsCredited(a.conclusion, p));
  const others = a.people.filter((p) => !credited.includes(p));
  // Two or more people and the conclusion names one → the others carry the false credit.
  if (a.people.length >= 2 && credited.length && others.length) {
    return { magnetAuthor: others[0], trueOrigin: credited[0], category: 'misattributed', likelyConfidence: 'disputed' };
  }
  // Two or more people, conclusion unusable → still contested, but who is who is unknown. Say so.
  if (a.people.length >= 2) {
    return { magnetAuthor: a.people[0], trueOrigin: '', category: 'disputed', likelyConfidence: 'disputed' };
  }
  // One person, conclusion credits them → QI investigated and it held up.
  if (a.people.length === 1 && credited.length) {
    return { magnetAuthor: a.people[0], trueOrigin: a.people[0], category: 'genuine-famous', likelyConfidence: 'verified' };
  }
  // Anything else: leave category and confidence EMPTY rather than guess. rank-backlog treats an
  // unknown category as weight 1.0 and select() warns on unscored candidates.
  return { magnetAuthor: a.people[0] || '', trueOrigin: '', category: a.people.length ? 'disputed' : '', likelyConfidence: '' };
}

// ---------- commands ----------
async function cmdFetch(n) {
  const gap = gapUrls();
  const cache = loadCache();
  const todo = gap.filter((u) => !cache.articles[u]).slice(0, n);
  if (!todo.length) { console.log(`nothing to fetch — all ${gap.length} gap articles are cached.`); return; }
  console.log(`fetching ${todo.length} of ${gap.length - Object.keys(cache.articles).length} uncached gap articles (~${Math.ceil(todo.length * DELAY_MS / 1000)}s)…`);
  let ok = 0, fail = 0;
  for (let i = 0; i < todo.length; i++) {
    const url = todo[i];
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      cache.articles[url] = parse(await res.text(), url);
      ok++;
    } catch (e) {
      cache.articles[url] = { url, error: String(e.message).slice(0, 80) };
      fail++;
    }
    if ((i + 1) % 25 === 0) { saveCache(cache); process.stdout.write(`  ${i + 1}/${todo.length}\n`); }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  cache.fetchedAt = new Date().toISOString();
  saveCache(cache);
  console.log(`done: ${ok} parsed, ${fail} failed. cache → data/qi-articles.json`);
}

function cmdEmit(limit, outPath) {
  const cache = loadCache();
  const arts = Object.values(cache.articles)
    .filter((a) => !a.error)
    // Re-derive from the cached raw title so extraction fixes apply to already-fetched articles.
    .map((a) => ({ ...a, quote: a.title ? quoteFromTitle(a.title) : a.quote }))
    .filter((a) => a.quote && a.quote.length > 8);
  if (!arts.length) { console.error('qi-harvest: nothing usable in cache — run --fetch first.'); process.exit(1); }

  // Existing text, for fuzzy dedup.
  const existing = [];
  for (const f of fs.readdirSync(QUOTES)) {
    if (!f.endsWith('.json')) continue;
    const r = JSON.parse(fs.readFileSync(path.join(QUOTES, f), 'utf8'));
    if (r.displayQuote) existing.push({ what: 'corpus', slug: r.quoteSlug, q: r.displayQuote, b: bag(r.displayQuote) });
  }
  if (fs.existsSync(BACKLOG)) {
    for (const c of JSON.parse(fs.readFileSync(BACKLOG, 'utf8')).candidates || []) {
      if (c.quote) existing.push({ what: 'backlog:' + c.status, slug: c.slug, q: c.quote, b: bag(c.quote) });
    }
  }

  // --contested: emit only what the traffic data says converts. Disputed pages take 80.3% of
  // quote-page visits on 52.6% of the corpus; verified take 14.7% on 35.7%. Combined with --limit
  // this is how the queue stays a working set instead of a dump.
  const contestedOnly = has('--contested');
  const candidates = [], near = [];
  let skippedMeta = 0, skippedSelf = 0;
  const seen = new Set();
  for (const a of arts) {
    // QI's own meta/admin posts ("A New Blog Exploring Quotations") carry the site author as their
    // sole tag and investigate nothing. Match on SOLE tag, not presence: he is a legitimate subject
    // elsewhere, and a `contains` test would silently drop real articles.
    if (a.people.length === 1 && /^garson\s+o'?toole$/i.test(a.people[0])) { skippedMeta++; continue; }
    const b = bag(a.quote);
    if (b.size < MIN_BAG) continue;                 // too short to dedup safely; skip rather than risk a dupe
    let best = null, bs = 0;
    for (const e of existing) { const s = overlap(b, e.b); if (s > bs) { bs = s; best = e; } }
    if (bs >= 0.85) { near.push({ verdict: 'DUPLICATE', score: +bs.toFixed(2), qi: a.quote, qiUrl: a.url, match: best.q, matchIn: best.what, matchSlug: best.slug }); continue; }
    if (bs >= 0.6) near.push({ verdict: 'REVIEW', score: +bs.toFixed(2), qi: a.quote, qiUrl: a.url, match: best.q, matchIn: best.what, matchSlug: best.slug });
    // Intra-batch dedup. QI splits one investigation across "Part 01"/"Part 02" posts, which now
    // reduce to the SAME quote once the suffix is stripped. sync() would drop the second as
    // already-queued, but a tool that reports 54 emitted when it emitted 53 distinct is lying.
    const selfKey = [...b].sort().join(' ');
    if (seen.has(selfKey)) { skippedSelf++; continue; }
    seen.add(selfKey);
    const h = infer(a);
    if (contestedOnly && h.category !== 'misattributed' && h.category !== 'disputed') continue;
    candidates.push({
      quote: a.quote,
      magnetAuthor: h.magnetAuthor,
      creditedTo: h.category === 'misattributed' ? h.magnetAuthor : '',
      trueOrigin: h.trueOrigin,
      category: h.category,
      likelyConfidence: h.likelyConfidence,
      rightsEra: '',
      whyNotable: a.conclusion ? a.conclusion.slice(0, 240) : '',
      documentedAt: a.url,
      // With 3+ tagged people the magnet is a pick among several, not a finding — say so where the
      // wave can see it, because that pick becomes creditedTo and asserts a false credit by name.
      notes: `From QI article metadata (title + category tags + conclusion)${a.kind && a.kind !== 'quote' ? ` · QI calls this a ${a.kind} origin` : ''}. Fields are ranking HINTS — the ingestion agent researches from documentedAt.${a.people.length >= 3 ? ` · AMBIGUOUS MAGNET: QI tags ${a.people.length} people (${a.people.join(', ')}); magnetAuthor is a pick, verify creditedTo before publishing.` : ''}`,
    });
    if (limit && candidates.length >= limit) break;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const out = outPath || path.join(ROOT, 'workflows', '.scratch', `qi-harvest-${stamp}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ meta: { source: 'quoteinvestigator.com', builtOn: stamp, tool: 'tools/qi-harvest.js' }, candidates }, null, 2) + '\n');
  const nearOut = out.replace(/\.json$/, '-near.json');
  fs.writeFileSync(nearOut, JSON.stringify(near, null, 2) + '\n');

  const byCat = {};
  candidates.forEach((c) => { byCat[c.category || '(unknown)'] = (byCat[c.category || '(unknown)'] || 0) + 1; });
  console.log(`\nemitted ${candidates.length} candidates → ${path.relative(ROOT, out)}`);
  console.log('  by category:', JSON.stringify(byCat));
  console.log(`  dropped as duplicates (overlap >= 0.85): ${near.filter((n) => n.verdict === 'DUPLICATE').length}`);
  if (skippedMeta) console.log(`  dropped as QI meta posts:                ${skippedMeta}`);
  if (skippedSelf) console.log(`  dropped as same-quote multi-part posts:  ${skippedSelf}`);
  console.log(`  flagged for review (0.60-0.85):          ${near.filter((n) => n.verdict === 'REVIEW').length}`);
  console.log(`  → ${path.relative(ROOT, nearOut)}  — READ THIS. A wording variant can be a legitimately`);
  console.log('    distinct popular form; the tool does not get to decide that.');
  console.log(`\nnext: node tools/harvest.js sync ${path.relative(ROOT, out)} && node tools/rank-backlog.js`);
}

function cmdStatus() {
  const gap = gapUrls();
  const cache = loadCache();
  const keys = Object.keys(cache.articles);
  const errs = keys.filter((k) => cache.articles[k].error).length;
  console.log(`\nQI gap:            ${gap.length} articles`);
  console.log(`  cached:          ${keys.length}  (${errs} failed)`);
  console.log(`  remaining:       ${gap.filter((u) => !cache.articles[u]).length}`);
  if (cache.fetchedAt) console.log(`  last fetch:      ${cache.fetchedAt.slice(0, 16).replace('T', ' ')}`);
  console.log('');
}

(async () => {
  if (has('--status')) return cmdStatus();
  if (has('--fetch')) return cmdFetch(parseInt(arg('--fetch', '100'), 10) || 100);
  if (has('--emit')) return cmdEmit(parseInt(arg('--limit', '0'), 10) || 0, typeof arg('--out') === 'string' ? arg('--out') : null);
  console.log('usage: qi-harvest.js --status | --fetch [N] | --emit [--limit N] [--out path]');
})().catch((e) => { console.error('qi-harvest: ' + e.message); process.exit(1); });
