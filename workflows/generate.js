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
// slugify + its tables are DUPLICATED VERBATIM from tools/slugify.js — workflow scripts run in a
// sandbox with no require(). Change one, change the other; see that file for why accented letters
// are transliterated (ò→o) instead of dropped, and why only ACCENT entities are decoded here.
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
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[ßæœøđðþłħı]/g, (ch) => RAW_LETTERS[ch] || ch)
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
    // isPartOf = the work this sentence is CONTAINED IN. tools/template.js:278-279 has documented the
    // distinction from isBasedOn (the specific TRANSLATION the English wording came from) all along,
    // but the schema only ever offered isBasedOn* — so every wave filed containment under derivation
    // and no agent could do otherwise. Measured 2026-07-30: 1,192 of 1,254 records carry no isPartOf
    // at all, and 1,029 of those hold the containing work under isBasedOn with no translation signal.
    // That is also why the standing Schema.org RULE (isPartOf required) was unmeetable by construction.
    //
    // Renaming rather than adding, because containment is the COMMON case and translation the rare one
    // (16 records) — the schema was offering the exception and agents correctly filled it with the
    // rule. It also costs NEGATIVE bytes: DOSSIER_SCHEMA sits at exactly SCHEMA_BUDGET (4,072) with
    // zero headroom, and isPartOf* is one character shorter per property, landing at 4,069.
    if (sc.isPartOfName) {
      out.isPartOf = { type: 'CreativeWork', name: sc.isPartOfName };
      if (sc.isPartOfDatePublished) out.isPartOf.datePublished = sc.isPartOfDatePublished;
      if (sc.isPartOfSameAs) out.isPartOf.sameAs = sc.isPartOfSameAs;
    }
    out.webPageName = d.meta.ogTitle;
    out.dateModified = DATE_MODIFIED;
    // The CLAIMED wording is displayQuote and the DOCUMENTED line is out.quotationText. Carrying both
    // lets template.js rate the claimed wording rather than the documented one, and (on an
    // author-less film record) suppress the bogus film/character/fragment claimant.
    //
    // This was gated on `!item.author` — track C (film) batches only — so a magnet-author batch could
    // never emit it, and that is a property of the TRACK, not of the quote: a Franklin line drifts the
    // same way whether the wave harvested it by author or by film. Keep in sync with prep-wave.js.
    if (out.quotationText && displayQuote !== out.quotationText) out.claimQuoteText = displayQuote;
    rec.schema = out;
  }
  // themes now come from the RESEARCHING agent (schema-enforced, 2-4 from the fixed vocabulary),
  // which removes the separate tag-themes workflow stage. Older journals predate this, so tolerate
  // absence rather than writing an empty array the theme pages would treat as tagged.
  if (Array.isArray(d.themes) && d.themes.length) rec.themes = d.themes;
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
    // NO `themes` HERE — and this is load-bearing, not an oversight.
    // Folding themes in (to remove the separate tag stage) grew this schema from 4,072 to 4,454
    // serialized bytes, and the platform then rejected EVERY agent before it ran: "output schema
    // too large to classify safely", 20/20 agents, 19ms, 0 tokens. Generation was dead — a silent
    // platform-layer failure with no content error to read. Measured bounds:
    //     4,072 bytes -> shipped fine (wave r23)
    //     4,159 bytes -> rejected (themes present, enum collapsed to a plain string)
    //     4,454 bytes -> rejected
    // So the ceiling sits between 4,072 and 4,159. This schema is at EXACTLY 4,072 — headroom ZERO.
    // (An earlier note here said "~87 bytes under it". That measured against 4,159, the size that was
    // REJECTED, and read as spare room; two sessions costed features against it. The enforced budget
    // — SCHEMA_BUDGET in tools/verify-corpus.js — is the proven-good 4,072, which is where we are.)
    //
    // tools/verify-corpus.js fails the build if it grows past the budget. Before adding ANY property
    // here, free space elsewhere first — the tag-themes stage is cheap next to a generator that
    // cannot run. Measured 2026-07-29: there is nothing cheap left. This schema carries NO
    // `description` prose; the remaining bytes are 485 of `required`, 375 of `additionalProperties:
    // false` and 91 of enums, all doing constraint work. Freeing ~35 bytes means deleting two
    // `additionalProperties: false`, i.e. weakening a gate so a field fits. Don't.
    //
    // If a field is genuinely worth spending the untested (4072, 4159] band on: an oversized schema
    // is rejected BEFORE execution, so ONE agent proves it at 0 tokens. Probe with one, record the
    // datapoint above, then raise SCHEMA_BUDGET — in that order. Raising it first turns a number that
    // means "proven" into one that means "probably".
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
      properties: { quotationText: { type: 'string' }, alternateName: { type: 'string' }, creatorName: { type: 'string' }, creatorBirthDate: { type: 'string' }, creatorJobTitle: { type: 'string' }, creatorSameAs: { type: 'string' }, dateCreated: { type: 'string' }, isPartOfName: { type: 'string' }, isPartOfDatePublished: { type: 'string' }, isPartOfSameAs: { type: 'string' } },
    },
    sourcesVerified: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['claim', 'url', 'containsClaim'], properties: { claim: { type: 'string' }, url: { type: 'string' }, containsClaim: { type: 'boolean' } } } },
  },
}

// TRACK C (film misquotes) arrives with author '' BY DESIGN: on a wording-drift line nobody is
// falsely credited — the source is right and only the words drifted — so the harvest deliberately
// leaves creditedTo/magnetAuthor empty (see harvest-film-misquotes.js). The track-A framing below is
// actively WRONG for those: there is no magnet, "assume fabrication" is false (the line is real but
// misworded), and the verdict label would render as "Not  — a modern paraphrase". So branch the
// framing. Everything after this block — the dossier contract, rights rules, toRecord — is shared,
// which is why this is a branch here rather than a second generate script: generate.js already
// carries duplicated copies of slugify and toRecord, and a third copy is how they drift.
const filmFraming = (dq) => `THE POPULAR WORDING: "${dq}"
THIS IS A SCREEN LINE THE PUBLIC MISQUOTES. There is NO magnet author and nothing here is fabricated
— the film is real and the line is nearly real. The error is the WORDING. Your job is to establish
what was ACTUALLY said, who wrote it, and whether that film originated the line at all.

RESEARCH (use WebSearch + WebFetch widely):
1. IDENTIFY the work, then get the ACTUAL line from a TRANSCRIPTION — Wikiquote's page for the film.
   The entire claim of this page is the wording, so it may not rest on memory or a listicle. NOTE:
   WebFetch tends to SUMMARISE a Wikiquote page rather than reproduce dialogue, which is useless
   here — fetch the raw wikitext instead (append ?action=raw to the Wikiquote URL). A summariser
   paraphrasing a transcript is precisely the error this site exists to correct.
2. ORIGINATION — the expensive question, do not skip it. Did the line originate in this film, or was
   it only USED there? Many famous "movie quotes" come from the source novel or play and the film
   merely sharpened them: "Frankly, my dear, I don't give a damn" is in Mitchell's 1936 novel, which
   reads "My dear, I don't give a damn" — the film's contribution is one word. If the line came from
   a novel/play/earlier work, SAY SO and name that work and date. Crediting a film with a line it
   borrowed is the same error class as crediting Einstein with a line he never said.
3. AUTHORSHIP — the author of a screen line is the WRITER (screenplay/teleplay), NEVER the character
   and NEVER the actor. author.* = the writer. Record the character + actor as the SPEAKER in
   source.docMeta ("Spoken by: Cmdr. William Riker (Jonathan Frakes) — a fictional character"). If
   the writing credit is shared or contested (Brackett & Kasdan on Empire), say so rather than
   picking one name. If a real person is credited in the misattribution section, they go there — not
   in author.*.
4. RIGHTS — screen writing is WORK-FOR-HIRE: source.rightsHolder is the STUDIO, not the screenwriter.
   US public domain reaches works published through 1930 only, so a film is essentially always
   in-copyright; use public-domain ONLY for a pre-1931 release and justify it.

VERDICT for a wording drift: confidence 'disputed' — the line AS QUOTED was not said. answer.label
reads like "Not quite — the actual line is ..." or "Misquoted — {Writer} wrote ...", NOT "Not X —".
answer.authorName = the WRITER (the real author of the real line). The popular wording stays as the
page's displayQuote because that is what people search for; put the ACTUAL sentence in
source.excerpt and set schema.claimQuoteText to the popular wording so the ClaimReview rates the
claim that was really made rather than a strawman.

FETCH each source you cite and confirm it literally contains the claim you attach to it. Populate
sourcesVerified with {claim, url, containsClaim} for every source link — do NOT use a link unless a
fetch confirmed it supports that claim (this is the site's #1 discipline).`;

const magnetFraming = (dq, author) => `THE QUOTE: "${dq}"
POPULARLY CREDITED TO: ${author}  (a famous name — one of the INTERNET'S #1 MAGNETS FOR FAKE QUOTES: feel-good and clever lines get pinned on them with no source. Assume fabrication until proven otherwise. Rights turn on when the specific SPEECH/BOOK/LETTER/artwork was first published — a modern line is usually IN-COPYRIGHT; an old translation may itself be in-copyright. Your job is the truth: did they really say/write this exact line, in what documented source, and is the popular wording genuine or a later paraphrase/fabrication?)

RESEARCH (use WebSearch + WebFetch widely): find the documented SOURCE (speech + date, book + page, interview, letter, diary) and whether ${author} actually said/wrote this exact wording; and the misattribution history. FETCH each source you cite and confirm it literally contains the specific claim you attach to it. Populate sourcesVerified with {claim, url, containsClaim} for every source link — do NOT use a link unless a fetch confirmed it supports that claim (this is the site's #1 discipline).`;

const researchPrompt = (item) => {
  const dq = String(item.text).replace(/\s*\.\s*$/, '');
  return `You are a rigorous quote-provenance researcher for quotle.info, a verified-provenance / fact-check site. Your output IS the data for a published page, so every claim must be checkable. Be skeptical; default to honest uncertainty over false precision.

${item.author ? magnetFraming(dq, item.author) : filmFraming(dq)}

ANCHOR SOURCES — DEFER TO THE SPECIALISTS: If Quote Investigator (quoteinvestigator.com) OR Wikiquote's *sourced* section has already investigated this quote, treat their finding as the AUTHORITATIVE ANCHOR. Search QI first (site:quoteinvestigator.com "<key phrase>"). Cite QI/Wikiquote prominently (a trail item AND a Dig-deeper link), adopt their earliest-attestation and origin conclusion, and do NOT assert a different or earlier origin, a more confident attribution, or extra specificity (dates, editions, who-really-said-it) beyond what they document — unless you independently confirm it against a primary source you fetched. Where QI is uncertain or calls it apocryphal, MIRROR that: use "attributed" or "disputed" honestly rather than manufacturing a confident answer. quotle.info's value is a clean, structured, honestly-hedged answer built on the best existing research — never an overclaim past it.

ASSIGN confidence (drives the page):
 • "verified"  — you located the specific work (+ translation, if translated) that demonstrably contains this exact wording from this author.
 • "attributed" — credibly and widely credited to ${item.author || 'the source above'}, consistent with their work, but you could NOT pin the exact wording to a specific primary source, and it is not known to be wrong.
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
${item.author ? ` • attributed → label "Attributed to". authorName = ${item.author}. sourceLine = honest: widely credited; consistent with their work; but no primary source/translation pins this exact wording.
 • disputed  → label like "Not ${item.author} — a modern paraphrase" or "Not ${item.author} — actually {TrueName}". authorName = the TRUE originator (or ${item.author} if the THOUGHT is theirs but the WORDING is a paraphrase — then explain in sourceLine). sourceLine = the real story.`
  : ` • attributed → label "Attributed to". authorName = the writer it is credibly credited to. sourceLine = honest: widely credited but no transcript pins this exact wording.
 • disputed  → this is the WORDING-DRIFT case. Label "Not quite &mdash; the actual line is &hellip;" or "Misquoted &mdash; {Writer} wrote &hellip;". Do NOT write "Not {name} &mdash;": nobody is falsely credited here, the source is right and only the words drifted, and that label would accuse the wrong party. authorName = the WRITER of the real line. sourceLine = what was actually said, in which work, and how the popular version drifted.`}
answer.confidenceText: OMIT unless overriding the default.

author.*  = ABOUT THE TRUE AUTHOR${item.author ? ` (for verified/attributed that is ${item.author}; for disputed the hero/author is the TRUE originator when known, else ${item.author} if the idea is theirs)` : ' (here: the WRITER of the line — never the character, never the actor)'}. name, initials (e.g. "MA"), metaLine (PLAIN TEXT, e.g. "121–180 AD · Roman emperor & Stoic philosopher"), bio (2-3 sentences, may use <strong>/<em>).

source: docMeta (2-4 {dt,dd}; ddClass:"title" for a work title; include a "Translation" row when relevant), excerpt (the quote in fuller original context when one exists, else the quote), cutTag (optional), excerptNote (optional), artifact (ONLY if a real primary artifact exists; OMIT otherwise), sourceLink ({text,url} to the best primary/translation/chronology page), trail (2-4 HTML strings, INNER content only, each with an inline confirmed <a>), rights (see RIGHTS above), rightsHolder (when in-copyright/licensed), rightsNote (honest HTML note).

misattribution: INCLUDE whenever the quote is misattributed, fabricated, mis-worded, or commonly mis-credited (the typical angle for these magnet names). intro; items[{scope, who, tag?, why (HTML w/ inline source link)}]; truthLine (HTML w/ source link). OMIT only if genuinely none.

context: OPTIONAL why-it-mattered. lead[] (1-2 paragraphs), pull? (short pull-quote), detailsBody[] (optional).

externalLinks: 4-6 {label, host, url, what} — trusted archives / fact-checks / scholarship (e.g. Project Gutenberg, Wikisource, Internet Archive, Poetry Foundation, the author's collected works, Wikiquote, Quote Investigator), each confirmed relevant.

cite.sourceCitation (Chicago for the primary source + translation, or best-available "earliest documented in …"). cite.pageCitation exactly: Quotle.info. &ldquo;Who really said &lsquo;${dq.replace(/"/g,'')}&rsquo;?&rdquo; Last verified ${VERIFIED_DATE}.

meta.title = Who really said "${dq.replace(/"/g,'')}"? | Quotle.info  · meta.ogTitle = Who really said '${dq.replace(/"/g,'')}'?  · description/ogDescription ≤ 160 chars, specific and honest.

schema (optional): quotationText (full form), creatorName + creatorBirthDate + creatorJobTitle + creatorSameAs (Wikipedia URL), dateCreated, isPartOfName/isPartOfDatePublished/isPartOfSameAs — isPartOf is the work the sentence APPEARS IN (the book, essay, speech or article), not a translation it was derived from.

CITATION DISCIPLINE (a page fails audit on any of these):
 • Do NOT add specificity beyond what your linked source literally states — no translator/edition/date, Wikiquote section label ("Misattributed" vs "Disputed"), volume/page, or exact variant-swap UNLESS the source you attach contains that exact detail. Verify translation names/dates by reading the actual edition or a catalog record.
 • If a point is your OWN inference, state it as a plain observation; attach a link only for what that link actually says.
 • answer.authorDates and author.metaLine are PLAIN TEXT — no tags; entities like &middot; &ndash; are fine.
 • source.sourceLink.text and artifact.linkText must NOT end with ↗ or any arrow — the renderer adds it.
 • copyAttribution (if provided) is PLAIN TEXT for the clipboard — literal Unicode (— ' ' " "), NO HTML tags, NO named entities.

THE FOUR THAT KEEP FAILING (every one of these was a real audit FAIL on a recent wave — they are the reason the fix stage is expensive, so read them twice):
 • NEVER COMPUTE a duration, interval, or age from a date you have not verified. "twenty-two years later", "a decade before", "in his sixties" — if the underlying date is not confirmed in a source you fetched, do not write the derived figure at all. A wave shipped "twenty-two years" computed from an unsupported 1984 date while three other places on the same page implied 2010.
 • A RESEARCH HEADLINE IS NOT A PERIOD QUOTATION. Quote Investigator and Wikiquote write their own summary headings; those are the researcher's words, not the historical source's. Never put a QI/Wikiquote heading in typographic quotes and pin it to a newspaper, book or speaker. If you cite a period wording, it must be one the source literally transcribes.
 • DO NOT CLAIM "earliest documented" UNLESS your source says so. If QI lists earlier attestations than the one you are about to call earliest, you are contradicting the very page you are linking. A wave asserted a Jan-1974 "earliest documented spoken version" inside a copy-pasteable citation while the Popik page linked three times on that same page documented 1971 and 1973.
 • THE PAGE MUST AGREE WITH ITSELF. Before returning, re-read your own dossier as one document: every date, year, span and attribution must be consistent across answer, source, misattribution, context and copyAttribution. A single page contradicting itself is the most damaging defect here, because the citation is designed to be copied and travel.

Return the dossier via the structured schema. Do not invent sources or translations; if you cannot verify a primary source, choose "attributed" or "disputed" and set rights honestly ("uncertain" when the wording's origin is unknown).`
}

phase('Research')

const records = (await parallel(items.map((it) => () =>
  agent(researchPrompt(it), { label: `research:${it.author ? it.author.split(' ').pop() : String(it.text).slice(0, 18)}#${it.index}`, phase: 'Research', schema: DOSSIER_SCHEMA, effort: 'high' })
    .then((d) => (d ? { record: toRecord(d, it), confidence: d.confidence, reason: d.confidenceReason, rights: (d.source && d.source.rights) || '?', verifiedCount: (d.sourcesVerified || []).length, author: d.author.name, index: it.index } : null))
))).filter(Boolean)

log(`Generated ${records.length}/${items.length} records. States: ${records.map((r) => r.confidence).join(', ')}`)

return {
  records: records.map((r) => r.record),
  summaries: records.map((r) => ({ index: r.index, slug: r.record.quoteSlug, confidence: r.confidence, rights: r.rights, trueAuthor: r.author, verifiedSources: r.verifiedCount, reason: r.reason })),
}
