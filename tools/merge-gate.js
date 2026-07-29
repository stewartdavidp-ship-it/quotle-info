#!/usr/bin/env node
'use strict';
/*
 * merge-gate.js — decides which routine PRs may merge, and in what order.
 *
 * WHY THIS EXISTS
 * Four routines write to main inside three hours: the 03:00 wave, the Monday 03:30 discovery audit,
 * the 05:00 reader-report pass, the 06:00 review. Every one of them rebuilds EVERY page, so any two
 * PRs open at the same time conflict across ~1,163 generated files. Observed 2026-07-29: #207 went
 * stale the instant #205 merged, and had to be rebuilt from source records rather than resolved.
 *
 * While a human merges them one at a time, that human IS the serialization. Auto-merging each
 * routine independently removes it and replaces it with a race. This tool restores it as ONE
 * authority: routines open PRs and stop; a single 07:00 pass decides what merges.
 *
 * WHAT THE CONTENT GATES CANNOT TELL YOU, and why this is a separate gate:
 * report-gate.js and the audit/skeptic stages establish that a CHANGE IS CORRECT. They say nothing
 * about whether the BRANCH IS CURRENT. A perfectly correct PR built against a superseded main
 * silently reverts whatever landed in between. That is not a content defect and no content gate
 * will ever catch it. This gate only ever asks mechanical questions.
 *
 *   node tools/merge-gate.js              decide and print; changes nothing
 *   node tools/merge-gate.js --json       machine-readable decisions
 *   node tools/merge-gate.js --self-test  run the decision function over fixtures
 *
 * It NEVER merges. It prints a plan; workflows/DAILY-MERGE.md executes it one PR at a time,
 * re-running this between merges because each merge invalidates every other branch's build.
 */
const { execFileSync } = require('child_process');
// Must run before the first fetch: routes GitHub reads through the sandbox proxy (15000/hr) instead
// of direct-and-anonymous (60/hr on a SHARED cloud IP, measured at 0 remaining). No-op locally.
require('./proxy-boot')();

// FAIL CLOSED. `author` is the same GitHub account for routine and human PRs, so authorship cannot
// distinguish them — a PR is auto-mergeable only if its branch matches a KNOWN routine prefix.
// Anything unrecognised is left for a human. A new routine must be added here deliberately; the
// failure mode of forgetting is "my PR was not auto-merged", not "a human's PR was".
const ROUTINES = [
  { prefix: 'wave-',      name: 'daily-wave',       mayTouch: null },
  { prefix: 'reports/',   name: 'daily-reports',    mayTouch: null },
  { prefix: 'review/',    name: 'daily-review',     mayTouch: null },
  // Discovery's whole job is proposing detectors, so it is the one routine allowed into tools/ —
  // and ONLY into detectors.js. Everything else under tools/ is still a scope escape for it.
  { prefix: 'discovery/', name: 'weekly-discovery', mayTouch: [/^tools\/detectors\.js$/] },
  // The merge pass logs its own run, so it opens PRs too. Omitting this made its log PR
  // permanently unmergeable: DAILY-MERGE.md told it to use `merge/<date>` while this list did
  // not carry the prefix, so #223 sat as HUMAN forever. The 2026-07-29 run diagnosed it exactly
  // and correctly refused the workaround of renaming its own branch to get past the gate.
  { prefix: 'merge/',     name: 'daily-merge',      mayTouch: null },
  { prefix: 'report/',    name: 'daily-report',     mayTouch: null },
];

// The r20 rule, mechanised. Fix agents shipped +94/-14 of template.js inside a content wave; the
// scope gate in report-gate.js catches that locally, this catches it at the merge boundary where
// a stale or hand-edited branch could still carry it.
const GENERATOR = /^(tools|workflows|\.github|worker)\//;

function routineFor(branch) {
  return ROUTINES.find((r) => branch.startsWith(r.prefix)) || null;
}

// PURE. Everything above the network boundary, so --self-test can drive it with fixtures rather
// than against live PRs — a decision function that can only be exercised by opening real pull
// requests is a decision function nobody tests.
function decide(pr) {
  const branch = pr.headRefName || '';
  const routine = routineFor(branch);
  if (!routine) return { verdict: 'HUMAN', reason: 'branch is not a known routine prefix — left alone' };
  if (pr.isDraft) return { verdict: 'SKIP', reason: 'draft — a draft cannot be merged and nothing here clicks Ready' };

  const checks = (pr.statusCheckRollup || []).map((c) => c.conclusion || c.state || 'PENDING');
  if (!checks.length) return { verdict: 'SKIP', reason: 'no checks reported yet' };
  // "Finished" is not "passed". Merging on a run that merely stopped being pending is how #210
  // went in red on 2026-07-29.
  if (checks.some((c) => c === 'PENDING' || c === 'IN_PROGRESS' || c === 'QUEUED')) {
    return { verdict: 'WAIT', reason: 'CI still running' };
  }
  if (checks.some((c) => c !== 'SUCCESS' && c !== 'NEUTRAL' && c !== 'SKIPPED')) {
    return { verdict: 'SKIP', reason: `CI not green (${[...new Set(checks)].join(', ')})` };
  }

  const escapes = (pr.files || []).map((f) => f.path).filter((p) => GENERATOR.test(p))
    .filter((p) => !(routine.mayTouch || []).some((rx) => rx.test(p)));
  if (escapes.length) {
    return { verdict: 'SKIP', reason: `scope escape — ${routine.name} touched ${escapes.slice(0, 3).join(', ')}${escapes.length > 3 ? ` +${escapes.length - 3}` : ''}` };
  }

  switch (pr.mergeStateStatus) {
    case 'DIRTY':    return { verdict: 'SKIP', reason: 'merge conflict — needs a human, do not auto-resolve generated files' };
    case 'BEHIND':   return { verdict: 'REBUILD', reason: 'behind main — rebase, rebuild, push, wait for green, then re-run this' };
    case 'BLOCKED':  return { verdict: 'SKIP', reason: 'blocked by branch protection or a required review' };
    case 'UNKNOWN':  return { verdict: 'WAIT', reason: 'mergeability not computed yet — re-run in a moment' };
    case 'CLEAN':
    case 'HAS_HOOKS':
    case 'UNSTABLE': return { verdict: 'MERGE', reason: 'green, in scope, up to date', routine: routine.name };
    default:         return { verdict: 'SKIP', reason: `unrecognised merge state ${pr.mergeStateStatus}` };
  }
}

if (process.argv.includes('--self-test')) {
  const base = { headRefName: 'wave-d20260729', isDraft: false, statusCheckRollup: [{ conclusion: 'SUCCESS' }], files: [{ path: 'data/quotes/x.json' }], mergeStateStatus: 'CLEAN' };
  const cases = [
    ['clean routine PR merges',        base, 'MERGE'],
    ['human branch left alone',        { ...base, headRefName: 'claude/whatever' }, 'HUMAN'],
    ['draft is skipped',               { ...base, isDraft: true }, 'SKIP'],
    ['failing CI is skipped',          { ...base, statusCheckRollup: [{ conclusion: 'FAILURE' }] }, 'SKIP'],
    ['running CI waits',               { ...base, statusCheckRollup: [{ conclusion: 'PENDING' }] }, 'WAIT'],
    ['no checks is skipped',           { ...base, statusCheckRollup: [] }, 'SKIP'],
    ['behind main rebuilds',           { ...base, mergeStateStatus: 'BEHIND' }, 'REBUILD'],
    ['conflict is skipped',            { ...base, mergeStateStatus: 'DIRTY' }, 'SKIP'],
    ['wave touching tools/ escapes',   { ...base, files: [{ path: 'tools/template.js' }] }, 'SKIP'],
    ['wave touching worker/ escapes',  { ...base, files: [{ path: 'worker/src/index.js' }] }, 'SKIP'],
    ['discovery may edit detectors',   { ...base, headRefName: 'discovery/2026-08-03', files: [{ path: 'tools/detectors.js' }] }, 'MERGE'],
    ['discovery may NOT edit template',{ ...base, headRefName: 'discovery/2026-08-03', files: [{ path: 'tools/template.js' }] }, 'SKIP'],
    ['merge pass may merge its own log PR', { ...base, headRefName: 'merge/2026-07-30', files: [{ path: 'data/routine-log/x.jsonl' }] }, 'MERGE'],
  ];
  let bad = 0;
  for (const [name, pr, want] of cases) {
    const got = decide(pr).verdict;
    if (got !== want) { console.error(`  ✗ ${name}: expected ${want}, got ${got}`); bad++; }
  }
  if (bad) { console.error(`\n  ${bad} of ${cases.length} merge-gate cases failed.\n`); process.exit(1); }
  console.log(`  ✓ merge-gate decision function (${cases.length} cases: scope, CI, staleness, drafts, per-routine tools/ allowance)`);
  process.exit(0);
}

// REST, not `gh pr list --json`. That used GraphQL, which the cloud egress proxy refuses, and `gh`
// is not installed there either — so this tool hard-failed in the one environment the merge pass
// actually runs in, and the 2026-07-29 run only worked by hand-building a shim it then threw away.
//
// tools/gh-rest.js needs no credential: this repo is public and anonymous REST answers every read
// here. Measured, not assumed — 200 on pulls, checks and files at a 60/hr limit against ~57 requests
// worst case. decide() is untouched and still takes the same plain object.
const ghRest = require('./gh-rest');

(async () => {
  let prs = [];
  try {
    prs = await ghRest.listOpenPRs();
  } catch (e) {
    // LOUD. This is the one failure mode that must never read as "no open PRs" — that is the
    // difference between a quiet morning and a merge pass that cannot see anything.
    console.error(`  ! cannot list PRs: ${(e && e.message) || e}`);
    process.exit(1);
  }

  // Oldest first. A routine's PR should not jump the queue because it happened to run later, and
  // merging in creation order keeps the rebuild cascade predictable.
  prs.sort((a, b) => a.number - b.number);
  const decisions = prs.map((pr) => ({ number: pr.number, title: pr.title, branch: pr.headRefName, url: pr.url, ...decide(pr) }));

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ decisions }, null, 2));
    process.exit(0);
  }

  if (!decisions.length) { console.log('  no open PRs'); process.exit(3); }
  console.log(`\n  ${decisions.length} open PR(s):\n`);
  for (const d of decisions) console.log(`    ${String(d.verdict).padEnd(8)} #${String(d.number).padEnd(5)} ${String(d.branch).slice(0, 34).padEnd(36)} ${d.reason}`);

  const mergeable = decisions.filter((d) => d.verdict === 'MERGE');
  const rebuild = decisions.filter((d) => d.verdict === 'REBUILD');
  console.log(`\n  => ${mergeable.length} to merge, ${rebuild.length} needing a rebase+rebuild, ${decisions.length - mergeable.length - rebuild.length} left alone\n`);
  if (mergeable.length) console.log(`  MERGE ONE, then re-run this. Each merge puts every other branch BEHIND and invalidates its build.\n`);
  // 0 = something to merge now; 4 = only rebuilds pending; 3 = nothing to do.
  process.exit(mergeable.length ? 0 : (rebuild.length ? 4 : 3));
})();
