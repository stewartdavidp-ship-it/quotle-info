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
];

// A tag that DENIES A PERSON is a refutation and must keep the ✕, even if it also happens to match
// one of the role patterns above. Checked first, deliberately.
const REFUTATION_TAG = [
  /^\s*not\s+[A-Z]/,                            // "Not Winston Churchill", "Not Lewis's words"
  /\bno\s+(primary\s+)?source\b/i,
  /\bfabricat/i,
  /\bnever\s+said\b/i,
];

/** '' | 'context' — '' means leave the default (refuted ✕). */
function kindForTag(tag) {
  const t = String(tag || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim();
  if (!t) return '';
  if (REFUTATION_TAG.some((re) => re.test(t))) return '';
  return CONTEXT_TAG.some((re) => re.test(t)) ? 'context' : '';
}

module.exports = { kindForTag };
