export const meta = {
  name: 'audit-songs',
  description: 'Adversarially audit each newly-built /who-recorded/ page: read the rendered HTML, re-fetch every source link and confirm it literally supports the claim attached to it, attack the FIRST-RECORDING claim and the confusion bar, check the listen link is the original and not a re-recording, and enforce NO-LYRICS. A skeptic then re-checks each high/blocker. Returns pageAudits[].',
  phases: [{ title: 'Audit', detail: 'one adversarial agent per song page' }, { title: 'Verify', detail: 'skeptic re-checks each high/blocker' }],
}

// args is EITHER an array of pages [{slug, confidence}], OR { pages:[...], repo:"/abs/path" }.
// repo MUST be passed when the wave was built in a git worktree: the agents Read the freshly BUILT
// html off disk, and a worktree's who-recorded/ is the only place this wave's pages exist. Pointed
// at the main checkout, every agent silently audits the WRONG site and returns a clean PASS.
const _a = typeof args === 'string' ? JSON.parse(args) : (args || [])
const pages = Array.isArray(_a) ? _a : (_a.pages || [])
const REPO = (!Array.isArray(_a) && _a.repo) || '/Users/davidstewart/Developer/quotle-info'
const BASE = `${REPO}/who-recorded`
const RECORDS = `${REPO}/data/songs`
const ORIGIN = 'https://quotle.info'

// Same shape as workflows/audit.js's AUDIT_SCHEMA so workflows/parse-audit.js reads this journal
// unchanged — it keys on {page, verdict, issues} and does not care which content type produced them.
const AUDIT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['page', 'claimsChecked', 'linksChecked', 'firstRecordingHolds', 'confusionBarHolds', 'noLyrics', 'issues', 'verdict', 'summary'],
  properties: {
    page: { type: 'string' },
    claimsChecked: { type: 'number' },
    linksChecked: { type: 'number' },
    // The three claims that ARE the page. Booleans so a FAIL cannot hide inside prose.
    firstRecordingHolds: { type: 'boolean' },
    confusionBarHolds: { type: 'boolean' },
    noLyrics: { type: 'boolean' },
    listenLinkIsOriginal: { type: 'string', enum: ['yes', 'no', 'no-link', 'unverifiable'] },
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

// slug + location are ECHOED BACK so the verdict can be PAIRED with the issue it judged.
// Without them the journal holds a bag of unattributable verdicts: workflows/parse-audit.js reads
// the JOURNAL (each agent's RAW return), while the refuted-issue filtering below happens in this
// script's .then() and never reaches the journal — so every wave fed fix.js the findings its own
// skeptics had already thrown out. Wave s2 shipped 5 refuted findings to fix agents that way.
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['slug', 'location', 'finding', 'standsUp', 'reasoning'],
  properties: { slug: { type: 'string' }, location: { type: 'string' }, finding: { type: 'string' }, standsUp: { type: 'boolean' }, reasoning: { type: 'string' } },
}

const auditPrompt = (p) => `You are an adversarial RECORDING-HISTORY auditor for quotle.info. Try to BREAK this page. Assume it is wrong until each claim survives an independent check.

PAGE (Read it in full): ${BASE}/${p.slug}/index.html
RECORD (Read it too — the page is generated from it): ${RECORDS}/${p.slug}.json
Canonical URL when live: ${ORIGIN}/who-recorded/${p.slug}/   [confidence=${p.confidence}]

The page makes ONE central claim: that a specific artist RECORDED THIS SONG FIRST, and that a later, more famous act is widely mistaken for the originator. Everything below tests that.

1. READ the rendered HTML and the record. Extract every factual claim (who recorded it first, the year, label, catalogue number, release format, chart placing, the writer, what the famous cover did) and every external/source link (answer source line, the provenance trail, misattribution items, external links, listen, sameAs, JSON-LD).

2. EVERY SOURCE LINK: WebFetch it and confirm it LITERALLY contains the specific claim the page attaches to it. The #1 failure mode across this site is "a real link that does not support the specific claim pinned to it" — flag every instance (severity high). If a host blocks the fetcher (403), note it in the summary but do NOT flag it as a broken link. SecondHandSongs blocks automated fetching; do not treat that as a defect.

3. *** ATTACK THE FIRST-RECORDING CLAIM. *** This is the page's reason to exist, so spend most of your effort here. Actively SEARCH for an EARLIER recording than the one named. Many songs have an obscure version ahead of the one usually called the original — if you find one, that is a blocker, and it is also the most valuable thing you can return. Check specifically:
   • Is the named artist the first to RECORD it, or merely the first to have a HIT with it?
   • Is the stated year the RECORDING date, the RELEASE date, or the copyright/publication date? The page must not silently swap one for another.
   • For a standard or a foreign-language song: the first recording is often NOT the first performance and NOT the famous one. Does the page say precisely what its sources say?
   Set firstRecordingHolds accordingly.

4. *** THE CONFUSION BAR. *** The page asserts that the public genuinely believes the cover act originated it. Test that honestly: if the original is itself a famous, universally-credited hit and the cover is well known AS a cover, the page has no thesis and should not exist. (The standing precedent: "Higher Ground" was dropped because Stevie Wonder's original was a #4 pop / #1 R&B hit universally credited to him.) A page that fails this is not a factual error but it IS a publishing error — flag it high and set confusionBarHolds=false.

5. *** NO LYRICS — ANY QUOTED LYRIC LINE IS A BLOCKER. *** Song titles are not copyrightable; lyrics are, and this is the site's core legal position. Scan every field: excerpt, trail, bios, context, misattribution, pull quote. Quoted human SPEECH ("Reznor said the song wasn't his any more") and belief statements are fine. A hook fragment, a chorus line, or a paraphrased lyric is NOT. Set noLyrics.

6. THE LISTEN LINK (if the page has one): does it point at the ORIGINAL recording, or at a later RE-RECORDING? An artist's own official channel very often hosts a re-recording under the original title — legitimate uploader, legitimate ℗ line, wrong record by decades. Check the uploader, the ℗ line, and the running time against the MusicBrainz recording for the original. A re-recording presented as the original is a blocker. Set listenLinkIsOriginal to yes / no / no-link / unverifiable.

7. AUTHOR CARDS: the roles are a closed set. "original" = who recorded it first. "cover" = the act mistaken for the originator. "writer" = THE SONGWRITER and nobody else. A producer, session player, label boss or intermediate cover act carded as "writer" is a defect (medium) — flag it, and say where that figure should live instead (context or misattribution). A card whose own bio says the person is not the writer is self-contradicting: flag it high.

8. DATES: every year, label and name must agree across the answer, the record block, docMeta, the trail, misattribution, context and the JSON-LD. AND: no interval ("seventeen years later", "a decade before") may be stated unless BOTH endpoints are dates the page's own sources support. A computed interval built on an unverified date is a high. Check the arithmetic of every interval you find.

9. sameAs: must be STABLE identifiers (musicbrainz.org / wikidata.org / secondhandsongs.com), and must resolve to the RIGHT entity — the original recording or work, not the famous cover's recording. A sameAs pointing at the cover is a high.

10. CONTRACT: canonical, og:url and the JSON-LD @ids all derive from ${ORIGIN}/who-recorded/${p.slug}/ — WITH the trailing slash. A missing trailing slash is a real defect (it makes every canonical point at a 301). Also check the MusicRecording JSON-LD: byArtist must be the ORIGINAL artist, datePublished the original year, and recordingOf.composer a clean PERSON NAME — not a note with parentheticals.

For every problem return an issue {severity, location (section + approx line), claim, sourceLink, problem, fix}.
severity: blocker (an earlier recording exists / a lyric is quoted / the stated first recorder is wrong), high (link does not support its claim / confusion bar fails / listen link is a re-recording / unverified computed interval / sameAs points at the cover), medium (mis-anchored-but-true / wrong author role / over-specific date), minor (cosmetic / structured-data nit).
verdict FAIL if any blocker or high, else PASS. Set page to "${p.slug}/index.html".`

const skepticPrompt = (slug, issue) => `You are a SKEPTIC re-checking one audit finding on the quotle.info song page ${BASE}/${slug}/index.html. Default to standsUp=false unless you can INDEPENDENTLY confirm the problem is real. An auditor looking for problems will manufacture some; your job is to throw those out.

CLAIMED PROBLEM [${issue.severity}] at ${issue.location}: ${issue.problem}
The claim in question: ${issue.claim}
The source link: ${issue.sourceLink}

Independently verify: WebFetch the source link, Read the page and the record at ${RECORDS}/${slug}.json, and search for yourself where the claim is about an earlier recording. Be especially hard on "an earlier recording exists" findings — confirm the earlier version is a RECORDING of the SAME song (not a different song with a similar title, and not a live performance or a publication date), and that a source actually says so. Return slug exactly "${slug}", location exactly "${issue.location}" (echo them verbatim so this verdict can be paired with the issue it judges), finding (what you found), standsUp (true ONLY if the problem is genuinely real and worth fixing), reasoning.`

phase('Audit')
if (!pages.length) { log('no pages passed — nothing to audit'); return { pageAudits: [] } }
log(`auditing ${pages.length} song page(s) under ${BASE}`)

const pageAudits = await parallel(pages.map((p) => () =>
  agent(auditPrompt(p), { label: `audit:${p.slug.slice(0, 22)}`, phase: 'Audit', schema: AUDIT_SCHEMA, effort: 'high' })
    .then(async (a) => {
      if (!a) return null
      // Skeptic re-check every high/blocker; drop the ones a skeptic refutes. Same discipline as
      // the quote audit — an adversarial pass told to find problems WILL find some that aren't real.
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
// Surface the three central claims separately from the PASS/FAIL count: a page can pass the link
// checks and still be publishing the wrong first recorder, which is the only failure that matters.
const badFirst = pageAudits.filter((a) => a.firstRecordingHolds === false).map((a) => a.page)
const badBar = pageAudits.filter((a) => a.confusionBarHolds === false).map((a) => a.page)
const lyrics = pageAudits.filter((a) => a.noLyrics === false).map((a) => a.page)
const badListen = pageAudits.filter((a) => a.listenLinkIsOriginal === 'no').map((a) => a.page)
log(`Audited ${pageAudits.length}/${pages.length}: ${pass} PASS, ${pageAudits.length - pass} FAIL`)
if (badFirst.length) log(`!! FIRST-RECORDING CLAIM FAILS on: ${badFirst.join(', ')}`)
if (badBar.length) log(`!! CONFUSION BAR FAILS on: ${badBar.join(', ')}`)
if (lyrics.length) log(`!! LYRICS DETECTED on: ${lyrics.join(', ')}`)
if (badListen.length) log(`!! LISTEN LINK IS A RE-RECORDING on: ${badListen.join(', ')}`)

return { pageAudits, badFirstRecording: badFirst, confusionBarFails: badBar, lyricsFound: lyrics, listenIsReRecording: badListen }
