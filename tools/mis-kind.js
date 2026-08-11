'use strict';
/*
 * mis-kind.js — decide whether a misattribution row is a REFUTATION or CONTEXT.
 *
 * template.js already draws the distinction: MIS_MARK renders a burgundy ✕ ("this credit is false")
 * for `kind: 'refuted'`, which is the DEFAULT, and a neutral tilde for `kind: 'context'`. The
 * comment on that table says the tilde exists "so the glyph never contradicts the row's prose".
 *
 * The mechanism was right and almost nothing used it: 32 of 2,913 rows carried a `kind`. So 248
 * rows whose own tag reads "paraphrase", "Popularizer, not author", "Speaker, not author" or
 * "wording drift" were rendering the ✕ that means their credit was refuted — a marker contradicting
 * the text printed beside it, which is the same defect class as every other one found this session.
 *
 * Found by a tier-3 fix agent, which proposed it as a detector. The proposal named tools/template.js
 * as the culprit; the renderer was innocent. From inside one record a missing field and a wrong
 * renderer look identical, so ALWAYS check where the defect actually lives before acting on a
 * proposal's diagnosis.
 *
 * CONSERVATIVE BY DESIGN. Marking a genuine refutation as context SOFTENS A DEBUNK, which is worse
 * than the ✕ being wrong — the page exists to refute. So this only matches tags that assert a
 * non-authorship ROLE ("popularizer", "speaker, not author", "paraphrase"), never a tag that denies
 * a person ("Not Winston Churchill", "No primary source"). Anything it does not recognise keeps the
 * default ✕ and is left for a human.
 *
 * Used by tools/backfill-mis-kind.js (the one-off sweep) and by workflows/prep-wave.js (so new
 * waves set it at ingest and the backlog cannot re-accumulate).
 *
 * OPEN GAP — THE `variant` / `wording` SEAM, LEFT ALONE ON PURPOSE 2026-08-08. Surveyed while closing
 * the tags r34 reported: ~250 rows in the ✕ tail carry a tag containing "variant", "wording",
 * "phrasing" or "form", led by a bare "variant" (54), "Variant" (26) and "wording" (21). Most look
 * like wording notes, but the same seam contains real refutations — "unsupported variant",
 * "Unsourced variant", "corrupted variant", "Garbled variant", "fabricated wording", "Wrong wording",
 * "Right author, wrong wording" — so a /\bvariant\b/ pattern would soften debunks at scale, which is
 * the one error this file is built to avoid. Only the narrow "(later|modern|popular) variant" form
 * was landed. The visible cost: `better-to-reign-in-hell-than-serve-in-heaven` now renders ~ on its
 * "context stripped" row and still ✕ on its "minor variant" row, two wording notes on ONE page with
 * different glyphs. Closing this wants its own measured pass over those ~250 rows, not another
 * pattern guessed from a sample.
 */

// Each pattern asserts a ROLE that is not authorship. None of them denies a named person.
const CONTEXT_TAG = [
  // Written narrow first and MEASURED: the initial set caught 175 rows and left a 142-row tail whose
  // top entries were bare "drift" (14), "Drifted", "minor drift", "date drift" and "Paraphrased" —
  // the same roles the corpus simply words more freely than the first draft assumed. Widened to the
  // ROLE WORD rather than the exact phrase. The refutation guard below is what keeps that safe.
  /\bparaphras(e|ed|es|ing)\b/i,                 // paraphrase · Paraphrased · modern paraphrase
  /\bdrift(ed|ing|s)?\b/i,                       // drift · minor drift · date drift · meaning drift
  /\bpopulari[sz](ers?|ed|es|ing)\b/i,             // Popularizer, not author · popularised, not coined
  /\brepeat(er|ed|s)\b/i,
  /\b(speaker|actor|performer)s?,?\s+not\s+(the\s+)?(author|originator|coiner)\b/i,
  /\btranslation,?\s+not\s+(the\s+)?original/i,
  /\bancestor\b/i,                              // "ancestor, not author"
  /\bcollector,?\s+not\s+(the\s+)?(author|origin)/i,
  /\breuse,?\s+not\s+origin/i,
  /\bearly\s+user\b/i,
  /\bnot\s+the\s+(author|coiner|originator)\s*$/i, // role statement, not a person-denial
  // THE GENERAL SHAPE, added after the first sweep left a 45-tag tail that was mostly this:
  // "<role>, not <authorship-word>" — Quoter/translator/reciter/adopter/anthology/compilation/
  // echo/seed/amplifier/character/users, each "not author|origin|originator|coiner|poet|source".
  // Naming the roles one by one was losing to the corpus's vocabulary; the CONSTRUCTION is the
  // signal. It stays safe because it requires the negation to land on an authorship word, so
  // "Wrong speaker", "no translator", "Translator erased" and "not free to reuse" are all skipped.
  /,\s*not\s+(the\s+)?(authors?|authored|origins?|originators?|coiners?|sources?|poets?)\b/i,
  /\bnot\s+the\s+origin\b/i,
  /\bquoted,?\s+not\s+authored\b/i,
  // ---- THE SECOND GAP, closed 2026-08-08 ----------------------------------------------------
  // Five r34 fix agents independently reported the same class from five different pages: a tag that
  // notes something about the WORDING or the CITATION, rendering the ✕ that means the CREDIT is
  // false — on pages whose own verdict is that the quote is genuine. The patterns below were each
  // checked row by row against the corpus (counts are rows in the 4,083-row misattribution set at
  // the time of landing); in every hit the page's prose affirms the person said it.
  /\b(later|modern|popular)\s+(variant|version|wording|phrasing|rewording)\b/i, // 7 rows
  /\bcontext\s+(stripped|removed|lost|missing)\b/i,                             // 29 rows
  // A mis-sourced row denies the CITATION, never the speaker — "Right author, wrong source" is one
  // of the tags it catches, and one row's own subject reads "Mis-sourced, not misattributed". The
  // "no source" case is a real refutation and REFUTATION_TAG below already claims it first.
  /\bmis[-\s]?(sourced|sourcing|cited|citation)\b|\bmiscit(ed|ation)\b|\bwrong\s+source\b/i, // 33 rows
  // ZERO ROWS TODAY, AND THAT IS NOT A REASON TO DROP THEM. Both were reported from the r34 record
  // that the wave then deliberately dropped as a duplicate, so the evidence is only in git:
  // `git show 3f346b024:data/quotes/im-so-fast-last-night-i-cut-the-light-switch-and-was-in-bed.json`.
  // Read those two rows before touching these — their subjects are PEOPLE ("Moran and Mack, Abbott
  // and Costello", "Satchel Paige") who genuinely did tell the joke earlier, which is why this pair
  // must NOT take the not-a-person guard used by the wording-edit family below.
  /\b(vaudeville|music[- ]hall|burlesque)\s+(stock|staple|gag|joke|material)\b/i,
  /\balso\s+borrowed\b/i,
  // ---- THE r35 PAIR, closed 2026-08-11 — kept literal on purpose ---------------------------
  // Two r35 fix agents (different pages) reported tags rendering the ✕ "this credit is false"
  // beside prose saying nobody disputes it: "reported, not written" (the person REPORTED the line,
  // a non-authorship role in exactly the "<role>, not <authorship-word>" construction — but
  // "written" is not in that pattern's authorship-word list and widening the list would need its
  // own measured pass) and the bare tag "echo" (HEDGED already knows the word; kindForTag never
  // consulted it). Both literal, per this file's own header: the third consecutive wave to hit a
  // CONTEXT_TAG gap, and each was closed at the width the evidence supported, not wider.
  /\breported,\s+not\s+written\b/i,
  /^echo$/i,
  // ---- THE LITERAL TAG, closed 2026-08-09 --------------------------------------------------
  // 28 rows carry the bare tag "context" — the row's printed label IS the word this file exists to
  // route to. 26 of them were rendering ✕ against it ("Speaker | Shakespeare in his own voice",
  // "The framing | Not about failing school", "Whose words are these, really? | A character, not
  // Shakespeare"). Every one of the 28 was read before landing; none denies a person. Anchored to
  // the WHOLE tag on purpose: "context stripped" is already handled above and stays a separate call.
  /^context$/i,
];

// A tag that DENIES A PERSON is a refutation and must keep the ✕, even if it also happens to match
// one of the role patterns above. Checked first, deliberately.
const REFUTATION_TAG = [
  /^\s*not\s+[A-Z]/,                            // "Not Winston Churchill", "Not Lewis's words"
  /\bno\s+(primary\s+)?source\b/i,
  // NEGATED, so the veto does not fire on a tag that DENIES fabrication. Three rows read
  // "Truncated, not fabricated" / "Translation, not fabrication" — each says the words are the
  // author's and only the form changed, which is the context case, and the bare /fabricat/ test was
  // vetoing them into the ✕ the tag explicitly rules out. Found 2026-08-08 while measuring the
  // wording-edit family below, which is where all three surfaced.
  /(?<!\bnot\s)\bfabricat/i,
  /\bnever\s+said\b/i,
];

// ---- the WORDING-EDIT family: needs the ROW, not just the tag ----------------------------------
// A tag that is just an edit participle — "Truncated", "Trimmed", "Translated, and flattened",
// "Clipped in search" — says the wording was changed. It does not say who said it, so on its own it
// cannot decide the glyph, and this is the one family in this file that MUST NOT be a CONTEXT_TAG
// entry: matching it on the tag alone is measurably wrong.
//
// MEASURED before landing, on 1,506 records / 4,083 rows:
//   * the participle test ALONE fires on 131 rows (3.2%) — and that set contains PERSON subjects:
//     "Serena Williams | trimmed", "Audre Lorde | Truncated", "Booker T. Washington | Truncated",
//     "Martin Luther King Jr. | Reworded". On those, ✕ may well be the correct refutation, and the
//     header of this file is explicit that softening a genuine debunk is the worse error.
//   * intersected with "the row's SUBJECT is not a person", it narrows to 92 rows (2.3%) across 88
//     records, EVERY ONE of which was read: each is a quoted fragment of the wording ("&ldquo;carpe
//     diem&rdquo; on its own") or an article-led description of it ("The half-sentence version"),
//     and not one is a person. Of the 59 rows the guard excludes, the person subjects above are the
//     reason it exists.
// So: keep the anchor, and keep the intersection. Un-anchoring the participle or dropping the guard
// re-admits the person subjects and turns this fix into the error it was written to avoid.
const WORDING_EDIT = /^\s*(translat(ed|ion)|trimmed|truncat(ed|ion)|reworded|shortened|elided|clipped|conflated|compressed|flattened|abridged|condensed|cut\s+short)\b/i;
// Tested against the RAW `who` (entities intact) because that is what was measured: an opening
// &ldquo;/&lsquo; means the subject IS the wording, and a leading article means it is a description
// of the wording. Deliberately narrow — it also excludes plainly non-person subjects like "Quote
// aggregators" and "Goodreads", which keep the ✕ and stay a human's call.
const NOT_A_PERSON = /^(?:&ldquo;|&lsquo;|&quot;|["'“‘])|^(?:the|a|an)\s/i;

/** '' | 'context' — '' means leave the default (refuted ✕). */
function kindForTag(tag) {
  const t = String(tag || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim();
  if (!t) return '';
  if (REFUTATION_TAG.some((re) => re.test(t))) return '';
  return CONTEXT_TAG.some((re) => re.test(t)) ? 'context' : '';
}


// ---- the TRUTH ROW: a row that states the correct attribution ----
// Found by tools/vocab-sweep.js (MIS_MARK.genuine used on 6 of 2,913 rows) and confirmed 3/3 by the
// skeptic panel, which also corrected the rule in two ways I had wrong:
//
//   1. NO AFFIRMATIVE SUBJECT → leave the ✕. "True author / Unknown / Undocumented" makes no claim
//      for the mark to contradict, so the refutation glyph is CORRECT there. My first rule keyed on
//      the scope label alone and would have mis-marked 6 rows.
//   2. HEDGED TRUTH IS CONTEXT, NOT GENUINE. "The genuine ancestor / Layman Pang — real, but
//      different" is not a passage the page holds up as the real thing; a sage ✓ would OVERCLAIM.
//      Those get the neutral tilde. 6 more rows.
//
// So 53 rows are genuine, 6 are context, 6 keep the ✕ — where a scope-label match alone said 65.
const AFFIRMS_TRUTH = /^(the\s+)?(actual|real|true|genuine|verified)\b/i;
// ---- THE SECOND AFFIRMING FAMILY, closed 2026-08-09 ----------------------------------------
// AFFIRMS_TRUTH keys on the scope PREFIX, so an affirming row phrased as a question or a category
// fell through to the default ✕ against its own prose — the d20260809 wave hand-marked two of these
// in a three-record build and reported the gap. MEASURED on 1,509 records / 4,093 rows: the two
// patterns below flip exactly 16 defaulted rows, every one read before landing —
//   * "What <X> really/actually/genuinely wrote|said|concludes…" and "What <X> did say|write|claim"
//     (13 rows): 8 affirm the true attribution outright ("What Gibran actually wrote | Gibran"),
//     4 are hedged truths routed to context by HEDGED below ("What Gandhi genuinely wrote |
//     (a different, longer line)"), 1 keeps the ✕ via NO_SUBJECT ("What QI actually concludes |
//     Nobody").
//   * "Who … credit(s)" / "The <noun> <Name> credits" (3 rows): "Who deserves credit | Anne
//     Sullivan", "Who period sources credit | Rep. Bede", "The scholar Wikiquote credits | Jiao
//     Hong" — all genuine. NOT matched, deliberately: noun-phrase credit LISTS ("Other false
//     credits", "Rival credits", "Earlier stray credits" — 13 rows), which are refutations and keep
//     the ✕; the verb-final anchor is what separates them.
// The other 63 question-shaped defaulted scopes ("What it means", "Where the name came from",
// "When the beer version appeared") affirm no attribution and were left alone on purpose.
const AFFIRMS_WHAT = /^what\b.*\b(really|actually|genuinely|truly|in\s+fact)\b.*\b(wrote|said|says?|is|concludes?|claims?)\b|^what\b.*\bdid\s+(say|write|claim)\b/i;
const AFFIRMS_CREDIT = /^who\b.*\bcredits?\s*$|^the\s+\w+\s+\S+\s+credits\s*$/i;
// "nobody" added 2026-08-09: "What QI actually concludes | Nobody" affirms no subject — same
// principle-1 case as "Unknown", the ✕ is correct there.
const NO_SUBJECT = /^(unknown|anonymous|unattributed|undocumented|origin unknown|nobody|no\s|none)/i;
const DENIES = /^(not|no)\b/i;
// "real, but a different X" — true of something, but not the thing this page is about.
// The last four alternations landed 2026-08-09 with the AFFIRMS_WHAT family and are measured
// against it: "(a different, longer line)", "A genuine line, on a different point", "Different
// words", "related, not the same line", "A genuinely parallel idea" — each affirms a truth the page
// does NOT hold up as this quote, so ✓ would overclaim. Zero collisions: no defaulted row computed
// genuine or context before this change (all 802 non-✕ kinds in the corpus are hand-set).
const HEDGED = /\b(precursor|ancestor|echo|seed|earlier|idea,\s*not|not\s+wording|but\s+(a\s+)?different|not\s+the\s+(origin|source)|a\s+different\b|different\s+words|not\s+the\s+same|parallel)\b/i;

/** '' | 'genuine' | 'context' — for a whole misattribution row, not just its tag. */
function kindForRow(item) {
  const it = item || {};
  const clean = (x) => String(x || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, "'").trim();
  const scope = clean(it.scope), who = clean(it.who), tag = clean(it.tag);
  if ((AFFIRMS_TRUTH.test(scope) || AFFIRMS_WHAT.test(scope) || AFFIRMS_CREDIT.test(scope)) && !DENIES.test(who)) {
    if (NO_SUBJECT.test(who)) return '';                       // nothing affirmed — ✕ is right
    // An explicit context-shaped tag wins over the scope inference: "What Freud really wrote |
    // Sigmund Freud, 1958 | context" affirms a real sentence about a DIFFERENT subject — the row's
    // own label says so, and a ✓ would overclaim exactly the way a hedged truth would.
    return (HEDGED.test(`${who} ${tag}`) || kindForTag(it.tag) === 'context') ? 'context' : 'genuine';
  }
  const byTag = kindForTag(it.tag);
  if (byTag) return byTag;
  // The wording-edit family, last: a tag the tag-only rule declined, on a row whose subject is the
  // wording rather than a person. REFUTATION_TAG has already had its say inside kindForTag.
  if (REFUTATION_TAG.some((re) => re.test(tag))) return '';
  return WORDING_EDIT.test(tag) && NOT_A_PERSON.test(String(it.who || '').trim()) ? 'context' : '';
}

module.exports = { kindForTag, kindForRow };
