#!/usr/bin/env node
'use strict';
/*
 * validate-workflows.js — parse every Workflow script, because nothing else does.
 *
 * WHY THIS EXISTS. Two Workflow scripts shipped to main with SYNTAX ERRORS on 2026-07-28, from
 * two separate commits, and neither was caught:
 *
 *   workflows/harvest-candidates.js  a prompt edit inserted PLAIN backticks around `notes` inside
 *                                    a template literal, closing the literal early
 *   workflows/fix.js                 a prompt edit ESCAPED the literal's own closing backtick, so
 *                                    it never closed
 *
 * Both were "validated" with `node --check`, which on these files prints
 *     Warning: Failed to load the ES module … set "type": "module"
 * and EXITS ZERO. The ESM warning looks like the syntax check passing. It is not a check at all —
 * the file is never parsed. Every prompt edit in this repo touches a template literal full of
 * backticks and apostrophes, so this is a standing hazard, not a one-off.
 *
 * A broken Workflow script fails at LAUNCH, after the operator has decided to spend a wave — it
 * cannot fail earlier, because nothing imports these files. They are read as source and sent to the
 * platform. So the only place to catch it is a deliberate parse, here, wired into build.js.
 *
 * HOW. Workflow scripts are ES modules that legally use top-level `await` and top-level `return`
 * (the platform wraps them). Neither is valid in a plain script, so the check strips `export ` and
 * wraps the body in an async IIFE before parsing. It compiles only — nothing runs, no agent is
 * spawned, no network is touched.
 *
 *   node tools/validate-workflows.js           # all Workflow scripts
 *   node tools/validate-workflows.js --quiet    # only failures (build gate)
 *
 * Exits non-zero on any parse failure.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'workflows');
const QUIET = process.argv.includes('--quiet');

// A Workflow script is identified by its `export const meta` header — the same marker the platform
// requires. Everything else in workflows/ is a CommonJS CLI with a shebang, which `node --check`
// DOES validate correctly and which build.js already exercises by running it.
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'))
  .filter((f) => /^export const meta/m.test(fs.readFileSync(path.join(DIR, f), 'utf8')));

let failed = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/^export /gm, '');
  try {
    new vm.Script(`(async()=>{\n${src}\n})()`, { filename: f });
    if (!QUIET) console.log(`  ✓ workflows/${f}`);
  } catch (e) {
    console.error(`  ✗ workflows/${f} — ${e.message}`);
    failed++;
  }
}

if (failed) {
  console.error(`\nvalidate-workflows: ${failed} of ${files.length} Workflow script(s) will not parse.`);
  console.error('A Workflow script fails at LAUNCH, after you have committed to a wave. Fix before shipping.');
  console.error('NOTE: `node --check` does NOT catch this — it prints an ESM warning and exits 0.');
  process.exit(1);
}
if (!QUIET) console.log(`validate-workflows: ${files.length} Workflow scripts parse.`);
