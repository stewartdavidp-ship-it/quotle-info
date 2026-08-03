#!/usr/bin/env node
'use strict';
/*
 * daily-report.js — gather the night's FACTS so the 08:00 pass can spend its judgement on meaning.
 *
 * WHY A TOOL AND NOT JUST A PROMPT. The report has to be trustworthy on the mornings nobody reads it
 * carefully, which means the numbers must not be re-derived by a model each time. Everything here is
 * mechanical: what ran, what merged, what is still open, what CI says, what the queues hold. The
 * routine's job is to say which of it MATTERS — a thing no script can do — and it should not also be
 * counting.
 *
 * It is also the answer to a specific failure: every environment problem this system hit presented as
 * "nothing happened". A routine that did not run at all and a routine that ran and found nothing look
 * identical in a chat log. They do not look identical here — a missing shard is a missing FILE.
 *
 *   node tools/daily-report.js            human-readable
 *   node tools/daily-report.js --json     machine-readable, for the routine to reason over
 *   node tools/daily-report.js --since 2026-07-29
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
// Must run before the first fetch: routes GitHub reads through the sandbox proxy (15000/hr) instead
// of direct-and-anonymous (60/hr on a SHARED cloud IP, measured at 0 remaining). No-op locally.
require('./proxy-boot')();

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const SINCE = arg('--since', new Date().toISOString().slice(0, 10));
const JSON_OUT = argv.includes('--json');

// FAILURES ARE RECORDED, NOT SWALLOWED. This helper used to return '' on any error, which flowed
// into JSON.parse -> [] -> "MERGED (0), OPEN none, tree clean" — a report of a perfect quiet morning,
// produced by a tool whose stated purpose (see the header) is that a routine which did not run and
// one that found nothing must not look identical. In cloud, where `gh --json` fails on GraphQL, that
// is exactly what it rendered while PRs rotted.
const toolFailures = [];
const sh = (c, a) => {
  try { return execFileSync(c, a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (e) { toolFailures.push(`${c} ${(a || [])[0] || ''}: ${String((e && e.message) || e).split('\n')[0].slice(0, 90)}`); return null; }
};
// null in (the sh() sentinel) means 'could not ask', which must not become an empty result.
const j = (s, d) => { if (s === null) return null; try { return JSON.parse(s); } catch { return d; } };

// EVERY routine that is supposed to run, so a SILENT ABSENCE is reportable. This is the whole point:
// a routine that never fired leaves no log line, and without an expected-set to compare against,
// "no line" is indistinguishable from "quiet night".
// `slotUtc` is the hour by which a run should have logged. Absence BEFORE that hour is not news;
// reporting it as DID NOT RUN is how this tool spent six days alarming that reports-close (12:00)
// had failed, in a report generated at 08:00. `dow` restricts a weekly routine to its own day.
const EXPECTED = [
  { routine: 'daily-wave', when: '03:00', slotUtc: 8, daily: true },
  { routine: 'daily-reports', when: '04:00', slotUtc: 9, daily: true },
  { routine: 'daily-review', when: '05:00', slotUtc: 10, daily: true },
  { routine: 'daily-merge', when: '07:00', slotUtc: 12, daily: true },
  { routine: 'reports-close', when: '12:00', slotUtc: 17, daily: true },
  // daily:false meant `missing` could never be true for it, so a weekly routine was never checked
  // AT ALL — not even on its own day. It is expected on Mondays and unremarkable otherwise.
  { routine: 'weekly-discovery', when: 'Mon 02:00', slotUtc: 7, daily: false, dow: 1 },
];

// Is this routine's slot in the past, on the day being reported? A report for an EARLIER date is
// always past-due; only a report about today has to respect the clock.
const NOW = new Date();
const IS_TODAY = SINCE === NOW.toISOString().slice(0, 10);
const SINCE_DOW = new Date(`${SINCE}T12:00:00Z`).getUTCDay();
function due(e) {
  if (e.dow !== undefined && e.dow !== SINCE_DOW) return false; // not its day at all
  if (!IS_TODAY) return true;
  return NOW.getUTCHours() >= e.slotUtc;
}

// ---- what ran ----
// READS BOTH LOG FORMATS. `routine-log.js` switched from one appended file to one file per run on
// 2026-07-29 (five branches conflicting on the same tail line); its own --report has always read
// both, but this tool read only the shard directory. On the first morning that mattered it showed
// `daily-wave: 1 run` when the wave had fired three times and one of those was an `error` — a hard
// failure rendered as a clean run, by the tool whose stated purpose is that those never look alike.
const seen = new Set();
const shards = [];
const ingest = (text, shard) => {
  for (const line of text.trim().split('\n')) {
    const e = j(line, null);
    if (!e) continue;
    // Dedupe on EXACT equality only. The transition day wrote some runs to both files; those lines
    // are byte-identical. A looser key (routine+outcome) would silently merge two real no-op runs,
    // and the alarm this tool exists to raise — "did not run" — is runs.length === 0, which no
    // amount of over-counting can suppress. So: collapse only what is provably the same line.
    const k = JSON.stringify(e);
    if (seen.has(k)) continue;
    seen.add(k);
    shards.push({ ...e, shard });
  }
};
try {
  const dir = path.join(ROOT, 'data', 'routine-log');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
    ingest(fs.readFileSync(path.join(dir, f), 'utf8'), f);
  }
} catch (_) {}
// Legacy single file: read-only, nothing appends to it, but it still carries history.
try { ingest(fs.readFileSync(path.join(ROOT, 'data', 'routine-log.jsonl'), 'utf8'), 'routine-log.jsonl'); } catch (_) {}
// A ROUTINE'S SHARD RIDES ON THE BRANCH THAT WROTE IT, so a routine whose PR has not merged is
// invisible here — this tool reads the working tree, which is main. That is not a corner case: it
// is the NORMAL state every morning, because each routine opens a PR and stops. For six consecutive
// days this printed DID NOT RUN against four routines that had all run and were sitting in the
// queue, and the reports had to carry a hand-written second column correcting their own tool.
// The shard list comes free — listOpenPRs already returns each PR's files — so this costs one
// contents read per shard, and only for shards that are actually unmerged.
async function ingestOpenBranchShards(ghRest, REPO) {
  let prs;
  try { prs = await ghRest.listOpenPRs(); }
  catch (e) { toolFailures.push(`open-branch shards: ${String((e && e.message) || e).slice(0, 90)}`); return; }
  const wanted = [];
  for (const pr of prs) {
    for (const f of pr.files || []) {
      if (/^data\/routine-log\/.+\.jsonl$/.test(f.path)) wanted.push({ pr: pr.number, ref: pr.headRefName, path: f.path });
    }
  }
  for (const w of wanted) {
    try {
      const d = await ghRest.api(`/repos/${REPO}/contents/${w.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(w.ref)}`);
      const text = Buffer.from(d.content || '', d.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
      ingest(text, `${w.path.split('/').pop()} (unmerged, PR #${w.pr})`);
    } catch (e) {
      // Named, not swallowed: a shard we could not read is a routine we cannot vouch for.
      toolFailures.push(`shard ${w.path} on #${w.pr}: ${String((e && e.message) || e).slice(0, 70)}`);
    }
  }
}

let ran = [];
const computeRan = () => {
  const todays = shards.filter((s) => s.date === SINCE);
  ran = EXPECTED.map((e) => {
    const runs = todays.filter((s) => s.routine === e.routine);
    const isDue = due(e);
    return {
      ...e,
      runs: runs.length,
      outcomes: runs.map((r) => r.outcome),
      notes: runs.map((r) => r.note).filter(Boolean),
      prs: runs.map((r) => r.pr).filter(Boolean),
      work: runs.reduce((n, r) => n + (r.built || 0) + (r.processed || 0) + (r.sampled || 0), 0),
      // Three states, not two. Absent-and-overdue is an alarm; absent-but-not-yet-due, and
      // not-scheduled-today, are simply not news.
      missing: runs.length === 0 && isDue,
      notYetDue: runs.length === 0 && !isDue && (e.dow === undefined || e.dow === SINCE_DOW),
      offDay: e.dow !== undefined && e.dow !== SINCE_DOW,
    };
  });
};
computeRan();

(async () => {

// ---- what merged / what is stuck ----
// GitHub reads go through tools/gh-rest.js rather than `gh`. `gh` is not installed in a cloud
// sandbox and the egress proxy refuses GraphQL, which `gh pr list --json` uses — that pairing is why
// this pass was pinned to the operator's laptop. REST needs no credential here: the repo is public
// and anonymous reads answer all three calls. Measured, not assumed: 200 on each, 60/hr limit
// against the 3 requests this makes.
const ghRest = require('./gh-rest');
let merged = [], open = [], ci = {};
try { merged = await ghRest.listMerged(SINCE); }
catch (e) { toolFailures.push(`merged PRs: ${(e && e.message) || e}`); }
try {
  open = (await ghRest.listOpenPRs()).map((p) => ({
    number: p.number, title: p.title, headRefName: p.headRefName,
    mergeStateStatus: p.mergeStateStatus, isDraft: p.isDraft, createdAt: p.createdAt,
  }));
} catch (e) { toolFailures.push(`open PRs: ${(e && e.message) || e}`); }

// Now that the network is available, fold in the shards still sitting on unmerged branches and
// recompute. Until this ran, every routine that had opened a PR and stopped read as DID NOT RUN.
await ingestOpenBranchShards(ghRest, process.env.QUOTLE_REPO || 'stewartdavidp-ship-it/quotle-info');
computeRan();

// ---- health ----
try { ci = await ghRest.latestRun('main'); }
catch (e) { toolFailures.push(`CI runs: ${(e && e.message) || e}`); }
const corpus = j(fs.existsSync(path.join(ROOT, 'data/corpus-state.json')) ? fs.readFileSync(path.join(ROOT, 'data/corpus-state.json'), 'utf8') : '', {});
const scan = j(fs.existsSync(path.join(ROOT, 'data/scan-state.json')) ? fs.readFileSync(path.join(ROOT, 'data/scan-state.json'), 'utf8') : '', { records: {} });
const flagged = Object.values(scan.records || {}).filter((r) => r.f && r.f.length).length;
const queue = j(fs.existsSync(path.join(ROOT, 'data/report-queue.json')) ? fs.readFileSync(path.join(ROOT, 'data/report-queue.json'), 'utf8') : '', {});
const dirtyRaw = sh('git', ['status', '--porcelain']);
const dirty = dirtyRaw === null ? null : dirtyRaw;

const out = {
  date: SINCE,
  ran,
  merged: merged.map((p) => ({ number: p.number, title: p.title })),
  open: open.map((p) => ({ number: p.number, branch: p.headRefName, state: p.mergeStateStatus, draft: p.isDraft, title: p.title, age_days: Math.floor((Date.now() - Date.parse(p.createdAt)) / 86400000) })),
  health: {
    ci: ci.conclusion || 'unknown',
    records: (corpus.figures && corpus.figures.quotes && corpus.figures.quotes.total) || null,
    flagged,
    ladder: queue.mode || null,
    unjudged_runs: (queue.runs || []).filter((r) => !r.judged).length,
    deferred: (queue.deferred || []).length,
    tree_dirty: dirty === null ? null : (dirty ? dirty.split('\n').length : 0),
    tool_failures: toolFailures,
  },
};

if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

console.log(`\n  quotle.info — ${SINCE}\n`);
console.log('  ROUTINES');
for (const r of out.ran) {
  // '·' is reserved for "nothing to say". Only a routine that is genuinely overdue gets '✗', and
  // a pending one says so rather than borrowing the alarm.
  const mark = r.missing ? '✗' : (r.runs ? '✓' : '·');
  const what = r.missing ? 'DID NOT RUN'
    : r.runs ? `${r.runs} run(s): ${r.outcomes.join(', ')}${r.work ? ` · ${r.work} record(s)` : ''}`
    : r.offDay ? 'not scheduled today'
    : `no run yet — due ${String(r.slotUtc).padStart(2, '0')}:00 UTC`;
  console.log(`    ${mark} ${r.when.padEnd(10)} ${r.routine.padEnd(18)} ${what}`);
}
console.log(`\n  MERGED (${out.merged.length})`);
for (const p of out.merged.slice(0, 12)) console.log(`      #${p.number} ${p.title.slice(0, 84)}`);
console.log(`\n  OPEN (${out.open.length})`);
if (!out.open.length) console.log('      none');
for (const p of out.open) console.log(`      #${p.number} ${String(p.state).padEnd(9)} ${p.branch.slice(0, 28).padEnd(30)} ${p.age_days}d  ${p.title.slice(0, 40)}`);
const h = out.health;
console.log(`\n  HEALTH`);
console.log(`      CI on main       ${h.ci}`);
console.log(`      records          ${h.records}`);
console.log(`      flagged          ${h.flagged}`);
console.log(`      report ladder    ${h.ladder}${h.unjudged_runs ? ` (${h.unjudged_runs} run(s) awaiting the operator's verdict)` : ''}`);
console.log(`      deferred items   ${h.deferred}`);
console.log(`      working tree     ${h.tree_dirty === null ? 'UNKNOWN — git failed' : (h.tree_dirty ? `${h.tree_dirty} DIRTY` : 'clean')}`);
if (toolFailures.length) {
  console.log(`\n  ⚠ ${toolFailures.length} TOOL CALL(S) FAILED — the sections below are INCOMPLETE, not empty:`);
  toolFailures.forEach((f) => console.log(`      ${f}`));
}
const alarms = [];
if (h.ci !== 'success') alarms.push(`CI on main is ${h.ci}`);
for (const r of out.ran) if (r.missing) alarms.push(`${r.routine} did not run`);
// A run that RECORDED ITS OWN FAILURE must not sit behind a ✓ just because the routine fired. Making
// the error run visible in the roster (above) without alarming on it is half a fix — the 08:00 pass
// reads this list to decide what to escalate.
for (const r of out.ran) for (const o of r.outcomes) if (o === 'error') alarms.push(`${r.routine} recorded an 'error' run`);
for (const p of out.open) if (p.age_days >= 1) alarms.push(`#${p.number} open ${p.age_days}d (${p.state})`);
if (h.tree_dirty === null) alarms.push('could not read git status');
else if (h.tree_dirty) alarms.push('working tree dirty');
if (toolFailures.length) alarms.push(`${toolFailures.length} tool call(s) failed — this report is incomplete`);
console.log(alarms.length ? `\n  NEEDS ATTENTION\n${alarms.map((a) => `      · ${a}`).join('\n')}\n` : '\n  nothing obviously wrong\n');

})();
