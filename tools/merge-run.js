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

async function main() {
  const merged = [];
  const notes = [];
  // Bounded: each iteration must merge exactly one PR or stop. The cap is a runaway guard, not a
  // policy — a night with more than this many routine PRs is itself worth a human look.
  for (let round = 0; round < 12; round++) {
    const decisions = gate();
    const next = decisions.find((d) => d.verdict === 'MERGE');
    if (!next) {
      const waiting = decisions.filter((d) => d.verdict === 'WAIT').map((d) => `#${d.number}`);
      const rebuild = decisions.filter((d) => d.verdict === 'REBUILD').map((d) => `#${d.number}`);
      if (waiting.length) notes.push(`WAIT: ${waiting.join(' ')} — CI still running, they merge next pass`);
      if (rebuild.length) notes.push(`REBUILD: ${rebuild.join(' ')} — behind main, need rebuild+green before they can merge`);
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
  if (writeToken() === 'proxy-injected') { console.error('  ✗ placeholder token not filtered'); bad++; }
  if (bad) { console.error(`\n  ${bad} merge-run case(s) failed.\n`); process.exit(1); }
  console.log(`  ✓ merge-run planner (${cases.length} cases: pick-first-MERGE, clean stop, HUMAN never picked)`);
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
