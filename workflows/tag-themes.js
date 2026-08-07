export const meta = {
  name: 'tag-themes',
  description: 'Tag each quote record with 2-4 intent themes from a fixed controlled vocabulary, so the verified corpus is discoverable by goal (e.g. "quotes about resilience"). Light classification, no web research. Returns {slug, themes[]} for every quote.',
  phases: [{ title: 'Tag', detail: 'one agent per batch assigns themes from the fixed vocab' }],
}

// Controlled vocabulary — MUST stay in sync with tools/themes.js (workflow scripts can't require()).
const THEMES = [
  ['resilience', 'Resilience — enduring hardship, bouncing back'],
  ['courage', 'Courage — facing fear, taking the risk'],
  ['leadership', 'Leadership — leading people, responsibility, direction'],
  ['change', 'Change — transformation, adapting, letting go of the old'],
  ['growth', 'Growth — self-improvement, learning by doing'],
  ['failure', 'Failure — mistakes, setbacks, what they teach'],
  ['success', 'Success — achievement, winning, its cost'],
  ['creativity', 'Creativity — imagination, making art, where ideas come from'],
  ['wisdom', 'Wisdom — insight, judgment, knowing what matters'],
  ['knowledge', 'Knowledge — learning, education, understanding'],
  ['truth', 'Truth — honesty, facts, facing them'],
  ['justice', 'Justice — fairness, rights, standing against wrong'],
  ['freedom', 'Freedom — liberty, independence, the right to choose'],
  ['love', 'Love — affection, devotion, bonds between people'],
  ['friendship', 'Friendship — connection, loyalty, the company we keep'],
  ['kindness', 'Kindness — compassion, generosity, treating others well'],
  ['gratitude', 'Gratitude — thankfulness, appreciating what you have'],
  ['happiness', 'Happiness — joy, contentment, the good life'],
  ['purpose', 'Purpose — meaning, calling, why we do what we do'],
  ['time', 'Time — impermanence, the present moment, how we spend our days'],
  ['mortality', 'Mortality — death, legacy, living in its light'],
  ['hope', 'Hope — optimism, faith things can be better'],
  ['work', 'Work — effort, discipline, craft, dignity of labor'],
  ['simplicity', 'Simplicity — less is more, focus, cutting to what counts'],
  ['doubt', 'Doubt — skepticism, questioning, thinking for yourself'],
  ['power', 'Power — influence, authority, how it is used'],
  ['character', 'Character — integrity, virtue, who you are unwatched'],
  ['humility', 'Humility — modesty, perspective, knowing your limits'],
]
const SLUGS = THEMES.map((t) => t[0])

const TAG_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['slug', 'themes'],
        properties: {
          slug: { type: 'string' },
          themes: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', enum: SLUGS } },
        },
      },
    },
  },
}

// args: { chunks, total, manifest }. `manifest` points at ANY manifest-shaped array of
// {quote, author, quoteSlug, confidence} — pass it to tag a subset (just a wave's new records)
// instead of re-tagging the whole corpus, and to work from a git worktree rather than the
// main checkout this used to hardcode.
const cfg = typeof args === 'string' ? JSON.parse(args) : (args || {})
const MANIFEST = cfg.manifest || '/Users/davidstewart/Developer/quotle-info/data/manifest.json'

const tagPrompt = (k, n) => `You are a librarian tagging quotations by THEME so people can find the right one for a talk or slide.

STEP 1: Read the JSON file ${MANIFEST} (an array of {quote, author, quoteSlug, confidence}). Work ONLY on the items whose zero-based position in the array satisfies (index % ${n} === ${k}) — that is your slice of the corpus. Ignore all other items.

STEP 2: For each quote in your slice, choose the 2-4 themes from the fixed list below that best capture what the quote is ABOUT (its meaning/message), not incidental words. Prefer fewer, stronger tags. Use ONLY these theme slugs:

${THEMES.map((t) => `- ${t[1]}`).join('\n')}

Judge by meaning: e.g. "Fall seven times, stand up eight" → resilience, hope (not "time"). A leadership maxim about serving others → leadership, character. If a quote is a fabrication/misattribution, tag it by what the LINE says anyway (someone still searches for its theme). Every quote in your slice must get at least one theme; never invent a slug outside the list.

Return {results:[{slug, themes:[...]}]} with one entry per quote in YOUR slice, echoing each quoteSlug exactly. Do not include items outside your slice. Your slice has EXACTLY ${sliceSize(k, n)} quotes in it and your results array must have exactly ${sliceSize(k, n)} entries — count them before returning.`

phase('Tag')
const N = cfg.chunks || 15
const total = cfg.total || 434

// HOW MANY QUOTES SLICE k OWNS. The slices are strided (index % N === k), not contiguous, so slice k
// holds every index k, k+N, k+2N, … below `total`. This is computable from numbers the script already
// has, which is what makes the retry below possible at all: the script cannot read the manifest (no
// filesystem in a workflow sandbox), so a per-slice EXPECTED COUNT is the only completeness signal
// available on this side of the boundary.
const sliceSize = (k, n) => (k >= total ? 0 : Math.floor((total - 1 - k) / n) + 1)

// RETRY A SHORT SLICE. r32 and r33 each lost exactly one record here, and r33's was at manifest
// position 22 of 40 with chunks:4 — 22 % 4 === 2, i.e. an agent returned 9 of its own 10 rather than
// a slice boundary being miscomputed. That failure is invisible downstream (see apply-tags.js) and it
// is also trivially self-correcting: ask the same slice again and name the shortfall. One retry, not a
// loop — a slice that comes back short twice is a real problem for a human, not something to grind at.
const runSlice = async (k, attempt) => {
  const want = sliceSize(k, N)
  const extra = attempt > 1
    ? `\n\nRETRY — a previous attempt on this slice returned FEWER than ${want} results. Enumerate every index k=${k}, ${k}+${N}, ${k}+2*${N}, … below ${total} and return one entry for each. Return all ${want}.`
    : ''
  // Opus, per the standing operator rule: Sonnet was tested against Opus on this corpus and
  // produced materially more errors, so the higher cost is an accepted trade for correctness.
  // This step is cheap either way (one call per slice); it is not the place to economise.
  const r = await agent(tagPrompt(k, N) + extra, {
    label: attempt > 1 ? `tag:slice${k + 1}/${N} retry` : `tag:slice${k + 1}/${N}`,
    phase: 'Tag', schema: TAG_SCHEMA, model: 'opus', effort: 'low',
  })
  const rows = (r && r.results) ? r.results : []
  if (rows.length >= want || attempt > 1) {
    if (rows.length < want) log(`slice ${k + 1}/${N} STILL SHORT after retry: ${rows.length}/${want} — apply-tags.js will name the missing slugs`)
    return rows
  }
  log(`slice ${k + 1}/${N} returned ${rows.length}/${want} — retrying that slice`)
  // Keep the first attempt's rows: the retry is asked for the whole slice, but if it comes back short
  // in a DIFFERENT place, the union covers more than either run alone. apply-tags.js dedupes by slug.
  const second = await runSlice(k, attempt + 1)
  return rows.concat(second)
}

const tagged = (await parallel(Array.from({ length: N }, (_, k) => () => runSlice(k, 1)))).flat()

// keep only valid slugs + valid themes; dedup themes per record
const bySlug = {}
for (const r of tagged) {
  if (!r || !r.slug) continue
  const themes = [...new Set((r.themes || []).filter((t) => SLUGS.includes(t)))]
  if (themes.length) bySlug[r.slug] = themes
}

const covered = Object.keys(bySlug).length
// SAY IT TWICE WHEN IT IS WRONG. `covered` is a number in a log line, and two waves running proved
// that is not enough on its own — see apply-tags.js, which is now the gate. This line exists so the
// shortfall is legible in the workflow output too, rather than being one digit off in a tidy summary.
if (covered < total) {
  log(`INCOMPLETE: ${covered}/${total} quotes tagged — ${total - covered} record(s) lost even after retries.`)
  log('apply-tags.js --manifest will name them and exit non-zero. Do NOT ship the wave on this.')
} else {
  log(`Tagged ${covered}/${total} quotes across ${N} slices`)
}
return { tags: bySlug, covered, total, complete: covered >= total }
