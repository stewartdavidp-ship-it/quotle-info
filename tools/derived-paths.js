#!/usr/bin/env node
'use strict';
/*
 * derived-paths.js — the ONE answer to "is this file authored, or is it a build product?"
 *
 * WHY THIS IS ITS OWN FILE
 * Two tools already asked this question and each carried its own copy of the answer:
 * merge-run.js used it to decide which merge conflicts a rebuild may honestly resolve, and
 * merge-gate.js needed it (2026-08-03) to decide which PRs staleness actually endangers. One rule
 * with two readers is this repo's most-repeated defect — it is called out by name in merge.yml's
 * own header — so the rule lives here and both require it.
 *
 * THE DEFINITION, and it is operational rather than a matter of taste:
 *
 *     DERIVED == exactly what `node tools/build.js && node tools/scan.js` regenerates.
 *
 * Those two commands are what merge-run's rebuild actually runs. So: a file is derived iff
 * discarding both sides of a conflict and re-running the build reproduces the right content.
 * Everything else is SOURCE, because a rebuild will NOT bring it back — taking one side of it and
 * calling that "rebuilding" silently discards whichever edit lost the coin toss.
 *
 * One definition serves both callers, which is not obvious and was nearly missed:
 *   - merge-run asks "may I auto-resolve this conflict?"  — safe iff a rebuild recomputes it.
 *   - merge-gate asks "does staleness endanger this PR?"  — yes iff it carries corpus-wide build
 *     output, which is the same set, because that is exactly what every PR rewrites at once.
 *
 * THE 2026-08-03 CORRECTION — read this before editing the list.
 * The first version was inherited verbatim from merge-run: a whitelist of six SOURCE prefixes,
 * with everything else assumed derived. Checked against the real inventory it misclassified a lot
 * of authored state — data/daily-report/*.md (the daily reports themselves), data/harvest-queue.md
 * (whose .json sibling WAS whitelisted), data/demand-cache.json, data/song-queue.*,
 * data/who-wrote-queue.*, data/routine-log.jsonl and backlog-index.json. Two consequences, one
 * cosmetic and one not:
 *   - merge-gate would force a needless rebuild on the daily-report PR every single day; and
 *   - merge-run would treat a conflict in the harvest queue's .md, the backlog index or the demand
 *     cache as auto-resolvable — take one side, run build.js — and build.js writes NONE of them.
 *     That is a silent loss of authored state, the one outcome this file exists to prevent. It was
 *     latent in merge-run from the start; giving the rule a second reader is what surfaced it.
 * So the list is now DERIVED-first and closed. Build outputs are few, stable and enumerable;
 * everything else is source by default, which makes a NEW authored file safe automatically. A new
 * BUILD OUTPUT must be added here deliberately — and if that is forgotten the failure is
 * "merge-gate let a stale PR through", which verify.yml's committed-output check still catches,
 * rather than "we destroyed someone's edit", which nothing catches.
 *
 *   node tools/derived-paths.js --self-test
 */

// Build products: everything build.js (pages, indexes, manifest, corpus-state) and scan.js
// (scan-state) write. Entries ending in `/` are directory prefixes; the rest are exact root paths.
const DERIVED = new RegExp('^(?:' + [
  // Rendered page trees.
  'who-said/', 'who-wrote/', 'who-recorded/', 'authors/', 'themes/', 'quotes/',
  'check/', 'cite/', 'flagged/', 'under-review/', 'og/', 'report/', 'vs-ai/',
  'how-we-verify/', 'about/', 'contact/', 'privacy/', 'terms/',
  // Root documents and machine indexes the generators emit. Traced through build.js's own chain
  // (build-search, build-verify, build-themes, build-discovery, build-sitemap, build-chrome-artifact)
  // to an actual writeFileSync — NOT guessed from the filename, which is how sitemap-test.xml very
  // nearly landed here. That file is named like a build product, is discussed at length inside
  // build-sitemap.js, and is never written by it: it is a committed 3-URL control for Search
  // Console. Its sibling sitemap-full.xml IS written (line 81), and is the URL Google actually
  // reads. Filename similarity is not evidence; a writeFileSync is.
  'index\\.html$', '404\\.html$', 'sitemap\\.xml$', 'sitemap-full\\.xml$', 'search\\.json$',
  'themes\\.json$', 'verify-index\\.json$', 'chrome\\.json$', 'openapi\\.json$', 'llms\\.txt$',
  '\\.well-known/ai-plugin\\.json$',
  // Derived state under data/. These three and ONLY these three are regenerated: build.js writes
  // the first two, scan.js the third. Every other data/ path is authored by a person or a routine.
  'data/manifest\\.json$', 'data/corpus-state\\.json$', 'data/scan-state\\.json$',
].join('|') + ')');

const isDerived = (p) => DERIVED.test(p);
const isSource = (p) => !DERIVED.test(p);

// merge-gate: "does being behind main endanger this PR?" — yes iff it rewrites build output.
const derived = (paths) => (paths || []).filter(isDerived);
// merge-run: "may a rebuild resolve these conflicts without a human?" — only if none are source.
const source = (paths) => (paths || []).filter(isSource);

module.exports = { DERIVED, isSource, isDerived, derived, source };

if (require.main === module && process.argv.includes('--self-test')) {
  // Drawn from the ACTUAL repo inventory (`git ls-tree -r origin/main`), not from imagination.
  // The previous list was entirely plausible and still wrong; only a real inventory catches that.
  const cases = [
    // ---- DERIVED: a rebuild reproduces these exactly. ----
    ['a rendered detail page',    'who-said/x/index.html', true],
    ['an author hub',             'authors/plato/index.html', true],
    ['a theme page',              'themes/courage/index.html', true],
    ['the homepage',              'index.html', true],
    ['the 404 page',              '404.html', true],
    ['the sitemap',               'sitemap.xml', true],
    ['the search index',          'search.json', true],
    ['the themes index',          'themes.json', true],
    ['the verify index',          'verify-index.json', true],
    ['the chrome artifact',       'chrome.json', true],
    ['the openapi document',      'openapi.json', true],
    ['the full sitemap',          'sitemap-full.xml', true],
    ['the llms.txt index',        'llms.txt', true],
    ['the AI plugin manifest',    '.well-known/ai-plugin.json', true],
    ['the manifest',              'data/manifest.json', true],
    ['corpus state',              'data/corpus-state.json', true],
    ['scan state (scan.js)',      'data/scan-state.json', true],

    // ---- SOURCE: authored. A rebuild does NOT bring these back. ----
    ['a quote record',            'data/quotes/x.json', false],
    ['a song record',             'data/songs/x.json', false],
    ['a routine-log shard',       'data/routine-log/2026-08-03T12-13-19-529Z-daily-report.jsonl', false],
    ['the legacy routine log',    'data/routine-log.jsonl', false],
    // The seven the first version got wrong — the reason this file was rewritten.
    ['a DAILY REPORT',            'data/daily-report/2026-08-03.md', false],
    ['the harvest queue .md',     'data/harvest-queue.md', false],
    ['the harvest queue .json',   'data/harvest-queue.json', false],
    ['the demand cache',          'data/demand-cache.json', false],
    ['the backlog index',         'backlog-index.json', false],
    ['the song queue',            'data/song-queue.json', false],
    ['the who-wrote queue',       'data/who-wrote-queue.md', false],
    ['the report queue',          'data/report-queue.json', false],
    ['harvest config',            'data/harvest-config.json', false],
    ['a generator',               'tools/template.js', false],
    ['a workflow doc',            'workflows/DAILY-MERGE.md', false],
    ['a GitHub workflow',         '.github/workflows/verify.yml', false],
    ['the worker',                'worker/src/index.js', false],
    ['the repo instructions',     'CLAUDE.md', false],
    // THE TRAP. Named like a build product, discussed inside build-sitemap.js, never written by it
    // — a committed 3-URL control for Search Console. Treating it as derived would let a rebuild
    // silently overwrite a file no generator can reproduce.
    ['the Search Console control','sitemap-test.xml', false],
    ['robots.txt is committed',   'robots.txt', false],
    ['the domain file',           'CNAME', false],
    ['the site logo',             'logo.svg', false],
  ];
  let bad = 0;
  for (const [name, p, wantDerived] of cases) {
    if (isDerived(p) !== wantDerived) {
      console.error(`  ✗ ${name} (${p}): expected ${wantDerived ? 'derived' : 'source'}, got ${isDerived(p) ? 'derived' : 'source'}`);
      bad++;
    }
  }
  // The two helpers must partition — every path is exactly one, never both or neither.
  const all = cases.map(([, p]) => p);
  if (derived(all).length + source(all).length !== all.length) {
    console.error('  ✗ derived() and source() do not partition the input'); bad++;
  }
  // The property that keeps merge-run safe, asserted directly so that widening DERIVED to cover a
  // new data/ path cannot slip through review: nothing under data/ is auto-resolvable except the
  // three files a rebuild genuinely recomputes.
  const dataDerived = all.filter((p) => p.startsWith('data/') && isDerived(p)).sort();
  const expected = ['data/corpus-state.json', 'data/manifest.json', 'data/scan-state.json'];
  if (JSON.stringify(dataDerived) !== JSON.stringify(expected)) {
    console.error(`  ✗ derived data/ paths drifted: [${dataDerived.join(', ')}]`); bad++;
  }
  if (bad) { console.error(`\n  ${bad} of ${cases.length + 2} derived-paths cases failed.\n`); process.exit(1); }
  console.log(`  ✓ derived-paths classifier (${cases.length + 2} cases: real repo inventory, partition, data/ closure)`);
  process.exit(0);
}
