#!/usr/bin/env node
'use strict';
/*
 * corpus.js — THE single source of truth for every number the site states about itself.
 *
 * WHY THIS EXISTS
 * Before this module, every generator rediscovered its own counts from the data directories:
 * build-index counted authors from the manifest, build-authors counted them from the hub
 * aggregation, build-search counted them a third way. They disagreed. The home page advertised
 * "526 Authors" on a tile linking to an index headed "593 authors", and the authors page said
 * "1041 quotes" against "1058" everywhere else. Both shipped to production unnoticed, because
 * nothing in the pipeline compared one generator's arithmetic to another's.
 *
 * THE RULE: no generator may count anything itself. It imports CORPUS and reads a field.
 * Every figure is derived here, exactly once per build, from the record files on disk — so two
 * consumers cannot disagree, and a number cannot be hardcoded and left to rot.
 *
 * This module also owns the shared aggregates (records, songs, authors) so consumers stop
 * re-reading and re-parsing the same directories five times.
 *
 * Consumed by: build-index, build-authors, build-search, build-sitemap, build-state, verify-corpus.
 * Verified by: tools/verify-corpus.js — invariants that FAIL the build if these figures stop
 * reconciling with what was actually rendered.
 */
const fs = require('fs');
const path = require('path');
const { aggregateAuthors } = require('./authors');
const { THEMES, isTheme } = require('./themes');

const ROOT = path.resolve(__dirname, '..');
const readJsonDir = (dir) => {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  } catch (_) { return []; } // a content type that does not exist yet is zero, not a crash
};

// ---- source data, read ONCE ----
const records = readJsonDir(path.join(ROOT, 'data', 'quotes'));
// A song record declares which axes it carries (default ['recording'] — every record shipped before
// the writing axis). The RECORDING axis renders /who-recorded/ (who recorded it first); the WRITING
// axis renders /who-wrote/ (who wrote it). One record may carry both. We split here so every existing
// consumer (build-authors, build-search, build-verify, home tiles, sitemap) keeps seeing exactly the
// recording-axis set it saw before the split — the writing axis is purely additive.
const allSongs = readJsonDir(path.join(ROOT, 'data', 'songs'));
const axesOf = (s) => (Array.isArray(s.axes) && s.axes.length ? s.axes : ['recording']);
const songs = allSongs.filter((s) => axesOf(s).includes('recording')); // → /who-recorded/, and the "songs" every other tool means
const writingSongs = allSongs.filter((s) => axesOf(s).includes('writing')); // → /who-wrote/
// Fold BOTH axes' people into hubs: a writing record's writer/performer get /authors/ pages too (a
// song entry carries its axes so the render routes to /who-wrote/ vs /who-recorded/). Passing allSongs
// (deduped per record) — not songs ∪ writingSongs — avoids folding a dual-axis record twice.
const authors = aggregateAuthors(records, allSongs); // the authoritative hub set — what /authors/ lists

// ---- era partition ----
// Buckets key on BIRTH year, labelled for what they actually catch: the second takes everyone from
// the fall of Rome to 1800. Anyone with no parseable year lands in 'undated' (mostly bands, whose
// metaLine is "English synth-pop duo · formed 1977", plus anonymous/collective authors) so that the
// era row is a true PARTITION and its chips sum to the author total.
const ERAS = [
  { id: 'ancient', label: 'Ancient', max: 500 },
  { id: 'pre1800', label: 'Pre-1800', max: 1800 },
  { id: 'nineteenth', label: '1800s', max: 1900 },
  { id: 'modern', label: 'Modern', max: 9999 },
];
const UNDATED = 'undated';
const plain = (s) => String(s || '').replace(/<[^>]+>/g, '')
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&middot;/g, '·')
  .replace(/&([a-z]+);/g, ' ').replace(/&#(\d+);/g, ' ').replace(/\s+/g, ' ').trim();
function eraOf(metaLine) {
  const head = plain(metaLine).split('·')[0];
  if (/\bBCE?\b/i.test(head)) return 'ancient';
  const yrs = head.match(/\d{3,4}/g);
  if (!yrs) return UNDATED;
  const birth = parseInt(yrs[0], 10);
  return (ERAS.find((e) => birth < e.max) || {}).id || UNDATED;
}

// ---- derived figures ----
const byConfidence = { verified: 0, attributed: 0, disputed: 0 };
for (const r of records) if (r.confidence in byConfidence) byConfidence[r.confidence]++;

const eraCounts = {};
for (const a of authors) { a.era = a.era || eraOf(a.metaLine); eraCounts[a.era] = (eraCounts[a.era] || 0) + 1; }

const themePresent = new Set();
for (const r of records) if (Array.isArray(r.themes)) for (const t of r.themes) if (isTheme(t)) themePresent.add(t);

let reviewQueued = 0;
try {
  const hq = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'harvest-queue.json'), 'utf8'));
  reviewQueued = (hq.candidates || []).filter((c) => c.status === 'queued').length;
} catch (_) { /* backlog optional */ }

const CORPUS = Object.freeze({
  quotes: Object.freeze({
    // The CORPUS size — the number every page means when it says "quotes". State this one.
    total: records.length,
    byConfidence: Object.freeze({ ...byConfidence }),
    // Quote→hub links. Lower than total by the quotes whose author is Anonymous/Unknown and so has
    // no hub. Internal bookkeeping — do NOT put this on a page next to the word "quotes".
    linkedToAuthor: authors.reduce((s, a) => s + a.quotes.length, 0),
  }),
  songs: Object.freeze({ total: songs.length }),
  whoWrote: Object.freeze({ total: writingSongs.length }),
  authors: Object.freeze({
    // What /authors/ lists, and therefore what any tile linking there must say.
    total: authors.length,
    withQuotes: authors.filter((a) => a.quotes.length).length,
    songArtists: authors.filter((a) => a.songs.length).length,
    songOnly: authors.filter((a) => a.songs.length && !a.quotes.length).length,
    eraCounts: Object.freeze({ ...eraCounts }),
  }),
  themes: Object.freeze({ total: THEMES.length, present: themePresent.size }),
  review: Object.freeze({ queued: reviewQueued }),
});

module.exports = { CORPUS, records, songs, writingSongs, authors, ERAS, UNDATED, eraOf };
