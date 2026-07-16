export const meta = {
  name: 'audit-wave',
  description: 'Adversarially audit each newly-built /who-said page: read the local rendered HTML, re-fetch every source link and confirm it literally supports the specific claim it is attached to, check confidence + rights honesty and the URL/JSON-LD contract, then a skeptic re-checks each high/blocker issue. Returns pageAudits[].',
  phases: [{ title: 'Audit', detail: 'one adversarial agent per page' }, { title: 'Verify', detail: 'skeptic re-checks each high/blocker' }],
}

// args is EITHER the legacy array of pages [{slug, confidence, rights}], OR an object
// { pages:[...], repo:"/abs/path/to/checkout" }.
// repo MUST be passed when the wave was built in a git worktree: the agents Read the freshly
// BUILT html off disk, and a worktree's who-said/ is the only place this wave's pages exist —
// pointed at the main checkout every agent silently fails to find its page.
const _a = typeof args === 'string' ? JSON.parse(args) : (args || [])
const pages = Array.isArray(_a) ? _a : (_a.pages || [])
const REPO = (!Array.isArray(_a) && _a.repo) || '/Users/davidstewart/Developer/quotle-info'
const BASE = `${REPO}/who-said`
const ORIGIN = 'https://quotle.info'

const AUDIT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['page', 'claimsChecked', 'linksChecked', 'confidenceHonest', 'rightsHonest', 'issues', 'verdict', 'summary'],
  properties: {
    page: { type: 'string' },
    claimsChecked: { type: 'number' },
    linksChecked: { type: 'number' },
    confidenceHonest: { type: 'boolean' },
    rightsHonest: { type: 'boolean' },
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['severity', 'location', 'claim', 'sourceLink', 'problem', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'minor'] },
          location: { type: 'string' }, claim: { type: 'string' }, sourceLink: { type: 'string' },
          problem: { type: 'string' }, fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['finding', 'standsUp', 'reasoning'],
  properties: { finding: { type: 'string' }, standsUp: { type: 'boolean' }, reasoning: { type: 'string' } },
}

const auditPrompt = (p) => `You are an adversarial fact-check AUDITOR for quotle.info. Try to BREAK this page. Assume it is wrong until each claim survives an independent check.

PAGE (read it in full with the Read tool): ${BASE}/${p.slug}/index.html
Canonical URL when live: ${ORIGIN}/who-said/${p.slug}   [confidence=${p.confidence}, rights=${p.rights}]

DO THIS:
1. Read the rendered HTML. Extract every factual claim (who really said it, the source work + date + page, the misattribution history, translator/edition specifics) and every external/source link (answer source-line, provenance trail, misattribution items, "Dig deeper" cards, JSON-LD).
2. For EACH source link: WebFetch it and confirm it LITERALLY contains the specific claim the page attaches to it. The #1 failure mode is "a real link that does not support the specific claim pinned to it" — flag every instance (severity high). If a host blocks the fetcher (403/blocked) but the source plausibly exists, note it in the summary but do NOT flag it as a broken link.
3. CONFIDENCE honesty: does the ${p.confidence} state match the evidence? (verified needs a primary source with the exact wording; disputed must correctly name the true origin / call it a fabrication; attributed must not overclaim.) A wrong state is a high/blocker.
4. RIGHTS honesty: is rights=${p.rights} defensible? A false "public-domain" badge is a blocker. Prose-only (no asserted status) is acceptable for an unpinned/fabricated line.
5. QI-DEFERENCE: the page must NOT overclaim past Quote Investigator / Wikiquote — no earlier origin, more confident attribution, or extra specificity than the specialist source documents. Flag overclaims.
6. CONTRACT: canonical, og:url, and the JSON-LD @ids all derive from ${ORIGIN}/who-said/${p.slug}. Report any mismatch. Note (do not fail on) the orchestrator template showing "quote undefined" — that is not the page.

For every problem return an issue {severity, location (section + approx line), claim, sourceLink, problem, fix}. severity: blocker (false published fact / wrong verdict / false PD badge), high (link does not support its claim / overclaim past specialist), medium (mis-anchored-but-true / over-specific date), minor (cosmetic / structured-data nit). verdict FAIL if any blocker/high, else PASS. Set page to "${p.slug}/index.html".`

const skepticPrompt = (slug, issue) => `You are a SKEPTIC re-checking one audit finding on the quotle.info page ${BASE}/${slug}/index.html. Default to standsUp=false unless you can independently confirm the problem is real.

CLAIMED PROBLEM [${issue.severity}] at ${issue.location}: ${issue.problem}
The claim in question: ${issue.claim}
The source link: ${issue.sourceLink}

Independently verify: WebFetch the source link and read the page's own wording (Read the file). Does the linked source REALLY fail to support the claim as stated (or is the confidence/rights/contract problem real)? Return finding (what you found), standsUp (true only if the problem is genuinely real and worth fixing), reasoning.`

phase('Audit')
// (pages + REPO are parsed at the top of this file, where BASE needs them.)

const pageAudits = await parallel(pages.map((p) => () =>
  agent(auditPrompt(p), { label: `audit:${p.slug.slice(0, 22)}`, phase: 'Audit', schema: AUDIT_SCHEMA, effort: 'high' })
    .then(async (a) => {
      if (!a) return null
      // Skeptic re-check every high/blocker issue; drop the ones a skeptic refutes.
      const hard = (a.issues || []).filter((i) => i.severity === 'high' || i.severity === 'blocker')
      if (hard.length) {
        const verdicts = await parallel(hard.map((i) => () =>
          agent(skepticPrompt(p.slug, i), { label: `verify:${p.slug.slice(0, 16)}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' })
            .then((v) => ({ i, keep: !v || v.standsUp !== false }))
        ))
        const refuted = new Set(verdicts.filter(Boolean).filter((v) => !v.keep).map((v) => v.i))
        a.issues = (a.issues || []).filter((i) => !refuted.has(i))
        a.verdict = (a.issues || []).some((i) => i.severity === 'high' || i.severity === 'blocker') ? 'FAIL' : 'PASS'
      }
      a.issueCount = (a.issues || []).length
      return a
    })
)).then((r) => r.filter(Boolean))

const pass = pageAudits.filter((a) => a.verdict === 'PASS').length
log(`Audited ${pageAudits.length}/${pages.length}: ${pass} PASS, ${pageAudits.length - pass} FAIL`)
return { pageAudits }
