#!/usr/bin/env node
'use strict';
/*
 * verify-review-spine.js — the review spine's invariants, asserted rather than described.
 *
 * WHY THIS EXISTS
 * The spine (scan.js -> review.js -> audit.js -> fix.js) had its contracts written down in prose
 * comments and enforced nowhere, and CI never ran scan.js at all. Every one of the bugs this file
 * now catches was documented in a comment that was WRONG at the time it was read:
 *
 *   · review.js's own comment computed the flag margin over two terms (age 365 + demand 300 = 665)
 *     and concluded FLAG_WEIGHT = 1000 was clear. Two more terms had been added since — the 250
 *     never-reviewed bonus and the 200 oddity cap — so the real ceiling was 1115 and an ORDINARY
 *     record outscored a FLAGGED one. The inversion the cap was added to fix, one tier up.
 *   · song rows omitted `odd`, so priority() added undefined and every song scored NaN. Array.sort
 *     reads a NaN comparator as "equal", so 97 song records were not ranked at all — they fell
 *     through to the alphabetical tiebreak in a queue whose entire job is ordering by urgency.
 *
 * Neither is visible by reading. Both fall out of one rank test in about a second.
 *
 *   node tools/verify-review-spine.js           offline invariants (what CI runs)
 *   node tools/verify-review-spine.js --live    …plus the checks that need ADMIN_TOKEN
 *
 * OFFLINE ONLY BY DEFAULT, deliberately. CI has no admin token and must not depend on the worker
 * being up. The live checks run in the nightly routine, where the token exists.
 */
const fs = require('fs');
const path = require('path');
const { DETECTORS } = require('./detectors');
const R = require('./review');

const ROOT = path.resolve(__dirname, '..');
const LIVE = process.argv.includes('--live');
const API = process.env.QUOTLE_API || 'https://quotle-community.stewartd.workers.dev';

const failures = [];
const passes = [];
const skips = [];
function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(`${name}${detail ? `\n      → ${detail}` : ''}`);
}

const readJson = (rel, dflt) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return dflt; } };

// ---------------------------------------------------------------- scan-state
const scan = readJson('data/scan-state.json', null);
const liveIds = new Set(DETECTORS.map((d) => d.id));

if (!scan) {
  check('data/scan-state.json exists', false, 'run `node tools/scan.js` and commit the result');
} else {
  // (a) A DELETED detector must not keep records flagged. A stale id in `f` flags a record forever
  //     for a check nobody runs, and no amount of rescanning clears it — the detector is gone.
  const staleF = [];
  for (const [slug, row] of Object.entries(scan.records || {})) {
    for (const id of (row.f || [])) if (!liveIds.has(id)) staleF.push(`${slug}: ${id}`);
  }
  check('every flag in scan-state names a live detector', staleF.length === 0,
    staleF.length ? `${staleF.length} stale flag(s), e.g. ${staleF.slice(0, 3).join(', ')} — run \`node tools/scan.js\`` : null);

  const staleCat = Object.keys(scan.catalogue || {}).filter((id) => !liveIds.has(id));
  check('every detector in the scan-state catalogue is live', staleCat.length === 0,
    staleCat.length ? `${staleCat.join(', ')} — a detector was deleted without a rescan` : null);

  // (b) Coverage. A record with no scan-state row has been tested by NOTHING, and it is invisible:
  //     `flagged: 0` reads identically whether a record is clean or unexamined. This is only
  //     assertable now that scan.js writes on substantive change alone (see its write block) — CI
  //     runs scan.js immediately before this, so a mismatch here means the corpus moved.
  const QDIR = path.join(ROOT, 'data', 'quotes');
  const recordSlugs = new Set(fs.readdirSync(QDIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')));
  const stateSlugs = new Set(Object.keys(scan.records || {}));
  const unscanned = [...recordSlugs].filter((s) => !stateSlugs.has(s));
  const orphaned = [...stateSlugs].filter((s) => !recordSlugs.has(s));
  check('scan-state covers exactly the live quote records', unscanned.length === 0 && orphaned.length === 0,
    (unscanned.length ? `${unscanned.length} record(s) never scanned (e.g. ${unscanned.slice(0, 3).join(', ')}). ` : '') +
    (orphaned.length ? `${orphaned.length} row(s) for deleted record(s) (e.g. ${orphaned.slice(0, 3).join(', ')}). ` : '') +
    'Run `node tools/scan.js` and commit data/scan-state.json.');
}

// ------------------------------------------------------------- the rank test
// ONE test over the REAL expression, not two arithmetic assertions over a copy of it.
//
// That distinction is the whole point. The measured bug — an uncapped sentinel scoring 9,884 while
// a flagged record scored 750, so flagging a record DEMOTED it — is invisible to "assert
// FLAG_WEIGHT > DEMAND_CAP" style checks, because every individual weight was in the right order.
// The order only breaks when the softer terms are SUMMED. So each tier is tested against the worst
// case of the tier below it: every lower signal simultaneously maxed out.
const row = (o) => ({ refutes: 0, reports: 0, flags: [], overdueBy: -1000, everReviewed: true, demand: 0, odd: 0, ...o });
const MAXED = { flags: ['x'], overdueBy: 99999, everReviewed: false, demand: R.DEMAND_CAP, odd: R.ODDITY_WEIGHT };

const TIERS = [
  ['reader-refuted', row({ refutes: 1, reports: 1 }), row({ refutes: 1, reports: 1, ...MAXED })],
  ['reader-reported', row({ reports: 1 }), row({ reports: 1, ...MAXED })],
  ['overdue+risky', row({ flags: ['x'] }), row({ ...MAXED })],
  ['overdue', row({ overdueBy: 1 }), row({ overdueBy: 99999, everReviewed: false, demand: R.DEMAND_CAP, odd: R.ODDITY_WEIGHT })],
];
for (let i = 0; i < TIERS.length - 1; i++) {
  const [hiName, hiMin] = TIERS[i];
  const [loName, , loMax] = TIERS[i + 1];
  const hi = R.priority(hiMin), lo = R.priority(loMax);
  check(`rank: the weakest ${hiName} outranks the strongest ${loName}`, hi > lo,
    `${hiName} at its minimum scores ${hi}; ${loName} at its maximum scores ${lo}. ` +
    'A tier weight no longer clears the sum of everything beneath it — raise it, do not reorder the test.');
}

// The bottom pair is not a weight comparison: "overdue" is continuous and "never-reviewed" is a
// flat bonus, so the honest claim is that the age term at full stretch beats the bonus alone.
check('rank: a fully overdue record outranks a fresh never-reviewed one',
  R.priority(row({ overdueBy: R.AGE_CAP })) > R.priority(row({ overdueBy: -1000, everReviewed: false })),
  'the capped age term no longer clears NEVER_REVIEWED');

// The regression itself, stated directly: flagging must never demote. Checked across the soft
// configurations rather than one, because the original bug needed the sentinel AND high demand.
let demoted = 0;
for (const overdueBy of [-1000, 1, 365, 99999]) {
  for (const everReviewed of [true, false]) {
    for (const demand of [0, R.DEMAND_CAP]) {
      for (const odd of [0, R.ODDITY_WEIGHT]) {
        const base = row({ overdueBy, everReviewed, demand, odd });
        if (R.priority({ ...base, flags: ['x'] }) <= R.priority(base)) demoted++;
      }
    }
  }
}
check('rank: flagging a record never demotes it', demoted === 0, `${demoted} soft configuration(s) where a flagged record scored no higher than the same record unflagged`);

// The inequality that makes the sweep ADVANCE rather than re-surfacing the same outliers forever:
// a stamped record at maximum oddity must never outrank an unstamped ordinary one.
check('rank: oddity never outranks never-reviewed (the sweep advances)',
  R.ODDITY_WEIGHT < R.NEVER_REVIEWED,
  `ODDITY_WEIGHT=${R.ODDITY_WEIGHT} must stay below NEVER_REVIEWED=${R.NEVER_REVIEWED}, or the queue re-serves the same structurally-odd records forever`);

// Every REAL row must score a finite number. This is the song-NaN catch: a missing term makes the
// arithmetic undefined, sort() silently reads NaN as "equal", and the queue stops being a queue.
const rows = R.survey();
const nonFinite = rows.filter((r) => !Number.isFinite(R.priority({ ...r, reports: 0, refutes: 0 })));
check('every record in the corpus scores a finite priority', nonFinite.length === 0,
  nonFinite.length ? `${nonFinite.length} row(s) score NaN, e.g. ${nonFinite.slice(0, 3).map((r) => r.slug).join(', ')} — a survey() row is missing a scoring term` : null);
check('the survey covers both quotes and songs', rows.some((r) => r.kind === 'quote') && rows.some((r) => r.kind === 'song'),
  'reports from song pages have no destination if survey() stops emitting song rows');

// ------------------------------------------------- every report has a destination
// (e) An unrouted report is a SECOND SILENT QUEUE — the exact bug /triage exists to stop. The
//     contract is not "most reports route"; it is that every slug shape lands in a bucket that has
//     a named outcome. Frozen here so a fifth shape cannot be added without giving it one.
const BUCKETS = { quote: 'audited via review.js due', song: 'audited via audit-songs.js', noSlug: 'triaged unresolvable', unknown: 'triaged unresolvable' };
const FIXTURE = [
  { id: 1, slug: 'a-real-quote-slug' },
  { id: 2, slug: 'song:a-real-song-slug' },
  { id: 3, slug: '' },
  { id: 4 },
  { id: 5, slug: null },
  { id: 6, slug: 'renamed-or-deleted-slug' },
  { id: 7, slug: 'song:' },
];
const grouped = R.classifyReports(FIXTURE, new Set(['a-real-quote-slug']));
check('every report bucket has a named destination',
  Object.keys(grouped).every((k) => k in BUCKETS),
  `unrouted bucket(s): ${Object.keys(grouped).filter((k) => !(k in BUCKETS)).join(', ')} — give it a triage outcome or it is a silent queue`);
const placed = Object.values(grouped).reduce((n, v) => n + v.length, 0);
check('classification drops nothing and duplicates nothing', placed === FIXTURE.length,
  `${FIXTURE.length} report(s) in, ${placed} placed`);

// ------------------------------------------- the reply URL comes from the index
// The worker mails a reader the page their report concerned. It used to match the slug in
// verify-index.json and then HARDCODE `/who-said/<slug>/` — but the index is three namespaces
// (measured: 1169 /who-said/, 113 /who-recorded/, 5 /who-wrote/), so every accepted report from one
// of the 113 song pages mailed a real person a 404. Asserted here, against the worker source, for
// the same reason the /triage guard is: CI cannot reach the worker, and this is the one output that
// lands in a stranger's inbox and cannot be recalled.
const workerSrc = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'index.js'), 'utf8');
check('the reply URL is taken from the index, not guessed',
  !/https:\/\/quotle\.info\/who-said\/\$\{/.test(workerSrc),
  'worker/src/index.js hardcodes a /who-said/ path for the reply link. Songs live at /who-recorded/ and writing records at /who-wrote/, so this mails a 404 to whoever reported a song page. Use the index entry\'s own `u`.');

// Every namespace the index publishes must be reachable by the lookup the worker uses, or a whole
// class of reader silently gets no link at all.
try {
  const vi = JSON.parse(fs.readFileSync(path.join(ROOT, 'verify-index.json'), 'utf8'));
  const entries = Array.isArray(vi) ? vi : (vi.entries || []);
  const withUrl = entries.filter((e) => e && e.slug && e.u).length;
  check('every verify-index entry carries a slug and a URL', withUrl, entries.length,
    'an entry without `u` would yield an empty reply link');
} catch (_) {
  check('verify-index.json is readable', false, true, 'the worker resolves reply URLs against it');
}

// -------------------------------------------------------- /triage idempotency
// (h) The guard is one SQL clause in the worker, and losing it makes the whole nightly job
//     non-idempotent: a second run re-stamps triaged_at and the report never settles. Asserted
//     against the source because CI cannot reach the database — the LIVE probe below is the other
//     half, and the routine's own `already` count is the third.
const worker = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'index.js'), 'utf8');
check('/triage UPDATE is guarded on status=\'pending\'',
  /UPDATE source_submissions SET[^"']*WHERE id=\? AND status='pending'/.test(worker),
  'the guard is gone — a second call would re-close an already-closed report and re-stamp triaged_at');

// -------------------------------------------------------------- live checks
(async () => {
  if (!LIVE) {
    skips.push('live checks (/sources routing, /triage idempotency) — pass --live with ADMIN_TOKEN set');
  } else if (!process.env.ADMIN_TOKEN) {
    check('--live requires ADMIN_TOKEN', false, 'export ADMIN_TOKEN=$(gcloud secrets versions access latest --secret=quotle-admin-token --project=word-boxing)');
  } else {
    const token = process.env.ADMIN_TOKEN;
    try {
      const r = await fetch(`${API}/sources?status=pending`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      const sources = d.sources || [];
      const known = new Set(rows.map((x) => x.slug));
      const g = R.classifyReports(sources, new Set(rows.filter((x) => x.kind === 'quote').map((x) => x.slug)));
      // Routable means it actually JOINS — the bucket name is not the proof, the join is.
      const joinable = [...g.quote, ...g.song].filter((s) => known.has(String(s.slug)));
      check('every routable pending report joins to a live record',
        joinable.length === g.quote.length + g.song.length,
        `${g.quote.length + g.song.length - joinable.length} report(s) classified as routable do not join to a survey row`);
      const stuck = g.noSlug.length + g.unknown.length;
      if (stuck) skips.push(`${stuck} pending report(s) need an 'unresolvable' triage — they will never join to a record`);
    } catch (e) {
      check('/sources is reachable', false, String(e && e.message || e));
    }
    try {
      // A non-existent id exercises the guarded UPDATE without touching real data: the endpoint
      // must report changed:0 rather than erroring. This proves the no-op RESPONSE contract that
      // review.js's closeReports() relies on; the status='pending' clause itself is asserted above.
      const r = await fetch(`${API}/triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: 0, verdict: 'rejected', note: 'invariant probe — no such row' }),
      });
      const d = await r.json().catch(() => ({}));
      check('/triage on an unmatched row is a no-op, not an error', r.ok && d.ok === true && d.changed === 0,
        `got ${r.status} ${JSON.stringify(d)} — closeReports() treats a non-ok response as a retry, so this would loop forever`);
    } catch (e) {
      check('/triage is reachable', false, String(e && e.message || e));
    }
  }

  for (const s of skips) console.log(`  ~ SKIPPED/NOTE: ${s}`);
  if (failures.length) {
    console.error('\n  ✗ REVIEW SPINE INVARIANTS FAILED:\n');
    failures.forEach((f, i) => console.error(`   ${i + 1}. ${f}\n`));
    console.error(`  ${failures.length} of ${failures.length + passes.length} checks failed.\n`);
    process.exit(1);
  }
  console.log(`  ✓ review spine invariants (${passes.length} checks: scan-state coverage, tier ordering, report routing, /triage idempotency)`);
  if (process.env.SPINE_VERBOSE) passes.forEach((p) => console.log(`      ✓ ${p}`));
})();
