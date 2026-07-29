#!/usr/bin/env node
'use strict';
/*
 * review.js — THE CORRECTION + RE-REVIEW SPINE.
 *
 * WHY THIS EXISTS
 * Two live factual errors shipped and sat on the public site until a reviewer found them
 * by hand (2026-07-27):
 *   - `nature-does-not-hurry…` asserted the line was "not in any standard Tao Te Ching
 *     translation". It is Archie J. Bahm's, 1958, chapter 73, verbatim. An absolute negative
 *     that nobody re-tested.
 *   - `he-who-opens-a-school-door…` credited "Louis-Charles Jourdan". Larousse prints only
 *     "L. Jourdan"; the authorities say Louis Jourdan (1810-1881). The record's OWN
 *     schema.creator.sameAs already linked the correct person — the name and its citation
 *     disagreed, in the same file, unnoticed.
 *
 * Neither was hard to catch. Nothing was looking. The pipeline audits a page ONCE, on the
 * wave that builds it, and never again — and /submit-source has been collecting reader
 * evidence into a table no tool has ever read.
 *
 * WHAT THIS DOES *NOT* DO
 * It does not audit. workflows/audit.js already re-fetches every source link, tests whether
 * it literally supports the claim attached to it, checks confidence + rights honesty, and
 * runs a skeptic over every blocker. It accepts an arbitrary slug list. It was simply never
 * pointed at published records. This tool decides WHICH records go to it, and records the
 * outcome. Do not write a second auditor.
 *
 *   review.js due [--limit N]     what should be re-reviewed next, and why
 *   review.js reports             pending reader reports from /sources  (needs ADMIN_TOKEN)
 *   review.js args --limit N      emit audit.js args JSON for the due set
 *   review.js stamp <slug…>       record that a slug was reviewed (after audit + any fix)
 *   review.js risk                records with a mechanical contradiction (no audit needed)
 *
 * Lifecycle a record moves through: due -> audited -> (fixed) -> stamped.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const QDIR = path.join(ROOT, 'data', 'quotes');
const API = process.env.QUOTLE_API || 'https://quotle-community.stewartd.workers.dev';

// NO CLAIM-SHAPE MATCHING HERE, AND THAT IS DELIBERATE.
//
// Two drafts of this file tried to flag "absolute negative" claims — "in no translation",
// "appears nowhere in", "never said" — on the theory that a universal negative is fragile
// because one counter-example destroys it. Measured: 703/1158 records (61%), then 516 (45%)
// after narrowing. Both are noise, not signal, for two reasons:
//
//   1. It matched the WHOLE JSON blob, so it fired on quoted material and source prose rather
//      than on our own assertions. The top hit was a record quoting Bill Gates saying "I never
//      said that" — the subject denying a quote, scored as us making a risky claim.
//   2. More fundamentally: "this appears nowhere in Jefferson's writings" IS the editorial
//      content of a disputed-quote corpus. Flagging it flags the job description.
//
// The Lao Tzu record ("not in any standard Tao Te Ching translation" — falsified by Archie J.
// Bahm, 1958, ch. 73) was not wrong because of its SHAPE. It was wrong because the claim was
// cheap to test and untested. Testing a claim against the sources attached to it is exactly
// what workflows/audit.js does, on every link, with a skeptic pass. Duplicating that here as a
// regex produces a worse version of a tool we already have.
//
// So this file flags only things that are MECHANICALLY DECIDABLE and high-precision — internal
// contradictions a machine can settle without judgement — and leaves claim-testing to audit.js.
// If you are tempted to add a prose pattern here, measure its hit rate against 1,158 records
// first. Anything firing on more than a few percent is a lens, not a flag.

const DEFAULT_CYCLE_DAYS = 365;   // ordinary record
const RISKY_CYCLE_DAYS = 180;     // record carrying a mechanical contradiction

// THE TIER WEIGHTS ARE DERIVED, NOT CHOSEN — and they were wrong until a rank test was written.
//
// The documented order is: reader-refuted > reader-reported > overdue+risky > overdue. For that to
// be TRUE rather than aspirational, each tier's weight must exceed the largest score anything below
// it can reach. The old comment did that arithmetic over two terms — capped age (365) plus demand
// (300) = 665 — and concluded FLAG_WEIGHT = 1000 was safely clear. It missed two terms that had
// been added since: the 250 never-reviewed bonus and the 200 oddity cap. The real ceiling on the
// soft signals is 1115, so a never-reviewed, high-demand, structurally-odd, fully-overdue record
// scored 1115 and OUTRANKED a flagged record on 1000 — the same inversion the cap was added to fix,
// one tier up. Reader reports had the identical hole: max flagged+soft = 2115 beat a plain
// report's 2000.
//
// Neither was reachable by inspection, and neither is caught by asserting two numbers against each
// other. tools/verify-review-spine.js asserts the ORDER over this expression, with every lower tier
// pushed to its worst case, which is what found both. Derive from the caps here so the next term
// somebody adds moves the tiers with it instead of silently eating the margin.
const AGE_CAP = DEFAULT_CYCLE_DAYS;   // the overdue term is capped at one extra cycle
const NEVER_REVIEWED = 250;           // never re-reviewed since it was built
const DEMAND_CAP = 300;               // log-scaled pageview/demand term
const ODDITY_WEIGHT = 200;            // structural oddity — see below; capped BELOW NEVER_REVIEWED
const SOFT_MAX = AGE_CAP + NEVER_REVIEWED + DEMAND_CAP + ODDITY_WEIGHT;   // 1115
const FLAG_WEIGHT = SOFT_MAX + 1;                                          // 1116 — clears all soft
const TIER = FLAG_WEIGHT + SOFT_MAX + 1;                                   // 2232 — clears flag+soft
const REPORT_WEIGHT = TIER;           // a human said this page is wrong
const REFUTES_WEIGHT = TIER;          // …and their evidence refutes rather than supports it
// STRUCTURAL ODDITY — a prioritisation signal, never a flag.
//
// Some fields are near-universal by CONVENTION and enforced nowhere: schema (1148/1158), context
// (1147), copyAttribution (1144), misattribution (1106). A record missing one is unusual without
// anybody having written a rule about it, which is exactly the shape tier 1 cannot see — you cannot
// flag what you have no detector for. Ranking by it turns the discovery sample from 20 RANDOM
// records into the 20 most likely to be carrying something nobody has met.
//
// IT IS NOT A DEFECT. 52 records legitimately have no misattribution block — a verified quote with
// no false credit does not need one. This decides who gets LOOKED at; it asserts nothing.
//
// CAPPED BELOW THE AGE TERM ON PURPOSE, and this is the load-bearing bit. Auditing a record does
// not change its oddity: conclude that its missing fields are fine and it is still an outlier next
// week, and the week after, forever. A pure ranking would re-surface the same 20 records
// indefinitely and the sweep would never advance. Rotation therefore comes from having LOOKED —
// review.js stamp — and for that to work a stamped record must never outrank an unstamped one:
//
// THE CAP IS 200, BELOW THE 250 NEVER-REVIEWED BONUS, and the first draft got this wrong. It used
// 300 on the reasoning that an unstamped record scores 365 (age) + 250 — but that age term only
// applies to the ~10 records missing schema.dateModified, which trip the 9999-day sentinel. An
// ORDINARY never-reviewed record scores just 250. At 300 a stamped outlier therefore outranked an
// unstamped ordinary record and the sweep would have stalled on the weird ones exactly as feared.
// Caught by stamping a record and watching it come back at #28.
//     stamped, max oddity  =   0 +   0 + 200 = 200
//     unstamped, ordinary  =   0 + 250 +   0 = 250   ← always higher
// If either weight moves, re-check this inequality; it is the thing that makes the sweep advance.
// (ODDITY_WEIGHT and NEVER_REVIEWED are declared with the other caps above, so SOFT_MAX can be
// derived from them; the inequality ODDITY_WEIGHT < NEVER_REVIEWED is asserted in
// tools/verify-review-spine.js rather than left to this comment.)
const NEAR_UNIVERSAL = ['schema', 'context', 'copyAttribution', 'misattribution'];
function oddity(rec) {
  const missing = NEAR_UNIVERSAL.filter((k) => !(k in rec)).length;
  return missing ? Math.round((missing / NEAR_UNIVERSAL.length) * ODDITY_WEIGHT) : 0;
}

const readRecord = (f) => { try { return JSON.parse(fs.readFileSync(path.join(QDIR, f), 'utf8')); } catch { return null; } };
const SDIR = path.join(ROOT, 'data', 'songs');
const allFiles = () => fs.readdirSync(QDIR).filter((f) => f.endsWith('.json'));
const allSongFiles = () => (fs.existsSync(SDIR) ? fs.readdirSync(SDIR).filter((f) => f.endsWith('.json')) : []);
const readSong = (f) => { try { return JSON.parse(fs.readFileSync(path.join(SDIR, f), 'utf8')); } catch { return null; } };

// Song reports arrive as `song:<songSlug>` (build-songs.js posts that prefix), and until now
// survey() read data/quotes only — so reports from ~97 live song pages joined to no record, never
// reached the due queue, and sat pending forever. The prefix is kept as the row's slug so the join
// in dueSet is exact, with no second keying scheme to get out of step.
const SONG_PREFIX = 'song:';
const daysBetween = (a, b) => Math.floor((a - b) / 86400000);

// Records have no dedicated freshness field yet (verified across all 1,158 — none carry one).
// schema.dateModified is the closest honest proxy: it is when the record last CHANGED, not
// when a human or agent last tested its claims against sources. Treat it as a seed, and mark
// anything relying on it as never-actually-reviewed so the first pass is not silently skipped.
function reviewState(rec) {
  const r = rec.review || {};
  const stamped = r.lastReviewedOn || null;
  // Songs carry dateModified at the TOP level; quotes carry it under schema. Without this a song
  // record has no seed date, falls to the 9999-day sentinel, and every song outranks every quote.
  const seed = (rec.schema && rec.schema.dateModified) || rec.dateModified || null;
  return {
    lastReviewedOn: stamped || seed,
    everReviewed: Boolean(stamped),
    by: r.lastReviewedBy || null,
    verdict: r.lastVerdict || null,
  };
}

// A THIRD heuristic was tried here and cut. Recording why, so it is not re-invented.
//
// The Jourdan error was a NAME error — our record said "Louis-Charles Jourdan" while its own
// `schema.creator.sameAs` linked the authority page for Louis Jourdan (1810-1881). An internal
// contradiction, apparently perfect for a mechanical check: compare our name against the tokens
// in the linked slug, flag when we carry name components the authority does not.
//
// It fired on 46 records. Spot-checking the first six:
//     Marcus Tullius Cicero            -> /Cicero
//     Napoleon Bonaparte               -> /Napoleon
//     Pierre-Augustin Caron de Beaumarchais -> /Pierre_Beaumarchais
//     John Watson (Ian Maclaren)       -> /Ian_Maclaren
//     Lao Tzu                          -> /Laozi
// Every one correct. Wikipedia titles on COMMON names; our records carry FULL names; a record
// holding more name than the slug is the normal, desirable case. The assumption was backwards.
//
// And "Marcus Tullius Cicero" (a correct expansion) is not mechanically distinguishable from
// "Louis-Charles Jourdan" (a fabricated middle name) by token comparison. Separating them means
// fetching the authority page and reading what it says — which is audit.js's job, again.
//
// Conclusion, arrived at the hard way: the useful signals here are the ones that need no
// judgement — a human said this page is wrong, or nobody has looked at it in a year. Claim
// correctness is not detectable by pattern-matching a record against itself. Do not add a
// fourth heuristic without measuring its false-positive rate on a sample first.
// LAYER 1 FEEDS THIS. The one inline check that used to live here (contested verdict with no
// citation) has moved into tools/detectors.js as `disputed-no-citation`, alongside the rest of the
// catalogue, so there is ONE place a signal is defined and one place it is measured. This function
// now just reads what tools/scan.js already worked out.
//
// Deliberately silent when data/scan-state.json is missing or stale: review.js must keep working
// on a fresh clone before anyone has run a scan. `flags` simply stays empty, and the queue falls
// back to age + reader reports, which is what it did before layer 1 existed. Run
// `node tools/scan.js` to populate it — `due` says so when the file is absent.
let SCAN = null;
function scanState() {
  if (SCAN) return SCAN;
  try { SCAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'scan-state.json'), 'utf8')); }
  catch (_) { SCAN = { records: {}, missing: true }; }
  return SCAN;
}
// DEMAND — a wrong page nobody reads matters less than a wrong page with traffic.
//
// Two partial sources, neither quote-level, and the shortfall is stated here rather than implied:
//   · data/harvest-queue.json  demandScore on the candidate that became this record. Already
//     category-weighted by rank-backlog.js. Covers 58 records.
//   · data/demand-cache.json   Wikimedia pageviews for the AUTHOR. Covers 202 records.
// Together 239 of 1,158 (21%). The other 919 contribute ZERO, which is why this term is additive
// and never negative: with coverage this thin it must only ever PROMOTE a record, never push an
// unmeasured one down. A missing signal is not evidence of low demand.
//
// Capped at 300 — below the 500 a mechanical contradiction earns, so a popular clean page never
// outranks a flagged one, and far below reader reports. Log-scaled because pageviews span
// 1 … 243,445 and a linear term would let one famous author swamp every other input.
//
// TO MAKE THIS MATTER: extend the author cache past the 127 magnet authors it currently holds
// (rank-backlog.js already has the fetch + cache logic; it just never runs over the built corpus).
// At 21% this is a tiebreak, not a driver.
let DEMAND = null;
function demandIndex() {
  if (DEMAND) return DEMAND;
  const byAuthor = {}, bySlug = {};
  try { Object.assign(byAuthor, JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'demand-cache.json'), 'utf8'))); } catch (_) {}
  try {
    const q = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'harvest-queue.json'), 'utf8'));
    for (const c of (q.candidates || [])) {
      if (c.demandScore == null) continue;
      if (c.resultSlug) bySlug[c.resultSlug] = c.demandScore;
      if (c.slug && bySlug[c.slug] == null) bySlug[c.slug] = c.demandScore;
    }
  } catch (_) {}
  DEMAND = { byAuthor, bySlug };
  return DEMAND;
}
function demandTerm(rec) {
  const { byAuthor, bySlug } = demandIndex();
  const slugScore = bySlug[rec.quoteSlug];
  const who = (rec.answer && (rec.answer.realAuthorName || rec.answer.authorName)) || '';
  const a = byAuthor[who];
  const authorViews = (a && typeof a === 'object') ? a.views : a;
  const v = Number(slugScore != null ? slugScore : authorViews) || 0;
  return v > 0 ? Math.min(Math.round(Math.log10(v + 1) * 50), DEMAND_CAP) : 0;
}

function riskFlags(rec) {
  // Detectors run over quote records only, so a song record legitimately has no flags. Keying on
  // the quote slug makes that explicit rather than accidental — if song detectors ever land, this
  // is the line that has to change.
  const row = (scanState().records || {})[rec.quoteSlug];
  return (row && Array.isArray(row.f)) ? row.f.slice() : [];
}

function survey() {
  const now = new Date();
  const rows = [];
  for (const f of allFiles()) {
    const rec = readRecord(f);
    if (!rec) continue;
    const st = reviewState(rec);
    const flags = riskFlags(rec);
    const demand = demandTerm(rec);
    const odd = oddity(rec);
    const cycle = flags.length ? RISKY_CYCLE_DAYS : DEFAULT_CYCLE_DAYS;
    const age = st.lastReviewedOn ? daysBetween(now, new Date(st.lastReviewedOn)) : 9999;
    rows.push({
      kind: 'quote',
      slug: rec.quoteSlug || f.replace(/\.json$/, ''),
      confidence: rec.confidence,
      rights: (rec.meta && rec.meta.rights) || rec.rights || null,
      lastReviewedOn: st.lastReviewedOn, everReviewed: st.everReviewed,
      ageDays: age, cycle, overdueBy: age - cycle, flags, demand, odd,
    });
  }
  // SONG ROWS. Same queue, same scoring, distinct kind — a song report and a quote report compete
  // on one list because a reader does not care which table we filed it under. Song reports arrive
  // as `song:<songSlug>` (build-songs.js posts that prefix) and until now survey() read data/quotes
  // only, so reports from ~97 live song pages joined to no record and sat pending forever.
  //
  // Two honest gaps, stated rather than papered over: song records carry no `answer` block so
  // demandTerm is always 0, and no detector runs over them so flags are always empty. A song
  // therefore ranks on staleness and reader reports alone — correct today, and visible if it changes.
  for (const f of allSongFiles()) {
    const rec = readSong(f);
    if (!rec) continue;
    const st = reviewState(rec);
    const age = st.lastReviewedOn ? daysBetween(now, new Date(st.lastReviewedOn)) : 9999;
    rows.push({
      kind: 'song',
      slug: SONG_PREFIX + (rec.songSlug || f.replace(/\.json$/, '')),
      confidence: rec.confidence,
      rights: null,
      lastReviewedOn: st.lastReviewedOn, everReviewed: st.everReviewed,
      ageDays: age, cycle: DEFAULT_CYCLE_DAYS, overdueBy: age - DEFAULT_CYCLE_DAYS,
      // `odd: 0` is load-bearing, not padding. Song rows omitted it, so priority() added `undefined`
      // and every song scored NaN — and `b.priority - a.priority` on NaN returns NaN, which
      // Array.sort treats as "equal". Songs were therefore not ranked at all; they fell through to
      // the slug tiebreak in a list that was supposed to be ordered by urgency, silently. Zero
      // rather than oddity(rec) because NEAR_UNIVERSAL names quote fields: scoring a song against
      // them would mark all 97 maximally odd, which is a statement about the schema, not the record.
      flags: [], demand: 0, odd: 0,
    });
  }
  return rows;
}

// Reader reports are the highest-priority input: a human looked at a live page and said it is
// wrong. They jump the staleness queue entirely. `refutes` outranks `supports`.
async function fetchReports() {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return { error: 'ADMIN_TOKEN not set — cannot read /sources. Reader reports skipped.' };
  try {
    const r = await fetch(`${API}/sources?status=pending&token=${encodeURIComponent(token)}`);
    if (!r.ok) return { error: `/sources returned ${r.status}` };
    const d = await r.json();
    return { sources: d.sources || [] };
  } catch (e) { return { error: String(e && e.message || e) }; }
}

// classifyReports — every report must land somewhere NAMED. dueSet joins reports to records by
// exact slug, so three classes fell straight through and stayed pending forever:
//   · song:<slug>  — song pages post that prefix (build-songs.js). survey() reads data/quotes only,
//                    so ~97 live song pages had no destination at all.
//   · ''           — /report/ sends an empty slug when the reader typed the line instead of pasting
//                    a link. That is a real report, not a malformed one.
//   · unknown      — a slug that was renamed or deleted since the report was filed.
// Naming them is the point: an unrouted report is a second silent queue, which is the bug the
// whole triage endpoint exists to stop.
function classifyReports(sources, knownQuoteSlugs) {
  const out = { quote: [], song: [], noSlug: [], unknown: [] };
  for (const s of sources) {
    const slug = String(s.slug || '');
    if (!slug) out.noSlug.push(s);
    else if (slug.startsWith('song:')) out.song.push(s);
    else if (knownQuoteSlugs.has(slug)) out.quote.push(s);
    else out.unknown.push(s);
  }
  return out;
}

// THE RETURN LEG. Without this the loop never closes: a record can be audited, fixed, stamped,
// rebuilt and shipped while its report is still status='pending' — so /sources keeps returning it
// and dueSet keeps scoring it at +2000/+4000, forever, starving the staleness lane behind it.
// stamp() is the right caller because it is the step that means "this record has been dealt with".
async function closeReports(ids, verdict, note) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return { error: 'ADMIN_TOKEN not set — cannot close reports.' };
  let closed = 0, already = 0;
  for (const id of ids) {
    try {
      const r = await fetch(`${API}/triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, verdict, note: note || '' }),
      });
      const d = await r.json().catch(() => ({}));
      if (d && d.ok) { if (d.changed) closed++; else already++; }
    } catch (_) { /* a failed close is retried next run — the guard makes that safe */ }
  }
  return { closed, already };
}

// THE SCORING EXPRESSION. Order: reader-refuted > reader-reported > overdue+risky > overdue.
// The age term is CAPPED, and that cap is what makes a flag mean anything.
//
// A never-stamped record falls back to schema.dateModified, and a record MISSING that field gets
// the 9999-day sentinel. Uncapped, that contributed 9,634 to priority — so the queue was
// effectively sorted by "does this record have a dateModified field", and the 500 awarded for a
// mechanical contradiction was noise against it. Measured before the cap: a record carrying a
// high-severity contradiction scored 750 while an ordinary one scored 9,884. Flagging a record
// DEMOTED it, the exact inverse of the stated order.
//
// 9999 is a sentinel, not a measurement: a record unreviewed since it was built is not "27 years
// overdue". Capping at one extra cycle keeps genuine staleness ranking above fresh work while
// leaving the flag and reader-report terms able to outrank it.
//
// EXPORTED so tools/verify-review-spine.js can rank-test THIS expression rather than a copy of it.
// A test that re-implements the arithmetic proves the test agrees with itself.
function priority(r) {
  return (r.refutes ? REFUTES_WEIGHT : 0)
    + (r.reports ? REPORT_WEIGHT : 0)
    + (r.flags.length ? FLAG_WEIGHT : 0)
    + Math.min(Math.max(0, r.overdueBy), AGE_CAP)
    + (r.everReviewed ? 0 : NEVER_REVIEWED)
    + r.demand + r.odd;
}

async function dueSet(limit) {
  const rows = survey();
  const rep = await fetchReports();
  const reported = new Map();
  for (const s of (rep.sources || [])) {
    const cur = reported.get(s.slug) || { n: 0, refutes: 0 };
    cur.n++; if (s.stance === 'refutes') cur.refutes++;
    reported.set(s.slug, cur);
  }
  for (const r of rows) {
    const rp = reported.get(r.slug);
    r.reports = rp ? rp.n : 0;
    r.refutes = rp ? rp.refutes : 0;
    r.priority = priority(r);
  }
  rows.sort((a, b) => b.priority - a.priority || a.slug.localeCompare(b.slug));
  return { rows: rows.slice(0, limit), all: rows, reportError: rep.error || null };
}

// ---- exports ---------------------------------------------------------------
// tools/verify-review-spine.js imports the REAL expression and the REAL classifier. Everything
// below this line is the CLI and must not run on require — hence the require.main guard.
module.exports = {
  priority, survey, classifyReports, oddity, demandTerm,
  AGE_CAP, NEVER_REVIEWED, DEMAND_CAP, ODDITY_WEIGHT, SOFT_MAX,
  FLAG_WEIGHT, REPORT_WEIGHT, REFUTES_WEIGHT,
  DEFAULT_CYCLE_DAYS, RISKY_CYCLE_DAYS, SONG_PREFIX,
};

// ---- commands --------------------------------------------------------------
if (require.main === module) {
const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : d; };
const LIMIT = parseInt(flag('--limit', '25'), 10);

(async () => {
  if (cmd === 'due' || cmd === 'args') {
    const { rows, all, reportError } = await dueSet(LIMIT);
    if (cmd === 'args') {
        // TWO auditors, two arg shapes. audit.js takes {pages:[{slug,confidence,rights}], repo};
        // audit-songs.js takes {pages:[{slug,confidence}], repo} and its slug must be the BARE songSlug —
        // the `song:` prefix is a queue-keying detail, not part of the record's identity. Emitting one
        // blended list would have handed song slugs to the quote auditor, which reads data/quotes and
        // would have found nothing, silently.
        const quotes = rows.filter((r) => r.kind !== 'song');
        const songs = rows.filter((r) => r.kind === 'song');
        process.stdout.write(JSON.stringify({
          audit: { pages: quotes.map((r) => ({ slug: r.slug, confidence: r.confidence, rights: r.rights })), repo: ROOT },
          auditSongs: { pages: songs.map((r) => ({ slug: r.slug.slice(SONG_PREFIX.length), confidence: r.confidence })), repo: ROOT },
        }, null, 1) + '\n');
      return;
    }
    if (reportError) console.log(`  ! reader reports unavailable: ${reportError}\n`);
    const never = all.filter((r) => !r.everReviewed).length;
    const risky = all.filter((r) => r.flags.length).length;
    console.log(`  corpus ${all.length} records · never re-reviewed since build: ${never} · records with a mechanical contradiction: ${risky}`);
    console.log(`  cycles: ordinary ${DEFAULT_CYCLE_DAYS}d, flagged ${RISKY_CYCLE_DAYS}d\n`);
    console.log(`  next ${rows.length} for re-review:`);
    for (const r of rows) {
      const why = [
        r.refutes ? `${r.refutes} REFUTES` : null,
        r.reports ? `${r.reports} report(s)` : null,
        ...r.flags,
        r.everReviewed ? `${r.ageDays}d since review` : 'never re-reviewed',
      ].filter(Boolean).join(', ');
      console.log(`    ${r.slug.slice(0, 52).padEnd(54)} ${why}`);
    }
    console.log(`\n  next: node tools/review.js args --limit ${LIMIT} > /tmp/review-args.json`);
    console.log(`        Workflow audit.js args=<contents of that file>`);
    return;
  }

  if (cmd === 'reports') {
    const rep = await fetchReports();
    if (rep.error) { console.log(`  ! ${rep.error}`); process.exitCode = 1; return; }
    const sources = rep.sources || [];
    if (!sources.length) { console.log('  no pending reader reports'); return; }
    const known = new Set(survey().map((r) => r.slug));
    const g = classifyReports(sources, known);
    // `reason` is the ONLY content on a sourceless report, and the /sources SELECT dropped it
    // until 2026-07-28 — so those printed as a blank line and read as empty submissions.
    const line = (s) => {
      const bits = [s.reason || '(no reason given)'];
      if (s.url) bits.push(s.url);
      if (s.note) bits.push(`"${String(s.note).slice(0, 90)}"`);
      // The reader left an address, so this report has someone waiting on an answer. Printed for
      // the same reason `reason` is: it is the difference between a report you can close silently
      // and one where a human owes a reply. Nothing sends anything yet — this is surfacing only.
      if (s.email) bits.push(`reply-to: ${s.email}`);
      console.log(`      #${s.id} [${(s.stance || '').toUpperCase()}] ${bits.join('  ·  ')}`);
    };
    console.log(`  ${sources.length} pending reader report(s):\n`);
    if (g.quote.length) {
      console.log(`    ROUTABLE — ${g.quote.length} on quote records (these reach review.js due):`);
      for (const s of g.quote) { console.log(`    ${s.slug}`); line(s); }
    }
    if (g.song.length) {
      console.log(`\n    SONGS — ${g.song.length}. NO destination yet: survey() reads data/quotes only,`);
      console.log('    so these never reach due. Audit with audit-songs.js by hand, or close them.');
      for (const s of g.song) { console.log(`    ${s.slug}`); line(s); }
    }
    if (g.noSlug.length) {
      console.log(`\n    NO SLUG — ${g.noSlug.length}. The reader typed the line instead of pasting a link.`);
      console.log('    A real report: identify the record by hand, or close as unresolvable.');
      for (const s of g.noSlug) line(s);
    }
    if (g.unknown.length) {
      console.log(`\n    UNKNOWN SLUG — ${g.unknown.length}. Renamed or deleted since the report was filed.`);
      console.log('    Close as unresolvable — nothing will ever join these to a record.');
      for (const s of g.unknown) { console.log(`    ${s.slug}`); line(s); }
    }
    const stuck = g.song.length + g.noSlug.length + g.unknown.length;
    if (stuck) console.log(`\n  ${stuck} report(s) cannot reach the due queue. Close them or they stay pending forever.`);
    return;
  }

  if (cmd === 'risk') {
    const rows = survey().filter((r) => r.flags.length);
    console.log(`  ${rows.length} records with a mechanical contradiction:\n`);
    for (const r of rows.slice(0, 60)) console.log(`    ${r.slug.slice(0, 56).padEnd(58)} ${r.flags.join(', ')}`);
    if (rows.length > 60) console.log(`    … and ${rows.length - 60} more`);
    return;
  }

  if (cmd === 'stamp') {
    // Skip flag VALUES too, not just the flags — `stamp foo --verdict PASS --by me` was
    // treating PASS and me as slugs and printing "! no record: PASS".
    const slugs = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));
    const verdict = flag('--verdict', 'PASS');
    const by = flag('--by', 'recheck');
    if (!slugs.length) {
      console.log('  usage: review.js stamp <slug…> [--verdict PASS|FIXED] [--by <who>]');
      console.log('    PASS  (default) — we looked, the page stands. Closes reports as rejected. Sends NO email.');
      console.log('    FIXED           — a fix shipped. Closes reports as accepted, which EMAILS the reporter.');
      process.exitCode = 1; return;
    }
    const today = new Date().toISOString().slice(0, 10);
    let n = 0;
      const stamped = [];
    for (const slug of slugs) {
      // A song slug arrives prefixed (`song:<songSlug>`) because that is what the page posts and what
      // dueSet joins on. Strip it here and ONLY here — two keying schemes would drift apart.
      const isSong = slug.startsWith(SONG_PREFIX);
      const file = isSong
        ? path.join(SDIR, `${slug.slice(SONG_PREFIX.length)}.json`)
        : path.join(QDIR, `${slug}.json`);
      if (!fs.existsSync(file)) { console.log(`  ! no record: ${slug}`); continue; }
      const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
      rec.review = { ...(rec.review || {}), lastReviewedOn: today, lastReviewedBy: by, lastVerdict: verdict };
      fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
        n++;
        stamped.push(slug);
    }
      // THE RETURN LEG. stamp means "this record has been dealt with" — so the reader report that put
      // it here is dealt with too. Without this the record ships audited, fixed and stamped while its
      // report is still status='pending', so /sources keeps returning it and dueSet keeps scoring it
      // at +2000/+4000 forever, starving the staleness lane behind it. Closing is idempotent
      // server-side (UPDATE ... WHERE status='pending'), so a re-run is a no-op and a failed close
      // simply retries next time.
      if (stamped.length) {
        const rep = await fetchReports();
        if (rep.error) { console.log(`  ! reports not closed: ${rep.error}`); }
        else {
          const ids = (rep.sources || []).filter((x) => stamped.includes(String(x.slug))).map((x) => x.id);
          if (ids.length) {
            // THE VERDICT DECIDES WHAT THE READER IS TOLD. This was hardcoded to 'accepted' until
            // 2026-07-29, which meant `stamp --verdict PASS` — the DEFAULT, and what a clean review
            // produces — closed the reader's report as accepted. The worker replies only on
            // 'accepted', and that reply says "you were right. We are updating the record."
            //
            // So a routine that reviewed a page, found it CORRECT, and stamped it PASS told the
            // reader we were fixing something we had not touched. DAILY-REPORTS.md stated the rule
            // in prose — "do not stamp a report as accepted unless the fix actually shipped" — and
            // the code gave the caller no way to comply: there was no verdict that mapped to
            // anything but 'accepted'.
            //
            // Not hypothetical at scale: WEEKLY-DISCOVERY stamps 20 records a week INCLUDING clean
            // PASSes, because stamping is its rotation mechanism. It was suppressed only because
            // that routine has no ADMIN_TOKEN — an accident of environment, not a guard.
            //
            //   FIXED  -> accepted  : something shipped, the reader was right, they hear from us
            //   PASS   -> rejected  : we looked and the page stands. Sends NOTHING (see the worker:
            //                         only 'accepted' replies), which is correct — "we looked and
            //                         changed nothing" is noise dressed as courtesy.
            const triage = verdict === 'FIXED' ? 'accepted' : 'rejected';
            const res = await closeReports(ids, triage, `reviewed ${today} by ${by} (${verdict})`);
            if (res.error) console.log(`  ! reports not closed: ${res.error}`);
            else console.log(`  closed ${res.closed} report(s) as ${triage}${res.already ? `, ${res.already} already closed` : ''}` + (triage === 'accepted' ? ' — a reply was sent to any reporter who left an address' : ' — no reply sent (nothing shipped)'));
          }
        }
      }
    console.log(`  stamped ${n} record(s) reviewed ${today} (${verdict})`);
    console.log('  remember: rebuild so schema.dateModified and the pages reflect any fix.');
    return;
  }

  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('\n').slice(1).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
})();
}
