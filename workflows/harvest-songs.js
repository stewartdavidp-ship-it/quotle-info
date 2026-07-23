export const meta = {
  name: 'harvest-songs',
  description: 'Sweep for NEW song-misattribution candidates — a cover mistaken for the ORIGINAL recording — one Opus agent per vein (blues, soul, country, reggae, sync, standards). Returns candidates[] for tools/songs.js sync.',
  phases: [{ title: 'Harvest', detail: 'one agent per vein → Wikipedia-verified candidates' }],
}

// ---------- input contract ----------
// args is optional: { veins:["blues","soul",...], perVein:12, exclude:["already-built-slug", ...] }
// Omit it entirely to sweep all six veins. `exclude` should carry the slugs already built or queued
// so agents do not spend their budget re-finding them — pass it from:
//   node -e "const q=require('./data/song-queue.json');const fs=require('fs');console.log(JSON.stringify([...new Set([...q.songs.map(s=>s.songSlug),...fs.readdirSync('data/songs').map(f=>f.replace(/\.json$/,''))])]))"
const _cfg = typeof args === 'string' ? JSON.parse(args) : (args || {})
const PER_VEIN = _cfg.perVein || 12
const EXCLUDE = Array.isArray(_cfg.exclude) ? _cfg.exclude : []

// The six veins, as run on 2026-07-22. Each is a distinct SEARCH STRATEGY, not just a genre label —
// that is why they are separate agents: an agent sweeping "blues covers" looks in different places
// than one sweeping "film syncs", and running them together produces the union of neither.
const VEINS = {
  blues: {
    label: 'Blues originals → British-invasion covers',
    brief: 'Led Zeppelin, Rolling Stones, Cream, The Animals, The Yardbirds, Fleetwood Mac, Them, Aerosmith etc. against Willie Dixon, Muddy Waters, Howlin\' Wolf, Memphis Minnie, Robert Johnson, Big Joe Williams, Sonny Boy Williamson II, Jake Holmes. Several have documented credit disputes and lawsuits, which is squarely the site\'s thesis. BEWARE: this vein produces the most false positives — a Stones or Cream blues cover is usually famous AS a cover, and the bluesman is usually well credited. Only the ones where the public genuinely believes the rock act originated it survive.',
  },
  soul: {
    label: 'Soul & Motown originals → later pop covers',
    brief: 'Motown, Stax, Atlantic, Philadelphia International and Chess-era soul originals later covered by pop or rock acts now assumed to have originated them. Includes same-label re-cuts (a producer giving a song to a second act months later), which are a legitimate "who recorded it first" question even though no outside act "took" anything.',
  },
  country: {
    label: 'Country & folk originals → pop/rock covers',
    brief: 'Country, bluegrass, traditional folk and singer-songwriter originals later covered by pop or rock acts. Watch the direction of travel: a pop original later made famous by a country act belongs to a different vein, not this one.',
  },
  reggae: {
    label: 'Reggae, ska and rocksteady originals → pop covers',
    brief: 'Studio One, Treasure Isle, Trojan, Beverley\'s and Island-era Jamaican originals later covered by pop, rock or new-wave acts. ALSO the reverse-direction trap: songs the public takes for reggae originals that were first recorded elsewhere. Jamaican discographies are prone to disputed and undocumented dates — DROP where the year is not confirmable rather than guessing.',
  },
  sync: {
    label: 'Film/TV/advert-sync covers a generation meets first',
    brief: 'The Mad World pattern: a cover placed in a film, TV series, trailer or advert becomes the version a whole cohort encounters first, and they assume it is the original. The sync must be what DROVE the misattribution — a cover that was already a straight chart hit does not qualify for this vein.',
  },
  standards: {
    label: 'Standards, jazz and foreign-language originals',
    brief: 'The Torn pattern: a non-English original, a demo, or a stage/standards recording predating the famous version. Includes French, Italian, German, Spanish, Japanese, Portuguese and Zulu originals later given English lyrics and turned into an Anglo hit. NOTE for standards: the first RECORDING is often not the first performance, and often not the famous one — say precisely what your source says.',
  },
}
const selected = (Array.isArray(_cfg.veins) && _cfg.veins.length ? _cfg.veins : Object.keys(VEINS)).filter((v) => VEINS[v])

// Matches the candidate shape tools/songs.js `sync` accepts. Kept deliberately SMALL — this is a
// lead, not a page. The expensive research happens later in generate-songs.js, and only for the
// candidates a human actually selected.
const CANDIDATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['songSlug', 'title', 'creditedTo', 'originalArtist', 'originalYear', 'writer', 'coverArtist', 'coverYear', 'confusion', 'whyNotable', 'sources'],
        properties: {
          songSlug: { type: 'string' }, title: { type: 'string' },
          creditedTo: { type: 'string' }, originalArtist: { type: 'string' },
          originalYear: { type: 'string' }, originalLabel: { type: 'string' },
          writer: { type: 'string' }, coverArtist: { type: 'string' }, coverYear: { type: 'string' },
          confusion: { type: 'string', enum: ['high', 'medium'] },
          whyNotable: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    dropped: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'why'], properties: { title: { type: 'string' }, why: { type: 'string' } } } },
    contested: { type: 'array', items: { type: 'string' } },
  },
}

const harvestPrompt = (key) => `You are harvesting candidates for quotle.info's song-misattribution vertical (/who-recorded/).

VEIN: **${VEINS[key].label}**
${VEINS[key].brief}

## THE LOCKED SCOPE — do not widen it
A song a LATER act COVERED, where that covering act is mistaken for the ORIGINAL RECORDING artist.
 • creditedTo    = the cover act the public wrongly thinks originated it.
 • originalArtist = who RECORDED IT FIRST.
 • The SONGWRITER is context, NOT the axis. "The performer didn't write it" is NOT a candidate — performers routinely don't write. The claim must be about who RECORDED it first.
 • **NO LYRICS EVER.** The unit is the TITLE. Never quote or paraphrase a lyric line, anywhere, for any reason.

## THE CONFUSION BAR — most candidates should die here
Only harvest where there is genuine, documentable public belief that the cover act originated it. If the honest answer is "everyone knows it's a cover", DROP it.
PRECEDENT: "Higher Ground" (RHCP ← Stevie Wonder) was dropped because Wonder's original was a #4 pop / #1 R&B hit universally credited to him, and the RHCP version is famously known AS a cover. Do not resurface it.
Rate each candidate confusion: high or medium. **DO NOT RETURN ANYTHING YOU WOULD RATE LOW** — the schema will not accept it and the queue rejects it. Target roughly ${PER_VEIN}, but a vein that honestly yields 5 solid candidates should return 5. A padded list is worse than a short one.

## RESEARCH DISCIPLINE — read this twice
 • **NEVER COMPUTE an interval** ("three years before X") from a date you have not verified. If you state a gap, BOTH dates must come from a source you actually fetched, and must agree with every other date in the same candidate.
 • **A research/encyclopedia HEADLINE OR SECTION HEADING IS NOT A PERIOD FACT.** Do not present a Wikipedia section label or a database summary as a contemporary source.
 • **Do not claim "the first recording" unless your source says so.** Several of these have an earlier obscure version than the one usually called the original — that is often the MOST interesting finding, but only if sourced. Put those in "contested".
 • **THE CANDIDATE MUST AGREE WITH ITSELF.** Re-read each before returning: every year, label and name consistent.
 • Verify against Wikipedia at minimum — actually FETCH the page, do not work from memory. SecondHandSongs blocks the fetcher; if it blocks you, say so rather than citing it unread.
 • **Never invent a fact, year, label or URL. DROP any candidate whose original recorder or year you cannot confirm.**

## ALREADY IN THE CORPUS — do NOT return any of these
${EXCLUDE.length ? EXCLUDE.join(' · ') : '(none passed — dedup happens at sync, but avoid obvious classics)'}

## RETURN
"candidates": the keepers. songSlug is kebab-case of the title and must not collide with the exclusion list above. originalYear and coverYear are strings.
"dropped": every candidate you rejected, with why — especially anything that failed the confusion bar. This list is as valuable as the keepers; it is the evidence the bar was applied, and it stops the next harvest re-proposing the same song.
"contested": any candidate where the "original" is contested, or where you found an EARLIER recording than the usual answer. Those make the best pages this site produces.`

// ---------- run: one agent per vein ----------
phase('Harvest')
log(`sweeping ${selected.length} vein(s): ${selected.join(', ')} · target ~${PER_VEIN} each · ${EXCLUDE.length} slugs excluded`)

const results = await pipeline(
  selected,
  (v) => agent(harvestPrompt(v), { label: `vein:${v}`, phase: 'Harvest', schema: CANDIDATE_SCHEMA })
    .then((r) => (r ? { vein: v, ...r } : null)),
)

// Dedup ACROSS veins — the same song legitimately surfaces in two lanes (a soul original covered by
// a British blues band is both). First vein to claim a slug keeps it.
const seen = new Set(EXCLUDE)
const candidates = []
const dropped = []
const contested = []
for (const r of results.filter(Boolean)) {
  for (const c of (r.candidates || [])) {
    if (seen.has(c.songSlug)) { dropped.push({ title: c.title, why: `duplicate — already found in another vein or already in the corpus (${r.vein})` }); continue }
    seen.add(c.songSlug)
    candidates.push({ ...c, vein: r.vein })
  }
  for (const d of (r.dropped || [])) dropped.push({ ...d, vein: r.vein })
  for (const x of (r.contested || [])) contested.push(`[${r.vein}] ${x}`)
}

const byVein = {}
for (const c of candidates) byVein[c.vein] = (byVein[c.vein] || 0) + 1
const byConfusion = {}
for (const c of candidates) byConfusion[c.confusion] = (byConfusion[c.confusion] || 0) + 1
log(`${candidates.length} candidates after cross-vein dedup — ${JSON.stringify(byVein)} · ${JSON.stringify(byConfusion)}`)
log(`${dropped.length} dropped · ${contested.length} contested originals`)

// Shape matches what `node tools/songs.js sync <file>` reads. Write this return to a file and sync it.
return { candidates, dropped, contested }
