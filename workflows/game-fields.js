export const meta = {
  name: 'game-fields',
  description: "Fill in the Quotle game's clue fields (gender, category, period, difficulty, hint, location, year) for verified quotes not yet in the game, per workflows/game/BRIEF.md. No web research.",
  phases: [{ title: 'Enrich', detail: 'one agent per batch of ~50 quotes from tools/game-todo.js output' }],
}

// args: { todo: "<absolute path to game-todo.json>", batches: <N> }  — both printed by tools/game-todo.js.
// game-todo.js numbers each entry's `batch` so an author never spans two batches: one agent decides
// each author's shared fields (gender, category, period).
const _a = typeof args === 'string' ? JSON.parse(args) : (args || {})
const REPO = '/Users/davidstewart/Developer/quotle-info'
const TODO = _a.todo
const BATCHES = _a.batches || 0
const ranges = Array.from({ length: BATCHES }, (_, k) => k)

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['slug', 'gender', 'category', 'period', 'difficulty', 'hint', 'location', 'year'],
        properties: {
          slug: { type: 'string' },
          gender: { type: 'string' },
          category: { type: 'string' },
          period: { type: 'string' },
          difficulty: { type: 'integer' },
          hint: { type: 'string' },
          location: { type: 'string' },
          year: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
  },
}

const prompt = (k) => `Read ${REPO}/workflows/game/BRIEF.md and follow it exactly.

Your input is every entry with "batch": ${k} in the JSON array in ${TODO}. Read that file and take exactly those entries. Return one result per entry, echoing each slug verbatim. Where an entry has "knownAuthor", copy its gender, category and period exactly. Do not search the web.`

phase('Enrich')
const out = await parallel(ranges.map((k) => () => agent(prompt(k), { schema: SCHEMA, label: `game:batch-${k}` })))
const results = out.filter(Boolean).flatMap((r) => r.results || [])
return { batches: BATCHES, got: results.length, results }
