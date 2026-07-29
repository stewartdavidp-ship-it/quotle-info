#!/usr/bin/env node
'use strict';
/*
 * verify-corpus.js — the safeguard. Asserts that what we RENDERED reconciles with what CORPUS
 * says, and FAILS the build (exit 1) when it does not.
 *
 * WHY: the site shipped "526 Authors" on a tile linking to an index headed "593 authors", and
 * "1041 quotes" against "1058" elsewhere. Nothing caught either, because nothing ever compared
 * one generator's arithmetic to another's or to the pages on disk. Counting from one module
 * (corpus.js) removes the ability of two consumers to disagree; this file removes the ability of
 * the rendered output to disagree with the module.
 *
 * Run automatically at the end of tools/build.js. Also runnable standalone:
 *   node tools/verify-corpus.js
 *
 * Every check states the invariant in English so a failure tells you what broke, not just that
 * two integers differ.
 */
const fs = require('fs');
const path = require('path');
const { CORPUS, authors } = require('./corpus');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
const checks = [];

function check(name, expected, actual, hint) {
  const ok = expected === actual;
  checks.push({ name, expected, actual, ok });
  if (!ok) failures.push(`${name}\n      expected ${expected}, got ${actual}${hint ? `\n      → ${hint}` : ''}`);
}

const countDirs = (rel) => {
  const dir = path.join(ROOT, rel);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'index.html'))).length;
};
const readJson = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch (_) { return null; } };

// ---- 1. internal arithmetic: the parts must sum to the wholes we publish ----
const conf = CORPUS.quotes.byConfidence;
check('confidence buckets sum to the quote total',
  CORPUS.quotes.total, conf.verified + conf.attributed + conf.disputed,
  'a record has a confidence outside verified/attributed/disputed — the home page states these three as the breakdown of the total');

const eraSum = Object.keys(CORPUS.authors.eraCounts).reduce((s, k) => s + CORPUS.authors.eraCounts[k], 0);
check('era buckets sum to the author total',
  CORPUS.authors.total, eraSum,
  'eraOf() returned nothing for someone — the /authors/ era row is a partition and its chips must sum to All');

// ---- 2. derived data matches the source ----
const manifest = readJson('data/manifest.json');
if (manifest) {
  check('manifest entries match quote records', CORPUS.quotes.total, manifest.length,
    'data/manifest.json is stale — rerun tools/build.js, which regenerates it from data/quotes/');
}

// ---- 3. rendered pages match the corpus ----
// This check used to report only "expected 786, got 788" — no names. The usual cause is a song
// record whose original.artist was REASSIGNED (wave s3 corrected 7 first-recorders), which orphans
// the old artist's hub; the dirs are tracked, so `git status --untracked=all` shows the NEW hubs and
// hides the stale ones, and finding them meant guessing from mtimes. Name them instead.
check('rendered author pages match author hubs', CORPUS.authors.total, countDirs('authors'),
  (() => {
    const live = new Set(authors.map((a) => a.slug));
    const dir = path.join(ROOT, 'authors');
    const onDisk = fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'index.html')))
        .map((d) => d.name)
      : [];
    const stale = onDisk.filter((d) => !live.has(d));
    const missing = [...live].filter((s) => !onDisk.includes(s));
    if (stale.length) {
      return `STALE author directories — no record points at them any more (usually a reassigned `
        + `song original.artist, or a deleted record). Remove them and rebuild:\n`
        + `        git rm -r ${stale.map((s) => `authors/${s}`).join(' ')}`;
    }
    if (missing.length) return `build-authors did not emit a page for: ${missing.join(', ')}`;
    return 'build-authors did not emit one page per hub';
  })());
check('rendered song pages match recording-axis records', CORPUS.songs.recordings, countDirs('who-recorded'),
  'build-songs did not emit one /who-recorded/ page per recording-axis record (songs.total is all 95; .recordings is the /who-recorded/ subset)');
check('rendered who-wrote pages match writing-ONLY records', CORPUS.whoWrote.pages, countDirs('who-wrote'),
  'a /who-wrote/ page exists only for a writing-ONLY record; a dual-axis record lives at /who-recorded/ with a who-wrote section');
check('rendered quote pages match quote records', CORPUS.quotes.total, countDirs('who-said'),
  'build.js did not emit one page per record in data/quotes/');

// ---- 4. the search index matches the corpus ----
const search = readJson('search.json');
if (search) {
  const n = search.reduce((m, e) => (m[e.t] = (m[e.t] || 0) + 1, m), {});
  check('search index quote entries match the corpus', CORPUS.quotes.total, n.q || 0);
  check('search index song entries match the corpus', CORPUS.songs.recordings, n.s || 0);
  check('search index who-wrote entries match the corpus', CORPUS.whoWrote.total, n.w || 0);
  check('search index author entries match the corpus', CORPUS.authors.total, n.a || 0,
    'build-search must build authors from aggregateAuthors, not from the manifest — that is the bug that produced 526 vs 593');
  check('search index under-review entries match the queue', CORPUS.review.queued, n.b || 0);
}

// ---- 4b. the /verify API index matches the corpus ----
// verify-index.json is the DATA BEHIND THE PUBLIC API: the Cloudflare Worker fetches it from the
// live site, so whatever ships here is what every agent asking "who really said this?" is told.
// Nothing asserted anything about it until now — and it silently carried quotes ONLY, so the entire
// song vertical was invisible to the agent-facing surface for its whole existence.
const vIdx = readJson('verify-index.json');
if (Array.isArray(vIdx)) {
  const isQuote = (e) => e && !e.t;                       // quotes carry no discriminator; songs t:'s', writing t:'w'
  const quotes = vIdx.filter(isQuote);
  const songs = vIdx.filter((e) => e && e.t === 's');
  const writing = vIdx.filter((e) => e && e.t === 'w');
  check('verify-index covers every quote', CORPUS.quotes.total, quotes.length,
    'the /verify API answers from this file — a missing entry is a quote the API cannot confirm');
  check('verify-index covers every song', CORPUS.songs.recordings, songs.length,
    'recording-axis songs must carry t:"s"; without them /verify cannot answer "who originally recorded X?"');
  check('verify-index covers every writing record', CORPUS.whoWrote.total, writing.length,
    'writing-axis records must carry t:"w"; without them /verify cannot answer "who wrote X?"');
  // Quotes MUST come first: the Worker's exact match is a .find(), so on a collision between a short
  // song/writing title and a quote the first entry wins, and the primary corpus must not be displaced.
  const firstNonQuote = vIdx.findIndex((e) => !isQuote(e));
  const lastQuote = vIdx.map((e) => (isQuote(e) ? 1 : 0)).lastIndexOf(1);
  check('verify-index emits all quotes before any song/writing entry', true, firstNonQuote === -1 || firstNonQuote > lastQuote,
    'a song/writing entry ahead of a quote can win an exact-match collision in the Worker and displace the quote');
  // A song page states recording history and quotes no lyrics; the composition and the recordings
  // remain in copyright. A "public-domain" verdict here would be published, machine-readable, and
  // wrong — the costliest error this site can make.
  check('no song claims public-domain reuse rights', 0, songs.filter((e) => e.rights === 'public-domain').length,
    'song entries must be rights:"uncertain" — there is no per-song rights research behind these records');
}
// ---- 4c. song JSON-LD names a PERSON per composer, never a joined string ----
// The composer field is prose in the record ("Bert Berns, Solomon Burke and Jerry Wexler") and was
// emitted as one Person carrying all three names, so every machine consumer read a single songwriter
// with that literal name. build-songs.js now splits it; this asserts nothing re-joins them. Cheap to
// check and impossible to notice by eye — the page prose reads correctly either way.
const joinedComposers = [];
for (const d of (fs.existsSync(path.join(ROOT, 'who-recorded')) ? fs.readdirSync(path.join(ROOT, 'who-recorded'), { withFileTypes: true }) : [])) {
  if (!d.isDirectory()) continue;
  const p = path.join(ROOT, 'who-recorded', d.name, 'index.html');
  if (!fs.existsSync(p)) continue;
  const h = fs.readFileSync(p, 'utf8');
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let j; try { j = JSON.parse(m[1]); } catch (_) { continue; }
    for (const n of (j['@graph'] || [j])) {
      if (n['@type'] !== 'MusicRecording') continue;
      const c = n.recordingOf && n.recordingOf.composer;
      const names = Array.isArray(c) ? c.map((x) => x && x.name) : (c ? [c.name] : []);
      for (const nm of names) if (nm && /\band\b|,|&|;/.test(nm)) joinedComposers.push(`${d.name}: "${nm}"`);
    }
  }
}
check('song JSON-LD emits one Person per composer', 0, joinedComposers.length,
  `a composer node carries several names joined into one Person — consumers read it as a single songwriter with that literal name: ${joinedComposers.slice(0, 3).join(' · ')}`);

// ---- 4d. the quote verdict never contradicts its own creator node ----
// Both defects here were found by wave-r26 fix agents, and both live ONLY in the machine-readable
// layer — the visible prose on every affected page was already correct, which is exactly why they
// survived a human read. The failure mode is general: prose hedges, structured data states a flat
// fact, and structured data is the half an assistant quotes.
//   (a) "Actually by Anonymous." — the anonymous arm of creatorOk legitimately emits
//       creator:"Anonymous" (it keeps ~85 pages RULE-compliant), but feeding that token into the
//       verdict string credited a person who does not exist.
//   (b) "no creator is asserted here" printed beside an asserted creator — self-refuting in one node.
//   (c) an anonymous creator with no description is indistinguishable from a byline for someone
//       actually named Anonymous. The name cannot carry that distinction; the node has to say it.
const ANON = /\b(unknown|anonymous|unattributed|uncertain)\b/i;
const verdictBugs = { anonByline: [], selfRefuting: [], undescribedAnon: [] };
for (const d of (fs.existsSync(path.join(ROOT, 'who-said')) ? fs.readdirSync(path.join(ROOT, 'who-said'), { withFileTypes: true }) : [])) {
  if (!d.isDirectory()) continue;
  const p = path.join(ROOT, 'who-said', d.name, 'index.html');
  if (!fs.existsSync(p)) continue;
  const h = fs.readFileSync(p, 'utf8');
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let j; try { j = JSON.parse(m[1]); } catch (_) { continue; }
    for (const n of (j['@graph'] || [j])) {
      if (n['@type'] !== 'Quotation') continue;
      const dd = n.disambiguatingDescription || '';
      if (/Actually by\s+(unknown|anonymous|unattributed|uncertain)\b/i.test(dd)) verdictBugs.anonByline.push(d.name);
      if (n.creator && /no creator is asserted here/i.test(dd)) verdictBugs.selfRefuting.push(d.name);
      if (n.creator && ANON.test(n.creator.name || '') && !n.creator.disambiguatingDescription) verdictBugs.undescribedAnon.push(d.name);
    }
  }
}
check('quote JSON-LD never credits "Anonymous" as the author', 0, verdictBugs.anonByline.length,
  `the verdict names an anonymous token as the true author — reads as a byline for a person who does not exist: ${verdictBugs.anonByline.slice(0, 3).join(' · ')}`);
check('quote JSON-LD verdict agrees with its own creator node', 0, verdictBugs.selfRefuting.length,
  `the verdict says no creator is asserted while the same node asserts one: ${verdictBugs.selfRefuting.slice(0, 3).join(' · ')}`);
check('an anonymous creator says it is anonymous', 0, verdictBugs.undescribedAnon.length,
  `creator is an anonymous token with no disambiguatingDescription — indistinguishable from a byline: ${verdictBugs.undescribedAnon.slice(0, 3).join(' · ')}`);

// ---- 4d-bis. the slide-kit warning agrees with the page's own verdict ----
// "⚠ The slide-ready mistake: crediting this to X" is an attribution claim, and for months it was
// decided by whether the record happened to carry schema.claimQuoteText — a property of the WORDING.
// So it printed on 17 right-person-wrong-words pages (the Franklin beer page ran it three sections
// below its own sentence "Nobody is falsely credited here — Franklin really did publish it") and was
// SUPPRESSED on houston-we-have-a-problem, whose credit to Jim Lovell is exactly the thing to warn
// about. Both directions were invisible: the banner renders and the page still looks finished.
//
// Asserted against RENDERED HTML, not against the predicate, so a future edit to renderPresentationKit
// cannot quietly decouple the two again. The contract is stated in both directions on purpose — a
// check that only forbade the banner would be satisfied by never printing it.
const { rightPersonWrongWords, plain: tplPlain } = require('./template');
const { primaryCredit } = require('./credits');
const bannerBugs = { contradicts: [], missing: [] };
for (const r of require('./corpus').records) {
  const p = path.join(ROOT, 'who-said', r.quoteSlug, 'index.html');
  if (!fs.existsSync(p)) continue;
  const shown = fs.readFileSync(p, 'utf8').includes('The slide-ready mistake');
  const rpww = rightPersonWrongWords(r);
  if (shown && rpww) bannerBugs.contradicts.push(r.quoteSlug);
  if (!shown && !rpww && r.confidence === 'disputed' && primaryCredit(r)) bannerBugs.missing.push(r.quoteSlug);
}
check('no slide kit warns against a credit its own page calls correct', 0, bannerBugs.contradicts.length,
  `right-person-wrong-words page prints "crediting this to X is the mistake" while X is its author: ${bannerBugs.contradicts.slice(0, 3).join(' · ')}`);
check('every disputed credit gets its slide-kit warning', 0, bannerBugs.missing.length,
  `a disputed page names a false credit but does not warn a slide-maker off it: ${bannerBugs.missing.slice(0, 3).join(' · ')}`);

// ---- 4d-ter. a right-person-wrong-words record must STATE the author it is standing behind ----
// rightPersonWrongWords() reads "the hero is the magnet AND the record does not name somebody else
// as real", so it depends on `answer.realAuthorName` being filled in whenever the true author
// differs. That field is NOT in DOSSIER_SCHEMA (workflows/generate.js) — no wave emits it, it is
// added by hand, and 71 of 704 disputed records carry one. A record that simply never got it looks
// identical to one asserting "the credited person really is the author", and the predicate then
// suppresses a warning the page needs. Two records failed exactly that way and were corrected in
// #258: `he-who-lives-in-harmony-…` and `i-have-nothing-to-declare-…`, both pages whose own prose
// says no primary text exists.
//
// A convention nothing checks is a convention that drifts, so check it against the record's OTHER
// statement of the same fact. Claiming right-person-wrong-words means claiming an author; a record
// making that claim while declining to name a Quotation.creator — or naming a different one — is
// contradicting itself in the one layer machines read. 22 of 22 records pass today, and both false
// positives carried no creator at all, so this costs nothing now and bites the next one.
const rpwwBugs = [];
for (const r of require('./corpus').records) {
  if (!rightPersonWrongWords(r)) continue;
  const cr = r.schema && r.schema.creator;
  const hero = tplPlain((r.answer && r.answer.authorName) || '').toLowerCase();
  if (!cr || tplPlain(cr.name || '').toLowerCase() !== hero) rpwwBugs.push(r.quoteSlug);
}
check('a right-person-wrong-words record names its own author as creator', 0, rpwwBugs.length,
  `the record says the credited person IS the author but its schema.creator does not say so — usually a missing answer.realAuthorName, which silently suppresses the slide-kit warning: ${rpwwBugs.slice(0, 3).join(' · ')}`);

// ---- 4e. every inline <script> actually PARSES ----
// Generators emit JS from inside JS template literals, so a backslash in the emitted code is eaten
// as an escape at build time. `/\/who-said\/([a-z0-9-]+)\//` shipped as `//who-said/([a-z0-9-]+)//`
// — a syntax error that killed the entire script block on /report/. Neither form bound its submit
// handler, the browser fell back to a native GET, and the reader's report went nowhere.
//
// Nothing caught it: the build was green, CI was green, all 43 invariants passed, the markup was
// correct and the page rendered perfectly. It was found by submitting the form in a real browser.
// new Function() PARSES without executing, so browser globals are irrelevant — this only asks
// "is this valid JavaScript", which is exactly the question that went unasked.
const badScripts = [];
const scanDirs = ['who-said', 'authors', 'themes', 'who-recorded', 'who-wrote', 'report', 'under-review', 'check', 'contact', 'how-we-verify', 'about'];
const pagesToParse = [path.join(ROOT, 'index.html')];
for (const d of scanDirs) {
  const dir = path.join(ROOT, d);
  if (!fs.existsSync(dir)) continue;
  const idx = path.join(dir, 'index.html');
  if (fs.existsSync(idx)) pagesToParse.push(idx);
  // one representative child page per section is enough — they share a generator
  const kid = fs.readdirSync(dir, { withFileTypes: true }).find((e) => e.isDirectory());
  if (kid && fs.existsSync(path.join(dir, kid.name, 'index.html'))) pagesToParse.push(path.join(dir, kid.name, 'index.html'));
}
for (const p of pagesToParse) {
  const h = fs.readFileSync(p, 'utf8');
  for (const m of h.matchAll(/<script(?![^>]*\btype\s*=\s*"application\/ld\+json")(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const code = m[1];
    if (!code.trim()) continue;
    try { new Function(code); } catch (e) {
      badScripts.push(`${path.relative(ROOT, p)}: ${e.message}`);
    }
  }
}
check('every inline <script> is valid JavaScript', 0, badScripts.length,
  `a script block does not parse — the whole block is dead, so nothing on that page binds: ${badScripts.slice(0, 3).join(' · ')}`);

// ---- 5. the sitemap covers every page ----
const sitemap = (() => { try { return fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8'); } catch (_) { return ''; } })();
if (sitemap) {
  const songLocs = (sitemap.match(/<loc>[^<]*\/who-recorded\/[^<]*<\/loc>/g) || []).length;
  check('sitemap lists every song page plus the index', CORPUS.songs.recordings + 1, songLocs,
    'build-sitemap missed song URLs — crawlers would never find them');
}

// ---- 6. THE PUBLISHED FIGURES: numbers a human actually reads on the page ----
// Checks 1–5 verify artifacts (files, entries, URLs). None of them would have caught the bug that
// started all this, because that bug was a NUMBER RENDERED INTO PROSE: "526 Authors" on a tile
// linking to an index headed "593". Sourcing every figure from CORPUS prevents a generator from
// computing a different one — but nothing stops someone typing a literal into a template. So scrape
// the built HTML and assert the figures on the page equal the corpus.
const html = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (_) { return ''; } };
const num = (s) => (s == null ? null : parseInt(String(s).replace(/[^0-9]/g, ''), 10));

const home = html('index.html');
if (home) {
  const tile = (label) => {
    const m = home.match(new RegExp(`<div class="tile-n">(\\d+)</div><div class="tile-label">${label}`));
    return m ? num(m[1]) : null;
  };
  check('home page "Quotes" tile states the corpus total', CORPUS.quotes.total, tile('Quotes'));
  check('home page "Songs" tile states the song total', CORPUS.songs.total, tile('Songs'),
    'songs are a separate content type from quotes — the tile must state CORPUS.songs.total, never be folded into the quote count');
  check('home page "Authors" tile states the author total', CORPUS.authors.total, tile('Authors'),
    'the tile links to /authors/ — if it disagrees with that page, the mismatch is visible on the first click');
  check('home page "Under review" tile states the queue', CORPUS.review.queued, tile('Under review'));

  const stat = home.match(/<p class="stat"><b>(\d+)<\/b> quotes[^<]*?(\d+) verified, (\d+) attributed, (\d+) flagged/);
  if (stat) {
    check('home page headline quote total', CORPUS.quotes.total, num(stat[1]));
    check('home page headline "verified" figure', CORPUS.quotes.byConfidence.verified, num(stat[2]));
    check('home page headline "attributed" figure', CORPUS.quotes.byConfidence.attributed, num(stat[3]));
    check('home page headline "flagged as misquoted" figure', CORPUS.quotes.byConfidence.disputed, num(stat[4]));
  }
}

const authorsIdx = html('authors/index.html');
if (authorsIdx) {
  const lede = authorsIdx.match(/<p class="lede"><b>(\d+)<\/b>[^<]*<b>(\d+)<\/b> quotes and <b>(\d+)<\/b> songs/);
  if (lede) {
    check('/authors/ lede author count', CORPUS.authors.total, num(lede[1]));
    check('/authors/ lede quote count', CORPUS.quotes.total, num(lede[2]),
      'state the corpus total here, not the quote→hub link count — they differ and both appear on the site');
    check('/authors/ lede song count', CORPUS.songs.total, num(lede[3]));
  }
  const eraChips = [...authorsIdx.matchAll(/data-era="[a-z0-9]+" aria-pressed="false">[^<]*<span class="n">(\d+)/g)]
    .reduce((s, m) => s + num(m[1]), 0);
  check('/authors/ era chips sum to the author total', CORPUS.authors.total, eraChips,
    'the era row is a partition — every author must land in exactly one bucket (that is what "undated" is for)');

  // The "wrongly credited" chip (data-mag on each index card) must reconcile with the "Often
  // misattributed to X" lists it summarises — both derive from misattrBy in build-authors.js, so
  // the sum of the chips must equal the total misattribution cards rendered across all author
  // pages. This guards the exact defect that shipped: mag was computed a SECOND way (bare
  // creditedTo, by name, no real-author exclusion) and over-stated the browse by 200 records
  // against the very lists it linked to. If someone reintroduces a divergent count, this fails.
  const chipSum = [...authorsIdx.matchAll(/data-mag="(\d+)"/g)].reduce((s, m) => s + num(m[1]), 0);
  let cardSum = 0;
  const authDir = path.join(ROOT, 'authors');
  if (fs.existsSync(authDir)) {
    for (const d of fs.readdirSync(authDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const page = html(`authors/${d.name}/index.html`);
      cardSum += (page.match(/class="mis-card"/g) || []).length;
    }
  }
  check('"wrongly credited" chips reconcile with the misattribution lists', chipSum, cardSum,
    'the data-mag chip and the "Often misattributed to X" cards must both come from misattrBy — a gap means mag is being recomputed independently (it was, and over-counted by 200)');
}

const songsIdx = html('who-recorded/index.html');
if (songsIdx) {
  const m = songsIdx.match(/data-song-total="(\d+)"/);
  if (m) check('Songs browse states the full song total', CORPUS.songs.total, num(m[1]));
}

// ---- 7. THE URL CONTRACT: no emitted URL may point at a redirect ----
// Pages live at directory URLs WITH a trailing slash; the no-slash form 301s. A canonical, og:url,
// Schema @id or sitemap <loc> pointing at the no-slash form points at a redirect — which is close
// to un-indexable and fails SILENTLY (the page returns 200 and looks perfect).
//
// This invariant exists because checks 1–6 did NOT catch it. They verify figures and artifacts; the
// URL contract is just as load-bearing and just as silent when broken. It was violated in 18 places
// across 5 generators — canonicals on 600 author + 28 theme pages, 628 sitemap entries, ~2,900
// internal links and 1,031 BreadcrumbList items — for weeks, with no error anywhere.
const { SECTIONS, STANDING } = require('./urls');
// TWO shapes, because covering only the first is how this bug survived its own fix:
//   /section/slug/   — content routes
//   /about/          — STANDING pages, no {slug} segment, so the section pattern never matched them
// All five standing pages sit in the FOOTER of every page and were listed in sitemap.xml as
// redirecting URLs for weeks after the "URL contract" was declared fixed.
const noSlash = new RegExp(
  '(?:href="|content="|"@id":\\s*"|"url":\\s*"|<loc>)(?:https://quotle\\.info)?'
  + `(?:/(?:${SECTIONS.join('|')})/[a-z0-9-]+|/(?:${STANDING.join('|')}))(?=["'<#?])`,
  'g');

function scanForNoSlash(files, label) {
  const offenders = new Map();
  for (const rel of files) {
    const body = html(rel);
    if (!body) continue;
    const hits = body.match(noSlash) || [];
    if (hits.length) offenders.set(rel, hits.length);
  }
  const total = [...offenders.values()].reduce((s, n) => s + n, 0);
  check(`URL contract: no no-slash section URLs in ${label}`, 0, total,
    total ? `e.g. ${[...offenders.keys()].slice(0, 3).join(', ')} — build every internal URL via tools/urls.js` : null);
}

// Scan EVERY built page, not a sample. A sample was the first instinct — the defect is usually
// systemic (one template literal) so one page per section "should" catch it. It did not: sampling
// passed while 10 real violations survived in record PROSE (inline links authors hand-wrote) and in
// data-fed href fields, which vary per record and are invisible to any sample. ~1,700 files is a
// couple of seconds; a silent 301 in a canonical is weeks of lost indexing.
const allPages = [];
// Iterate SECTIONS (the URL contract's own list), not a hardcoded copy. A hardcoded list here
// silently EXCLUDES any new section from the no-slash scan — exactly how /who-wrote/ could have
// shipped canonicals pointing at redirects with this invariant reporting all-clear.
for (const section of SECTIONS) {
  const dir = path.join(ROOT, section);
  if (!fs.existsSync(dir)) continue;
  allPages.push(`${section}/index.html`);
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) allPages.push(`${section}/${d.name}/index.html`);
  }
}
allPages.push('index.html');
// STANDING pages must be scanned as FILES, not just matched as a URL shape. The regex above
// already knew about them — but this list was built from SECTIONS only, so the guard caught a
// no-slash link *to* /about/ from a quote page and never once opened /about/index.html, which is
// exactly where the defect was: all five standing pages shipped a canonical + og:url pointing at
// their own 301, and this invariant reported all-clear the whole time. Knowing the shape and not
// reading the files is not a guard. Iterate STANDING, never a hardcoded copy.
for (const name of STANDING) {
  if (fs.existsSync(path.join(ROOT, name, 'index.html'))) allPages.push(`${name}/index.html`);
}
scanForNoSlash(allPages, `all ${allPages.length} built pages`);

scanForNoSlash(['sitemap.xml'], 'sitemap.xml');

// ---- 8. the generator's theme vocabulary matches ours ----
// generate.js now emits `themes` directly (schema-enforced), which removed a whole pipeline stage.
// But workflow scripts run sandboxed and cannot require() repo modules, so that enum is a
// hand-maintained COPY of tools/themes.js. If they drift, the researching agent is offered a slug
// validate-records.js will reject — the wave fails at the very end, after all the research spend.
// Cheap to check here, expensive to discover there.
try {
  const genSrc = fs.readFileSync(path.join(ROOT, 'workflows', 'generate.js'), 'utf8');
  const m = genSrc.match(/themes:\s*\{[\s\S]*?enum:\s*\[([^\]]+)\]/);
  if (m) {
    const offered = m[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean).sort().join(',');
    const vocab = require('./themes').THEMES.map((t) => t.slug).sort().join(',');
    check('generate.js theme enum matches tools/themes.js', vocab, offered,
      'the sandboxed copy in generate.js has drifted — an agent would be offered a slug validate-records rejects');
  }
} catch (_) { /* generate.js optional */ }

// ---- 9. the generate.js output schema stays under the platform's classifier ceiling ----
// This is the guard that should have existed before wave r24. Adding one property to
// DOSSIER_SCHEMA (themes, with a 28-slug enum) grew it 4,072 -> 4,454 serialized bytes, and the
// platform then rejected EVERY research agent before it ran: "output schema too large to classify
// safely" — 20/20 agents, 19ms, 0 tokens, no content error to read. A whole wave died at a layer
// nothing in this repo was watching.
// Measured: 4,072 shipped (r23) · 4,159 rejected · 4,454 rejected. Ceiling is in (4072, 4159].
// The budget is the proven-good size. Raising it is a deliberate act that needs a real wave to
// confirm — not something to nudge because a new field would be convenient.
// EVERY agent-facing output schema is checked, not just the quote one. The songs pipeline
// (generate-songs.js) was added later against the same platform ceiling, and its dossier is richer
// than a quote's — so it is the schema MOST likely to drift over the line, and the one that would
// take a whole song wave down with it in exactly the same silent way.
const SCHEMA_BUDGET = 4072;
const AGENT_SCHEMAS = [
  ['generate.js', 'DOSSIER_SCHEMA'],
  ['generate-songs.js', 'SONG_DOSSIER_SCHEMA'],
  ['harvest-songs.js', 'CANDIDATE_SCHEMA'],
  ['audit-songs.js', 'AUDIT_SCHEMA'],
];
for (const [file, constName] of AGENT_SCHEMAS) {
  try {
    const gen = fs.readFileSync(path.join(ROOT, 'workflows', file), 'utf8');
    const i = gen.indexOf(`const ${constName} = {`);
    if (i === -1) continue;
    const seg = gen.slice(i);
    let depth = 0, end = 0;
    for (let k = seg.indexOf('{'); k < seg.length; k++) {
      if (seg[k] === '{') depth++;
      else if (seg[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
    }
    // eslint-disable-next-line no-eval
    const schema = eval('(' + seg.slice(seg.indexOf('{'), end) + ')');
    const bytes = JSON.stringify(schema).length;
    const ok = bytes <= SCHEMA_BUDGET;
    const name = `${file} ${constName} within the classifier budget`;
    checks.push({ name, expected: `<= ${SCHEMA_BUDGET}`, actual: bytes, ok });
    if (!ok) {
      failures.push(`${name}\n      ${bytes} bytes, budget ${SCHEMA_BUDGET}\n      → the platform rejects an oversized output schema BEFORE any agent runs (0 tokens, no content error).\n      → free space in the schema before adding fields; do not raise the budget without a real wave to prove it.`);
    }
  } catch (_) { /* workflow scripts are optional */ }
}

// ---- 10. the committed snapshot is not stale ----
const state = readJson('data/corpus-state.json');
if (state && state.figures) {
  const same = JSON.stringify(state.figures) === JSON.stringify(CORPUS);
  checks.push({ name: 'committed corpus-state.json matches the live derivation', expected: 'match', actual: same ? 'match' : 'STALE', ok: same });
  if (!same) failures.push('committed corpus-state.json matches the live derivation\n      → data/corpus-state.json is stale; tools/build-state.js rewrites it on every build, so commit the change');
}

// ---- THE CHECKS MUST ALL STILL BE HERE ----
// Nearly every block above is guarded by `if (thing)` — if a scrape stops matching, or a file goes
// missing, or a JSON.parse fails, that block's checks SILENTLY VANISH and the build stays green with
// a smaller number nobody is comparing. Measured 2026-07-29: ~15 such guards, and `checks.length` is
// a stable 44 regardless of corpus size (the per-record loops accumulate into single checks). So the
// count is a safe invariant, and asserting it converts every one of those silent deletions into one
// loud failure. If you legitimately add or remove a check, update this number in the same commit —
// that is the point, not an inconvenience.
// EXPECTED_CHECKS is the FINAL total, including this assertion. check() pushes as it runs, so
// checks.length here is the count BEFORE this one is added — hence the +1. Written this way round
// because the number you compare against should be the number the build prints, not that number
// minus one; the off-by-one version failed on its first run and cost ten minutes.
const EXPECTED_CHECKS = 48; // 45 → 47: the slide-kit banner checks (§4d-bis); → 48: rpww creator agreement (§4d-ter)
check('every invariant still runs (none silently skipped)', EXPECTED_CHECKS, checks.length + 1,
  'a check block is guarded by `if (x)` and its input went missing, so it removed itself. Find which by diffing the printed check list with CORPUS_VERBOSE=1.');

// ---- report ----
const pad = (s, n) => String(s).padEnd(n);
if (failures.length) {
  console.error('\n  ✗ CORPUS INVARIANTS FAILED — the site would publish numbers that contradict each other:\n');
  failures.forEach((f, i) => console.error(`   ${i + 1}. ${f}\n`));
  console.error(`  ${failures.length} of ${checks.length} invariants failed. Build aborted.\n`);
  process.exit(1);
}
console.log(`  ✓ corpus invariants (${checks.length} checks: ${CORPUS.quotes.total} quotes, ${CORPUS.songs.total} songs, ${CORPUS.authors.total} authors, ${CORPUS.review.queued} queued — all reconcile)`);
if (process.env.CORPUS_VERBOSE) checks.forEach((c) => console.log(`      ${c.ok ? '✓' : '✗'} ${pad(c.name, 52)} ${c.actual}`));
