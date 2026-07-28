export const meta = {
  name: 'fix-wave',
  description: 'Apply the confirmed audit fixes to each record on Opus, re-verifying every factual replacement against the cited source before editing. Reads the per-wave fixes map from a durable file. Returns a fix report.',
  phases: [{ title: 'Fix', detail: 'one agent per flagged record' }],
}

// args is EITHER the legacy array of FAIL slugs, OR an object { slugs:[...], repo:"/abs/path" }.
// repo MUST be passed when the wave was built in a git worktree — the records this edits, and the
// fixes map it reads, only exist in that checkout. Pointed at the main one, every agent fails to
// find its file. (parse-audit.js defaults its --out to the main checkout too: point it at the
// same repo when you generate current-fixes.json.)
const _a = typeof args === 'string' ? JSON.parse(args) : (args || [])
const _slugs = Array.isArray(_a) ? _a : (_a.slugs || [])
const REPO = (!Array.isArray(_a) && _a.repo) || '/Users/davidstewart/Developer/quotle-info'
// kind: 'quote' (default) | 'song'. Songs live in a different record dir and have a different
// record shape, so steps 4-5 below branch on it. This is a BRANCH rather than a second fix-songs.js
// on purpose: the scope gate, the parallel-edit race warning and the generator-defect reporting
// rule are the valuable part of this file and they are identical for both content types — a forked
// copy is how those drift apart, and generate.js already demonstrates the cost of duplication.
const KIND = (!Array.isArray(_a) && _a.kind) || 'quote'
const DIR = `${REPO}/data/${KIND === 'song' ? 'songs' : 'quotes'}`
// Per-wave fixes map: { "<slug>": [ {severity, location, problem, fix}, ... ] }.
// Write this file (from the audit FAIL issues) BEFORE invoking this workflow.
// It lives in the gitignored scratch dir so per-wave intermediates don't get committed.
const FIXES = `${REPO}/workflows/.scratch/current-fixes.json`

const FIX_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['slug', 'fixedCount', 'summary', 'sourceVerified'],
  properties: {
    slug: { type: 'string' },
    fixedCount: { type: 'number' },
    summary: { type: 'string' },
    sourceVerified: { type: 'boolean' },
    remaining: { type: 'string' },
    // THE TIER-3 → TIER-1 FEEDBACK LOOP. When a fix addresses a CLASS of defect rather than a
    // one-off fact, that class should become a permanent layer-1 detector (tools/detectors.js) so
    // it can never go unnoticed again. Without this the catalogue only grows when a human happens
    // to remember; with it, every wave hands back the signal it just learned.
    detectorProposal: {
      type: 'object', additionalProperties: false,
      required: ['id', 'rationale', 'test'],
      properties: {
        id: { type: 'string' },          // kebab-case, e.g. 'coined-verb-mismatch'
        rationale: { type: 'string' },   // what contradiction it catches, and the defect it came from
        test: { type: 'string' },        // JS source: (r) => null | 'why this record is flagged'
      },
    },
  },
}

const fixPrompt = (p) => `You are a meticulous record-fixer for quotle.info. Apply ONLY the confirmed audit fixes to one record, re-verifying every factual replacement against the cited source before you write it.

RECORD FILE: ${DIR}/${p.slug}.json  (a JSON record; fields carry inner HTML with entities like &mdash; &rsquo; and inline <a href> links).
CONFIRMED ISSUES: Read ${FIXES} (a JSON object keyed by slug) and use ONLY the array under the key "${p.slug}" — each entry has {severity, location, problem, fix}, independently verified by a skeptic. Fix every entry for this slug.

STEPS:
1. Read the record file in full, and read your issues from the fixes file above.
2. For any fix that introduces or changes a FACT (a date, page, edition, translator, source URL, attribution): WebFetch the relevant source FIRST and confirm the replacement is correct. Do not write an unverified fact. If a host blocks the fetcher, corroborate via WebSearch and say so in your summary.
3. Apply each fix by editing the JSON with the Edit tool. Preserve the file's formatting exactly (2-space indent, trailing newline, entity style — real entities like &mdash; not &amp;mdash;). Change ONLY what the issues require; do not touch unrelated fields.

SCOPE — YOU MAY EDIT EXACTLY ONE FILE: ${DIR}/${p.slug}.json. Nothing else. Not tools/*, not workflows/*, not another record, not built HTML.
  Some of your issues will NOT be fixable from the record, because the defect is in a shared generator (tools/template.js renders all ~718 pages; buildJsonLd ignores record fields it doesn't read, so "fixing" it in the record would be INERT and would look fixed while shipping the same bad markup). When that happens: DO NOT EDIT THE GENERATOR. Report it in \`remaining\` — name the file, the line/function, the exact defect, and the change you would make.
  This is not bureaucracy, it is correctness. Dozens of you run in PARALLEL on the same generator, so concurrent edits race and land conflicting variants of one line. The same generator defect is typically filed against several slugs at once, so each of you would "fix" it independently. And a per-record fix silently rewriting a file that renders every page is a blast radius nobody chose. The parent collects your \`remaining\` reports, applies each generator fix ONCE, centrally, and rebuilds.
  Report it even if it looks trivial and even if you are confident. A precise report is worth more than an edit — it is what a past wave did, and it is how the ClaimReview claimant bug (59 pages emitting a false machine-readable claim) got found and fixed properly.
${KIND === 'song' ? `4. ORIGINAL-ARTIST CONSISTENCY: if a fix reassigns who recorded it FIRST (the audit found an earlier recording, or the named original turned out to be the first HIT rather than the first record), make the record internally consistent — answer.originalArtist, answer.originalArtistSlug, answer.originalArtistDates, answer.label, original.artist/year/label/released/charted, the docMeta rows, the authors[] card with role "original", and schema.byArtist + schema.datePublished must ALL be the true first recorder. The previously-named artist keeps a place in the story (usually in original.trail or misattribution) but must no longer be presented as the original. A page whose hero says one artist and whose JSON-LD says another is worse than the error it was fixing.
   AUTHOR ROLES are a closed set: "original" = who recorded it first, "cover" = the act mistaken for the originator, "writer" = THE SONGWRITER only. If an issue says a producer, session player or intermediate cover act is carded as "writer", REMOVE that card and move the person into context.lead / context.detailsBody / a misattribution item, where they can be described accurately. Two cards is a valid page.
5. NO LYRICS: if an issue flags a quoted lyric, REWRITE the passage as factual description — do not merely shorten the quotation. Song titles are fine; a hook fragment is not. This is the site's core legal position, so a lyric issue is never "fixed" by trimming a word.
   LISTEN LINK: if an issue says the listen link is a later re-recording rather than the original, DELETE the whole listen block unless you can fetch-confirm a legitimate copy of the ORIGINAL (official artist/label/topic channel, ℗ line, running time matching the MusicBrainz recording for the original). An absent link is correct and expected — do not substitute a fan upload.` : `4. HERO/AUTHOR CONSISTENCY: if a fix reassigns the true author (a disputed page whose real author is someone other than the credited magnet), make the record internally consistent — answer.authorName, answer.authorDates, answer.authorHref, and the author.* block (name/slug/initials/heading/metaLine/bio) must all be the TRUE author, with the credited magnet only in the misattribution section, and schema.creator = the true author. The rendered hero must NOT show the magnet name under a "Not X" label. (This is the Jobs→Brand / Lincoln→Anonymous pattern.)
5. CONFIDENCE INVERSION (rare): if an issue shows the confidence itself was wrong — a genuine quote wrongly marked disputed, or a fabrication wrongly marked verified — correct confidence AND make answer/author/misattribution/rights all consistent with the corrected finding. Only do this when an issue directs it.`}

Report fixedCount (how many issues for your slug you resolved), a one-paragraph summary of the edits, sourceVerified (did you fetch-confirm the factual replacements — false is fine for pure structured-data/formatting fixes with no new fact), and remaining (anything you could NOT fix and why).

  FINALLY — \`detectorProposal\`, and only when it genuinely applies. If one of your fixes addressed a CLASS of defect that a machine could spot in ANY record without fetching anything, propose it as a layer-1 detector. Emit \`test\` as JS source for a function (r) => null | 'reason', reading ONLY the record object.

  The bar is narrow and you should usually emit NOTHING:
   • It must be TWO THINGS WE PUBLISHED CONTRADICTING EACH OTHER — a visible label against a schema field, a rights claim against a source year. Mechanically decidable from the record alone.
   • It must NOT require judging whether a claim is true about the world. That is what the audit you are downstream of already does, with sources and a skeptic. A detector cannot fetch.
   • A one-off wrong date, name or URL is NOT a class. Fixing it is the whole job; there is nothing to generalise.
   • Assume your rule fires far more than you expect. Rules that looked obviously right have measured 130 hits (11.2%) and 703 hits (61%) on this corpus, because they matched the editorial content of a misattribution site rather than errors in it.

  A human runs \`node tools/propose-detector.js\` on your proposal, which measures it across all 1,158 records and rejects anything above the noise floor. Proposing a bad one costs nothing; proposing none when you found a real class costs the loop.`

phase('Fix')
const pages = _slugs.map((slug) => ({ slug }))

const done = await parallel(pages.map((p) => () =>
  agent(fixPrompt(p), { label: `fix:${p.slug.slice(0, 22)}`, phase: 'Fix', schema: FIX_SCHEMA, effort: 'high' })
    .then((v) => v || { slug: p.slug, fixedCount: 0, summary: 'agent failed', sourceVerified: false, remaining: 'agent died' })
)).then((r) => r.filter(Boolean))

log(`Fixed ${done.length}/${pages.length} pages; ${done.reduce((s, r) => s + (r.fixedCount || 0), 0)} issues`)
return {
  pagesFixed: done.length,
  issuesFixed: done.reduce((s, r) => s + (r.fixedCount || 0), 0),
  unverified: done.filter((r) => !r.sourceVerified).map((r) => r.slug),
  withRemaining: done.filter((r) => r.remaining && r.remaining.trim()).map((r) => ({ slug: r.slug, remaining: r.remaining })),
  perPage: done.map((r) => ({ slug: r.slug, fixed: r.fixedCount, summary: r.summary })),
}
