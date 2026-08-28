export const meta = {
  name: 'backfill-song-covers',
  description: 'Find and verify a listenCover link (the famous cover recording) for songs that already have an original link',
  phases: [{ title: 'Research', detail: 'one agent per batch of songs → verified cover links' }],
}

// args: { songs: [{songSlug,title,originalArtist,originalYear,coverArtist,coverNote,originalListenUrl}], perAgent }
const cfg = typeof args === 'string' ? JSON.parse(args) : (args || {})
const songs = cfg.songs || []
const PER = cfg.perAgent || 6

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['songSlug', 'found'],
        properties: {
          songSlug: { type: 'string' },
          found: { type: 'boolean' },
          url: { type: 'string' },
          host: { type: 'string' },
          what: { type: 'string' },
          source: { type: 'string' },
          omitReason: { type: 'string' },
        },
      },
    },
  },
}

const prompt = (batch) => `You are finding ONE link per song: a legitimate copy of the FAMOUS COVER recording, so a reader who has just heard the obscure original can play the version they know and compare.

SONGS (${batch.length}):
${batch.map((s, i) => `${i + 1}. ${s.songSlug}
   title: "${s.title}"
   original: ${s.originalArtist} (${s.originalYear}) — already linked, do NOT re-find this
   COVER TO FIND: ${s.coverArtist}
   context: ${s.coverNote || '(none)'}`).join('\n')}

THE BAR. An absent link beats a dubious one. Omitting is a valid, expected outcome — a wrong link is worse than none here, because the reader will assume the comparison is fair and it will not be.

FOUR STEPS PER SONG. Do all four or set found:false.
 1. Find the COVER artist's own studio recording — the famous one. Not the original, not a live version, not a remaster retitled as the original, not a re-recording.
 2. VERIFY THE UPLOADER. Accept ONLY an official artist/label channel, a VEVO channel, or an auto-generated "Provided to YouTube by <distributor>" upload. A fan upload, a rip or a compilation channel is NOT acceptable however good the audio.
 3. *** CHECK THE DURATION AGAINST MUSICBRAINZ. *** This matters MORE for a cover than for an original: a famous artist re-cuts their own hit constantly — anniversary re-recordings, live cuts, remasters — and those pass step 2 while being the wrong record by decades. Query MusicBrainz for the COVER ARTIST's recording specifically and compare runtimes. Allow a few seconds' slack; reject anything off by more than ~15s. If you cannot establish a duration, set found:false.
 4. Never an embed URL (no /embed/, no player., no autoplay=). https only.

*** HOW TO READ A YOUTUBE PAGE — WebFetch CANNOT DO THIS. *** YouTube is JS-rendered, so WebFetch returns only the footer. Use Bash:
  curl -s --compressed -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" "https://www.youtube.com/watch?v=<ID>" | tr '{' '\\n{' | grep -oE '"lengthSeconds":"[0-9]+"|"ownerChannelName":"[^"]*"|Provided to YouTube by [^\\\\"]{0,40}|. [0-9]{4}[^\\\\"]{0,60}' | sort -u
That gives you the uploader, the runtime in seconds, the distributor line and the copyright year in one call.

MusicBrainz durations:
  curl -s "https://musicbrainz.org/ws/2/recording?query=recording:%22<TITLE>%22%20AND%20artist:%22<COVER ARTIST>%22&fmt=json&limit=6" -H "User-Agent: quotle.info/1.0 (+https://quotle.info)"
Read .recordings[].length (milliseconds) and .recordings[]["first-release-date"].

Use WebSearch to find candidate video IDs; verify every one with the curl above before accepting it.

RETURN, per song:
 • found:true with url, host ("www.youtube.com"), what, source
   - what: one sentence naming whose version it is and when, e.g. "Wilson Pickett's 1966 Atlantic version — the one most people mean by \\"Mustang Sally\\"." Use HTML entities for quotes and dashes (&ldquo; &rdquo; &rsquo; &mdash; &ndash;). NEVER include HTML TAGS — no <em>, no <a>. Tags are escaped on render and would ship as literal text.
   - source: WHY this copy is legitimate — which channel, which distributor line, and the runtime you matched against which MusicBrainz figure. State any discrepancy you noticed rather than hiding it.
 • found:false with omitReason naming which step failed.

Return ONE entry per song, all ${batch.length}, in the order given.`

const batches = []
for (let i = 0; i < songs.length; i += PER) batches.push(songs.slice(i, i + PER))

phase('Research')
log(`${songs.length} songs in ${batches.length} batches of up to ${PER}`)

const out = await parallel(batches.map((b, i) => () =>
  agent(prompt(b), { label: `covers:${i + 1}/${batches.length}`, phase: 'Research', schema: SCHEMA })))

const results = out.filter(Boolean).flatMap((r) => r.results || [])
const found = results.filter((r) => r.found && r.url)
log(`found ${found.length} of ${songs.length}; ${results.length - found.length} omitted`)
return { results }
