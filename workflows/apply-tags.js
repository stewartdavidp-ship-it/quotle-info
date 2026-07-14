#!/usr/bin/env node
'use strict';
/*
 * apply-tags.js — write theme tags from a tag-themes workflow run into the records.
 *
 *   node workflows/apply-tags.js --journal <tagTranscriptDir>/journal.jsonl
 *
 * Reads the tagging journal's {results:[{slug,themes}]} agent outputs, validates each theme against
 * the controlled vocab (tools/themes.js), and writes record.themes into data/quotes/{slug}.json.
 * Idempotent. Reports how many were written and how many records remain untagged (should be 0 after
 * a full pass). Run after tagging a wave's new records, before the final build.
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const { isTheme } = require(path.join(REPO, 'tools/themes.js'));
function arg(name) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : null; }
const JOURNAL = arg('journal');
if (!JOURNAL) { console.error('usage: apply-tags.js --journal <tag journal.jsonl>'); process.exit(1); }
const DIR = path.join(REPO, 'data/quotes');

const tags = {};
const take = (r) => { if (!r || !r.slug) return; const t = [...new Set((r.themes || []).filter(isTheme))]; if (t.length) tags[r.slug] = t; };
for (const l of fs.readFileSync(JOURNAL, 'utf8').trim().split('\n')) {
  let j; try { j = JSON.parse(l); } catch (e) { continue; }
  if (j.type !== 'result' || !j.result) continue;
  // Two shapes: the workflow's final return {result:{results:[...]}}, OR a per-agent
  // journal line whose result IS a single {slug,themes} (what wf journal.jsonl actually holds).
  if (Array.isArray(j.result.results)) j.result.results.forEach(take);
  else take(j.result);
}
let n = 0;
for (const [slug, themes] of Object.entries(tags)) {
  const p = path.join(DIR, slug + '.json');
  if (!fs.existsSync(p)) continue;
  const r = JSON.parse(fs.readFileSync(p, 'utf8'));
  r.themes = themes;
  fs.writeFileSync(p, JSON.stringify(r, null, 2) + '\n');
  n++;
}
let untagged = 0;
for (const f of fs.readdirSync(DIR)) { if (!f.endsWith('.json')) continue; const r = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); if (!Array.isArray(r.themes) || !r.themes.length) untagged++; }
console.log('themes written:', n, '| records still untagged in corpus:', untagged);
