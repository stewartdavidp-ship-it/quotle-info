export const meta = {
  name: 'generate-quote-records',
  description: 'Research + adversarially-source each quote into a verified provenance dossier WITH 3-state rights classification, on Opus, deferring to Quote Investigator/Wikiquote where they have investigated. Returns records[] for ingest.',
  phases: [{ title: 'Research', detail: 'one deep-provenance agent per quote → schema-validated dossier' }],
}

// ---------- input contract ----------
// args is EITHER a legacy array of items [{text, author, index}], OR an object
// { items:[...], verifiedDate:"8 Jul 2026", dateModified:"2026-07-08" }.
// The two dates are STAMPED into every record (answer.lastVerified, cite.pageCitation,
// schema.dateModified). They default to the values below — OVERRIDE them per wave by
// passing the object form so pages don't all claim the same stale "last verified" date.
const _cfg = typeof args === 'string' ? JSON.parse(args) : (args || [])
const items = Array.isArray(_cfg) ? _cfg : (_cfg.items || [])
const VERIFIED_DATE = (!Array.isArray(_cfg) && _cfg.verifiedDate) || '8 Jul 2026'
const DATE_MODIFIED = (!Array.isArray(_cfg) && _cfg.dateModified) || '2026-07-08'

// ---------- deterministic helpers (plain JS, no fs) ----------
function slugify(text) {
  let s = String(text).toLowerCase()
    .replace(/[’'‘`]/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > 60) { s = s.slice(0, 60).replace(/-[^-]*$/, ''); }
  return s;
}
const authorSlugOf = (name) => slugify(name);

function toRecord(d, item) {
  const displayQuote = String(item.text).replace(/\s*\.\s*$/, '');
  const quoteSlug = slugify(displayQuote);
  const aSlug = authorSlugOf(d.author.name);
  const rec = {
    quoteSlug,
    dayNumber: item.index,
    confidence: d.confidence,
    displayQuote,
    meta: {
      title: d.meta.title,
      version: '0.4.0-proto',
      description: d.meta.description,
      ogTitle: d.meta.ogTitle,
      ogDescription: d.meta.ogDescription,
    },
    answer: {
      kicker: 'Who really said it',
      label: d.answer.label,
      authorName: d.answer.authorName,
      authorHref: '/authors/' + aSlug,
      authorDates: d.answer.authorDates,
      sourceLine: d.answer.sourceLine,
      lastVerified: VERIFIED_DATE,
    },
    source: {
      kicker: 'Provenance',
      heading: d.source.heading || 'The source',
      docMeta: d.source.docMeta,
      excerpt: d.source.excerpt,
      trailTitle: d.source.trailTitle || 'How we verified this',
      trail: d.source.trail,
    },
    externalLinks: d.externalLinks,
    author: {
      name: d.author.name,
      slug: aSlug,
      initials: d.author.initials,
      kicker: d.author.kicker || 'The author',
      heading: d.author.heading || ('About ' + d.author.name),
      metaLine: d.author.metaLine,
      bio: d.author.bio,
    },
    cite: {
      sourceLabel: d.cite.sourceLabel || 'The primary source (Chicago)',
      sourceCitation: d.cite.sourceCitation,
      pageCitation: d.cite.pageCitation,
    },
  };
  if (d.answer.confidenceText) rec.answer.confidenceText = d.answer.confidenceText;
  if (d.source.cutTag) rec.source.cutTag = d.source.cutTag;
  if (d.source.excerptNote) rec.source.excerptNote = d.source.excerptNote;
  if (d.source.artifact) rec.source.artifact = d.source.artifact;
  if (d.source.sourceLink) rec.source.sourceLink = d.source.sourceLink;
  // Rights: structured 3-state. 'uncertain' → assert no status (prose-only, conservative).
  if (d.source.rights && d.source.rights !== 'uncertain') {
    rec.source.rights = d.source.rights;
    if (d.source.rightsHolder) rec.source.rightsHolder = d.source.rightsHolder;
  }
  if (d.source.rightsNote) rec.source.rightsNote = d.source.rightsNote;
  if (d.copyAttribution) rec.copyAttribution = d.copyAttribution;

  if (d.misattribution) {
    rec.misattribution = {
      kicker: 'Fact-check',
      heading: d.misattribution.heading || 'Often misattributed',
      intro: d.misattribution.intro,
      items: d.misattribution.items,
      truthLine: d.misattribution.truthLine,
    };
  }
  if (d.context) {
    rec.context = {
      kicker: 'Context',
      heading: d.context.heading || 'Why it mattered',
      lead: d.context.lead,
      detailsSummary: d.context.detailsSummary || 'Read the full story',
      detailsBody: d.context.detailsBody || [],
    };
    if (d.context.pull) rec.context.pull = d.context.pull;
  }
  if (d.schema) {
    const sc = d.schema, out = {};
    if (sc.quotationText) out.quotationText = sc.quotationText;
    if (sc.alternateName) out.alternateName = sc.alternateName;
    if (sc.creatorName) {
      out.creator = { name: sc.creatorName };
      if (sc.creatorBirthDate) out.creator.birthDate = sc.creatorBirthDate;
      if (sc.creatorJobTitle) out.creator.jobTitle = sc.creatorJobTitle;
      if (sc.creatorSameAs) out.creator.sameAs = sc.creatorSameAs;
    }
    if (sc.dateCreated) out.dateCreated = sc.dateCreated;
    if (sc.isBasedOnName) {
      out.isBasedOn = { type: 'CreativeWork', name: sc.isBasedOnName };
      if (sc.isBasedOnDatePublished) out.isBasedOn.datePublished = sc.isBasedOnDatePublished;
      if (sc.isBasedOnSameAs) out.isBasedOn.sameAs = sc.isBasedOnSameAs;
    }
    out.webPageName = d.meta.ogTitle;
    out.dateModified = DATE_MODIFIED;
    rec.schema = out;
  }
  return rec;
}

// ---------- dossier schema (StructuredOutput-enforced) ----------
const DOSSIER_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['confidence', 'confidenceReason', 'meta', 'answer', 'source', 'externalLinks', 'author', 'cite', 'sourcesVerified'],
  properties: {
    confidence: { type: 'string', enum: ['verified', 'attributed', 'disputed'] },
    confidenceReason: { type: 'string' },
    copyAttribution: { type: 'string' },
    meta: {
      type: 'object', additionalProperties: false, required: ['title', 'description', 'ogTitle', 'ogDescription'],
      properties: { title: { type: 'string' }, description: { type: 'string' }, ogTitle: { type: 'string' }, ogDescription: { type: 'string' } },
    },
    answer: {
      type: 'object', additionalProperties: false, required: ['label', 'authorName', 'authorDates', 'sourceLine'],
      properties: { label: { type: 'string' }, authorName: { type: 'string' }, authorHref: { type: 'string' }, authorDates: { type: 'string' }, confidenceText: { type: 'string' }, sourceLine: { type: 'string' } },
    },
    source: {
      type: 'object', additionalProperties: false, required: ['docMeta', 'excerpt', 'trail', 'rights'],
      properties: {
        heading: { type: 'string' },
        docMeta: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['dt', 'dd'], properties: { dt: { type: 'string' }, dd: { type: 'string' }, ddClass: { type: 'string' } } } },
        excerpt: { type: 'string' }, cutTag: { type: 'string' }, excerptNote: { type: 'string' },
        artifact: { type: 'object', additionalProperties: false, required: ['icon', 'kindLabel', 'url', 'linkText'], properties: { icon: { type: 'string' }, kindLabel: { type: 'string' }, url: { type: 'string' }, linkText: { type: 'string' } } },
        sourceLink: { type: 'object', additionalProperties: false, required: ['text', 'url'], properties: { text: { type: 'string' }, url: { type: 'string' } } },
        trail: { type: 'array', items: { type: 'string' } },
        trailTitle: { type: 'string' },
        rights: { type: 'string', enum: ['public-domain', 'in-copyright', 'licensed', 'uncertain'] },
        rightsHolder: { type: 'string' },
        rightsNote: { type: 'string' },
      },
    },
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
    externalLinks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'host', 'url', 'what'], properties: { label: { type: 'string' }, host: { type: 'string' }, url: { type: 'string' }, what: { type: 'string' } } } },
    author: {
      type: 'object', additionalProperties: false, required: ['name', 'initials', 'metaLine', 'bio'],
      properties: { name: { type: 'string' }, slug: { type: 'string' }, initials: { type: 'string' }, metaLine: { type: 'string' }, bio: { type: 'string' }, kicker: { type: 'string' }, heading: { type: 'string' } },
    },
    cite: {
      type: 'object', additionalProperties: false, required: ['sourceCitation', 'pageCitation'],
      properties: { sourceLabel: { type: 'string' }, sourceCitation: { type: 'string' }, pageCitation: { type: 'string' } },
    },
    schema: {
      type: 'object', additionalProperties: false,
      properties: { quotationText: { type: 'string' }, alternateName: { type: 'string' }, creatorName: { type: 'string' }, creatorBirthDate: { type: 'string' }, creatorJobTitle: { type: 'string' }, creatorSameAs: { type: 'string' }, dateCreated: { type: 'string' }, isBasedOnName: { type: 'string' }, isBasedOnDatePublished: { type: 'string' }, isBasedOnSameAs: { type: 'string' } },
    },
    sourcesVerified: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['claim', 'url', 'containsClaim'], properties: { claim: { type: 'string' }, url: { type: 'string' }, containsClaim: { type: 'boolean' } } } },
  },
}

const researchPrompt = (item) => {
  const dq = String(item.text).replace(/\s*\.\s*$/, '');
  return `You are a rigorous quote-provenance researcher for quotle.info, a verified-provenance / fact-check site. Your output IS the data for a published page, so every claim must be checkable. Be skeptical; default to honest uncertainty over false precision.

THE QUOTE: "${dq}"
POPULARLY CREDITED TO: ${item.author}  (a famous name — one of the INTERNET'S #1 MAGNETS FOR FAKE QUOTES: feel-good and clever lines get pinned on them with no source. Assume fabrication until proven otherwise. Rights turn on when the specific SPEECH/BOOK/LETTER/artwork was first published — a modern line is usually IN-COPYRIGHT; an old translation may itself be in-copyright. Your job is the truth: did they really say/write this exact line, in what documented source, and is the popular wording genuine or a later paraphrase/fabrication?)

RESEARCH (use WebSearch + WebFetch widely): find the documented SOURCE (speech + date, book + page, interview, letter, diary) and whether ${item.author} actually said/wrote this exact wording; and the misattribution history. FETCH each source you cite and confirm it literally contains the specific claim you attach to it. Populate sourcesVerified with {claim, url, containsClaim} for every source link — do NOT use a link unless a fetch confirmed it supports that claim (this is the site's #1 discipline).

ANCHOR SOURCES — DEFER TO THE SPECIALISTS: If Quote Investigator (quoteinvestigator.com) OR Wikiquote's *sourced* section has already investigated this quote, treat their finding as the AUTHORITATIVE ANCHOR. Search QI first (site:quoteinvestigator.com "<key phrase>"). Cite QI/Wikiquote prominently (a trail item AND a Dig-deeper link), adopt their earliest-attestation and origin conclusion, and do NOT assert a different or earlier origin, a more confident attribution, or extra specificity (dates, editions, who-really-said-it) beyond what they document — unless you independently confirm it against a primary source you fetched. Where QI is uncertain or calls it apocryphal, MIRROR that: use "attributed" or "disputed" honestly rather than manufacturing a confident answer. quotle.info's value is a clean, structured, honestly-hedged answer built on the best existing research — never an overclaim past it.

ASSIGN confidence (drives the page):
 • "verified"  — you located the specific work (+ translation, if translated) that demonstrably contains this exact wording from this author.
 • "attributed" — credibly and widely credited to ${item.author}, consistent with their work, but you could NOT pin the exact wording to a specific primary source, and it is not known to be wrong.
 • "disputed"   — the attribution is wrong/unsupported: a different writer originated it, OR it is a fabrication/paraphrase found in none of the author's actual works, OR no evidence they wrote it.

RIGHTS — classify source.rights (a claim SEPARATE from attribution; a quote can be firmly attributed and still under copyright). Rules for the UNITED STATES, current year 2026:
 • For an author writing in ENGLISH, rights turn on when the WORK containing this line was first PUBLISHED:
   - First published BEFORE 1931 → "public-domain".
   - First published 1931 OR LATER by an identifiable author/estate/publisher → "in-copyright", rightsHolder = the author's estate and/or publisher.
 • For a TRANSLATED author (ancient/foreign-language), rights attach to the EXACT English TRANSLATION shown: translation pre-1931 → "public-domain"; a specific 1931+ translation → "in-copyright" (translator/publisher). Ancient original text long PD, but a modern rendering is not.
 • If the exact wording is a fabrication or anonymous paraphrase with no identifiable source → "uncertain" (assert no status; NEVER claim public-domain for something you cannot source).
 • If you genuinely cannot determine the work/first-publication → "uncertain".
 • CONSERVATIVE BIAS: a wrong "public-domain" is the costliest error. Use "public-domain" only when you've tied the line to a specific pre-1931 work/edition; when a work is 1931+ or you're unsure of the edition date, prefer "in-copyright"; when the wording's origin is unknown, use "uncertain".
 Also give rightsNote (HTML, 1-2 sentences) explaining the rights situation honestly (which work, its date, why PD or in-copyright), and rightsHolder when in-copyright/licensed.

FILL THE DOSSIER (all prose fields use HTML entities — &ldquo; &rdquo; &lsquo; &rsquo; &mdash; &amp; — and inline links as <a href="URL" target="_blank" rel="noopener">text ↗</a>. Provide INNER HTML only — NEVER wrap a field value in a block tag like <li>, <p>, or <div>; the renderer adds those. Write real entities like &mdash; once, not &amp;mdash;):

answer.label / authorName / authorDates / sourceLine, following the confidence pattern:
 • verified  → label "Written by" (or "Spoken by"). authorName = the author. authorDates = life dates / role. sourceLine = 1-2 sentences: which work + translation + that it's confirmed.
 • attributed → label "Attributed to". authorName = ${item.author}. sourceLine = honest: widely credited; consistent with their work; but no primary source/translation pins this exact wording.
 • disputed  → label like "Not ${item.author} — a modern paraphrase" or "Not ${item.author} — actually {TrueName}". authorName = the TRUE originator (or ${item.author} if the THOUGHT is theirs but the WORDING is a paraphrase — then explain in sourceLine). sourceLine = the real story.
answer.confidenceText: OMIT unless overriding the default.

author.*  = ABOUT THE TRUE AUTHOR (for verified/attributed that is ${item.author}; for disputed the hero/author is the TRUE originator when known, else ${item.author} if the idea is theirs). name, initials (e.g. "MA"), metaLine (PLAIN TEXT, e.g. "121–180 AD · Roman emperor & Stoic philosopher"), bio (2-3 sentences, may use <strong>/<em>).

source: docMeta (2-4 {dt,dd}; ddClass:"title" for a work title; include a "Translation" row when relevant), excerpt (the quote in fuller original context when one exists, else the quote), cutTag (optional), excerptNote (optional), artifact (ONLY if a real primary artifact exists; OMIT otherwise), sourceLink ({text,url} to the best primary/translation/chronology page), trail (2-4 HTML strings, INNER content only, each with an inline confirmed <a>), rights (see RIGHTS above), rightsHolder (when in-copyright/licensed), rightsNote (honest HTML note).

misattribution: INCLUDE whenever the quote is misattributed, fabricated, mis-worded, or commonly mis-credited (the typical angle for these magnet names). intro; items[{scope, who, tag?, why (HTML w/ inline source link)}]; truthLine (HTML w/ source link). OMIT only if genuinely none.

context: OPTIONAL why-it-mattered. lead[] (1-2 paragraphs), pull? (short pull-quote), detailsBody[] (optional).

externalLinks: 4-6 {label, host, url, what} — trusted archives / fact-checks / scholarship (e.g. Project Gutenberg, Wikisource, Internet Archive, Poetry Foundation, the author's collected works, Wikiquote, Quote Investigator), each confirmed relevant.

cite.sourceCitation (Chicago for the primary source + translation, or best-available "earliest documented in …"). cite.pageCitation exactly: Quotle.info. &ldquo;Who really said &lsquo;${dq.replace(/"/g,'')}&rsquo;?&rdquo; Last verified ${VERIFIED_DATE}.

meta.title = Who really said "${dq.replace(/"/g,'')}"? | Quotle.info  · meta.ogTitle = Who really said '${dq.replace(/"/g,'')}'?  · description/ogDescription ≤ 160 chars, specific and honest.

schema (optional): quotationText (full form), creatorName + creatorBirthDate + creatorJobTitle + creatorSameAs (Wikipedia URL), dateCreated, isBasedOnName/isBasedOnDatePublished/isBasedOnSameAs.

CITATION DISCIPLINE (a page fails audit on any of these):
 • Do NOT add specificity beyond what your linked source literally states — no translator/edition/date, Wikiquote section label ("Misattributed" vs "Disputed"), volume/page, or exact variant-swap UNLESS the source you attach contains that exact detail. Verify translation names/dates by reading the actual edition or a catalog record.
 • If a point is your OWN inference, state it as a plain observation; attach a link only for what that link actually says.
 • answer.authorDates and author.metaLine are PLAIN TEXT — no tags; entities like &middot; &ndash; are fine.
 • source.sourceLink.text and artifact.linkText must NOT end with ↗ or any arrow — the renderer adds it.
 • copyAttribution (if provided) is PLAIN TEXT for the clipboard — literal Unicode (— ' ' " "), NO HTML tags, NO named entities.

Return the dossier via the structured schema. Do not invent sources or translations; if you cannot verify a primary source, choose "attributed" or "disputed" and set rights honestly ("uncertain" when the wording's origin is unknown).`
}

phase('Research')

const records = (await parallel(items.map((it) => () =>
  agent(researchPrompt(it), { label: `research:${it.author.split(' ').pop()}#${it.index}`, phase: 'Research', schema: DOSSIER_SCHEMA, effort: 'high' })
    .then((d) => (d ? { record: toRecord(d, it), confidence: d.confidence, reason: d.confidenceReason, rights: (d.source && d.source.rights) || '?', verifiedCount: (d.sourcesVerified || []).length, author: d.author.name, index: it.index } : null))
))).filter(Boolean)

log(`Generated ${records.length}/${items.length} records. States: ${records.map((r) => r.confidence).join(', ')}`)

return {
  records: records.map((r) => r.record),
  summaries: records.map((r) => ({ index: r.index, slug: r.record.quoteSlug, confidence: r.confidence, rights: r.rights, trueAuthor: r.author, verifiedSources: r.verifiedCount, reason: r.reason })),
}
