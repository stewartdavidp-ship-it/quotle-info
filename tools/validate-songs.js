#!/usr/bin/env node
'use strict';
/*
 * validate-songs.js — the gate song records never had.
 *
 * Quote records have validate-records.js. Song records had NOTHING: all 27 were written straight
 * into data/songs/ by build agents, so an entire content type entered the corpus without a single
 * automated check on its shape, its vocabulary, or the one rule that actually carries legal
 * weight — no lyrics.
 *
 *   node tools/validate-songs.js            # whole song corpus
 *   node tools/validate-songs.js --quiet    # only problems (used as a pre-build gate)
 *
 * Exits 1 on any failure so it can gate a build or an ingest.
 */
const fs = require('fs');
const path = require('path');
const { scanRecord } = require('./html-safety');
const { THEMES } = require('./themes');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'songs');
const QUIET = process.argv.includes('--quiet');
const THEME_IDS = new Set(THEMES.map((t) => t.slug));

// Every field the renderer (build-songs.js) dereferences. A missing one is a broken page, not a
// cosmetic gap, so these are failures rather than warnings. The list is now AXIS-AWARE: a record
// carries a recording axis (/who-recorded/), a writing axis (/who-wrote/), or both, and each axis's
// renderer derefs its own fields. BASE holds fields both renderers need.
const BASE_REQUIRED = ['songSlug', 'title', 'confidence', 'creditedTo', 'meta', 'authors', 'rights', 'themes', 'schema'];
const RECORDING_REQUIRED = ['answer', 'original', 'misattribution', 'context']; // renderSong derefs these
const WRITING_REQUIRED = ['writing', 'shape'];                                  // renderWrote derefs these
const CONFIDENCE = new Set(['verified', 'attributed', 'disputed']);
const ROLES = new Set(['original', 'cover', 'writer', 'performer']);
const SHAPES = new Set(['credit', 'misbelief', 'contested']);
const axesOf = (s) => (Array.isArray(s.axes) && s.axes.length ? s.axes : ['recording']);

// The no-lyrics rule, mechanised. We cannot detect "is this a lyric" in general, but we CAN detect
// the shape it takes when it slips in: a quoted run of ordinary words that is not a title. Titles
// are Capitalised And Short; lyric lines are longer and sentence-cased. This caught two real hook
// fragments ("sock it to me", the spelled-out R-E-S-P-E-C-T) on the Respect page in review.
const QUOTED = /&lsquo;([^&]{2,80})&rsquo;/;
// Walks the PARSED record rather than the raw JSON text, so a hit can name the field it came from
// ("authors[0].bio") instead of just the phrase. Reviewing a warning meant grepping the record to
// find it; the field path makes the message actionable on its own.
function lyricSuspects(node, path = '', out = []) {
  if (typeof node === 'string') {
    const re = new RegExp(QUOTED.source, 'g');
    let m;
    while ((m = re.exec(node))) {
      const phrase = m[1].trim();
      const words = phrase.split(/\s+/);
      if (words.length < 4) continue;                       // too short to be a lyric line
      const capitalised = words.filter((w) => /^[A-Z(]/.test(w)).length;
      if (capitalised / words.length >= 0.5) continue;      // Title Case → a work title, fine
      out.push({ phrase, path: path || '(root)' });
    }
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => lyricSuspects(v, `${path}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) lyricSuspects(node[k], path ? `${path}.${k}` : k, out);
  }
  return out;
}

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];
let failed = 0; let warned = 0;
const seenSlugs = new Map();

for (const f of files) {
  const p = []; const w = [];

  // HTML SAFETY — song records inject raw prose too (authors[].bio, misattribution items, context).
  // Same stored-XSS route as quote records: agent writes the record from a fetched page.
  // Shared implementation (tools/html-safety.js) so the two validators cannot diverge on what is safe.
  const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
  let s;
  try { s = JSON.parse(raw); } catch (e) { console.log(`✗ ${f}\n     - unparseable JSON: ${e.message}`); failed++; continue; }

  scanRecord(s).forEach((m) => p.push(`UNSAFE HTML — ${m}`));

  const axes = axesOf(s);
  const hasRecording = axes.includes('recording');
  const hasWriting = axes.includes('writing');
  if (s.axes !== undefined && (!Array.isArray(s.axes) || !s.axes.length)) p.push('axes must be a non-empty array (["recording"], ["writing"], or both)');
  if (Array.isArray(s.axes) && s.axes.some((x) => x !== 'recording' && x !== 'writing')) p.push('axes may only contain "recording" and/or "writing"');

  const required = [...BASE_REQUIRED, ...(hasRecording ? RECORDING_REQUIRED : []), ...(hasWriting ? WRITING_REQUIRED : [])];
  for (const k of required) if (s[k] === undefined) p.push(`missing required field: ${k}`);
  if (s.songSlug && s.songSlug !== f.replace(/\.json$/, '')) p.push(`songSlug "${s.songSlug}" does not match filename ${f}`);
  if (s.songSlug && !/^[a-z0-9-]+$/.test(s.songSlug)) p.push(`songSlug is not kebab-case: ${s.songSlug}`);
  if (s.songSlug && seenSlugs.has(s.songSlug)) p.push(`duplicate songSlug, also in ${seenSlugs.get(s.songSlug)}`);
  if (s.songSlug) seenSlugs.set(s.songSlug, f);
  if (s.confidence && !CONFIDENCE.has(s.confidence)) p.push(`confidence "${s.confidence}" is outside verified/attributed/disputed`);
  // creditedTo is required on EITHER axis (base) — it records who the public associates the song
  // with. On a recording page that is the cover act; on a writing page it is the performer (who is
  // correctly credited AS the performer — nobody is wrongly credited on a credit/contested page).
  if (!s.creditedTo) p.push('creditedTo is empty — name who the public associates the song with');

  // ---- recording axis: the misattribution must be populated, both sides present ----
  if (hasRecording) {
    if (s.answer && !s.answer.originalArtist) p.push('answer.originalArtist is empty — the recording page has no "who recorded it first" answer');
    if (Array.isArray(s.authors)) {
      const roles = s.authors.map((a) => a.role);
      if (!roles.includes('original')) p.push('recording axis: no author card with role "original" — nobody is credited with recording it first');
      if (!roles.includes('cover')) p.push('recording axis: no author card with role "cover" — nobody is named as the act mistaken for the original');
    }
  }

  // ---- writing axis: shape drives the verdict vocabulary; it must agree with the data ----
  if (hasWriting) {
    if (s.shape && !SHAPES.has(s.shape)) p.push(`shape "${s.shape}" is outside credit/misbelief/contested`);
    if (s.writing && !s.writing.writer) p.push('writing.writer is empty — the writing page has no "who wrote it" answer');
    // shape ⇄ data consistency — an unchecked enum is a lie surface. These rules apply to a
    // WRITING-ONLY record, where `confidence` and the `misattribution` block belong to the writing
    // axis. On a DUAL-axis record both belong to the RECORDING axis (a cover-eclipse is disputed and
    // carries its own misattribution block), so tying them to the writing shape would be wrong —
    // skip them. misbelief is the only writing shape that adjudicates a false belief.
    if (!hasRecording) {
      if (s.shape === 'misbelief' && s.confidence !== 'disputed') p.push('shape "misbelief" adjudicates a false belief — confidence must be "disputed"');
      if (s.shape === 'credit' && s.confidence === 'disputed') p.push('shape "credit" is a revelation, not a fact-check — confidence must not be "disputed" (use "attributed")');
      if (s.shape === 'misbelief' && s.misattribution === undefined) p.push('shape "misbelief" states a false belief — it must carry a misattribution block');
      if ((s.shape === 'credit' || s.shape === 'contested') && s.misattribution !== undefined) p.push(`shape "${s.shape}" has no false belief to state — remove the misattribution block`);
    }
    if (Array.isArray(s.authors) && !s.authors.some((a) => a.role === 'writer')) p.push('writing axis: no author card with role "writer" — the writer is the subject of the page');
  }

  // author cards: roles must be known and slugs valid, on every axis
  if (Array.isArray(s.authors)) {
    s.authors.forEach((a) => {
      if (!ROLES.has(a.role)) p.push(`author role "${a.role}" is outside original/cover/writer/performer`);
      if (!a.slug || !/^[a-z0-9-]+$/.test(a.slug)) p.push(`author "${a.name}" has a bad slug: ${a.slug}`);
      if (!a.name) p.push('an author card has no name');
    });
  }

  // listen — optional "hear the original" link. Shape only: whether the link is LEGITIMATE (an
  // official artist/label/service upload rather than someone's rip) is a human judgement recorded
  // in `source`, and whether it still resolves is checked separately, not at build time (external
  // link checks are flaky enough to get a build gate disabled).
  if (s.listen) {
    const l = s.listen;
    if (!l.url) p.push('listen.url is missing — drop the listen block rather than shipping it empty');
    else if (!/^https:\/\//.test(l.url)) p.push(`listen.url must be https: ${String(l.url).slice(0, 60)}`);
    else if (/\/embed\/|player\.|autoplay=/.test(l.url)) p.push('listen.url looks like an EMBED — link to the page, never embed a player (weight + third-party cookies)');
    if (!l.source) w.push('listen.source is empty — record WHY this copy is legitimate (official channel/label/service), or someone will assume it was the first search result');
    if (!l.what) w.push('listen.what is empty — say which recording is being linked, so it is clear this is the ORIGINAL and not the famous cover');
  }

  // sameAs — STABLE identifiers only. The point of this field is that it does not rot; a streaming
  // URL here would defeat it and put a dead identifier in structured data.
  if (s.sameAs !== undefined) {
    if (!Array.isArray(s.sameAs)) p.push('sameAs must be an array of stable identifier URLs');
    else s.sameAs.forEach((u) => {
      if (!/^https:\/\//.test(String(u))) p.push(`sameAs entry must be https: ${String(u).slice(0, 60)}`);
      else if (!/^https:\/\/(musicbrainz\.org|www\.wikidata\.org|secondhandsongs\.com)\//.test(String(u))) {
        p.push(`sameAs entry is not a stable identifier: ${String(u).slice(0, 60)} (use musicbrainz.org / wikidata.org / secondhandsongs.com — streaming URLs rot and belong in listen.url)`);
      }
    });
  }

  // themes must come from the shared vocabulary or the song will not appear on /themes/
  if (Array.isArray(s.themes)) {
    if (s.themes.length !== 2) w.push(`${s.themes.length} themes (convention is 2)`);
    s.themes.forEach((t) => { if (!THEME_IDS.has(t)) p.push(`theme "${t}" is not in the shared vocabulary`); });
  }

  // THE hard rule — but a WARNING, deliberately, not a failure. Whether a quoted phrase is a lyric
  // is not mechanically decidable: these records legitimately quote human speech (Bowie on fans
  // telling him he was "doing a Nirvana song") and belief statements ("Natalie Imbruglia wrote and
  // sang it first"), which look identical to a lyric line to any regex. A gate that blocks those
  // would be disabled within a week and protect nothing. So: surface every candidate for a human
  // to eyeball, always — these print even under --quiet — and never silently pass one either.
  const lyrics = lyricSuspects(s);
  lyrics.forEach((l) => w.push(`LYRIC REVIEW: ${l.path} — “${l.phrase}” — confirm this is quoted speech or a work title, not a lyric`));

  if (p.length) {
    failed++;
    console.log(`✗ ${s.songSlug || f}`);
    p.forEach((m) => console.log(`     - ${m}`));
    w.forEach((m) => console.log(`     ? ${m}`));
  } else if (w.length) {
    warned++;
    console.log(`⚠ ${s.songSlug || f}`);
    w.forEach((m) => console.log(`     ? ${m}`));
  } else if (!QUIET) {
    console.log(`✓ ${s.songSlug}`);
  }
}

if (failed) {
  console.log(`\n*** ${failed} song record(s) FAILED, ${warned} with warnings — fix before building ***`);
  process.exit(1);
}
if (!QUIET || warned) console.log(`\nAll ${files.length} song record(s) valid${warned ? ` (${warned} with warnings to review)` : ''}.`);
