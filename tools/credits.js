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

// The credits that are actually FALSE — creditList minus any name that IS the record's real author.
//
// WHY: a Track A wave stamps creditedTo = the magnet author on EVERY record it harvested, including
// the ones that come back genuine ("trust, but verify" really is Reagan's) and the
// right-person-wrong-words ones (Franklin really did publish it, about wine). Neither is a
// misattribution, so `creditedTo` on those records names the true author under a field whose whole
// meaning is "falsely credited to". 41 non-disputed records carry one today.
//
// build-authors.js has excluded them since the "N quotes wrongly credited to them" chip over-stated
// itself by 200 records — but it did so with its own inline copy of this rule, so /verify kept
// shipping `credited` (which the Worker returns as `misattributedTo`) naming the true author on 38
// verified/attributed pages. Same rule, two readers, one of them missing: exactly what this module
// exists to prevent. Defined here once; build-authors and build-verify both read it.
//
// Compared by SLUG, not by string: the real author is answer.realAuthorName when the record names
// one (a disputed record's answer.authorName often holds the magnet's own name), else the author
// card's own slug — which is what absorbs the name-form variants ("Seneca" vs "Seneca the Younger").
const { slugify } = require('./slugify');
function falseCredits(r) {
  const a = (r && r.answer) || {};
  const explicitReal = a.realAuthorName;
  const trueSlug = explicitReal ? slugify(explicitReal)
    : ((r && r.author && r.author.slug) || slugify(a.authorName || 'Unknown'));
  return creditList(r).filter((c) => { const s = slugify(c); return s && s !== trueSlug; });
}

module.exports = { creditList, primaryCredit, otherCredits, falseCredits };
