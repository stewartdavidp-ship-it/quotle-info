export const meta = {
  name: 'harvest-film-misquotes',
  description: 'HARVEST step, TRACK C (film): one Opus agent per movie/TV title sweeps Wikiquote + Quote Investigator for lines the public MISQUOTES (right source, wrong words — "Luke, I am your father") or misattributes (a screen line pinned on a historical figure). Emits the same candidate queue shape as track A so tools/harvest.js sync ingests it unchanged. Returns raw candidates[] grouped by title.',
  phases: [{ title: 'Harvest', detail: 'one misquote/misattribution sweep per film or TV title' }],
}

// ---------- candidate schema (StructuredOutput-enforced) ----------
// Field names match tools/harvest.js cmdSync EXACTLY — sync maps explicit fields and silently drops
// anything it does not know, so an invented field would vanish without an error. Anything extra we
// want to survive (the true wording, the writer, the studio) has to ride inside trueOrigin/whyNotable.
const CANDIDATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'wikiquoteUrl', 'candidates'],
  properties: {
    title: { type: 'string' },               // the film/TV title searched
    wikiquoteUrl: { type: 'string' },        // the Wikiquote page actually fetched ('' if none)
    notes: { type: 'string' },
    candidates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['quote', 'creditedTo', 'trueOrigin', 'category', 'whyNotable', 'likelyConfidence', 'rightsEra', 'documentedAt'],
        properties: {
          quote: { type: 'string' },          // the POPULAR wording — what people actually search
          creditedTo: { type: 'string' },     // see the creditedTo rules in the prompt — often ''
          trueOrigin: { type: 'string' },     // the ACTUAL line + who wrote it + the work
          category: { type: 'string', enum: ['misattributed', 'disputed', 'genuine-famous'] },
          whyNotable: { type: 'string' },
          likelyConfidence: { type: 'string', enum: ['verified', 'attributed', 'disputed'] },
          rightsEra: { type: 'string', enum: ['public-domain', 'in-copyright', 'uncertain'] },
          documentedAt: { type: 'string' },
        },
      },
    },
  },
}

const harvestPrompt = (title, cap) => `You are a quote-provenance scout for quotle.info, a verified-provenance / fact-check site. Your job is NOT to research from scratch — it is to HARVEST a candidate queue from the authorities we defer to: Wikiquote and Quote Investigator.

TITLE: ${title}

Screen quotes fail DIFFERENTLY from the rest of our corpus. Our existing 432 disputed pages are mostly wrong-PERSON errors. Film's signature error is wrong-WORDS from the right source. Both are in scope, and they are modelled differently — read this carefully, because getting it wrong makes the page assert something false.

THE TWO SHAPES:

(A) MISQUOTE — right source, wrong words. The public quotes a line that was never actually spoken in that form.
    Examples: "Luke, I am your father" (actual: "No, I am your father"); "Play it again, Sam" (never said);
    "Houston, we have a problem" (actual: "Houston, we've had a problem"); "Mirror, mirror on the wall"
    (actual: "Magic mirror on the wall"); "Life is like a box of chocolates" (actual: "Life WAS like a box of chocolates").
    -> quote = the POPULAR (wrong) wording, because that is what people search for.
    -> trueOrigin = the ACTUAL line in quotes, then the writer and the work. e.g. 'Actual line: "No, I am your father" — written by Leigh Brackett & Lawrence Kasdan, The Empire Strikes Back (1980)'.
    -> creditedTo = LEAVE EMPTY (''). This matters: nobody is being falsely credited — the source is right and only
       the wording drifted. creditedTo drives an author-page count that literally reads "N quotes wrongly credited to
       them", so putting a character or a film title there would publish a false claim, and would type a work or a
       fictional character as a Person in our machine-readable layer. Do not do it.
    -> category: 'disputed' (the line AS QUOTED is not what was said). likelyConfidence: 'disputed'.

(B) SCREEN LINE MISATTRIBUTED TO A REAL PERSON — a line written for the screen that the public pins on a historical
    figure, usually because it sounds ancient or authoritative.
    Example we already carry: "Fear is the true enemy, the only enemy" is pinned on Sun Tzu; it is a 1987 Star Trek: TNG
    line written by Herbert Wright.
    -> quote = the popular wording. creditedTo = the REAL PERSON it is falsely pinned on (e.g. "Sun Tzu").
    -> trueOrigin = the screenwriter + the work.
    -> category: 'misattributed'. likelyConfidence: 'disputed'.

(C) You may include 1-2 GENUINELY famous lines from ${title} that Wikiquote sources exactly, as anchors
    (category 'genuine-famous', likelyConfidence 'verified', creditedTo ''). Priority is (A) and (B).

AUTHORSHIP RULE (this is our house convention — a record already on the site models it):
The author of a screen line is the WRITER (screenwriter / teleplay), never the character and never the actor.
The character and actor are recorded separately as the speaker. Put the writer in trueOrigin. If the writing credit is
shared or disputed, say so rather than picking one.

THE ORIGINATION QUESTION (the expensive part — do not skip it):
Ask whether the line ORIGINATED in ${title} or was only USED in it. Many famous "movie quotes" come from the source
novel or play, and the film only sharpened or popularised them — "Frankly, my dear, I don't give a damn" is in
Margaret Mitchell's 1936 novel; "The first rule of Fight Club" is Palahniuk's. Others are older sayings the film
rewrote. If the line came from a source novel/play/earlier work, SAY SO explicitly in trueOrigin, naming that work and
its date. A film credited with a line it borrowed is exactly the error class this site exists to correct.

RIGHTS:
US copyright now covers essentially every quotable film — public domain reaches works published through 1930 only. So
rightsEra is 'in-copyright' for almost everything here; use 'public-domain' ONLY for a pre-1931 release and say why.
Screen writing is work-for-hire: the rights holder is the STUDIO, not the screenwriter. Note the studio in trueOrigin
where you know it.

DO THIS (use WebSearch + WebFetch):
1. Fetch the Wikiquote page for ${title}. Wikiquote transcribes lines exactly and often has a "Misattributed",
   "Misquoted" or "About" section. This is the primary check on WORDING — the whole point of a misquote page is that
   our wording claim is right, so it must come from a transcription, not from memory or a listicle.
2. Search Quote Investigator: site:quoteinvestigator.com "${title}" — QI investigates the famous ones and often traces
   the drift from actual line to popular misquote, with dates.
3. Useful corroboration: the AFI "100 Years...100 Movie Quotes" list, and Snopes for the heavily-debunked ones.
   IMDb "Quotes" pages are USER-SUBMITTED and frequently wrong — do not treat them as a source.

HARD RULES:
- Only include a candidate DOCUMENTED at Wikiquote or QI. Give the documentedAt URL for each. Invent nothing.
- The single highest-value thing you can return is a line where the popular wording DIFFERS from the transcript and you
  can cite both. Prefer those.
- If you cannot establish the ACTUAL wording from a transcription, drop the candidate. A misquote page whose "real"
  wording is itself unverified is worse than no page.
- SKIP song lyrics (high legal risk) even when a film made them famous.
- Prefer lines people actually search for. Skip obscure fragments.
- Cap at ${cap} candidates for this title.
- Do NOT dedup against our corpus — that is a deterministic downstream step.

Return via the structured schema. wikiquoteUrl = the page you fetched ('' if none).`

phase('Harvest')

const cfg = typeof args === 'string' ? JSON.parse(args) : (args || {})
const titles = cfg.titles || []
const cap = cfg.perTitle || 8

const results = (await parallel(titles.map((title) => () =>
  agent(harvestPrompt(title, cap), { label: `film:${title.slice(0, 22)}`, phase: 'Harvest', schema: CANDIDATE_SCHEMA, effort: 'high' })
    .then((r) => (r ? {
      title,
      wikiquoteUrl: r.wikiquoteUrl,
      notes: r.notes || '',
      // magnetAuthor is what sync groups on. For (B) it is the real person falsely credited. For (A)
      // there is NO magnet — leave it empty rather than inventing one out of the title.
      candidates: (r.candidates || []).map((c) => ({ ...c, magnetAuthor: c.creditedTo || '', sourceTitle: title })),
    } : null))
))).filter(Boolean)

const all = results.flatMap((r) => r.candidates)
const byCat = all.reduce((m, c) => { m[c.category] = (m[c.category] || 0) + 1; return m }, {})
const withTrueWording = all.filter((c) => /actual line/i.test(c.trueOrigin || '')).length
log(`Harvested ${all.length} across ${results.length} titles — ${JSON.stringify(byCat)}; ${withTrueWording} carry an explicit actual-line correction`)
results.forEach((r) => log(`  ${r.title}: ${r.candidates.length}${r.wikiquoteUrl ? '' : '  (no wikiquote page found)'}`))

return {
  byTitle: results.map((r) => ({ title: r.title, wikiquoteUrl: r.wikiquoteUrl, count: r.candidates.length, notes: r.notes })),
  candidates: all,
}
