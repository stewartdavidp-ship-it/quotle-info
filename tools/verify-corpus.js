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
const { CORPUS } = require('./corpus');

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
check('rendered author pages match author hubs', CORPUS.authors.total, countDirs('authors'),
  'build-authors did not emit one page per hub (or stale directories remain from a deleted record)');
check('rendered song pages match song records', CORPUS.songs.total, countDirs('who-recorded'),
  'build-songs did not emit one page per record in data/songs/');
check('rendered quote pages match quote records', CORPUS.quotes.total, countDirs('who-said'),
  'build.js did not emit one page per record in data/quotes/');

// ---- 4. the search index matches the corpus ----
const search = readJson('search.json');
if (search) {
  const n = search.reduce((m, e) => (m[e.t] = (m[e.t] || 0) + 1, m), {});
  check('search index quote entries match the corpus', CORPUS.quotes.total, n.q || 0);
  check('search index song entries match the corpus', CORPUS.songs.total, n.s || 0);
  check('search index author entries match the corpus', CORPUS.authors.total, n.a || 0,
    'build-search must build authors from aggregateAuthors, not from the manifest — that is the bug that produced 526 vs 593');
  check('search index under-review entries match the queue', CORPUS.review.queued, n.b || 0);
}

// ---- 5. the sitemap covers every page ----
const sitemap = (() => { try { return fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8'); } catch (_) { return ''; } })();
if (sitemap) {
  const songLocs = (sitemap.match(/<loc>[^<]*\/who-recorded\/[^<]*<\/loc>/g) || []).length;
  check('sitemap lists every song page plus the index', CORPUS.songs.total + 1, songLocs,
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
}

const songsIdx = html('who-recorded/index.html');
if (songsIdx) {
  const m = songsIdx.match(/(\d+) songs? traced/);
  if (m) check('/who-recorded/ index states the song total', CORPUS.songs.total, num(m[1]));
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
const { SECTIONS } = require('./urls');
const noSlash = new RegExp(`(?:href="|content="|"@id":\\s*"|"url":\\s*"|<loc>)(?:https://quotle\\.info)?/(${SECTIONS.join('|')})/[a-z0-9-]+(?=["'<#?])`, 'g');

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
for (const section of ['who-said', 'authors', 'themes', 'who-recorded']) {
  const dir = path.join(ROOT, section);
  if (!fs.existsSync(dir)) continue;
  allPages.push(`${section}/index.html`);
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) allPages.push(`${section}/${d.name}/index.html`);
  }
}
allPages.push('index.html');
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
