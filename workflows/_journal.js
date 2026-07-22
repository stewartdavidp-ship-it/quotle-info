'use strict';
/*
 * _journal.js — guard against reading a workflow journal that is STILL BEING WRITTEN.
 *
 * WHY THIS EXISTS
 * `journal.jsonl` is appended live while a workflow runs, and it contains BOTH `started` and
 * `result` entries. So a line count is not a result count, and a journal read early looks exactly
 * like a small-but-successful run.
 *
 * The r23 wave hit this twice in one session, and both times it looked like clean success:
 *   - prep-wave.js against a partial journal → "dossiers: 2" of a 10-quote batch
 *   - parse-audit.js against a partial journal → 8 of 10 page audits
 * A wave that trusted either would have SILENTLY SHIPPED A FRACTION OF ITSELF — 2 records from a
 * 10-quote wave, with no error anywhere. That is the same silent-failure class as every other
 * defect this repo has had to chase, so it gets a mechanical gate, not a README warning.
 *
 * Note `audit.js` emits skeptic re-checks into the same journal, so results legitimately outnumber
 * the pages audited (19 results for 10 pages in r23). Only a started-without-result imbalance means
 * "still running" — the ratio itself proves nothing.
 */
const fs = require('fs');

/**
 * Read a journal and return { started, results, complete }.
 */
function scanJournal(file) {
  let started = 0; let results = 0;
  for (const line of fs.readFileSync(file, 'utf8').trim().split('\n')) {
    let j; try { j = JSON.parse(line); } catch (_) { continue; }
    const t = j.type || j.event || '';
    if (t === 'started' || t === 'start') started++;
    else if (t === 'result' || t === 'completed') results++;
  }
  return { started, results, complete: started <= results };
}

/**
 * Abort unless every started agent has reported a result. Pass --allow-partial to override
 * deliberately (e.g. salvaging a run where one agent died and you accept the shortfall).
 */
function assertComplete(file, { allowPartial = false, label = 'journal' } = {}) {
  const s = scanJournal(file);
  if (s.complete || allowPartial) {
    if (!s.complete) console.warn(`  ⚠ ${label}: ${s.started} started vs ${s.results} results — PARTIAL, continuing because --allow-partial was passed`);
    return s;
  }
  console.error(`\n  ✗ ${label} is INCOMPLETE — the workflow is still running.\n`);
  console.error(`      ${s.started} agents started, only ${s.results} results written.\n`);
  console.error('      Reading it now would silently build a FRACTION of the wave and look like success.');
  console.error('      Wait for the workflow\'s completion notification, then re-run this command.');
  console.error('      (Do not judge by line count — the journal holds `started` lines too.)');
  console.error('      To proceed anyway on a run where an agent genuinely died: --allow-partial\n');
  process.exit(1);
}

module.exports = { scanJournal, assertComplete };
