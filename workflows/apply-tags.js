#!/usr/bin/env node
'use strict';
/*
 * apply-tags.js — write theme tags from a tag-themes workflow run into the records.
 *
 *   node workflows/apply-tags.js --journal <tagTranscriptDir>/journal.jsonl \
 *                               --manifest <the same manifest you passed to tag-themes.js>
 *
 * Reads the tagging journal's {results:[{slug,themes}]} agent outputs, validates each theme against
 * the controlled vocab (tools/themes.js), and writes record.themes into data/quotes/{slug}.json.
 * Idempotent.
 *
 * --------------------------------------------------------------------------------------------------
 * WHY --manifest IS MANDATORY: THIS TOOL USED TO LOSE A RECORD PER WAVE AND PRINT SUCCESS.
 *
 * tag-themes.js slices a manifest across N agents by array position. When one agent returns 9 of its
 * 10, the workflow logs `covered: 39, total: 40` and returns normally; this script then wrote the 39
 * it received, printed a cheerful count, and exited 0. An untagged record never appears on /themes
 * and nothing downstream flags it — verify-corpus.js counts tags, it does not know how many were
 * expected — so the ONLY thing standing between a silent loss and production was a human reading a
 * counter in workflow output.
 *
 * That is not a hypothetical. It happened on r32 (the Epictetus "Never say of anything" record) and
 * again on r33 (`i-never-said-most-of-the-things-i-said`, at manifest position 22 of 40 — not a chunk
 * boundary, so an agent dropped one of its own, which is exactly the failure a count cannot survive).
 * Both times a human caught it. workflows/README.md calls a silent loss "the one failure this
 * pipeline is built to make impossible everywhere else".
 *
 * The journal cannot answer "how many should there be?" — it holds per-agent result lines, so what
 * was NEVER RETURNED leaves no trace in it. Only the manifest knows the expected set. So the manifest
 * is required rather than optional: an optional completeness check is one nobody passes on the wave
 * where it would have mattered, and a warning is what already failed twice. Missing slugs are named
 * AND written to a re-run manifest, so the fix is a mechanical re-run rather than a hunt.
 * --------------------------------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const { isTheme } = require(path.join(REPO, 'tools/themes.js'));
function arg(name) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : null; }
const JOURNAL = arg('journal');
const MANIFEST = arg('manifest');
if (!JOURNAL || !MANIFEST) {
  console.error('usage: apply-tags.js --journal <tag journal.jsonl> --manifest <the manifest passed to tag-themes.js>');
  console.error('  --manifest is REQUIRED: it is the only thing that knows which records were meant to be tagged.');
  console.error('  Pass the SAME path you gave tag-themes.js (e.g. workflows/.scratch/untagged-rN.json).');
  process.exit(1);
}
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

// ---- COMPLETENESS: every record the manifest asked for must now carry themes ----
// Checked against the RECORD ON DISK, not against what this run happened to write, so a re-run after
// a partial pass correctly reports "nothing missing" instead of re-failing on records already tagged.
let manifest;
try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (e) {
  console.error(`\n*** cannot read --manifest ${MANIFEST}: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(manifest)) {
  console.error(`\n*** --manifest ${MANIFEST} is not a JSON array of {quoteSlug,...} entries`);
  process.exit(1);
}
const expected = manifest.map((x) => x && (x.quoteSlug || x.slug)).filter(Boolean);
const missing = expected.filter((slug) => {
  const p = path.join(DIR, slug + '.json');
  if (!fs.existsSync(p)) return false;   // a slug with no record is a manifest problem, reported below
  const r = JSON.parse(fs.readFileSync(p, 'utf8'));
  return !Array.isArray(r.themes) || !r.themes.length;
});
const noRecord = expected.filter((slug) => !fs.existsSync(path.join(DIR, slug + '.json')));

console.log(`manifest: ${expected.length} records requested | ${expected.length - missing.length - noRecord.length} now tagged`);
if (noRecord.length) {
  console.log(`  ! ${noRecord.length} manifest slug(s) have no record on disk: ${noRecord.slice(0, 5).join(', ')}`);
}
if (!missing.length) {
  if (!noRecord.length) console.log('  ✓ every requested record is tagged.');
  process.exit(noRecord.length ? 1 : 0);
}

// Write the re-run manifest beside the original, preserving the entries verbatim so tag-themes.js
// can be pointed straight at it with chunks:1.
const rerun = MANIFEST.replace(/(\.json)?$/, '-missing.json');
const bySlug = new Map(manifest.filter((x) => x).map((x) => [x.quoteSlug || x.slug, x]));
fs.writeFileSync(rerun, JSON.stringify(missing.map((s) => bySlug.get(s)), null, 2) + '\n');

console.error(`
*** ${missing.length} of ${expected.length} REQUESTED RECORDS ARE STILL UNTAGGED — the tagger dropped them.
    An untagged record never appears on /themes and nothing downstream will flag it, which is why
    this exits non-zero instead of printing a count nobody reads. (r32 and r33 each lost one here.)

${missing.map((s) => `      · ${s}`).join('\n')}

    Re-run manifest written: ${rerun}
    Then:
      Workflow tag-themes.js args={ chunks: 1, total: ${missing.length}, manifest: "${rerun}", repo: "$(pwd)" }
      node workflows/apply-tags.js --journal <newTranscriptDir>/journal.jsonl --manifest ${rerun}
`);
process.exit(1);
