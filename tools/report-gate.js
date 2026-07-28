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
 *   node tools/report-gate.js --fixes <current-fixes.json> --audit <journal.jsonl> [--dry-run]
 *   node tools/report-gate.js --queue            print the deferred queue
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
const loadQueue = () => readJson(QUEUE, { deferred: [] });
const saveQueue = (q) => fs.writeFileSync(QUEUE, JSON.stringify(q, null, 2) + '\n');

if (has('--queue')) {
  const q = loadQueue();
  if (!q.deferred.length) { console.log('  report queue empty'); process.exit(0); }
  console.log(`  ${q.deferred.length} deferred item(s):`);
  for (const d of q.deferred) console.log(`    [${d.reason}] ${d.slug} — ${String(d.detail || '').slice(0, 100)}`);
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

const openPr = decision.pr.length > 0 && !scopeEscape;
console.log(`\n  => ${openPr ? 'OPEN A PR' : 'NO PR — queue only'}\n`);

if (!has('--dry-run')) {
  const q = loadQueue();
  const seen = new Set(q.deferred.map((d) => d.slug + '|' + d.reason));
  for (const d of decision.queue) if (!seen.has(d.slug + '|' + d.reason)) q.deferred.push(d);
  saveQueue(q);
}
process.exit(openPr ? 0 : 3);   // 3 = nothing to PR, so the caller can skip the build/commit steps
