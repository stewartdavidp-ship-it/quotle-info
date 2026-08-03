#!/usr/bin/env node
'use strict';
/*
 * merge-run.js — EXECUTES the merge pass that merge-gate.js decides.
 *
 * WHY THIS EXISTS AS CODE AND NOT AS A PROMPT
 * The merge authority was an unattended LLM session reading workflows/DAILY-MERGE.md. Every
 * decision it made was already encoded in merge-gate.js — its own prompt is largely a list of
 * things NOT to decide ("the gate decides, never you"). So the agent contributed no judgement and
 * three failure modes:
 *   1. it could not run where it was scheduled (cloud has no `gh`, and the proxy-injected API
 *      identity has permissions.push=false — measured 2026-07-30, probe/cloud-auth-2026-07-30),
 *   2. a stop left NO artifact anywhere: persist_session=false, no run history, and the log line is
 *      only written when there is something to merge, so a failed night looked exactly like a quiet
 *      one — the precise outcome preflight.js exists to prevent,
 *   3. the procedure lived in prose, so it drifted from the code (DAILY-MERGE.md still described
 *      itself as running Local weeks after it moved).
 * A deterministic function of GitHub state belongs in a file with a self-test, invoked by a
 * scheduler that keeps run logs. That is .github/workflows/merge.yml calling this.
 *
 *   node tools/merge-run.js              decide and print; changes NOTHING (safe anywhere)
 *   node tools/merge-run.js --execute    actually merge; needs a write-capable token
 *   node tools/merge-run.js --self-test  exercise the planner over fixtures, no network
 *
 * SEPARATION OF POWERS, deliberately kept: merge-gate.js still DECIDES and still never merges — its
 * header promises that and this file does not make it a liar. This file only carries out MERGE
 * verdicts, and it re-asks the gate between every merge because branch protection is strict:true,
 * so one merge puts every other PR BEHIND and invalidates the plan computed a moment ago.
 */
const { execFileSync } = require('child_process');
const path = require('path');
require('./proxy-boot')();

const ROOT = path.resolve(__dirname, '..');
const REPO = process.env.QUOTLE_REPO || 'stewartdavidp-ship-it/quotle-info';
const API = 'https://api.github.com';
const EXECUTE = process.argv.includes('--execute');

// THE STALL THIS EXISTS TO REMOVE (diagnosed 2026-08-03, four runs deep).
// GitHub computes a PR's mergeable_state lazily and invalidates it for EVERY open PR on every push
// to main. So the first read after main moves returns `unknown` across the board — and that read is
// itself what schedules the recompute, which lands a few seconds later. merge-gate maps `unknown` to
// WAIT/mergeability-unknown and says "re-run in a moment"; nothing ever did.
//
// The cost was not subtle. This pass merges ONE PR per round and re-asks the gate between merges
// (strict:true makes that mandatory). But merging is itself a push to main, so round N+1's read was
// always the poisoned first-read — every run merged exactly one PR and stopped:
//   08-01 merged #295 then stalled · 08-02 merged #296 then stalled · 07-31 and 08-03 merged nothing.
//
// THIS FIX IS NECESSARY AND NOT SUFFICIENT — measured, do not let the next reader assume otherwise.
// A dispatch on 2026-08-03T18:28Z merged #301 and stalled exactly as above. Reading every open PR
// immediately afterwards: ONE was DIRTY and all FIFTEEN others were BEHIND — including the PR
// carrying this very patch. main is protected with strict:true and `verify` required, so each merge
// puts every other branch out of date, and each must then be rebuilt AND pass a fresh verify run
// before it may merge. That is a quadratic rebuild cascade, not a re-poll problem, and it is the
// larger half of why a queue that gains ~4 PRs a night cannot drain. Removing the stall lets a pass
// merge one PR and then rebuild the rest in the same run instead of stopping blind; it does not make
// a pass drain the queue. The structural options — relaxing strict for log-only PRs, or not
// committing generated output at all — are a decision above this file's pay grade.
//
// Budget: a gate() call costs ~14 REST requests per open PR (detail + check-runs + paginated files),
// so re-polling is not free. merge.yml supplies GH_TOKEN, so these run at 5000/hr rather than the
// anonymous 60 — a bounded handful of extra reads per round is affordable there and nowhere else.
const UNKNOWN_RETRIES = 4;
const UNKNOWN_DELAY_MS = 6000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The token must be able to WRITE. GITHUB_TOKEN reads as the literal 'proxy-injected' placeholder in
// the cloud sandbox — sending that as a Bearer is worse than sending nothing, so it is filtered here
// exactly as tools/gh-rest.js filters it for reads.
function writeToken() {
  const t = process.env.MERGE_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  return t && t !== 'proxy-injected' ? t : '';
}

async function ghWrite(method, pathAndQuery, body) {
  const token = writeToken();
  if (!token) throw new Error('no write-capable token — set MERGE_TOKEN (or GH_TOKEN)');
  const r = await fetch(`${API}${pathAndQuery}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'quotle.info-merge-run/1.0',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, ok: r.ok, body: text.slice(0, 400) };
}

// Ask the gate. Shelled out rather than required: merge-gate.js runs its pass at load time, so
// requiring it would execute it. --json is its machine-readable contract.
function gate() {
  const out = execFileSync('node', [path.join(ROOT, 'tools', 'merge-gate.js'), '--json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(out);
  // --json emits { decisions: [...] }. Tolerate a bare array too, so a future shape change surfaces
  // as "no MERGE found" rather than a TypeError three frames deep.
  const list = Array.isArray(parsed) ? parsed : (parsed && parsed.decisions);
  if (!Array.isArray(list)) throw new Error('merge-gate --json did not return decisions[]');
  return list;
}

// A merge that 409s is NOT a failure — it means the head moved between the gate's read and the write
// (another merge landed, or CI pushed). That is expected under strict:true and the correct response
// is to re-ask the gate, not to stop the night. 405 means GitHub refused (not mergeable / protection),
// which IS a stop for that PR but not for the pass.
const RETRYABLE = new Set([409]);

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitTry = (...args) => { try { return { ok: true, out: git(...args) }; } catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() }; } };

// WHICH CONFLICTS A REBUILD CAN HONESTLY RESOLVE.
// Generated output is a pure function of the source records, so a conflict in it carries no
// information — both sides are stale the moment build.js runs. Taking either side and rebuilding is
// not "resolving a conflict", it is discarding two derived artefacts and recomputing the right one.
// A conflict in SOURCE is the opposite: it is two humans' (or two agents') intent disagreeing, and
// nothing here is entitled to pick. So the rule is a whitelist of source paths, and anything that
// touches one is handed back untouched.
//
// This is the mechanised form of DAILY-MERGE.md's "do NOT hand-resolve built output — take the
// source records and rebuild". The blanket version of that (`git checkout origin/main -- .`) is
// explicitly wrong and was tried: on a PR whose only change is a log line it discards the entire PR
// and leaves it empty. Hence per-path, and only for paths that are genuinely derived.
//
// The classifier itself moved to tools/derived-paths.js on 2026-08-03, when merge-gate needed the
// same question answered for staleness. It was defined here first; it is not defined here any more,
// because two copies of one rule is the defect this repo repeats most.
const { source: sourceConflicts } = require('./derived-paths');

// Bring ONE branch current with main and rebuild it. Never merges it — the doc's rule, and a real
// constraint: the required `verify` check has to run against the new head before anything may merge,
// so this pushes and stops. The PR merges on the next pass.
//
// MERGE, never rebase: force-pushes are denied by branch protection (allow_force_pushes:false), so a
// rebase would produce a branch that cannot be pushed at all.
function rebuild(pr) {
  const branch = pr.branch;
  git('fetch', 'origin', 'main', branch);
  const co = gitTry('checkout', '-B', branch, `origin/${branch}`);
  if (!co.ok) return `#${pr.number} rebuild: cannot check out ${branch} — ${co.out.slice(0, 160)}`;

  const m = gitTry('merge', '--no-edit', 'origin/main');
  if (!m.ok) {
    const conflicted = gitTry('diff', '--name-only', '--diff-filter=U').out.split('\n').filter(Boolean);
    const blocking = sourceConflicts(conflicted);
    if (blocking.length) {
      gitTry('merge', '--abort');
      return `#${pr.number} rebuild ABANDONED — conflict in SOURCE (${blocking.slice(0, 3).join(', ')}). A person decides this, not a rebuild.`;
    }
    // Generated-only: take either side, then recompute. build.js overwrites all of it anyway.
    for (const p of conflicted) { gitTry('checkout', '--theirs', '--', p); gitTry('add', '--', p); }
    const cont = gitTry('commit', '--no-edit');
    if (!cont.ok) return `#${pr.number} rebuild: could not conclude the merge — ${cont.out.slice(0, 160)}`;
  }

  execFileSync('node', [path.join(ROOT, 'tools', 'build.js')], { cwd: ROOT, stdio: 'ignore' });
  execFileSync('node', [path.join(ROOT, 'tools', 'scan.js')], { cwd: ROOT, stdio: 'ignore' });
  gitTry('add', '-A');
  const staged = gitTry('diff', '--cached', '--name-only').out;
  if (staged) git('commit', '-m', 'Bring branch current with main and rebuild');

  const push = gitTry('push', 'origin', `HEAD:${branch}`);
  if (!push.ok) return `#${pr.number} rebuild built but PUSH FAILED — ${push.out.slice(0, 200)}`;
  return `#${pr.number} rebuilt and pushed — merges next pass, once verify is green on the new head`;
}

// PURE, so --self-test can drive it without a network: should this round wait and re-ask rather than
// conclude? Only when there is nothing to merge AND at least one PR is stuck behind a computation
// GitHub has not finished. Note what is NOT here: `ci-running` never re-polls, so a genuinely quiet
// queue still stops immediately and a red morning is never mistaken for a slow one.
const shouldRepoll = (decisions) =>
  !decisions.some((d) => d.verdict === 'MERGE') &&
  decisions.some((d) => d.code === 'mergeability-unknown');

async function main() {
  const merged = [];
  const notes = [];
  // Bounded: each iteration must merge exactly one PR or stop. The cap is a runaway guard, not a
  // policy — a night with more than this many routine PRs is itself worth a human look.
  for (let round = 0; round < 12; round++) {
    let decisions = gate();
    let next = decisions.find((d) => d.verdict === 'MERGE');

    // Settle the transient before concluding anything. Only `mergeability-unknown` is worth waiting
    // out: it resolves with no new CI and no push, purely because GitHub finished a computation our
    // last read triggered. A `ci-running` WAIT is a real wait and is NOT retried here — CI takes
    // minutes, this pass is not a place to burn them.
    for (let retry = 0; retry < UNKNOWN_RETRIES && shouldRepoll(decisions); retry++) {
      const pending = decisions.filter((d) => d.code === 'mergeability-unknown').length;
      notes.push(`re-poll ${retry + 1}/${UNKNOWN_RETRIES}: ${pending} PR(s) with mergeability not yet computed — waiting ${UNKNOWN_DELAY_MS / 1000}s`);
      await sleep(UNKNOWN_DELAY_MS);
      decisions = gate();
      next = decisions.find((d) => d.verdict === 'MERGE');
    }

    if (!next) {
      const stale = decisions.filter((d) => d.verdict === 'REBUILD');
      // Report each WAIT under the gate's OWN reason. This line used to hardcode "CI still running"
      // over every WAIT, which put #287 — a permanent merge conflict with no CI activity for days —
      // in a CI-blamed list in four consecutive runs, and sent every reader looking at the wrong
      // subsystem. The gate knows why it is waiting; say what it said.
      const byReason = new Map();
      for (const d of decisions.filter((x) => x.verdict === 'WAIT')) {
        if (!byReason.has(d.reason)) byReason.set(d.reason, []);
        byReason.get(d.reason).push(`#${d.number}`);
      }
      for (const [reason, prs] of byReason) {
        const stillUnknown = reason.startsWith('mergeability not computed');
        notes.push(`WAIT: ${prs.join(' ')} — ${reason}${stillUnknown ? ` (unresolved after ${UNKNOWN_RETRIES} re-polls — that is a real GitHub stall, not a quiet queue)` : ', they merge next pass'}`);
      }
      if (stale.length && !EXECUTE) {
        notes.push(`REBUILD: ${stale.map((d) => `#${d.number}`).join(' ')} — behind main (dry run, not rebuilt)`);
      } else if (stale.length) {
        // A rebuild rewrites the working tree, so it must own the checkout. Refusing on a dirty tree
        // is the same rule preflight applies — "something else is using this checkout".
        if (gitTry('status', '--porcelain').out) {
          notes.push(`REBUILD: ${stale.length} branch(es) behind main, SKIPPED — working tree is dirty`);
        } else {
          const back = gitTry('rev-parse', '--abbrev-ref', 'HEAD').out;
          for (const d of stale) { try { notes.push(rebuild(d)); } catch (e) { notes.push(`#${d.number} rebuild threw: ${(e && e.message) || e}`); } }
          gitTry('checkout', back || 'main');
        }
      }
      break;
    }
    if (!EXECUTE) { merged.push(`${next.number} (dry-run)`); break; }
    const r = await ghWrite('PUT', `/repos/${REPO}/pulls/${next.number}/merge`, { merge_method: 'squash' });
    if (r.ok) { merged.push(String(next.number)); continue; }
    if (RETRYABLE.has(r.status)) { notes.push(`#${next.number} 409 — head moved mid-pass, re-asking the gate`); continue; }
    notes.push(`#${next.number} merge refused: HTTP ${r.status} ${r.body}`);
    break;
  }
  return { merged, notes };
}

if (process.argv.includes('--self-test')) {
  // The planner's contract: pick the FIRST MERGE, and stop cleanly when there is none. Anything
  // richer belongs to decide(), which has its own fixtures in merge-gate.js.
  const pick = (ds) => (ds.find((d) => d.verdict === 'MERGE') || null);
  const cases = [
    ['picks the first MERGE', [{ number: 1, verdict: 'WAIT' }, { number: 2, verdict: 'MERGE' }], 2],
    ['no MERGE is a clean stop', [{ number: 1, verdict: 'SKIP' }, { number: 2, verdict: 'REBUILD' }], null],
    ['HUMAN is never picked', [{ number: 9, verdict: 'HUMAN' }], null],
  ];
  let bad = 0;
  for (const [name, ds, want] of cases) {
    const got = pick(ds); const n = got ? got.number : null;
    if (n !== want) { console.error(`  ✗ ${name}: expected ${want}, got ${n}`); bad++; }
  }
  // The re-poll predicate. Its permissive failure wastes a few seconds; its restrictive failure is
  // the 2026-08-03 stall — one PR merged per run while the queue grew four a night — so it is
  // fixtured in both directions.
  const repollCases = [
    ['uncomputed mergeability re-polls',    [{ verdict: 'WAIT', code: 'mergeability-unknown' }], true],
    ['a CI wait does NOT re-poll',          [{ verdict: 'WAIT', code: 'ci-running' }], false],
    ['a MERGE outranks any transient',      [{ verdict: 'MERGE', code: 'ready' }, { verdict: 'WAIT', code: 'mergeability-unknown' }], false],
    ['a genuinely quiet queue stops',       [{ verdict: 'SKIP', code: 'merge-conflict' }], false],
    ['mixed waits still re-poll',           [{ verdict: 'WAIT', code: 'ci-running' }, { verdict: 'WAIT', code: 'mergeability-unknown' }], true],
  ];
  for (const [name, ds, want] of repollCases) {
    const got = shouldRepoll(ds);
    if (got !== want) { console.error(`  ✗ ${name}: expected ${want}, got ${got}`); bad++; }
  }
  if (writeToken() === 'proxy-injected') { console.error('  ✗ placeholder token not filtered'); bad++; }
  // The conflict classifier decides whether a rebuild may proceed without a human. Getting it wrong
  // in the permissive direction means silently discarding somebody's record edit, so it is fixtured.
  const conflictCases = [
    ['generated output is rebuildable', ['who-said/x/index.html', 'search.json', 'sitemap.xml'], 0],
    ['a quote record is NOT', ['who-said/x/index.html', 'data/quotes/x.json'], 1],
    ['tools/ is NOT', ['tools/template.js'], 1],
    ['a routine-log shard is NOT', ['data/routine-log/2026-07-30-wave.jsonl'], 1],
    ['workflows/ is NOT', ['workflows/DAILY-MERGE.md'], 1],
    ['derived data under data/ is rebuildable', ['data/manifest.json', 'data/corpus-state.json'], 0],
  ];
  for (const [name, paths, want] of conflictCases) {
    const got = sourceConflicts(paths).length;
    if ((got > 0) !== (want > 0)) { console.error(`  ✗ ${name}: expected ${want ? 'blocked' : 'rebuildable'}, got ${got} source conflict(s)`); bad++; }
  }
  if (bad) { console.error(`\n  ${bad} merge-run case(s) failed.\n`); process.exit(1); }
  console.log(`  ✓ merge-run planner (${cases.length + repollCases.length + conflictCases.length} cases: pick-first-MERGE, clean stop, HUMAN never picked, transient-vs-real WAIT, source-vs-generated conflicts)`);
  process.exit(0);
}

main().then(({ merged, notes }) => {
  console.log(`\n  merge-run${EXECUTE ? '' : ' (DRY RUN — pass --execute to act)'}`);
  console.log(`\n    merged: ${merged.length ? merged.map((n) => `#${n}`).join(' ') : 'nothing'}`);
  notes.forEach((n) => console.log(`    · ${n}`));
  console.log('');
}).catch((e) => {
  // LOUD, and non-zero. A merge pass that cannot run must not exit 0 — that is indistinguishable
  // from a quiet night, which is the whole failure this file replaces.
  console.error(`\n  ✗ merge-run failed: ${(e && e.message) || e}\n`);
  process.exit(1);
});
