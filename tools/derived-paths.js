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
 * THE RULE. A path is SOURCE if a person or a routine wrote it by intent. Everything else is a pure
 * function of the source records, reproduced exactly by `node tools/build.js`. The whitelist is of
 * source, not of derived output, so a NEW generated path is derived by default — the failure mode of
 * forgetting to update this list is "we rebuilt something we could have merged", never "we silently
 * discarded someone's edit".
 *
 *   node tools/derived-paths.js --self-test
 */
const SOURCE = /^(data\/quotes\/|data\/songs\/|data\/harvest-queue\.json|data\/report-queue\.json|data\/routine-log\/|tools\/|workflows\/|\.github\/|worker\/|CLAUDE\.md)/;

const isSource = (p) => SOURCE.test(p);
const isDerived = (p) => !SOURCE.test(p);

// Which of these paths are build products? Used for two different questions:
//   - merge-run: "may a rebuild resolve this conflict without a human?" (yes iff all derived)
//   - merge-gate: "does being behind main endanger this PR?" (yes iff any derived)
const derived = (paths) => (paths || []).filter(isDerived);
const source = (paths) => (paths || []).filter(isSource);

module.exports = { SOURCE, isSource, isDerived, derived, source };

if (require.main === module && process.argv.includes('--self-test')) {
  const cases = [
    // Derived — corpus-wide build products. Any two PRs that touch these collide.
    ['a rendered detail page',   'who-said/x/index.html', true],
    ['the homepage',             'index.html', true],
    ['the search index',         'search.json', true],
    ['the sitemap',              'sitemap.xml', true],
    ['the manifest',             'data/manifest.json', true],
    ['corpus state',             'data/corpus-state.json', true],
    ['an author hub',            'authors/plato/index.html', true],
    // Source — authored by a person or a routine, and never regenerated.
    ['a quote record',           'data/quotes/x.json', false],
    ['a song record',            'data/songs/x.json', false],
    ['a routine-log shard',      'data/routine-log/2026-08-03-wave.jsonl', false],
    ['the harvest queue',        'data/harvest-queue.json', false],
    ['a generator',              'tools/template.js', false],
    ['a workflow doc',           'workflows/DAILY-MERGE.md', false],
    ['a GitHub workflow',        '.github/workflows/verify.yml', false],
    ['the worker',               'worker/src/index.js', false],
    ['the repo instructions',    'CLAUDE.md', false],
  ];
  let bad = 0;
  for (const [name, path, wantDerived] of cases) {
    if (isDerived(path) !== wantDerived) {
      console.error(`  ✗ ${name} (${path}): expected ${wantDerived ? 'derived' : 'source'}`);
      bad++;
    }
  }
  // The two helpers must partition — a path is exactly one of the two, never both or neither.
  const all = cases.map(([, p]) => p);
  if (derived(all).length + source(all).length !== all.length) {
    console.error('  ✗ derived() and source() do not partition the input'); bad++;
  }
  if (bad) { console.error(`\n  ${bad} of ${cases.length + 1} derived-paths cases failed.\n`); process.exit(1); }
  console.log(`  ✓ derived-paths classifier (${cases.length + 1} cases: build products vs authored source, partition)`);
  process.exit(0);
}
