#!/usr/bin/env node
'use strict';
/*
 * build-state.js — write data/corpus-state.json, the committed snapshot of every canonical figure.
 *
 * This is the "central source, updated when data is ingested" in durable form: a small, diffable
 * file that shows up in the PR for a content wave as `"total": 1058 → 1076`, so a change in what
 * the site claims about itself is reviewable instead of invisible. Anything that needs the numbers
 * without running the generators (a dashboard, a check, a human) reads this file.
 *
 * It is DERIVED, never hand-edited: corpus.js computes the figures from the record files, this
 * writes them down, and verify-corpus.js fails the build if the committed copy drifts from the
 * live derivation. That ordering matters — a persisted counter that is updated by hand, or only
 * by one ingest path, becomes a confident lie the moment a record is added another way (which is
 * exactly how 27 song records entered the corpus without passing a single gate).
 *
 * Run by tools/build.js.
 */
const fs = require('fs');
const path = require('path');
const { CORPUS } = require('./corpus');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'corpus-state.json');

// generatedAt is deliberately absent: a timestamp would make this file churn on every build and
// turn a meaningful "the corpus grew" diff into noise. The figures ARE the state.
const state = {
  _comment: 'DERIVED FILE — do not edit. Written by tools/build-state.js from tools/corpus.js on every build; tools/verify-corpus.js fails the build if it drifts from the live data.',
  figures: CORPUS,
};

const next = JSON.stringify(state, null, 2) + '\n';
const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
fs.writeFileSync(OUT, next);

const c = CORPUS;
const changed = prev && prev !== next;
console.log(`  ✓ data/corpus-state.json (${c.quotes.total} quotes, ${c.songs.total} songs, ${c.authors.total} authors, ${c.review.queued} queued)${changed ? ' — CHANGED, commit it' : ''}`);
