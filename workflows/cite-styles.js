export const meta = {
  name: 'cite-styles',
  description: "Reformat each citable record's existing Chicago citation into MLA 9 and APA 7, and classify the source's original language / translation status. Pure reformatting from the record's own bibliographic data — NO web research.",
  phases: [{ title: 'Format', detail: 'one agent per chunk of records reformats Chicago → MLA + APA' }],
}

const _a = typeof args === 'string' ? JSON.parse(args) : (args || [])
const slugs = Array.isArray(_a) ? _a : (_a.slugs || [])
const REPO = '/Users/davidstewart/Developer/quotle-info'
const CHUNK = _a.chunk || 12
const chunks = []
for (let i = 0; i < slugs.length; i += CHUNK) chunks.push(slugs.slice(i, i + CHUNK))

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['slug', 'mla', 'apa', 'inLanguage', 'translated'],
        properties: {
          slug: { type: 'string' },
          mla: { type: 'string' },        // MLA 9 works-cited entry (HTML-safe, <em> for titles)
          apa: { type: 'string' },        // APA 7 reference entry (HTML-safe, <em> for titles)
          inLanguage: { type: 'string' }, // BCP-47 of the ORIGINAL work ("en" if originally English)
          translated: { type: 'boolean' },// true if the English quote is a translation of a non-English original
          note: { type: 'string' },       // optional: any component genuinely missing
        },
      },
    },
  },
}

const prompt = (batch) => `You are a meticulous citation formatter. For EACH slug below, read its record JSON at ${REPO}/data/quotes/<slug>.json and produce a correctly formatted **MLA 9th edition** works-cited entry and an **APA 7th edition** reference entry for THE PRIMARY SOURCE the quotation comes from.

AUTHORITATIVE INPUT: the record's existing Chicago citation (\`cite.sourceCitation\`) already contains the bibliographic components (author, work/container title, translator, edition, publisher, place, year, page/section). Use it as the source of truth, cross-checked against \`source.docMeta\` and \`answer.authorName\`. This is a REFORMATTING task — do NOT do web research and do NOT invent any component (publisher, year, translator, page) that isn't present; if one is genuinely absent, follow MLA/APA rules for omitting a missing element and mention it in \`note\`.

MLA 9 form: \`Author Last, First. "Title of the Source." <em>Title of Container</em>, translated by X, Publisher, Year, pp. N.\` (for a whole book, the work title is italicized and there's no container). Credit a translator when the record names one.
APA 7 form: \`Author, A. A. (Year). <em>Title of work</em> (X, Trans.). Publisher. (Original work published YEAR)\` — include the "(Original work published …)" parenthetical only when the record gives an original composition date for a translated work.

Also classify:
- \`inLanguage\`: BCP-47 code of the ORIGINAL work's language — "en" if originally written in English; "fr", "grc" (ancient Greek), "la" (Latin), "de", "it", "es", etc. if the English quote is a translation.
- \`translated\`: true if the English wording is a translation of a non-English original, else false.

OUTPUT AS RAW HTML FRAGMENTS — this is critical: emit LITERAL \`<em>\`/\`</em>\` tags (NOT \`&lt;em&gt;\`), and escape each special character EXACTLY ONCE (a real ampersand is \`&amp;\`, never \`&amp;amp;\`; curly quotes \`&ldquo;\`/\`&rdquo;\`, never \`&amp;ldquo;\`). Do not double-escape. Exactly one result object per slug, echoing the slug verbatim.

Slugs (${batch.length}): ${batch.join(', ')}`

phase('Format')
const out = await parallel(chunks.map((b) => () => agent(prompt(b), { schema: SCHEMA, model: 'sonnet', label: `cite:${b[0].slice(0, 20)}` })))
const results = out.filter(Boolean).flatMap((r) => r.results || [])
return { requested: slugs.length, got: results.length, results }
