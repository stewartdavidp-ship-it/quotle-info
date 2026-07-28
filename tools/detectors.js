'use strict';
/*
 * detectors.js — LAYER 1 of the review spine: the catalogue of KNOWN anomaly patterns.
 *
 * Three layers, and this is the cheap one:
 *   1. scan.js + this file — deterministic, no network, no agents. Flags suspicion. Does NOT
 *      touch answer.lastVerified or review.lastReviewedOn, because it has not reviewed anything.
 *   2. workflows/audit.js, chosen by tools/review.js — re-fetches sources, tests claims, runs a
 *      skeptic. CLEARS a record (review.js stamp) or sends it to be rewritten.
 *   3. generate → prep → ingest → audit → fix — the full lifecycle, which restamps on the way out.
 *
 * THE ONE RULE FOR ADDING A DETECTOR: flag only when TWO THINGS WE PUBLISHED CONTRADICT EACH
 * OTHER. That is mechanically decidable and cheap. "Is this claim true about the world" is not —
 * it needs sources and a skeptic, which is layer 2's entire job. review.js's header records what
 * happens when this line is crossed: a draft that flagged "absolute negative" claims matched
 * 703/1158 records (61%), then 516 (45%) after narrowing, because "this appears nowhere in
 * Jefferson's writings" IS the editorial content of a disputed-quote corpus. It flagged the job
 * description.
 *
 * EVERY DETECTOR HERE WAS MEASURED BEFORE IT WAS ADDED. Candidates rejected on 2026-07-28:
 *   · claimant-not-a-person       130 hits (11.2%) — "No primary source" is legitimate prose in
 *                                 items[0].who, and template.js already guards it at RENDER time
 *                                 via looksLikePerson(). Duplicating a render guard as a flag
 *                                 produces a worse version of a tool we already have.
 *   · credited-equals-realauthor   11 hits, 0/11 precision — every one was right-person-wrong-words
 *                                 (Edison's "10,000 ways", Socrates' "I know that I know nothing").
 *                                 Naming one person as both the credit and the truth is the
 *                                 LEGITIMATE shape there, and validate-records already warns on it.
 *   · verified-but-hedged-prose     4 hits, 0/4 — all matched an incidental keyword inside
 *                                 otherwise-correct prose ("Written by Descartes…").
 * Measure before you add. A detector under ~2% that you have hand-checked is worth having; one at
 * 11% is a second inbox nobody will read.
 *
 * A ZERO-HIT DETECTOR IS NOT DEAD CODE. It is a tripwire for a regression that has not happened
 * yet. Three below currently fire on nothing; that is the point.
 *
 * VERSIONING: bump `version` whenever a detector's LOGIC changes. scan.js re-runs a detector on
 * every record whose recorded version differs, so a new or changed signal sweeps the whole corpus
 * without re-running the detectors that are already settled. Never reuse an id for new logic.
 */


const plain = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ');
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const DETECTORS = [
  {
    id: 'coined-verb-mismatch',
    version: 1,
    severity: 'high',
    title: 'label says the credited person did not COIN it, but the ClaimReview will deny they SAID it',
    // MEASURED 2026-07-28: 8/1158 (0.7%). Hand-checked: 6 genuine, 2 are records whose label wording
    // overstates ("Not coined by Selfridge" where he never said it at all) — those are a copy
    // question, and a true positive of the pattern either way.
    //
    // The bug this catches shipped: the Gary Player page's visible label read "Not coined by Gary
    // Player — an older saying he made famous" while its JSON-LD asserted `Gary Player said: "…"`
    // rated 1/5. He DID say it. Prose hedged, structured data flat and wrong, and only the
    // structured data is what an answer engine reads.
    test(r) {
      const label = plain((r.answer || {}).label);
      if (!/not coined|didn.t coin|did not coin|did not originate|an older saying/i.test(label)) return null;
      const s = r.schema || {};
      if (s.claimVerb || s.claimReviewed) return null;
      return `label: "${label.trim().slice(0, 72)}" — set schema.claimVerb`;
    },
  },
  {
    id: 'disputed-no-citation',
    version: 1,
    severity: 'medium',
    title: 'contested verdict published with no citation attached',
    // TRIPWIRE — 0 hits at 2026-07-28. Mechanically decidable and no judgement: we published a
    // contested verdict and attached nothing to it. Carried over from review.js riskFlags().
    test(r) {
      if (r.confidence !== 'disputed' && r.confidence !== 'attributed') return null;
      return r.cite ? null : 'no cite block on a contested record';
    },
  },
  {
    id: 'public-domain-modern-source',
    version: 1,
    severity: 'high',
    title: 'rights say public-domain but the source is 1931 or later',
    // TRIPWIRE — 0 hits at 2026-07-28. A rights claim is the one thing on this site a reader may
    // ACT on commercially, so a contradiction between the rights field and the source year is worth
    // catching before a reader relies on it.
    test(r) {
      const s = r.source || {};
      if (s.rights !== 'public-domain') return null;
      const y = String(s.year || s.date || '').match(/\b(1[89]\d\d|20\d\d)\b/);
      return (y && +y[1] >= 1931) ? `rights=public-domain but source year ${y[1]}` : null;
    },
  },
  {
    id: 'faq-affirms-disputed',
    version: 1,
    severity: 'high',
    title: 'FAQ answer opens "Yes" on a disputed record',
    // TRIPWIRE — 0 hits at 2026-07-28. The FAQ answer is the string an answer engine reads aloud.
    // On a disputed record it must not open by affirming the claim the page exists to refute. The
    // songs vertical shipped exactly this shape (beyond-the-sea's FAQ asserted a first-recording
    // the prose had already corrected), so it is a real failure mode, not a hypothetical.
    test(r) {
      if (r.confidence !== 'disputed') return null;
      const a = plain((r.schema || {}).faqAnswer).trim();
      return /^yes\b/i.test(a) ? `faqAnswer opens "${a.slice(0, 48)}"` : null;
    },
  },
];

// Stable fingerprint of the detector SET, so scan.js can tell "nothing to do" from "never run".
const CATALOGUE = DETECTORS.reduce((m, d) => (m[d.id] = d.version, m), {});

function runDetector(d, rec) {
  try {
    const detail = d.test(rec);
    return detail ? { id: d.id, severity: d.severity, title: d.title, detail: String(detail) } : null;
  } catch (e) {
    // A throwing detector must not take the scan down — it is the cheap layer, and a broken
    // detector is itself a finding.
    return { id: d.id, severity: 'error', title: d.title, detail: `detector threw: ${e.message}` };
  }
}

module.exports = { DETECTORS, CATALOGUE, runDetector };
