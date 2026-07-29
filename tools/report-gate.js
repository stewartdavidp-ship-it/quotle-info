#!/usr/bin/env node
'use strict';
/*
 * report-gate.js — decides whether a night's reader-report work becomes a PR or goes to a queue.
 *
 * WHY A GATE AT ALL
 * The input is anonymous. An automated path from "a stranger typed something" to "a PR against a
 * provenance site" has to earn each step, and the earning happens AFTER audit.js has actually
 * re-fetched the sources and a skeptic has tried to refute the finding — not at intake, where all
 * we have is the claim. Deciding at intake would be guessing; deciding here is reading evidence.
 *
 * THE FOUR GATES (all must hold, or it queues)
 *   1. skeptic CONFIRMED the finding      — ~15-20% of audit findings get refuted. A PR built on an
 *                                           unconfirmed finding trains the reviewer to skim.
 *   2. severity is blocker or high        — medium/minor is a long tail; a PR per nit trains the
 *                                           same habit, so those batch into the next wave instead.
 *   3. fix.js produced a REAL diff in     — no diff means nothing was actionable, whatever the
 *      data/quotes or data/songs            audit said. This is the difference between a finding
 *                                           and a change.
 *   4. scope gate clean + build green     — `git status --porcelain -- tools workflows` must be
 *                                           empty. r20's fix agents escaped into template.js and
 *                                           shipped +94/-14 of generator change inside a content
 *                                           wave; this is the guard that would have caught it.
 *
 * WHAT QUEUES INSTEAD (each is a real outcome, not a failure)
 *   · audit PASSED            → the reader was wrong; close the report with the verdict
 *   · skeptic REFUTED         → same, close with the refutation
 *   · only medium/minor       → record it; the next content wave picks it up
 *   · generator-level finding → applied ONCE, centrally, as its own commit. Never inside an
 *                               automated content PR — that is the r20 rule, and it is the reason
 *                               fix agents are told to report rather than edit.
 *   · blocker beyond audit    → leave the report open and flag the record for a human
 *
 * VOLUME
 * MAX_RECORDS caps a run so a flood of reports on one slug cannot produce a 200-file PR, and one
 * run makes at most ONE PR — batched, with the reports it closes listed. The cost per night is
 * therefore bounded and predictable, which is what makes running it unattended defensible.
 *
 * THE TRUST LADDER — the gate's authority is EARNED, and the promotion bar is a number.
 *
 *   observe   run every gate, record what it WOULD have done, change nothing   ← starts here
 *   pr        open the PR, stop
 *   merge     merge on green CI
 *
 * "If we believe the gate holds" is a feeling until it has a threshold. The bar, agreed with the
 * operator: 5 CONSECUTIVE runs where the gate's call matched theirs — no PR they would have
 * rejected, no queued item they would have wanted as a PR. Miss one and the counter resets to zero.
 * Five is arbitrary; a stated threshold is not.
 *
 * Each run appends its decision to `runs` in data/report-queue.json, so promotion is a judgement on
 * a RECORD rather than on somebody's memory of how the last few nights went. Only runs that
 * actually made a call are recorded — a night with no pending reports exits before this file runs
 * and tests nothing, so it must not count toward the streak.
 *
 *   node tools/report-gate.js --fixes <current-fixes.json> [--dry-run]
 *   node tools/report-gate.js --queue                        print the deferred queue
 *   node tools/report-gate.js --mode                         current rung, streak, last runs
 *   node tools/report-gate.js --judge agree|disagree [--note ...]   operator verdict on the last run
 *   node tools/report-gate.js --promote                      advance a rung once the bar is met
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const QUEUE = path.join(ROOT, 'data', 'report-queue.json');
const MAX_RECORDS = 10;
const ACTIONABLE = new Set(['blocker', 'high']);

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};
const has = (name) => process.argv.includes(name);

const readJson = (p, dflt) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; } };
const RUNGS = ['observe', 'pr', 'merge'];
const loadQueue = () => {
  const q = readJson(QUEUE, {});
  return { mode: 'observe', promoteAt: 5, streak: 0, deferred: [], runs: [], ...q };
};
const saveQueue = (q) => fs.writeFileSync(QUEUE, JSON.stringify(q, null, 2) + '\n');
const today = () => new Date().toISOString().slice(0, 10);

if (has('--queue')) {
  const q = loadQueue();
  if (!q.deferred.length) { console.log('  report queue empty'); process.exit(0); }
  console.log(`  ${q.deferred.length} deferred item(s):`);
  for (const d of q.deferred) console.log(`    [${d.reason}] ${d.slug} — ${String(d.detail || '').slice(0, 100)}`);
  process.exit(0);
}

if (has('--mode')) {
  const q = loadQueue();
  const unjudged = q.runs.filter((r) => !r.judged).length;
  console.log(`  mode: ${q.mode}   streak: ${q.streak}/${q.promoteAt}   runs recorded: ${q.runs.length}${unjudged ? ` (${unjudged} awaiting the operator's verdict)` : ''}`);
  for (const r of q.runs.slice(-8)) {
    console.log(`    ${r.date}  ${String(r.mode).padEnd(8)}${String(r.call).padEnd(10)}pr=${r.pr.length} queued=${r.queued.length}  ${r.judged || 'UNJUDGED'}${r.note ? ` — ${r.note}` : ''}`);
  }
  const next = RUNGS[RUNGS.indexOf(q.mode) + 1];
  if (!next) console.log('\n  top rung — nothing above merge.');
  else if (q.streak >= q.promoteAt) console.log(`\n  bar met. \`node tools/report-gate.js --promote\` moves to ${next}.`);
  else console.log(`\n  ${q.promoteAt - q.streak} more matching run(s) to reach ${next}.`);
  process.exit(0);
}

// The operator's verdict on the most recent run. This is the ONLY thing that moves the streak —
// the gate never grades its own homework, which is the entire point of the ladder.
if (has('--judge')) {
  const verdict = arg('--judge');
  if (!['agree', 'disagree'].includes(verdict)) { console.error('  usage: --judge agree|disagree [--note "..."]'); process.exit(1); }
  const q = loadQueue();
  const run = [...q.runs].reverse().find((r) => !r.judged);
  if (!run) { console.log('  no unjudged run to grade'); process.exit(0); }
  run.judged = verdict;
  if (arg('--note')) run.note = arg('--note');
  q.streak = verdict === 'agree' ? q.streak + 1 : 0;
  saveQueue(q);
  console.log(`  ${run.date} run judged ${verdict} — streak now ${q.streak}/${q.promoteAt}`);
  process.exit(0);
}

if (has('--promote')) {
  const q = loadQueue();
  const next = RUNGS[RUNGS.indexOf(q.mode) + 1];
  if (!next) { console.log(`  already at ${q.mode} — the top rung`); process.exit(0); }
  if (q.streak < q.promoteAt) {
    console.error(`  ✗ bar not met: ${q.streak}/${q.promoteAt} consecutive matching runs. Not promoting.`);
    process.exit(1);
  }
  q.mode = next;
  q.streak = 0;   // the next rung earns its own record; a streak is not transferable between rungs
  saveQueue(q);
  console.log(`  promoted to ${next}. Streak reset — ${q.promoteAt} runs at this rung before the next.`);
  process.exit(0);
}

const fixesPath = arg('--fixes');
if (!fixesPath) { console.error('  usage: report-gate.js --fixes <current-fixes.json> [--dry-run]'); process.exit(1); }
const fixes = readJson(fixesPath, null);
if (!fixes) { console.error(`  cannot read ${fixesPath}`); process.exit(1); }

// ---- gate 1 + 2: what survived the skeptic, and at what severity ----
// parse-audit.js has already dropped skeptic-REFUTED findings (it pairs verdicts by {slug,location}
// and prints each drop). So anything still present here is confirmed by construction — the gate is
// "is it still here", not a second re-derivation of the skeptic's work.
const bySlug = {};
for (const [slug, items] of Object.entries(fixes)) {
  const actionable = (items || []).filter((i) => ACTIONABLE.has(i.severity));
  const lesser = (items || []).filter((i) => !ACTIONABLE.has(i.severity));
  bySlug[slug] = { actionable, lesser };
}

// ---- gate 4: scope. Fix agents may edit ONLY their own record. ----
const scopeEscape = execFileSync('git', ['status', '--porcelain', '--', 'tools', 'workflows'], { cwd: ROOT, encoding: 'utf8' }).trim();

// ---- gate 3: did anything actually change on disk? ----
const changed = execFileSync('git', ['status', '--porcelain', '--', 'data/quotes', 'data/songs'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
const changedSlugs = new Set(changed.map((f) => path.basename(f, '.json')));

const decision = { pr: [], queue: [] };
for (const [slug, g] of Object.entries(bySlug)) {
  const bare = slug.replace(/^song:/, '');
  if (!g.actionable.length) {
    decision.queue.push({ slug, reason: g.lesser.length ? 'only-medium-minor' : 'nothing-confirmed',
      detail: g.lesser.length ? `${g.lesser.length} lesser finding(s) — batch into the next wave` : 'audit passed or every finding was refuted' });
    continue;
  }
  if (!changedSlugs.has(bare)) {
    decision.queue.push({ slug, reason: 'no-diff', detail: `${g.actionable.length} confirmed finding(s) but the record did not change — needs a human` });
    continue;
  }
  decision.pr.push({ slug, findings: g.actionable.length });
}

// Volume cap. Stated out loud when it bites — a silent truncation reads as "we handled everything".
let capped = 0;
if (decision.pr.length > MAX_RECORDS) {
  capped = decision.pr.length - MAX_RECORDS;
  for (const extra of decision.pr.slice(MAX_RECORDS)) {
    decision.queue.push({ slug: extra.slug, reason: 'over-cap', detail: `deferred by the ${MAX_RECORDS}-record cap; will be picked up next run` });
  }
  decision.pr = decision.pr.slice(0, MAX_RECORDS);
}

console.log(`\n  gate: ${decision.pr.length} record(s) qualify for a PR · ${decision.queue.length} queued`);
if (scopeEscape) {
  console.log('\n  ✗ SCOPE GATE FAILED — an agent edited tools/ or workflows/:');
  scopeEscape.split('\n').forEach((l) => console.log(`      ${l}`));
  console.log('  No PR. Generator findings are applied once, centrally, as their own commit.');
}
for (const p of decision.pr) console.log(`    PR    ${p.slug}  (${p.findings} confirmed blocker/high)`);
for (const q of decision.queue) console.log(`    QUEUE ${q.slug}  [${q.reason}] ${q.detail}`);
if (capped) console.log(`\n  NOTE: ${capped} record(s) held back by the ${MAX_RECORDS}-record cap — not dropped, queued.`);

// ---- the four gates have spoken; the LADDER decides how much of it we act on ----
const queue = loadQueue();
const qualifies = decision.pr.length > 0 && !scopeEscape;
const call = qualifies ? 'would-pr' : 'queue-only';

// In `observe` the gate is fully exercised and then obeyed by nobody. That is not a dry run for its
// own sake: the record it leaves is the evidence the operator grades, and grading is the only thing
// that moves the ladder. A rung that acts before it has a record is exactly the assumption this
// whole structure exists to avoid making.
const act = qualifies && queue.mode !== 'observe';

console.log(`  mode: ${queue.mode}  (streak ${queue.streak}/${queue.promoteAt})`);
if (queue.mode === 'observe' && qualifies) {
  console.log(`\n  => OBSERVE — would have opened a PR for ${decision.pr.length} record(s). Opening none.`);
  console.log('     Grade this call: node tools/report-gate.js --judge agree|disagree --note "…"');
} else if (act) {
  console.log(`\n  => OPEN A PR${queue.mode === 'merge' ? ' — and merge it on green CI' : ' — and stop there'}\n`);
} else {
  console.log('\n  => NO PR — queue only\n');
}

if (!has('--dry-run')) {
  const seen = new Set(queue.deferred.map((d) => d.slug + '|' + d.reason));
  for (const d of decision.queue) if (!seen.has(d.slug + '|' + d.reason)) queue.deferred.push(d);
  // One entry per run that actually made a call. Appended, never rewritten, so the streak is a
  // judgement on a record rather than on a memory of how the last few nights went.
  queue.runs.push({
    date: today(), mode: queue.mode, call, acted: act,
    pr: decision.pr.map((p) => p.slug),
    queued: decision.queue.map((d) => ({ slug: d.slug, reason: d.reason })),
    scopeEscape: scopeEscape ? scopeEscape.split('\n').length : 0,
    capped, judged: null,
  });
  saveQueue(queue);
}

// 0 = act on it. 3 = nothing to do, so the caller skips build/commit/PR entirely. `observe` always
// returns 3: it has decided, and decided to do nothing.
process.exit(act ? 0 : 3);
