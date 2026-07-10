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

const MANIFEST = '/Users/davidstewart/Developer/quotle-info/data/manifest.json'

const tagPrompt = (k, n) => `You are a librarian tagging quotations by THEME so people can find the right one for a talk or slide.

STEP 1: Read the JSON file ${MANIFEST} (an array of {quote, author, quoteSlug, confidence}). Work ONLY on the items whose zero-based position in the array satisfies (index % ${n} === ${k}) — that is your slice of the corpus. Ignore all other items.

STEP 2: For each quote in your slice, choose the 2-4 themes from the fixed list below that best capture what the quote is ABOUT (its meaning/message), not incidental words. Prefer fewer, stronger tags. Use ONLY these theme slugs:

${THEMES.map((t) => `- ${t[1]}`).join('\n')}

Judge by meaning: e.g. "Fall seven times, stand up eight" → resilience, hope (not "time"). A leadership maxim about serving others → leadership, character. If a quote is a fabrication/misattribution, tag it by what the LINE says anyway (someone still searches for its theme). Every quote in your slice must get at least one theme; never invent a slug outside the list.

Return {results:[{slug, themes:[...]}]} with one entry per quote in YOUR slice, echoing each quoteSlug exactly. Do not include items outside your slice.`

phase('Tag')
const cfg = typeof args === 'string' ? JSON.parse(args) : (args || {})
const N = cfg.chunks || 15
const total = cfg.total || 434

const tagged = (await parallel(Array.from({ length: N }, (_, k) => () =>
  agent(tagPrompt(k, N), { label: `tag:slice${k + 1}/${N}`, phase: 'Tag', schema: TAG_SCHEMA, model: 'sonnet', effort: 'low' })
    .then((r) => (r && r.results ? r.results : []))
))).flat()

// keep only valid slugs + valid themes; dedup themes per record
const bySlug = {}
for (const r of tagged) {
  if (!r || !r.slug) continue
  const themes = [...new Set((r.themes || []).filter((t) => SLUGS.includes(t)))]
  if (themes.length) bySlug[r.slug] = themes
}

const covered = Object.keys(bySlug).length
log(`Tagged ${covered}/${total} quotes across ${N} slices`)
return { tags: bySlug, covered, total }
