export const meta = {
  name: 'harvest-candidates',
  description: 'HARVEST step for quotle.info: one Opus agent per magnet author pulls DOCUMENTED misattributions/disputed lines (Wikiquote Misattributed/Disputed sections) + famous investigated quotes (Quote Investigator catalog), emitting a candidate queue {quote, creditedTo, whyNotable, likelyConfidence, rightsEra} that feeds the SAME proven Opus + QI-deference ingestion waves. Dedup vs existing corpus is a deterministic post-step. Returns raw candidates[] grouped by author.',
  phases: [{ title: 'Harvest', detail: 'one documented-misattribution + famous-quote sweep per magnet author' }],
}

// ---------- candidate schema (StructuredOutput-enforced) ----------
const CANDIDATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['author', 'wikiquoteUrl', 'candidates'],
  properties: {
    author: { type: 'string' },              // canonical magnet-author name searched
    wikiquoteUrl: { type: 'string' },        // the Wikiquote page actually fetched (or '' if none)
    notes: { type: 'string' },               // optional: coverage notes / what was skipped
    candidates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['quote', 'creditedTo', 'category', 'whyNotable', 'likelyConfidence', 'rightsEra', 'documentedAt'],
        properties: {
          quote: { type: 'string' },         // the exact popular wording (plain text, no surrounding quotes)
          creditedTo: { type: 'string' },     // who it is POPULARLY credited to (usually the magnet author)
          trueOrigin: { type: 'string' },     // if known: who really said it / real source (for misattributions)
          category: { type: 'string', enum: ['misattributed', 'disputed', 'genuine-famous'] },
          whyNotable: { type: 'string' },     // 1 sentence: why this is worth a page
          likelyConfidence: { type: 'string', enum: ['verified', 'attributed', 'disputed'] },
          rightsEra: { type: 'string', enum: ['public-domain', 'in-copyright', 'uncertain'] },
          documentedAt: { type: 'string' },   // URL of the QI post or Wikiquote section documenting it
        },
      },
    },
  },
}

// Scouts fetch Wikiquote and QI directly and hit the same blocked-page walls that make an agent
// reach for `curl -o`. A relative filename lands in the operator's live checkout and a routine's
// `git add -A` commits it to main. Full rationale in workflows/generate.js (SCRATCH_RULE); keep this
// copy SHORT so they cannot drift apart.
const SCRATCH_RULE = `SCRATCH FILES — ABSOLUTE PATHS UNDER /tmp ONLY. If a fetch is unusable and you fall back to curl or any write-to-disk step, write to an absolute path under /tmp (e.g. /tmp/probe-$$.html) and read it back by that path. Your working directory is the operator's live git checkout: a relative filename gets committed to main by the next scheduled routine. Write nothing into the repository.`;

const harvestPrompt = (author, cap) => `You are a quote-provenance scout for quotle.info, a verified-provenance / fact-check site whose sweet spot is DOCUMENTED misattributions.

${SCRATCH_RULE} Your job is NOT to research from scratch — it is to HARVEST a candidate queue of quotes worth building pages for, sourced from the two authorities we defer to: Wikiquote and Quote Investigator.

MAGNET AUTHOR: ${author}
(One of the internet's biggest fake-quote magnets — feel-good and clever lines get pinned on them constantly. That is exactly why they are high-value: documented misattributions are our best content.)

DO THIS (use WebSearch + WebFetch):
1. Fetch this author's Wikiquote page. Go straight to the "Misattributed" and "Disputed" sections (also "Attributed" if present). These are gold: each entry is a quote commonly pinned on ${author} that Wikiquote has flagged. Harvest them.
2. Search Quote Investigator for this author: site:quoteinvestigator.com ${author.split(' ').slice(-1)[0]} — QI publishes deep investigations of the most-quoted lines tied to a name. Harvest the notable ones (both the ones QI CONFIRMS and the ones QI DEBUNKS/reassigns).
3. You may also include 1-3 GENUINELY famous, verified lines by ${author} that have their own Wikiquote sourced entry (category 'genuine-famous') — the hubs benefit from real anchors alongside the debunks. But the PRIORITY is misattributed/disputed material.

FOR EACH CANDIDATE emit: quote (the EXACT popular wording, plain text, no wrapping quote marks), creditedTo (who it is popularly credited to — usually ${author}; for a misattribution that Wikiquote reassigns, still put the POPULAR credit here and put the real originator in trueOrigin), category (misattributed | disputed | genuine-famous), whyNotable (one sentence — e.g. "One of the most-shared fake Einstein quotes; QI traces it to a 1980s self-help book"), likelyConfidence (your BEST GUESS at what our page will land on: verified = real & sourced; attributed = credibly credited but unpinned; disputed = misattributed/fabricated/reassigned), rightsEra (your best guess: public-domain if the source work is pre-1931; in-copyright if 1931+; uncertain if a fabrication/unknown origin — note that many misattributed lines have no real source so are 'uncertain'), documentedAt (the URL of the specific QI post or the Wikiquote section that documents this).

4. Wikiquote and QI are where you START, not where you stop. If a line is famously pinned on ${author} and neither covers it, KEEP GOING — look for a CREDIBLE PRIMARY OR INSTITUTIONAL SOURCE: the author's own book/letter/speech/transcript, the publication a line actually first appeared in, or the body that owns the author's legacy (e.g. the Drucker Institute, the W. Edwards Deming Institute, the Institute for Healthcare Improvement). Those are authorities in their own right. This step exists because it was skipped: a previous run of this workflow had TWO agents independently investigate "What gets measured gets managed" — the most-used management-slide quote there is — and correctly discard it under the old Wikiquote-or-QI-only rule, even though the Drucker Institute publicly denies it, the Deming Institute publishes a page showing Deming argued the OPPOSITE, and the idea traces to V. F. Ridgway's 1956 paper. The rule was hiding the single highest-value candidate for that author.

HARD RULES:
- Only include a candidate if you can point to a CREDIBLE SOURCE you actually read, and put its URL in documentedAt. Wikiquote and QI are the preferred sources; a primary source (the author's own work, the first publication of a line) or an institutional authority (a foundation/institute for the author, a professional body) is equally acceptable. What is NOT acceptable: quote aggregators (BrainyQuote, AZQuotes, Goodreads, QuoteFancy, PictureQuotes) — they are the problem this site exists to fix, and a candidate whose only support is an aggregator has no provenance at all. Do NOT invent quotes, misattributions, or sources.
- DEMAND is not the same as SOURCE COVERAGE. A living or contemporary figure may have no Wikiquote page and no QI article and still be one of the most-looked-up names in the field — Simon Sinek draws ~325K English Wikipedia pageviews a year, double Peter Drucker's. For such an author, source the candidate to their OWN book, talk or transcript (a primary source), and say so in documentedAt. Returning nothing because the two aggregating authorities are silent is a FALSE negative; say what you found and where instead.
- If you deliberately EXCLUDE a well-known line, say so in the notes field with the reason and any sources you did find. Those exclusions are read.
- SKIP song lyrics and short poems entirely (high legal risk — even if quoted on Wikiquote).
- Prefer DISTINCT, well-known lines. Skip obscure fragments no one searches for.
- Cap at ${cap} candidates for this author; if there are more, keep the most notable / most-shared.
- Do NOT dedup against our existing corpus — that is handled downstream. Just harvest.

Return via the structured schema. wikiquoteUrl = the Wikiquote page you fetched (or '' if none exists).`

phase('Harvest')

const cfg = typeof args === 'string' ? JSON.parse(args) : (args || {})
const authors = cfg.authors || []
const cap = cfg.perAuthor || 12

const results = (await parallel(authors.map((author) => () =>
  agent(harvestPrompt(author, cap), { label: `harvest:${author.split(' ').slice(-1)[0]}`, phase: 'Harvest', schema: CANDIDATE_SCHEMA, effort: 'high' })
    .then((r) => (r ? { author, wikiquoteUrl: r.wikiquoteUrl, notes: r.notes || '', candidates: (r.candidates || []).map((c) => ({ ...c, magnetAuthor: author })) } : null))
))).filter(Boolean)

const all = results.flatMap((r) => r.candidates)
log(`Harvested ${all.length} candidates across ${results.length} authors: ${results.map((r) => `${r.author.split(' ').slice(-1)[0]}=${r.candidates.length}`).join(', ')}`)

return {
  byAuthor: results.map((r) => ({ author: r.author, wikiquoteUrl: r.wikiquoteUrl, count: r.candidates.length, notes: r.notes })),
  candidates: all,
}
