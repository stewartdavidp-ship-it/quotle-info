export const meta = {
  name: 'harvest-verified-by-theme',
  description: 'Track B: theme-driven harvest of the BEST genuinely-attributed, public-domain great quotes for the sourcing/discovery job (not misattributions — that is track A). One agent per theme finds the most famous, correctly-attributed, primary-sourced, PD-preferred lines people actually put on slides. Returns candidates[] (all category "genuine-famous").',
  phases: [{ title: 'Curate', detail: 'one agent per theme finds top verified public-domain quotes' }],
}

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['theme', 'quotes'],
  properties: {
    theme: { type: 'string' },
    notes: { type: 'string' },
    quotes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['quote', 'author', 'source', 'rightsEra', 'whyNotable', 'documentedAt'],
        properties: {
          quote: { type: 'string' },        // exact canonical wording, plain text, no wrapping quotes
          author: { type: 'string' },        // the TRUE, correct author
          source: { type: 'string' },        // the work + date it's from (or "speech, date"/"letter, date")
          rightsEra: { type: 'string', enum: ['public-domain', 'in-copyright', 'uncertain'] },
          whyNotable: { type: 'string' },     // why it's a strong pick for this theme
          documentedAt: { type: 'string' },   // URL: Wikiquote sourced entry / primary source / reputable ref
        },
      },
    },
  },
}

const prompt = (t) => `You are a quote CURATOR helping people find the best line for a presentation. Find the ${t.target} most FAMOUS, genuinely-and-correctly-attributed quotes about the theme "${t.label}" (${t.blurb}) — the canonical lines people actually put on slides and in books.

HARD REQUIREMENTS (a candidate that fails any of these must be dropped):
1. GENUINE + CORRECTLY ATTRIBUTED: the quote is really by the author you name, with a DOCUMENTED primary source (book + date, speech + date, essay, letter). This is NOT the misattribution track — do NOT include fakes, misquotes, or "disputed" lines. If you are not confident the attribution is correct and sourced, drop it.
2. STRONGLY PREFER PUBLIC DOMAIN: prioritise quotes whose source work was first published BEFORE 1931 (so they are cleared for commercial reuse — the whole point). Aim for at least ~80% public-domain. The public-domain canon is deep for every theme: Marcus Aurelius, Seneca, Epictetus, Confucius, Lao Tzu, Aristotle, Plato, Montaigne, Shakespeare, Emerson, Thoreau, Whitman, Dickinson, Austen, Twain (real), Lincoln, Frederick Douglass, Emily/Charlotte Brontë, Tolstoy, Nietzsche, Wilde (real), Kipling, proverbs, scripture, etc. Only include an in-copyright quote if it is truly iconic for this theme and you cannot find a public-domain equal.
3. PRIMARY-SOURCE-ABLE: you can point to where it is documented (Wikiquote SOURCED section, Project Gutenberg/Wikisource, a reputable reference). Put that URL in documentedAt.
4. Skip song lyrics and short poems (legal risk). Skip generic filler; pick lines that are genuinely quotable and on-theme.
5. VARIETY: prefer a spread of different authors and eras over many lines from one person.

For each, give: quote (the exact canonical wording, plain text, no surrounding quote marks), author (the true author), source (work + date), rightsEra (public-domain if the source is pre-1931, else in-copyright/uncertain — be honest), whyNotable (one line on why it's a strong pick for "${t.label}"), documentedAt (a URL where it's documented).

Return up to ${t.target} for "${t.label}". Quality and correct public-domain attribution over quantity — a shorter list of genuinely-sourced PD greats beats a padded one.`

phase('Curate')
const cfg = typeof args === 'string' ? JSON.parse(args) : (args || {})
const themes = cfg.themes || []

const results = (await parallel(themes.map((t) => () =>
  agent(prompt(t), { label: `theme:${t.slug}`, phase: 'Curate', schema: SCHEMA, effort: 'high' })
    .then((r) => (r ? { theme: t.slug, label: t.label, notes: r.notes || '', quotes: (r.quotes || []).map((q) => ({ ...q, theme: t.slug })) } : null))
))).filter(Boolean)

// flatten into the harvest-queue candidate shape (all genuine-famous; creditedTo = the true author)
const candidates = results.flatMap((r) => r.quotes.map((q) => ({
  quote: q.quote,
  creditedTo: q.author,          // the true author (genuine-famous → excluded from "misattributed to X")
  trueOrigin: q.author,
  category: 'genuine-famous',
  whyNotable: q.whyNotable,
  likelyConfidence: 'verified',
  rightsEra: q.rightsEra,
  documentedAt: q.documentedAt,
  magnetAuthor: q.author,
  sourceWork: q.source,
  seedTheme: q.theme,            // which theme this was curated for (track B provenance)
})))

const pd = candidates.filter((c) => c.rightsEra === 'public-domain').length
log(`Curated ${candidates.length} genuine quotes across ${results.length} themes (${pd} public-domain): ${results.map((r) => `${r.label}=${r.quotes.length}`).join(', ')}`)

return {
  byTheme: results.map((r) => ({ theme: r.label, count: r.quotes.length, notes: r.notes })),
  candidates,
}
