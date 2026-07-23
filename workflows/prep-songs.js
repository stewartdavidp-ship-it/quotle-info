#!/usr/bin/env node
'use strict';
/*
 * prep-songs.js — turn a generate-songs.js workflow run into ingest-ready song records.
 * The songs equivalent of workflows/prep-wave.js. Run AFTER the generate-songs workflow completes.
 *
 *   node workflows/prep-songs.js \
 *     --journal <transcriptDir>/journal.jsonl \    (from the Workflow launch result's "Transcript dir")
 *     --batch   data/.song-batch-sN.json \          (the batch fed to generate-songs)
 *     --out     workflows/.scratch/songs-sN.json \
 *     --verified-date "22 Jul 2026" --date-modified "2026-07-22"
 *
 * Why reconstruct from the JOURNAL and not the workflow's return value: the task-notification
 * <result> is TRUNCATED for big waves. The journal's per-agent {type:'result'} lines hold the raw
 * DOSSIER (pre-toRecord), so we re-apply toRecord here, matching each dossier to its batch item via
 * meta.ogTitle. (toRecord is duplicated from workflows/generate-songs.js — keep the two in sync.)
 *
 * Safety passes:
 *   1. ESCAPING SCAN — some agents double-escape HTML (&lt;a, &amp;mdash); unescape one level.
 *   2. STUB DETECTION — some agents return schema-valid PLACEHOLDER junk; exclude them.
 *   3. LYRIC SCAN — surface any quoted run that looks like a lyric line BEFORE it reaches a record.
 *      tools/validate-songs.js does this at build time too; catching it here means the fix is a
 *      re-generate rather than a hand-edit of a written record.
 *   4. AXIS CHECK — a song record with no `original` author card and no `cover` author card has
 *      nothing to say; validate-songs.js fails the build on it, so fail here where it is cheap.
 */
const fs = require('fs');
const path = require('path');

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : def; }
const has = (name) => process.argv.includes('--' + name);
const JOURNAL = arg('journal');
const BATCH = arg('batch');
const OUT = arg('out');
const VERIFIED_DATE = arg('verified-date', '');
const DATE_MODIFIED = arg('date-modified', '');
if (!JOURNAL || !BATCH || !OUT) { console.error('usage: prep-songs.js --journal <journal.jsonl> --batch <batch.json> --out <songs.json> --verified-date "D Mon YYYY" --date-modified "YYYY-MM-DD"'); process.exit(1); }
if (!VERIFIED_DATE || !DATE_MODIFIED) { console.error('ERROR: pass --verified-date and --date-modified (must match what generate-songs.js was launched with).'); process.exit(1); }

// The journal is appended LIVE. Reading it mid-run yields a fraction of the wave and looks exactly
// like a small successful run. Same gate the quote pipeline uses, same reason.
require('./_journal').assertComplete(JOURNAL, { allowPartial: has('allow-partial'), label: 'generate-songs journal' });

const norm = (s) => String(s).toLowerCase().replace(/[’‘`"“”']/g, '').replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const { slugify } = require(path.join(__dirname, '..', 'tools', 'slugify.js'));
const initialsOf = (name) => String(name).replace(/&[a-z]+;/g, '').split(/\s+/)
  .filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

// --- toRecord: VERBATIM from workflows/generate-songs.js (keep in sync) ---
function toRecord(d, item) {
  const oSlug = slugify(item.originalArtist);
  const rec = {
    songSlug: item.songSlug, title: item.title, confidence: d.confidence, creditedTo: item.creditedTo,
    lastVerified: VERIFIED_DATE, dateModified: DATE_MODIFIED,
    meta: { title: d.meta.title, description: d.meta.description, ogTitle: d.meta.ogTitle, ogDescription: d.meta.ogDescription },
    answer: { kicker: 'Who recorded it first', label: d.answer.label, originalArtist: item.originalArtist, originalArtistSlug: oSlug, originalArtistDates: d.answer.artistDates, sourceLine: d.answer.sourceLine, lastVerified: VERIFIED_DATE },
    original: {
      kicker: 'The record', heading: 'Who recorded it first', artist: item.originalArtist, year: String(item.originalYear),
      label: item.originalLabel || d.original.label || '', released: d.original.released, charted: d.original.charted,
      writer: item.writer, cover: d.original.cover, docMeta: d.original.docMeta,
      trailTitle: d.original.trailTitle || 'How we traced it', trail: d.original.trail,
    },
    externalLinks: d.externalLinks,
    authors: (d.authors || []).map((a) => ({ name: a.name, slug: slugify(a.name), initials: a.initials || initialsOf(a.name), kicker: a.kicker, heading: a.heading || ('About ' + a.name), metaLine: a.metaLine, role: a.role, bio: a.bio })),
    misattribution: { kicker: 'Fact-check', heading: d.misattribution.heading || 'The attribution problem', intro: d.misattribution.intro, items: d.misattribution.items, truthLine: d.misattribution.truthLine },
    context: { kicker: 'Context', heading: d.context.heading || 'Why the cover ate the original', lead: d.context.lead, detailsSummary: d.context.detailsSummary || 'The creators, in order', detailsBody: d.context.detailsBody || [] },
    rights: {
      note: (d.rightsNote ? d.rightsNote + ' ' : '') +
        'This page states authorship and recording history &mdash; who wrote the song and who recorded it first &mdash; and does not reproduce any lyrics. Song titles are not copyrightable; the composition and the recordings are, and remain the rights of their owners. Nothing here is a grant of reuse rights, and this is not legal advice.',
    },
    themes: d.themes || [],
    schema: {
      recordingName: item.title, byArtist: { name: item.originalArtist }, datePublished: String(item.originalYear),
      composer: { name: item.writer }, coverArtist: item.coverArtist, coverYear: String(item.coverYear), webPageName: d.meta.ogTitle,
    },
  };
  if (d.context.pull) rec.context.pull = d.context.pull;
  if (d.original.sourceLink) rec.original.sourceLink = d.original.sourceLink;
  if (d.listen && d.listen.url) rec.listen = d.listen;
  if (Array.isArray(d.sameAs) && d.sameAs.length) rec.sameAs = d.sameAs;
  return rec;
}

const batch = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
// Match on TITLE, extracted from meta.ogTitle ("Who originally recorded 'X'?"). The dossier has no
// songSlug — it is not in the output schema, because the batch already knows it and schema bytes are
// the scarcest resource in this pipeline (see SONG_DOSSIER_SCHEMA).
const byTitle = new Map();
for (const b of batch) {
  const k = norm(b.title);
  if (!byTitle.has(k)) byTitle.set(k, []);
  byTitle.get(k).push(b);
}
const extractTitle = (og) => String(og || '')
  .replace(/^Who originally recorded\s*/i, '').replace(/\?\s*$/, '')
  .replace(/^[‘'"“]/, '').replace(/[’'"”]$/, '');

const dossiers = [];
for (const l of fs.readFileSync(JOURNAL, 'utf8').trim().split('\n')) {
  let j; try { j = JSON.parse(l); } catch (e) { continue; }
  if (j.type !== 'result' || !j.result || !j.result.meta || !j.result.answer) continue;
  dossiers.push(j.result);
}
console.log('dossiers:', dossiers.length);
if (dossiers.length < batch.length && !has('allow-partial')) {
  console.error(`\n  ✗ ${dossiers.length} dossiers for a ${batch.length}-song batch — ${batch.length - dossiers.length} missing.\n`);
  console.error('      Building this would silently ship a FRACTION of the wave, and the missing songs');
  console.error('      would stay marked "selected" in data/song-queue.json with no page.');
  console.error('      Check the generate-songs workflow actually finished, then re-run.');
  console.error('      If some agents genuinely failed and you accept the shortfall: --allow-partial\n');
  process.exit(1);
}

const records = []; const unmatched = [];
for (const d of dossiers) {
  const t = extractTitle(d.meta.ogTitle);
  const hits = byTitle.get(norm(t)) || [];
  if (hits.length === 1) { records.push(toRecord(d, hits[0])); continue; }
  if (hits.length > 1) {
    // Two batch items with the same title (different crediting acts). Guessing would attach a whole
    // researched page to the wrong song, so refuse and name it.
    unmatched.push(`${d.meta.ogTitle}  [AMBIGUOUS — ${hits.length} batch items titled "${t}"; split the wave]`);
    continue;
  }
  // Fuzzy fallback, guarded at >=12 chars so a degenerate stub ogTitle cannot misroute onto a real
  // batch item (the r16 bug in the quote pipeline).
  const nt = norm(t);
  let b = null;
  if (nt.length >= 12) b = batch.find((x) => { const nx = norm(x.title); return nx.startsWith(nt.slice(0, 30)) || nt.startsWith(nx.slice(0, 30)); });
  if (b) records.push(toRecord(d, b)); else unmatched.push(d.meta.ogTitle);
}

// DEDUPE by slug — a RESUMED generate (Workflow resumeFromRunId) appends to the SAME journal, so
// every cached replay emits a second identical result line. Last wins.
const bySlug = new Map();
for (const r of records) bySlug.set(r.songSlug, r);
const deduped = [...bySlug.values()];
if (deduped.length !== records.length) {
  console.log('deduped:', records.length, '→', deduped.length, 'records (journal holds a resumed run — expected, not an error)');
  records.length = 0; records.push(...deduped);
}
console.log('records built:', records.length, '| unmatched (likely stubs):', unmatched.length);
unmatched.slice(0, 6).forEach((u) => console.log('   ?', u));

// 1. escaping scan
const SIG = /&lt;a|&lt;strong|&lt;em|&lt;\/|&amp;mdash|&amp;rsquo|&amp;lsquo|&amp;ldquo|&amp;rdquo|&amp;nbsp|&amp;middot/;
const unesc1 = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
let fixed = 0;
const cleaned = records.map((r) => { const s = JSON.stringify(r); if (SIG.test(s)) { fixed++; return JSON.parse(unesc1(s)); } return r; });
console.log('escaping-fixed records:', fixed, '| still dirty:', cleaned.filter((r) => SIG.test(JSON.stringify(r))).length);

// 2. stub detection
const isStub = (r) => {
  const t = (r.meta && r.meta.title) || '', sl = (r.answer && r.answer.sourceLine) || '';
  const bio = (r.authors && r.authors[0] && r.authors[0].bio) || '', rel = (r.original && r.original.released) || '';
  const shortish = [t, sl, bio, rel].filter((x) => String(x).trim().length < 6).length;
  return shortish >= 2 || /^\s*(test|todo)\s*$/i.test(sl) || String(bio).trim().toLowerCase() === 'test';
};
const stubs = cleaned.filter(isStub);
let good = cleaned.filter((r) => !isStub(r));
if (stubs.length) console.log('STUB/placeholder records EXCLUDED:', stubs.length, stubs.map((r) => r.songSlug));

// 3. LYRIC SCAN — same heuristic as tools/validate-songs.js: a quoted run of >=4 words that is not
// Title Case. It cannot decide "is this a lyric" (these records legitimately quote speech), so it
// WARNS rather than excluding — but it warns HERE, where the fix is a cheap re-generate.
const QUOTED = /&lsquo;([^&]{2,80})&rsquo;/g;
const lyricHits = [];
const walk = (node, p, slug) => {
  if (typeof node === 'string') {
    let m; const re = new RegExp(QUOTED.source, 'g');
    while ((m = re.exec(node))) {
      const words = m[1].trim().split(/\s+/);
      if (words.length < 4) continue;
      if (words.filter((w) => /^[A-Z(]/.test(w)).length / words.length >= 0.5) continue;
      lyricHits.push(`${slug} · ${p} — “${m[1].trim()}”`);
    }
  } else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${p}[${i}]`, slug));
  else if (node && typeof node === 'object') for (const k of Object.keys(node)) walk(node[k], p ? `${p}.${k}` : k, slug);
};
good.forEach((r) => walk(r, '', r.songSlug));
if (lyricHits.length) {
  console.log(`\n  ⚠ LYRIC REVIEW — ${lyricHits.length} quoted phrase(s) need a human eye before ingest:`);
  lyricHits.forEach((h) => console.log('     ? ' + h));
  console.log('     Confirm each is quoted SPEECH or a work TITLE, not a lyric line. NO LYRICS is the site\'s core legal position.\n');
}

// 4. axis check — validate-songs.js fails the build without both sides of the misattribution, so
// catch it here rather than after ingest has written the file.
const brokenAxis = good.filter((r) => {
  const roles = (r.authors || []).map((a) => a.role);
  return !roles.includes('original') || !roles.includes('cover');
});
if (brokenAxis.length) {
  console.error(`\n  ✗ ${brokenAxis.length} record(s) missing an author card with role "original" and/or "cover":`);
  brokenAxis.forEach((r) => console.error(`     - ${r.songSlug}  (roles: ${(r.authors || []).map((a) => a.role).join(', ') || 'none'})`));
  console.error('      These would fail validate-songs.js and abort the build. Re-generate them.\n');
  good = good.filter((r) => !brokenAxis.includes(r));
}

// 4b. WRITER-ROLE CHECK — the author roles are a closed set (original / cover / writer), and agents
// treat the third slot as "one more interesting person" rather than "the songwriter". Wave s1 shipped
// Rico Rodriguez (a session trombonist) and The Yardbirds (an intermediate cover act) as role
// "writer"; the Rodriguez card's own bio said he was NOT the writer, so it contradicted its own
// label. validate-songs.js cannot see this — it only checks the role is in the allowed set.
// Heuristic, so it WARNS rather than excluding: a writer may legitimately be credited under a
// different name than the record's writer string.
const normName = (s) => String(s).toLowerCase().replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['the', 'and', 'his', 'her', 'band', 'orchestra', 'brothers']);
const roleMismatch = [];
for (const r of good) {
  for (const a of (r.authors || [])) {
    if (a.role !== 'writer') continue;
    const w = normName(r.original.writer || '');
    const words = normName(a.name).split(' ').filter((x) => x.length >= 4 && !STOP.has(x));
    if (words.length && !words.some((x) => w.includes(x))) {
      roleMismatch.push(`${r.songSlug} · "${a.name}" is carded as role "writer", but the record's writer is "${r.original.writer}"`);
    }
  }
}
if (roleMismatch.length) {
  console.log(`\n  ⚠ WRITER-ROLE REVIEW — ${roleMismatch.length} card(s) look mislabelled:`);
  roleMismatch.forEach((m) => console.log('     ? ' + m));
  console.log('     The third author card is for the SONGWRITER. A producer, session player, label boss or');
  console.log('     intermediate cover act belongs in the prose (context / misattribution), not an author card.\n');
}

const conf = {}; for (const r of good) conf[r.confidence] = (conf[r.confidence] || 0) + 1;
console.log('confidences:', JSON.stringify(conf));

// 5. LISTEN / SAMEAS REPORT — surfaced for a human, never auto-approved. Whether a link is the
// ORIGINAL recording (and not a later re-recording on the same artist's official channel) cannot be
// decided mechanically: the last research pass caught a 2003 re-cut, a set of 1995/2009/2022
// re-recordings and a 2002 re-do that all sat on legitimate channels under the original's name, and
// only a duration cross-check against MusicBrainz separated them. So print every proposed link with
// the provenance the agent claimed, and make the omissions visible too — an absent link is a valid
// outcome (4 of the first 27 correctly have none), but it should be a noticed one.
const withListen = good.filter((r) => r.listen && r.listen.url);
const noListen = good.filter((r) => !r.listen || !r.listen.url);
console.log(`\nlisten links: ${withListen.length}/${good.length} proposed — CHECK EACH before ingest:`);
withListen.forEach((r) => {
  console.log(`   ♪ ${r.songSlug}`);
  console.log(`       ${r.listen.url}`);
  console.log(`       what:   ${r.listen.what || '(missing)'}`);
  console.log(`       source: ${r.listen.source || '(missing — validate-songs will warn)'}`);
});
if (noListen.length) console.log(`   (no link: ${noListen.map((r) => r.songSlug).join(', ')} — fine if no legitimate official copy of the ORIGINAL exists)`);
const noSameAs = good.filter((r) => !Array.isArray(r.sameAs) || !r.sameAs.length);
if (noSameAs.length) console.log(`sameAs missing on: ${noSameAs.map((r) => r.songSlug).join(', ')} — prefer a MusicBrainz recording MBID for the original + the Wikidata QID`);
console.log('');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(good, null, 2));
const redo = [...stubs.map((r) => r.title), ...brokenAxis.map((r) => r.title), ...unmatched];
if (redo.length) fs.writeFileSync(OUT.replace(/songs/, 'songs-redo'), JSON.stringify(redo, null, 2));
console.log('wrote', OUT, `(${good.length} good)`, redo.length ? `+ songs-redo (${redo.length} to re-generate)` : '');
if (!good.length) { console.error('nothing usable to ingest'); process.exit(1); }
