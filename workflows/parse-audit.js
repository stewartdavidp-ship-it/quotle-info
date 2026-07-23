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

// THE SKEPTIC VERDICTS LIVE IN THIS JOURNAL TOO, AND THIS SCRIPT USED TO IGNORE THEM.
// The audit workflow re-checks every high/blocker with a skeptic and drops the refuted ones — but it
// does that in its own .then(), and the journal records each agent's RAW return. So the issues read
// back here are PRE-skeptic: every wave handed fix.js findings its own skeptics had already thrown
// out. Wave s2 sent 5 refuted findings to fix agents (they caught them, which was luck, not design),
// and a wave-s1 finding reported as "skeptic-confirmed" had in fact been refuted.
// Verdicts echo {slug, location} precisely so they can be paired back here.
const pages = [];
const verdicts = [];
for (const l of fs.readFileSync(JOURNAL, 'utf8').trim().split('\n')) {
  let j; try { j = JSON.parse(l); } catch (e) { continue; }
  if (j.type !== 'result') continue;
  const v = j.result;
  if (v && v.page && typeof v.page === 'string' && v.page.endsWith('index.html') && v.verdict) pages.push(v);
  else if (v && typeof v.standsUp === 'boolean') verdicts.push(v);
}
const key = (slug, loc) => `${String(slug || '').replace(/\/index\.html$/, '')}::${String(loc || '').trim().toLowerCase()}`;
const refuted = new Set(verdicts.filter((v) => v.standsUp === false).map((v) => key(v.slug, v.location)));
const unpairable = verdicts.filter((v) => !v.slug || !v.location).length;

const fails = pages.filter((p) => p.verdict === 'FAIL');
console.log('page audits:', pages.length, '| PASS:', pages.length - fails.length, '| FAIL:', fails.length);
console.log('skeptic verdicts:', verdicts.length, '| confirmed:', verdicts.filter((v) => v.standsUp).length, '| REFUTED:', refuted.size);
if (unpairable) {
  console.log(`  ⚠ ${unpairable} verdict(s) carry no slug/location and CANNOT be paired — they are from an audit run`);
  console.log('    that predates the echo fields. Those findings pass through unfiltered; review them by hand.');
}

const map = {};
let dropped = 0;
for (const v of fails) {
  const slug = v.page.replace(/\/index\.html$/, '');
  const kept = (v.issues || []).filter((i) => {
    if (refuted.has(key(slug, i.location))) { dropped++; console.log(`  – dropped (skeptic refuted) ${slug}: ${String(i.location).slice(0, 60)}`); return false; }
    return true;
  });
  // A page whose every hard finding was refuted is not a FAIL any more — sending it to fix.js would
  // spend an agent on nothing and invite a speculative edit to a page that was correct.
  if (!kept.length) { console.log(`  – ${slug} now PASSES: all findings refuted`); continue; }
  map[slug] = kept.map((i) => ({ severity: i.severity, location: i.location, problem: i.problem, fix: i.fix }));
}
fs.writeFileSync(OUT, JSON.stringify(map, null, 2));
console.log('issues:', Object.values(map).reduce((a, b) => a + b.length, 0), `(dropped ${dropped} refuted) → wrote`, OUT);
console.log('\nFAIL slugs (feed as fix.js args):');
console.log(JSON.stringify(Object.keys(map)));
