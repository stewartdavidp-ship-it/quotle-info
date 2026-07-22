#!/usr/bin/env node
'use strict';
/*
 * parse-audit.js — turn an audit.js workflow run into the fixes map that fix.js reads.
 *
 *   node workflows/parse-audit.js --journal <auditTranscriptDir>/journal.jsonl \
 *     [--out workflows/.scratch/current-fixes.json]
 *
 * Reads the audit journal's per-page {page, verdict, issues} results, prints PASS/FAIL counts,
 * writes the FAIL pages' issues as { "<slug>": [ {severity,location,problem,fix}, ... ] } to
 * current-fixes.json (which workflows/fix.js reads), and prints the FAIL slug list to feed as
 * fix.js args. Reconstructs from the journal because the task-notification result is truncated.
 */
const fs = require('fs');
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : def; }
const JOURNAL = arg('journal');
const OUT = arg('out', '/Users/davidstewart/Developer/quotle-info/workflows/.scratch/current-fixes.json');
if (!JOURNAL) { console.error('usage: parse-audit.js --journal <audit journal.jsonl> [--out current-fixes.json]'); process.exit(1); }

// Same trap as prep-wave: the journal is written live, and a partial read looks like a clean
// smaller run — r23 parsed 8 of 10 page audits this way and it appeared to succeed. Note audit.js
// also emits skeptic re-checks here, so results legitimately EXCEED the page count; only a
// started-without-result imbalance means "still running".
require('./_journal').assertComplete(JOURNAL, { allowPartial: process.argv.includes('--allow-partial'), label: 'audit journal' });

const pages = [];
for (const l of fs.readFileSync(JOURNAL, 'utf8').trim().split('\n')) {
  let j; try { j = JSON.parse(l); } catch (e) { continue; }
  if (j.type !== 'result') continue;
  const v = j.result;
  if (v && v.page && typeof v.page === 'string' && v.page.endsWith('index.html') && v.verdict) pages.push(v);
}
const fails = pages.filter((p) => p.verdict === 'FAIL');
console.log('page audits:', pages.length, '| PASS:', pages.length - fails.length, '| FAIL:', fails.length);
const map = {};
for (const v of fails) map[v.page.replace(/\/index\.html$/, '')] = (v.issues || []).map((i) => ({ severity: i.severity, location: i.location, problem: i.problem, fix: i.fix }));
fs.writeFileSync(OUT, JSON.stringify(map, null, 2));
console.log('issues:', Object.values(map).reduce((a, b) => a + b.length, 0), '→ wrote', OUT);
console.log('\nFAIL slugs (feed as fix.js args):');
console.log(JSON.stringify(Object.keys(map)));
