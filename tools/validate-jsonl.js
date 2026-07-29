#!/usr/bin/env node
'use strict';
/*
 * validate-jsonl.js — every committed .jsonl under data/ must actually parse.
 *
 * WHY. On 2026-07-29 three literal git conflict markers were committed into
 * data/routine-log.jsonl, so the file stopped being JSONL. Nothing noticed: the build does not read
 * it, no validator covered it, and CI went green on the commit that broke it. The corruption was
 * found a run later by a wave that happened to read the log for other reasons.
 *
 * The mechanism was a merge whose conflict was swallowed — `git merge … >/dev/null 2>&1 && echo ok`
 * followed by an unconditional `git add -A`, which stages conflict markers as content. That is a
 * mistake a person or an agent will make again; this is the check that makes it loud instead of
 * silent.
 *
 * Deliberately narrow: it asserts the file is parseable, not what is in it. A log is not derived
 * from anything, so there is nothing to reconcile it against — but "is it still a file we can read"
 * is exactly the invariant that was missing.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QUIET = process.argv.includes('--quiet');
const failures = [];
let files = 0, lines = 0;

const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.jsonl')) check(p);
  }
};

function check(p) {
  files++;
  const rel = path.relative(ROOT, p);
  const text = fs.readFileSync(p, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    lines++;
    // Named separately from a parse error: a conflict marker is not malformed JSON, it is an
    // unfinished merge, and saying so points at the cause rather than the symptom.
    if (/^(<{7}|={7}|>{7})/.test(line)) {
      failures.push(`${rel}:${i + 1}  UNRESOLVED MERGE CONFLICT — "${line.slice(0, 40)}"`);
      return;
    }
    try { JSON.parse(line); }
    catch (e) { failures.push(`${rel}:${i + 1}  not valid JSON — ${String(e.message).slice(0, 70)}`); }
  });
}

const dataDir = path.join(ROOT, 'data');
if (fs.existsSync(dataDir)) walk(dataDir);

if (failures.length) {
  console.error('\n  ✗ JSONL VALIDATION FAILED:\n');
  failures.forEach((f) => console.error(`   ${f}`));
  console.error(`\n  ${failures.length} bad line(s) across ${files} file(s). A committed conflict marker means a merge was never finished.\n`);
  process.exit(1);
}
if (!QUIET) console.log(`  ✓ jsonl parses (${files} file(s), ${lines} line(s))`);
