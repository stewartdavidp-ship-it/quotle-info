#!/usr/bin/env node
'use strict';
/*
 * prep-wave.js — turn a generate.js workflow run into ingest-ready records. DURABLE + reusable
 * (replaces the per-wave prep-rN.js scripts that used to live in gitignored .scratch and got lost
 * on context compaction). Run AFTER the generate workflow completes.
 *
 *   node workflows/prep-wave.js \
 *     --journal <transcriptDir>/journal.jsonl \   (from the Workflow launch result's "Transcript dir")
 *     --batch   data/.harvest-batch-rN.json \      (the batch fed to generate)
 *     --out     workflows/.scratch/records-rN.json \
 *     --verified-date "10 Jul 2026" --date-modified "2026-07-10" \
 *     [--credited]                                 (stamp creditedTo = batch author; TRACK A only —
 *                                                   OMIT for track B / genuine-famous PD greats)
 *
 * Why reconstruct from the JOURNAL and not the workflow's return value: the task-notification
 * <result> is TRUNCATED for big waves. The journal's per-agent {type:'result'} lines hold the raw
 * DOSSIER (pre-toRecord), so we re-apply toRecord here, matching each dossier to its batch item via
 * meta.ogTitle. (toRecord is duplicated from workflows/generate.js — keep the two in sync.)
 *
 * It does three safety passes the pipeline depends on:
 *   1. ESCAPING SCAN — some agents double-escape HTML (&lt;a, &amp;mdash); unescape one level per
 *      flagged record before ingest (the r9/r13 pitfall).
 *   2. STUB DETECTION — some agents return schema-valid PLACEHOLDER junk (meta.title "t",
 *      sourceLine "test"); exclude them (→ stubs-*.json) so you can re-generate just those.
 *   3. creditedTo stamping (track A) — for the author-page "misattributed to X" feature.
 * Writes records-*.json (ingest with tools/_ingest.js) + audit-args-*.json (feed to workflows/audit.js).
 */
const fs = require('fs');
const { kindForRow } = require('./../tools/mis-kind');
const path = require('path');

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : def; }
const has = (name) => process.argv.includes('--' + name);
const JOURNAL = arg('journal');
const BATCH = arg('batch');
const OUT = arg('out');
const VERIFIED_DATE = arg('verified-date', '');
const DATE_MODIFIED = arg('date-modified', '');
const STAMP_CREDITED = has('credited');
if (!JOURNAL || !BATCH || !OUT) { console.error('usage: prep-wave.js --journal <journal.jsonl> --batch <batch.json> --out <records.json> --verified-date "D Mon YYYY" --date-modified "YYYY-MM-DD" [--credited]'); process.exit(1); }
if (!VERIFIED_DATE || !DATE_MODIFIED) { console.error('ERROR: pass --verified-date and --date-modified (must match what generate.js was launched with).'); process.exit(1); }

// The journal is appended LIVE. Reading it mid-run yields a fraction of the wave and looks like
// success — r23 got "dossiers: 2" from a 10-quote batch this way. Abort unless every started agent
// has reported. --allow-partial to override on a run where an agent genuinely died.
require('./_journal').assertComplete(JOURNAL, { allowPartial: has('allow-partial'), label: 'generate journal' });

// Quote/apostrophe ENTITIES must normalize exactly like their literal characters — DELETED, not
// spaced. Agents write ogTitle in either form (house style is entities, but most emit ASCII), and
// the generic `&[a-z]+;` → ' ' rule below is right for &ndash;/&mdash; and wrong for &rsquo;:
// it turned "don&rsquo;t" into "don t" while a literal "don't" became "dont", so the two forms of
// the SAME character could never match. r29 lost a complete, correct record that way — the Burke/
// Santayana "doomed to repeat it" dossier was reported as an unmatched stub and would have shipped
// the wave 39/40. Delete the quote entities FIRST, then let the generic rule handle the rest.
const norm = (s) => String(s).toLowerCase().replace(/&(?:rsquo|lsquo|apos|quot|ldquo|rdquo|#8216|#8217|#39|#34);/g, '').replace(/[’‘`"“”']/g, '').replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
// slugify lives in tools/slugify.js — generate.js inlines a verbatim copy (sandbox, no require).
const { slugify, authorSlugOf } = require(path.join(__dirname, '..', 'tools', 'slugify.js'));

// --- toRecord: VERBATIM from workflows/generate.js (keep in sync) ---
function toRecord(d, item) {
  const displayQuote = String(item.text).replace(/\s*\.\s*$/, '');
  const quoteSlug = slugify(displayQuote);
  const aSlug = authorSlugOf(d.author.name);
  const rec = {
    quoteSlug, dayNumber: item.index, confidence: d.confidence, displayQuote,
    meta: { title: d.meta.title, version: '0.4.0-proto', description: d.meta.description, ogTitle: d.meta.ogTitle, ogDescription: d.meta.ogDescription },
    answer: { kicker: 'Who really said it', label: d.answer.label, authorName: d.answer.authorName, authorHref: '/authors/' + aSlug, authorDates: d.answer.authorDates, sourceLine: d.answer.sourceLine, lastVerified: VERIFIED_DATE },
    source: { kicker: 'Provenance', heading: d.source.heading || 'The source', docMeta: d.source.docMeta, excerpt: d.source.excerpt, trailTitle: d.source.trailTitle || 'How we verified this', trail: d.source.trail },
    externalLinks: d.externalLinks,
    author: { name: d.author.name, slug: aSlug, initials: d.author.initials, kicker: d.author.kicker || 'The author', heading: d.author.heading || ('About ' + d.author.name), metaLine: d.author.metaLine, bio: d.author.bio },
    cite: { sourceLabel: d.cite.sourceLabel || 'The primary source (Chicago)', sourceCitation: d.cite.sourceCitation, pageCitation: d.cite.pageCitation },
  };
  if (d.answer.confidenceText) rec.answer.confidenceText = d.answer.confidenceText;
  if (d.source.cutTag) rec.source.cutTag = d.source.cutTag;
  if (d.source.excerptNote) rec.source.excerptNote = d.source.excerptNote;
  if (d.source.artifact) rec.source.artifact = d.source.artifact;
  if (d.source.sourceLink) rec.source.sourceLink = d.source.sourceLink;
  if (d.source.rights && d.source.rights !== 'uncertain') { rec.source.rights = d.source.rights; if (d.source.rightsHolder) rec.source.rightsHolder = d.source.rightsHolder; }
  if (d.source.rightsNote) rec.source.rightsNote = d.source.rightsNote;
  if (d.copyAttribution) rec.copyAttribution = d.copyAttribution;
  if (d.misattribution) {
    // Stamp `kind` from the row's own tag. template.js defaults a row to the burgundy ✕ ("this
    // credit is refuted"), so a row tagged "paraphrase" or "Popularizer, not author" shipped a
    // marker contradicting the text beside it. 301 rows across 274 records had accumulated that way
    // before anything noticed. Doing it HERE is what stops the backfill decaying: the rule lives in
    // tools/mis-kind.js and is shared with tools/backfill-mis-kind.js, so a wave cannot reintroduce
    // the gap. Unrecognised tags keep the default ✕ and stay a human call — marking a genuine
    // refutation as context would soften a debunk, which is worse than the marker being wrong.
    const items = (d.misattribution.items || []).map((it) => (
      it.kind || !kindForRow(it) ? it : { ...it, kind: kindForRow(it) }));
    rec.misattribution = { kicker: 'Fact-check', heading: d.misattribution.heading || 'Often misattributed', intro: d.misattribution.intro, items, truthLine: d.misattribution.truthLine };
  }
  if (d.context) { rec.context = { kicker: 'Context', heading: d.context.heading || 'Why it mattered', lead: d.context.lead, detailsSummary: d.context.detailsSummary || 'Read the full story', detailsBody: d.context.detailsBody || [] }; if (d.context.pull) rec.context.pull = d.context.pull; }
  if (d.schema) {
    const sc = d.schema, out = {};
    if (sc.quotationText) out.quotationText = sc.quotationText;
    if (sc.alternateName) out.alternateName = sc.alternateName;
    if (sc.creatorName) { out.creator = { name: sc.creatorName }; if (sc.creatorBirthDate) out.creator.birthDate = sc.creatorBirthDate; if (sc.creatorJobTitle) out.creator.jobTitle = sc.creatorJobTitle; if (sc.creatorSameAs) out.creator.sameAs = sc.creatorSameAs; }
    if (sc.dateCreated) out.dateCreated = sc.dateCreated;
    // isPartOf = the work the sentence is CONTAINED IN. Renamed from isBasedOn* 2026-07-30 — see the
    // long note at the same spot in workflows/generate.js. KEEP THESE TWO IN SYNC.
    if (sc.isPartOfName) { out.isPartOf = { type: 'CreativeWork', name: sc.isPartOfName }; if (sc.isPartOfDatePublished) out.isPartOf.datePublished = sc.isPartOfDatePublished; if (sc.isPartOfSameAs) out.isPartOf.sameAs = sc.isPartOfSameAs; }
    out.webPageName = d.meta.ogTitle; out.dateModified = DATE_MODIFIED;
    // The line in circulation differs from the documented sentence: carry BOTH, so Quotation.text can
    // hold what the source actually says while the ClaimReview rates the paraphrase people repeat.
    // Keep in sync with generate.js toRecord.
    //
    // This was gated on `!item.author` — i.e. track C (film) batches only — so a magnet-author batch
    // could never produce it, and that is a property of the TRACK, not of the quote. The wording of a
    // Franklin line drifts exactly the same way whether the wave harvested it by author or by film.
    // (The banner that made this visible no longer depends on the field at all — see
    // rightPersonWrongWords in tools/template.js — but the kit label and the two-string ClaimReview
    // still do, and a generator that structurally cannot emit a valid field is a bug either way.)
    if (out.quotationText && displayQuote !== out.quotationText) out.claimQuoteText = displayQuote;
    rec.schema = out;
  }
  // themes now come from the RESEARCHING agent (schema-enforced, 2-4 from the fixed vocabulary),
  // which removes the separate tag-themes workflow stage. Older journals predate this, so tolerate
  // absence rather than writing an empty array the theme pages would treat as tagged.
  if (Array.isArray(d.themes) && d.themes.length) rec.themes = d.themes;
  return rec;
}

const batch = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
const byNorm = {}; for (const b of batch) byNorm[norm(b.text)] = b;
const extractDq = (og) => String(og || '').replace(/^Who really said\s*/i, '').replace(/\?\s*$/, '').replace(/^[‘'"“]/, '').replace(/[’'"”]$/, '');

const dossiers = [];
for (const l of fs.readFileSync(JOURNAL, 'utf8').trim().split('\n')) {
  let j; try { j = JSON.parse(l); } catch (e) { continue; }
  if (j.type !== 'result' || !j.result || !j.result.meta || !j.result.author) continue;
  dossiers.push(j.result);
}
console.log('dossiers:', dossiers.length);
// The batch says how many quotes this wave asked for. Fewer dossiers than that means either a
// partial journal (caught above) or agents that returned nothing usable — either way the wave is
// short, and shipping it silently drops quotes that stay marked "selected" in the backlog.
// State it as a hard stop, not a line of output someone has to notice.
if (dossiers.length < batch.length && !has('allow-partial')) {
  console.error(`\n  ✗ ${dossiers.length} dossiers for a ${batch.length}-quote batch — ${batch.length - dossiers.length} missing.\n`);
  console.error('      Building this would silently ship a FRACTION of the wave.');
  console.error('      Check the generate workflow actually finished, then re-run.');
  console.error('      If some agents genuinely failed and you accept the shortfall: --allow-partial\n');
  process.exit(1);
}

const records = []; const unmatched = [];
for (const d of dossiers) {
  const dq = extractDq(d.meta.ogTitle);
  let b = byNorm[norm(dq)];
  if (!b) { // fuzzy fallback — REQUIRE >=12 chars so a degenerate ogTitle ("o") can't misroute (r16 bug)
    const nd = norm(dq);
    if (nd.length >= 12) b = batch.find((x) => { const nx = norm(x.text); return nx.startsWith(nd.slice(0, 30)) || nd.startsWith(nx.slice(0, 30)); });
  }
  if (!b) { unmatched.push(d.meta.ogTitle); continue; }
  // index → dayNumber. Carry the batch's index instead of dropping it: track-D candidates come
  // from the Quotle game and own a slot there, and dayNumber is what the game resolves its
  // provenance link through. Null for tracks A/B, where the batch has no index — which is why
  // this was hardcoded null and got away with it until the first track-D wave.
  const rec = toRecord(d, { text: b.text, author: b.author, index: b.index ?? null });
  // Only stamp a magnet that EXISTS. Track C (film) batches carry author '' for wording-drift lines,
  // where nobody is falsely credited; stamping creditedTo:'' there would write a junk field claiming
  // a magnet, and one mixed wave can legitimately hold both shapes (a misquote next to a screen line
  // genuinely pinned on Conan Doyle), so this is per-record, not a per-wave flag.
  //
  // …and only stamp a magnet the record does not itself name as the AUTHOR. `creditedTo` means
  // "falsely credited to" (tools/credits.js). A track A wave asks one magnet author for candidates
  // and gets back three shapes, not one: real misattributions, quotes the magnet genuinely said
  // (harvest calls these genuine-famous), and right-person-wrong-words lines where the person is
  // right and only the wording drifted. Stamping unconditionally wrote a false misattribution claim
  // on the last two — 41 records carry one today, and on the disputed ones it was the input that
  // made the slide-kit banner contradict the page's own prose. The dossier already states the
  // verdict in answer.authorName; consult it. (Reported 2026-07-28 and 2026-07-29.)
  //
  // Compared on the LEADING name, the same split template.js uses: a card reading
  // "The Buddha (Siddhārtha Gautama)" or "Seneca the Younger" must not slip a self-credit through on
  // a punctuation difference.
  const leadName = (s) => String(s || '').split(/\s*[—–(,]|\s-\s/)[0].trim().toLowerCase();
  if (STAMP_CREDITED && b.author && leadName(rec.answer.authorName) !== leadName(b.author)) rec.creditedTo = b.author;
  records.push(rec);
}
// DEDUPE by slug. A RESUMED generate (Workflow resumeFromRunId — the sanctioned recovery for a
// usage-limit or transient API failure) appends to the SAME journal, so every agent that replayed
// from cache now has TWO identical {type:result} lines. Left alone that doubles the record count,
// and audit-args bills to adversarially audit each duplicated page twice. Last wins: for the agents
// that actually re-ran, the resume's result is the real one (the original attempt died before
// emitting a line, so it appears once anyway); for cached replays the two lines are identical.
const bySlug = new Map();
for (const r of records) bySlug.set(r.quoteSlug, r);
const deduped = [...bySlug.values()];
if (deduped.length !== records.length) {
  console.log('deduped:', records.length, '→', deduped.length, 'records (journal holds a resumed run — expected, not an error)');
  records.length = 0; records.push(...deduped);
}
console.log('records built:', records.length, '| unmatched (likely stubs):', unmatched.length, unmatched.slice(0, 6));

// 1. escaping scan
const SIG = /&lt;a|&lt;strong|&lt;em|&lt;\/|&amp;mdash|&amp;rsquo|&amp;lsquo|&amp;ldquo|&amp;rdquo|&amp;nbsp|&amp;middot/;
const unesc1 = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
let fixed = 0;
let cleaned = records.map((r) => { const s = JSON.stringify(r); if (SIG.test(s)) { fixed++; return JSON.parse(unesc1(s)); } return r; });
console.log('escaping-fixed records:', fixed, '| still dirty:', cleaned.filter((r) => SIG.test(JSON.stringify(r))).length);

// 2. stub detection
const isStub = (r) => {
  const t = (r.meta && r.meta.title) || '', sl = (r.answer && r.answer.sourceLine) || '', bio = (r.author && r.author.bio) || '', ex = (r.source && r.source.excerpt) || '';
  const shortish = [t, sl, bio, ex].filter((x) => String(x).trim().length < 6).length;
  return shortish >= 2 || /^\s*(test|todo)\s*$/i.test(sl) || String(bio).trim().toLowerCase() === 'test';
};
const stubs = cleaned.filter(isStub); const good = cleaned.filter((r) => !isStub(r));
if (stubs.length) console.log('STUB/placeholder records EXCLUDED:', stubs.length, stubs.map((r) => r.quoteSlug));

const conf = {}; for (const r of good) conf[r.confidence] = (conf[r.confidence] || 0) + 1;
console.log('confidences:', JSON.stringify(conf), '| creditedTo stamped:', good.filter((r) => r.creditedTo).length);

fs.writeFileSync(OUT, JSON.stringify(good, null, 2));
const auditArgs = good.map((r) => ({ slug: r.quoteSlug, confidence: r.confidence, rights: (r.source && r.source.rights) || 'prose-only' }));
const auditOut = OUT.replace(/records/, 'audit-args').replace(/\.json$/, '.json');
fs.writeFileSync(auditOut, JSON.stringify(auditArgs));
const stubQuotes = [...stubs.map((r) => r.displayQuote), ...unmatched];
if (stubQuotes.length) fs.writeFileSync(OUT.replace(/records/, 'stubs'), JSON.stringify(stubQuotes, null, 2));
console.log('wrote', OUT, '(' + good.length + ' good) +', path.basename(auditOut), stubQuotes.length ? ('+ stubs (' + stubQuotes.length + ' to re-generate)') : '');
