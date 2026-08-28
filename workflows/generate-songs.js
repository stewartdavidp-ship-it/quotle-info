export const meta = {
  name: 'generate-song-records',
  description: 'Research each queued song-misattribution candidate into a verified recording-history dossier, on Opus, confirming who recorded it FIRST against fetched primary/reference sources. Returns records[] for ingest into data/songs/.',
  phases: [{ title: 'Research', detail: 'one recording-history agent per song → schema-validated dossier' }],
}

// ---------- input contract ----------
// args is EITHER a bare array of batch items, OR { items:[...], verifiedDate:"22 Jul 2026",
// dateModified:"2026-07-22" }. Items come from `node tools/songs.js batch --wave sN`, and each
// carries the WHOLE harvested lead (title, creditedTo, originalArtist, originalYear, writer,
// coverArtist, coverYear, sources) — not a bare title. The harvest already established the answer
// and a human reviewed the queue on it; re-deriving it per agent invites a DIFFERENT answer than the
// one that was approved. The agent's job is to CONFIRM and deepen it, or to report a contradiction.
const _cfg = typeof args === 'string' ? JSON.parse(args) : (args || [])
const items = Array.isArray(_cfg) ? _cfg : (_cfg.items || [])
const VERIFIED_DATE = (!Array.isArray(_cfg) && _cfg.verifiedDate) || '22 Jul 2026'
const DATE_MODIFIED = (!Array.isArray(_cfg) && _cfg.dateModified) || '2026-07-22'

// ---------- deterministic helpers (plain JS, no fs) ----------
// slugify is DUPLICATED VERBATIM from tools/slugify.js — workflow scripts run in a sandbox with no
// require(). Change one, change the other. (workflows/prep-songs.js requires the real one; this copy
// exists only so the workflow's own return value is usable without a prep pass.)
const ACCENT_ENTITIES = Object.assign(Object.create(null), {
  agrave: 'a', aacute: 'a', acirc: 'a', atilde: 'a', auml: 'a', aring: 'a', aelig: 'ae',
  ccedil: 'c', egrave: 'e', eacute: 'e', ecirc: 'e', euml: 'e',
  igrave: 'i', iacute: 'i', icirc: 'i', iuml: 'i', ntilde: 'n',
  ograve: 'o', oacute: 'o', ocirc: 'o', otilde: 'o', ouml: 'o', oslash: 'o', oelig: 'oe',
  ugrave: 'u', uacute: 'u', ucirc: 'u', uuml: 'u', yacute: 'y', yuml: 'y',
  szlig: 'ss', eth: 'd', thorn: 'th',
})
const RAW_LETTERS = Object.assign(Object.create(null), {
  ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', þ: 'th', ł: 'l', ħ: 'h', ı: 'i',
})
function slugify(text) {
  let s = String(text).toLowerCase()
    .replace(/[’'‘`]/g, '')
    .replace(/&([a-z]+);/g, (m, name) => ACCENT_ENTITIES[name] || m)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[ßæœøđðþłħı]/g, (ch) => RAW_LETTERS[ch] || ch)
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > 60) { s = s.slice(0, 60).replace(/-[^-]*$/, ''); }
  return s;
}
const initialsOf = (name) => String(name).replace(/&[a-z]+;/g, '').split(/\s+/)
  .filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

// ---------- toRecord — dossier + batch item → the data/songs/{slug}.json shape ----------
// DUPLICATED in workflows/prep-songs.js (sandbox, no require) — keep the two in sync. The same
// duplication exists between generate.js and prep-wave.js for quotes, for the same reason.
//
// Everything FIXED or DERIVABLE is applied here rather than asked of the agent: kickers, headings,
// slugs, initials, the stamped dates, and the four fields the batch already carries (artist, year,
// label, writer). That is not tidiness — the dossier schema has a hard size ceiling (see
// SONG_DOSSIER_SCHEMA), and every field moved out of it buys room for one that genuinely needs a
// researcher.
function toRecord(d, item) {
  const oSlug = slugify(item.originalArtist);
  const cSlug = slugify(item.creditedTo);
  const rec = {
    songSlug: item.songSlug,
    title: item.title,
    confidence: d.confidence,
    creditedTo: item.creditedTo,
    lastVerified: VERIFIED_DATE,
    dateModified: DATE_MODIFIED,
    meta: { title: d.meta.title, description: d.meta.description, ogTitle: d.meta.ogTitle, ogDescription: d.meta.ogDescription },
    answer: {
      kicker: 'Who recorded it first',
      label: d.answer.label,
      originalArtist: item.originalArtist,
      originalArtistSlug: oSlug,
      originalArtistDates: d.answer.artistDates,
      sourceLine: d.answer.sourceLine,
      lastVerified: VERIFIED_DATE,
    },
    original: {
      kicker: 'The record',
      heading: 'Who recorded it first',
      artist: item.originalArtist,
      year: String(item.originalYear),
      label: item.originalLabel || d.original.label || '',
      released: d.original.released,
      charted: d.original.charted,
      writer: item.writer,
      cover: d.original.cover,
      docMeta: d.original.docMeta,
      trailTitle: d.original.trailTitle || 'How we traced it',
      trail: d.original.trail,
    },
    externalLinks: d.externalLinks,
    authors: (d.authors || []).map((a) => ({
      name: a.name, slug: slugify(a.name), initials: a.initials || initialsOf(a.name),
      kicker: a.kicker, heading: a.heading || ('About ' + a.name),
      metaLine: a.metaLine, role: a.role, bio: a.bio,
    })),
    misattribution: {
      kicker: 'Fact-check',
      heading: d.misattribution.heading || 'The attribution problem',
      intro: d.misattribution.intro,
      items: d.misattribution.items,
      truthLine: d.misattribution.truthLine,
    },
    context: {
      kicker: 'Context',
      heading: d.context.heading || 'Why the cover ate the original',
      lead: d.context.lead,
      detailsSummary: d.context.detailsSummary || 'The creators, in order',
      detailsBody: d.context.detailsBody || [],
    },
    // The rights note is boilerplate-shaped but NOT boilerplate: it names the composition's rights
    // holder, which differs per song. The agent supplies the first clause; the standing disclaimer
    // is appended here so no agent can weaken or forget it. NO-LYRICS is the load-bearing claim on
    // this site and it is not left to a prompt.
    rights: {
      note: (d.rightsNote ? d.rightsNote + ' ' : '') +
        'This page states authorship and recording history &mdash; who wrote the song and who recorded it first &mdash; and does not reproduce any lyrics. Song titles are not copyrightable; the composition and the recordings are, and remain the rights of their owners. Nothing here is a grant of reuse rights, and this is not legal advice.',
    },
    themes: d.themes || [],
    schema: {
      recordingName: item.title,
      byArtist: { name: item.originalArtist },
      datePublished: String(item.originalYear),
      composer: { name: item.writer },
      coverArtist: item.coverArtist,
      coverYear: String(item.coverYear),
      webPageName: d.meta.ogTitle,
    },
  };
  if (d.context.pull) rec.context.pull = d.context.pull;
  if (d.original.sourceLink) rec.original.sourceLink = d.original.sourceLink;
  // listen — OPTIONAL, and deliberately hard to earn. validate-songs.js rejects an embed URL and
  // warns on a missing `source`, because the whole point is a link to the ORIGINAL recording from a
  // channel someone can justify (artist/label/service), not the first YouTube result.
  if (d.listen && d.listen.url) rec.listen = d.listen;
  // listenCover — the famous version, for A/B comparison. Only meaningful alongside the original:
  // build-songs.js renders it ONLY when rec.listen exists, so a cover without an original is dropped
  // rather than left as the page's single audio link, which would point at the record the page is
  // arguing against.
  if (d.listenCover && d.listenCover.url && rec.listen) rec.listenCover = d.listenCover;
  // sameAs — STABLE identifiers only (musicbrainz / wikidata / secondhandsongs). validate-songs.js
  // enforces the host list; a streaming URL here would rot inside structured data.
  if (Array.isArray(d.sameAs) && d.sameAs.length) rec.sameAs = d.sameAs;
  return rec;
}

// ---------- dossier schema (StructuredOutput-enforced) ----------
// !! SIZE CEILING. The platform rejects an oversized output schema BEFORE any agent runs — 0 tokens,
// no content error, the whole wave dead (quotes wave r24: 20/20 agents rejected in 19ms). Measured
// ceiling for generate.js sat in (4072, 4159]. tools/verify-corpus.js asserts THIS schema against
// the same budget, so a well-meant new field fails the build instead of a wave.
//
// Consequences visible below, all deliberate:
//  • `themes` is a plain string array with NO enum. The 28-slug enum is exactly what blew the quote
//    schema. The vocabulary goes in the PROMPT (free) and validate-songs.js rejects a bad slug at
//    the gate (mechanical). Belt and braces without paying for the enum twice.
//  • artist / year / label / writer / coverArtist / coverYear are NOT here — they come from the
//    batch item, which the harvest already verified and a human reviewed.
//  • kickers, headings, slugs and initials are NOT here — toRecord applies them.
const SONG_DOSSIER_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['confidence', 'meta', 'answer', 'original', 'externalLinks', 'authors', 'misattribution', 'context', 'themes', 'sourcesVerified'],
  properties: {
    confidence: { type: 'string', enum: ['verified', 'attributed', 'disputed'] },
    meta: {
      type: 'object', additionalProperties: false, required: ['title', 'description', 'ogTitle', 'ogDescription'],
      properties: { title: { type: 'string' }, description: { type: 'string' }, ogTitle: { type: 'string' }, ogDescription: { type: 'string' } },
    },
    answer: {
      type: 'object', additionalProperties: false, required: ['label', 'artistDates', 'sourceLine'],
      properties: { label: { type: 'string' }, artistDates: { type: 'string' }, sourceLine: { type: 'string' } },
    },
    original: {
      type: 'object', additionalProperties: false, required: ['released', 'charted', 'cover', 'docMeta', 'trail'],
      properties: {
        label: { type: 'string' }, released: { type: 'string' }, charted: { type: 'string' }, cover: { type: 'string' },
        docMeta: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['dt', 'dd'], properties: { dt: { type: 'string' }, dd: { type: 'string' }, ddClass: { type: 'string' } } } },
        trail: { type: 'array', items: { type: 'string' } },
        trailTitle: { type: 'string' },
        sourceLink: { type: 'object', additionalProperties: false, required: ['text', 'url'], properties: { text: { type: 'string' }, url: { type: 'string' } } },
      },
    },
    externalLinks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'host', 'url', 'what'], properties: { label: { type: 'string' }, host: { type: 'string' }, url: { type: 'string' }, what: { type: 'string' } } } },
    listen: { type: 'object', additionalProperties: false, required: ['url', 'host', 'what', 'source'], properties: { url: { type: 'string' }, host: { type: 'string' }, what: { type: 'string' }, source: { type: 'string' } } },
    listenCover: { type: 'object', additionalProperties: false, required: ['url', 'host', 'what', 'source'], properties: { url: { type: 'string' }, host: { type: 'string' }, what: { type: 'string' }, source: { type: 'string' } } },
    sameAs: { type: 'array', items: { type: 'string' } },
    authors: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'metaLine', 'role', 'bio', 'kicker'], properties: { name: { type: 'string' }, initials: { type: 'string' }, kicker: { type: 'string' }, heading: { type: 'string' }, metaLine: { type: 'string' }, role: { type: 'string', enum: ['original', 'cover', 'writer'] }, bio: { type: 'string' } } } },
    misattribution: {
      type: 'object', additionalProperties: false, required: ['intro', 'items', 'truthLine'],
      properties: {
        heading: { type: 'string' }, intro: { type: 'string' },
        items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['who', 'why'], properties: { scope: { type: 'string' }, who: { type: 'string' }, tag: { type: 'string' }, why: { type: 'string' } } } },
        truthLine: { type: 'string' },
      },
    },
    context: {
      type: 'object', additionalProperties: false, required: ['lead'],
      properties: { heading: { type: 'string' }, lead: { type: 'array', items: { type: 'string' } }, pull: { type: 'string' }, detailsSummary: { type: 'string' }, detailsBody: { type: 'array', items: { type: 'string' } } },
    },
    rightsNote: { type: 'string' },
    themes: { type: 'array', items: { type: 'string' } },
    sourcesVerified: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['claim', 'url', 'containsClaim'], properties: { claim: { type: 'string' }, url: { type: 'string' }, containsClaim: { type: 'boolean' } } } },
  },
}

const THEME_VOCAB = 'resilience, courage, leadership, change, growth, failure, success, creativity, wisdom, knowledge, truth, justice, freedom, love, friendship, kindness, gratitude, happiness, purpose, time, mortality, hope, work, simplicity, doubt, power, character, humility'

const researchPrompt = (it) => `You are a rigorous RECORDING-HISTORY researcher for quotle.info. Your output IS the data for a published page, so every claim must be checkable. Be skeptical; default to honest uncertainty over false precision.

THE SONG: "${it.title}"
THE POPULAR BELIEF: that it originated with ${it.creditedTo}.
WHAT THE HARVEST FOUND: first recorded by ${it.originalArtist} in ${it.originalYear}${it.originalLabel ? ` on ${it.originalLabel}` : ''}; written by ${it.writer}; the version people know is ${it.coverArtist}, ${it.coverYear}.
ALREADY-VERIFIED SOURCE(S): ${it.sources.join(' · ')}
WHY IT WAS QUEUED: ${it.whyNotable}
${it.caveats && it.caveats.length ? `
>> THE HARVEST COULD NOT SETTLE THESE, AND THEY ARE THE POINT OF THIS RECORD:
${it.caveats.map((c) => `   · ${c}`).join('\n')}
   These are unresolved questions, not established facts — an earlier agent fetched sources and
   could not reconcile them. Resolve each one if a source you fetch settles it. If you cannot,
   SAY SO ON THE PAGE and set confidence "disputed"; do not quietly assert the clean version.
   A caveat that vanishes silently is how a page ends up stating a date its own sources contradict.
` : ''}
YOUR JOB is to CONFIRM and DEEPEN that finding, not to re-derive it from scratch. A human reviewed and approved this lead; the harvest is your starting point. Fetch the source(s) above plus whatever else you need.

>> DO NOT ASSUME THE LEAD IS RIGHT. It came from a cheap harvest pass, and it has been wrong: a
   queued candidate named the wrong original artist entirely (the harvest said Pablo Beltran Ruiz's
   orchestra recorded "Sway" first; the original is La Sonora Matancera with Nelson Pinedo, Seeco,
   October 1953 — the Beltran Ruiz performance is 1959). The generate agent accepted it and the AUDIT
   caught it, which is the expensive place to catch it. Actively look for a recording EARLIER than
   the one you were handed before you accept it.

>> IF YOU CANNOT CONFIRM IT, SAY SO AND STOP. If your research CONTRADICTS the lead — a different first recorder, a different year, or an EARLIER recording than the one named — do NOT quietly publish your own answer. Set confidence "disputed" and make the contradiction the subject of answer.sourceLine and the misattribution section. A wrong page is far worse than a late one.

*** THE ABSOLUTE RULE: NO LYRICS. EVER. ***
The unit of this page is the TITLE. Never quote, excerpt, or paraphrase a line of lyric — not in the excerpt, not in context, not in a bio, not to illustrate a point, not even a two-word hook. This is the site's core legal position and it is not negotiable. Song titles are not copyrightable; lyrics are. A page that quotes a hook fragment is a defect and gets rewritten. (A real wave shipped the spelled-out chorus of one song and a hook phrase of another before this rule was mechanised — tools/validate-songs.js now flags quoted runs for human review.)

THE AXIS — read this twice. The claim is about who RECORDED IT FIRST.
 • "The performer didn't write it" is NOT the story. Performers routinely don't write. The songwriter is CONTEXT.
 • The story is that ${it.creditedTo} is widely taken to have ORIGINATED the recording, and did not.
 • If the honest finding is "everyone knows this is a cover", say so in confidence/sourceLine rather than manufacturing a confusion that isn't there.

ASSIGN confidence:
 • "verified"   — you confirmed the first recording (artist, year, release) against sources you fetched, and they agree.
 • "attributed" — the first recording is credibly and consistently reported, but you could not pin a release date/label to a primary or reference source.
 • "disputed"   — sources conflict on who recorded it first, OR you found an earlier recording than the usual answer, OR the harvest's lead did not survive checking.

RESEARCH DISCIPLINE (each of these was a real defect on a previous song or quote wave):
 • NEVER COMPUTE an interval — "seventeen years later", "a decade before", "three years after". If BOTH dates are not confirmed in sources you fetched, do not write the derived figure at all. One wave shipped a computed gap that contradicted three other dates on the same page.
 • A research/encyclopedia HEADLINE OR SECTION HEADING IS NOT A PERIOD FACT. Do not present a Wikipedia section label or a database summary as a contemporary source.
 • DO NOT claim "the first recording" unless your source says so. Many of these have an earlier, obscure version ahead of the one usually called the original — that is often the most interesting thing on the page, but only if you can source it.
 • THE RECORD MUST AGREE WITH ITSELF. Re-read before returning: every year, name and label consistent across meta, answer, original, docMeta, trail, misattribution, context and schema.
 • SecondHandSongs blocks automated fetching. If it blocks you, do not cite it as though you read it.
 • Populate sourcesVerified with {claim, url, containsClaim} for EVERY source you cite. Do not attach a link unless a fetch confirmed it supports that specific claim. This is the site's #1 discipline.

FILL THE DOSSIER. All prose uses HTML entities (&ldquo; &rdquo; &lsquo; &rsquo; &mdash; &amp;) and inline links as <a href="URL" target="_blank" rel="noopener">text ↗</a>. Provide INNER HTML only — NEVER wrap a value in <li>, <p> or <div>; the renderer adds those. Write &mdash; once, not &amp;mdash;.

meta.title = Who originally recorded "${it.title}"? | Quotle.info
meta.ogTitle = Who originally recorded '${it.title}'?
meta.description / ogDescription ≤ 160 chars, specific and honest; lead with the correction.

answer.label = a short verdict, e.g. "Not a ${it.creditedTo} original &mdash; a ${it.originalYear} ${it.originalArtist} single".
answer.artistDates = PLAIN TEXT life/era line for ${it.originalArtist}, e.g. "b. 1944 &middot; American soul singer".
answer.sourceLine = 2-4 sentences: the belief, the correction, who wrote it, what happened to the original.

original.released (how/when the original was issued — single? B-side? album track?), .charted (honestly: "Did not chart" is a strong fact here), .cover (what the famous version did — label, year, chart peak), .docMeta (3-4 {dt,dd}; ddClass:"title" on the record title row), .trail (2-4 HTML strings, each with an inline confirmed <a>), .sourceLink ({text,url} — the best single "originals & covers" page; text must NOT end with an arrow, the renderer adds it).

authors[] = 2-3 cards. The roles are a CLOSED SET and each means one specific person:
 • "original" — who RECORDED IT FIRST (${it.originalArtist}). Required.
 • "cover" — the act mistaken for the originator (${it.creditedTo}). Required.
 • "writer" — THE SONGWRITER, and nobody else. Here that is: ${it.writer}. Include this card only when the songwriter is neither of the two above.
 >> DO NOT use "writer" as a slot for a third interesting person. A producer, a session player, a label boss, an intermediate cover act, or the artist who had the hit in between are NOT the writer. They are often the best detail on the page — put them in context.lead, context.detailsBody or a misattribution item, where they can be described accurately. A card whose bio has to say "he is not the song's writer" is a card in the wrong slot. Two cards is a perfectly good page.
 kicker is a short label ("The original recording artist" / "Popularly credited as the original" / "The songwriter"). metaLine is PLAIN TEXT. bio is 2-4 sentences. Be generous to the cover act — their record is usually genuinely great and the only error is chronological.

misattribution.intro / items[{scope, who, tag, why}] / truthLine — the fact-check block. Typical items: "The belief", "The original", "The writer".

context.lead[] (1-2 paragraphs on WHY the cover eclipsed the original — the interesting question), .pull (one short line), .detailsBody[] (a plain chronology, one step per string).

rightsNote: ONE sentence naming who holds the composition rights (e.g. "The composition is the rights of X's estate and publisher."). A standard no-lyrics disclaimer is appended automatically — do not restate it.

themes: exactly 2, from this fixed vocabulary and nothing else: ${THEME_VOCAB}.

externalLinks: 3-5 {label, host, url, what} — Wikipedia, a cover database, artist pages. Each confirmed relevant.

listen: OPTIONAL — a link to HEAR THE ORIGINAL. This is the most persuasive artifact on the page: reading that a ${it.originalYear} ${it.originalArtist} recording exists is weak, hearing it is proof. It is also the easiest thing on the page to get WRONG, so it has a fixed procedure. Follow all four steps or omit the block.
 1. This block is the ORIGINAL only — NEVER the famous ${it.coverArtist} version. The cover has its own field (listenCover, below); putting it here would give the record the page is arguing AGAINST the primary slot.
 2. FETCH THE WATCH PAGE and read the uploader and the &#8471; line. Do not trust a search result, a title, or a thumbnail. Accept ONLY: an official artist/label channel, a VEVO channel, or an auto-generated "Provided to YouTube by <distributor>" upload. A fan upload, a rip, or a compilation channel is NOT acceptable however good the audio is.
 3. *** CHECK THE DURATION AGAINST THE MUSICBRAINZ RECORDING. *** An artist's own channel very often hosts a LATER RE-RECORDING under the original title, and it will pass every check in step 2 while being the wrong record by decades. This single check caught three of them on the last pass: a 2003 re-cut, a set of 1995/2009/2022 re-recordings, and a 2002 re-do — all on legitimate official channels, all wearing the original's name. If the duration does not match, or you cannot establish the original's duration, OMIT.
 4. Never an embed URL (no /embed/, no player., no autoplay=) — the page renders a LINK, not a player. The "source" field must state WHY that copy is legitimate (which channel, and what you confirmed).
 AN ABSENT LINK BEATS A DUBIOUS ONE. On the last pass 4 of 27 songs correctly got no link because no legitimate copy of the original exists. Omitting is a valid, expected outcome — not a failure.

listenCover: OPTIONAL — a link to hear ${it.coverArtist}'s famous version, so a reader who has just discovered the original can play the one they know and hear the difference. That comparison is the payoff of the whole page; making the reader go and find it themselves loses them at the moment the page has worked.
 SAME FOUR STEPS AS ABOVE, with two differences that matter:
 • Step 3 matters MORE here, not less. A famous artist re-cuts their own hit far more often than an obscure originator does — live versions, anniversary re-recordings, remasters retitled as the original. Check the duration against the MusicBrainz recording for ${it.coverArtist}'s ${it.coverYear || 'original'} release specifically, not against "a recording of this song".
 • Only supply this if you also supplied the listen block. The page drops a cover link that has no original beside it, so an unmatched one is wasted work.
 AN ABSENT LINK STILL BEATS A DUBIOUS ONE. The cover being easy to find is not a reason to lower the bar — a wrong link here is worse than none, because the reader will assume the comparison is fair and it will not be.

sameAs: OPTIONAL but preferred. *** CHECK THAT EACH IDENTIFIER RESOLVES TO THE ORIGINAL, NOT THE FAMOUS COVER. *** One wave shipped three that pointed at the cover's entity (UB40 rather than Lord Creator, Wilson Pickett rather than Sir Mack Rice, Sinatra rather than Claude Francois) — the exact conflation this page exists to undo, asserted in machine-readable form. Open each one and confirm whose recording it describes. STABLE identifiers ONLY — musicbrainz.org, wikidata.org, secondhandsongs.com. Never a streaming URL: those rot, and a dead identifier inside structured data is worse than none.
 • Prefer a MusicBrainz **recording** MBID for the ORIGINAL, confirmed against the release it first appeared on (the ${it.originalYear} ${it.originalLabel || 'original'} release) — not just any recording of the song.
 • Fall back to a **work** MBID only where no reliable recording entity exists.
 • Include the Wikidata QID as well wherever one exists.`

// ---------- run: one agent per song ----------
phase('Research')
if (!items.length) { log('no items passed — nothing to generate'); return { records: [] } }
log(`researching ${items.length} song${items.length === 1 ? '' : 's'} (one Opus agent each)`)

const records = await pipeline(
  items,
  (it) => agent(researchPrompt(it), { label: `song:${it.songSlug}`, phase: 'Research', schema: SONG_DOSSIER_SCHEMA })
    .then((d) => (d ? toRecord(d, it) : null)),
)

const good = records.filter(Boolean)
const conf = {}
for (const r of good) conf[r.confidence] = (conf[r.confidence] || 0) + 1
log(`built ${good.length}/${items.length} records — ${JSON.stringify(conf)}`)
if (good.length < items.length) log(`${items.length - good.length} agent(s) returned nothing — re-run those slugs`)

return { records: good }
