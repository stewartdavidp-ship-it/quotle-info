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
const { THEMES } = require('./themes');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'songs');
const QUIET = process.argv.includes('--quiet');
const THEME_IDS = new Set(THEMES.map((t) => t.slug));

// Every field the renderer (build-songs.js) dereferences. A missing one is a broken page, not a
// cosmetic gap, so these are failures rather than warnings.
const REQUIRED = ['songSlug', 'title', 'confidence', 'creditedTo', 'meta', 'answer', 'original', 'authors', 'misattribution', 'context', 'rights', 'themes', 'schema'];
const CONFIDENCE = new Set(['verified', 'attributed', 'disputed']);
const ROLES = new Set(['original', 'cover', 'writer']);

// The no-lyrics rule, mechanised. We cannot detect "is this a lyric" in general, but we CAN detect
// the shape it takes when it slips in: a quoted run of ordinary words that is not a title. Titles
// are Capitalised And Short; lyric lines are longer and sentence-cased. This caught two real hook
// fragments ("sock it to me", the spelled-out R-E-S-P-E-C-T) on the Respect page in review.
const QUOTED = /&lsquo;([^&]{2,80})&rsquo;/g;
function lyricSuspects(json) {
  const out = [];
  let m;
  while ((m = QUOTED.exec(json))) {
    const phrase = m[1].trim();
    const words = phrase.split(/\s+/);
    if (words.length < 4) continue;                       // too short to be a lyric line
    const capitalised = words.filter((w) => /^[A-Z(]/.test(w)).length;
    if (capitalised / words.length >= 0.5) continue;      // Title Case → a work title, fine
    out.push(phrase);
  }
  return out;
}

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];
let failed = 0; let warned = 0;
const seenSlugs = new Map();

for (const f of files) {
  const p = []; const w = [];
  const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
  let s;
  try { s = JSON.parse(raw); } catch (e) { console.log(`✗ ${f}\n     - unparseable JSON: ${e.message}`); failed++; continue; }

  for (const k of REQUIRED) if (s[k] === undefined) p.push(`missing required field: ${k}`);
  if (s.songSlug && s.songSlug !== f.replace(/\.json$/, '')) p.push(`songSlug "${s.songSlug}" does not match filename ${f}`);
  if (s.songSlug && !/^[a-z0-9-]+$/.test(s.songSlug)) p.push(`songSlug is not kebab-case: ${s.songSlug}`);
  if (s.songSlug && seenSlugs.has(s.songSlug)) p.push(`duplicate songSlug, also in ${seenSlugs.get(s.songSlug)}`);
  if (s.songSlug) seenSlugs.set(s.songSlug, f);
  if (s.confidence && !CONFIDENCE.has(s.confidence)) p.push(`confidence "${s.confidence}" is outside verified/attributed/disputed`);

  // the misattribution axis must actually be populated — a song page with no original recorder
  // has nothing to say
  if (s.answer && !s.answer.originalArtist) p.push('answer.originalArtist is empty — the page has no "who recorded it first" answer');
  if (!s.creditedTo) p.push('creditedTo is empty — nothing to correct');

  // author cards: roles must be known, and there must be both sides of the misattribution
  if (Array.isArray(s.authors)) {
    const roles = s.authors.map((a) => a.role);
    roles.forEach((r) => { if (!ROLES.has(r)) p.push(`author role "${r}" is outside original/cover/writer`); });
    if (!roles.includes('original')) p.push('no author card with role "original" — nobody is credited with recording it first');
    if (!roles.includes('cover')) p.push('no author card with role "cover" — nobody is named as the act mistaken for the original');
    s.authors.forEach((a) => {
      if (!a.slug || !/^[a-z0-9-]+$/.test(a.slug)) p.push(`author "${a.name}" has a bad slug: ${a.slug}`);
      if (!a.name) p.push('an author card has no name');
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
  const lyrics = lyricSuspects(raw);
  lyrics.forEach((l) => w.push(`LYRIC REVIEW: “${l}” — confirm this is quoted speech or a work title, not a lyric`));

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
