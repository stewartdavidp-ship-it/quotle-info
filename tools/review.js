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

const readRecord = (f) => { try { return JSON.parse(fs.readFileSync(path.join(QDIR, f), 'utf8')); } catch { return null; } };
const allFiles = () => fs.readdirSync(QDIR).filter((f) => f.endsWith('.json'));
const daysBetween = (a, b) => Math.floor((a - b) / 86400000);

// Records have no dedicated freshness field yet (verified across all 1,158 — none carry one).
// schema.dateModified is the closest honest proxy: it is when the record last CHANGED, not
// when a human or agent last tested its claims against sources. Treat it as a seed, and mark
// anything relying on it as never-actually-reviewed so the first pass is not silently skipped.
function reviewState(rec) {
  const r = rec.review || {};
  const stamped = r.lastReviewedOn || null;
  const seed = (rec.schema && rec.schema.dateModified) || null;
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
function riskFlags(rec) {
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
    const cycle = flags.length ? RISKY_CYCLE_DAYS : DEFAULT_CYCLE_DAYS;
    const age = st.lastReviewedOn ? daysBetween(now, new Date(st.lastReviewedOn)) : 9999;
    rows.push({
      slug: rec.quoteSlug || f.replace(/\.json$/, ''),
      confidence: rec.confidence,
      rights: (rec.meta && rec.meta.rights) || rec.rights || null,
      lastReviewedOn: st.lastReviewedOn, everReviewed: st.everReviewed,
      ageDays: age, cycle, overdueBy: age - cycle, flags,
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
    // Priority: reader-refuted > reader-reported > overdue+risky > overdue > never reviewed.
    // The age term is CAPPED, and that cap is what makes a flag mean anything.
    //
    // A never-stamped record falls back to schema.dateModified, and a record MISSING that field
    // gets the 9999-day sentinel. Uncapped, that contributed 9,634 to priority — so the queue was
    // effectively sorted by "does this record have a dateModified field", and the 500 awarded for a
    // mechanical contradiction was noise against it. Measured before the cap: a record carrying a
    // high-severity contradiction scored 750 while an ordinary one scored 9,884. Flagging a record
    // DEMOTED it, which is the exact inverse of this function's own stated order
    // ("reader-refuted > reader-reported > overdue+risky > overdue > never reviewed").
    //
    // 9999 is a sentinel, not a measurement: a record unreviewed since it was built is not "27
    // years overdue". Capping at one extra cycle keeps genuine staleness ranking above fresh work
    // while leaving the flag and reader-report terms able to outrank it, as intended.
    r.priority = (r.refutes ? 4000 : 0) + (r.reports ? 2000 : 0)
      + (r.flags.length ? 500 : 0) + Math.min(Math.max(0, r.overdueBy), DEFAULT_CYCLE_DAYS)
      + (r.everReviewed ? 0 : 250);
  }
  rows.sort((a, b) => b.priority - a.priority || a.slug.localeCompare(b.slug));
  return { rows: rows.slice(0, limit), all: rows, reportError: rep.error || null };
}

// ---- commands --------------------------------------------------------------
const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : d; };
const LIMIT = parseInt(flag('--limit', '25'), 10);

(async () => {
  if (cmd === 'due' || cmd === 'args') {
    const { rows, all, reportError } = await dueSet(LIMIT);
    if (cmd === 'args') {
      // audit.js takes { pages:[{slug,confidence,rights}], repo }. Emit exactly that.
      process.stdout.write(JSON.stringify({
        pages: rows.map((r) => ({ slug: r.slug, confidence: r.confidence, rights: r.rights })),
        repo: ROOT,
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
    if (!rep.sources.length) { console.log('  no pending reader reports'); return; }
    console.log(`  ${rep.sources.length} pending reader report(s):\n`);
    for (const s of rep.sources) {
      console.log(`    [${(s.stance || '').toUpperCase().padEnd(8)}] ${s.slug}`);
      console.log(`               ${s.url}`);
      if (s.note) console.log(`               "${String(s.note).slice(0, 110)}"`);
    }
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
    if (!slugs.length) { console.log('  usage: review.js stamp <slug…> [--verdict PASS|FIXED] [--by <who>]'); process.exitCode = 1; return; }
    const today = new Date().toISOString().slice(0, 10);
    let n = 0;
    for (const slug of slugs) {
      const file = path.join(QDIR, `${slug}.json`);
      if (!fs.existsSync(file)) { console.log(`  ! no record: ${slug}`); continue; }
      const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
      rec.review = { ...(rec.review || {}), lastReviewedOn: today, lastReviewedBy: by, lastVerdict: verdict };
      fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
      n++;
    }
    console.log(`  stamped ${n} record(s) reviewed ${today} (${verdict})`);
    console.log('  remember: rebuild so schema.dateModified and the pages reflect any fix.');
    return;
  }

  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('\n').slice(1).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
})();
