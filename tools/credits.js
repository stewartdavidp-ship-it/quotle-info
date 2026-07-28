'use strict';
/*
 * credits.js — the ONE reading of a QUOTE record's `creditedTo`.
 *
 * `creditedTo` names who a quote is FALSELY credited to. It was a single string for the corpus's
 * first 580 disputed records — but a quote routinely collects MORE THAN ONE false credit. The
 * pessimist/optimist line is pinned on Churchill AND Rockefeller; "Tell 'em what you're going to
 * tell 'em" on Aristotle AND Dale Carnegie; "Folks are usually about as happy…" on Lincoln AND
 * Dale Carnegie.
 *
 * The PROSE layer already handled that — `misattribution.items[]` is multi-entry and 1,005 of the
 * 1,106 pages with a fact-check block debunk two or more names. The MACHINE and NAVIGATION layers
 * did not:
 *   - ClaimReview rated only the first name, so an answer engine reading the pessimist page learned
 *     "Churchill didn't say this" and never learned the same about Rockefeller, though the visible
 *     prose says so.
 *   - build-authors.js keyed "Often misattributed to X" off the single value, so a magnet author's
 *     hub silently omitted every line where they are the SECOND-most-common false credit.
 *
 * So `creditedTo` now accepts a STRING or an ARRAY, and everything reads it through here.
 * ORDER IS MEANINGFUL: the FIRST credit is the primary — the one the page's headline warning and
 * the primary ClaimReview node are about, and the one machine consumers that expect a single name
 * (the /verify API's `credited`) receive. The rest are additional false credits, additive
 * everywhere. A string record therefore behaves EXACTLY as before; nothing needed migrating.
 *
 * ⚠ SONG records also carry `creditedTo`, meaning something else entirely — the cover act mistaken
 * for the originator, which is singular by nature. Do NOT route song records through this module.
 */

// string | array | absent → de-duped, trimmed names in order. Case-insensitive de-dupe, because
// "Dale Carnegie" and "dale carnegie" would otherwise both index a hub and emit two ClaimReviews.
function creditList(r) {
  const raw = r && r.creditedTo;
  const arr = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    const name = String(x == null ? '' : x).trim();
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out;
}

// The headline false credit. '' when there is none — same falsy shape the old `q.creditedTo || ''`
// reads relied on, so every existing guard keeps working untouched.
const primaryCredit = (r) => creditList(r)[0] || '';

// The additional false credits, if any. Empty array for every legacy string record.
const otherCredits = (r) => creditList(r).slice(1);

module.exports = { creditList, primaryCredit, otherCredits };
