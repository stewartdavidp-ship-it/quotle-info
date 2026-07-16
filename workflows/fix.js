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
const DIR = `${REPO}/data/quotes`
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
  },
}

const fixPrompt = (p) => `You are a meticulous record-fixer for quotle.info. Apply ONLY the confirmed audit fixes to one record, re-verifying every factual replacement against the cited source before you write it.

RECORD FILE: ${DIR}/${p.slug}.json  (a JSON record; fields carry inner HTML with entities like &mdash; &rsquo; and inline <a href> links).
CONFIRMED ISSUES: Read ${FIXES} (a JSON object keyed by slug) and use ONLY the array under the key "${p.slug}" — each entry has {severity, location, problem, fix}, independently verified by a skeptic. Fix every entry for this slug.

STEPS:
1. Read the record file in full, and read your issues from the fixes file above.
2. For any fix that introduces or changes a FACT (a date, page, edition, translator, source URL, attribution): WebFetch the relevant source FIRST and confirm the replacement is correct. Do not write an unverified fact. If a host blocks the fetcher, corroborate via WebSearch and say so in your summary.
3. Apply each fix by editing the JSON with the Edit tool. Preserve the file's formatting exactly (2-space indent, trailing newline, entity style — real entities like &mdash; not &amp;mdash;). Change ONLY what the issues require; do not touch unrelated fields.
4. HERO/AUTHOR CONSISTENCY: if a fix reassigns the true author (a disputed page whose real author is someone other than the credited magnet), make the record internally consistent — answer.authorName, answer.authorDates, answer.authorHref, and the author.* block (name/slug/initials/heading/metaLine/bio) must all be the TRUE author, with the credited magnet only in the misattribution section, and schema.creator = the true author. The rendered hero must NOT show the magnet name under a "Not X" label. (This is the Jobs→Brand / Lincoln→Anonymous pattern.)
5. CONFIDENCE INVERSION (rare): if an issue shows the confidence itself was wrong — a genuine quote wrongly marked disputed, or a fabrication wrongly marked verified — correct confidence AND make answer/author/misattribution/rights all consistent with the corrected finding. Only do this when an issue directs it.

Report fixedCount (how many issues for your slug you resolved), a one-paragraph summary of the edits, sourceVerified (did you fetch-confirm the factual replacements — false is fine for pure structured-data/formatting fixes with no new fact), and remaining (anything you could NOT fix and why).`

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
