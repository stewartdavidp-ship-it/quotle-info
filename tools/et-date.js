#!/usr/bin/env node
'use strict';
/*
 * et-date.js — "today" for anything that stamps a date a reader sees.
 *
 *   node tools/et-date.js     →  --verified-date "3 Nov 2026" --date-modified "2026-11-03"
 *
 * Record dates are the operator's calendar day in America/New_York, NOT the UTC day.
 * `new Date().toISOString().slice(0, 10)` rolls over at 19:00 ET (20:00 in summer), so a wave
 * prepped in the evening stamped tomorrow's date into answer.lastVerified, schema.dateModified and
 * sourcesVerified[].verifiedOn — published as ClaimReview.datePublished and the visible "Last
 * verified" line. r55/r56/r57 fix agents each found 2026-11-02 on records audited on 2026-11-01
 * (58 records carried "2 Nov 2026"). The wave runner passes these dates by hand, so the CLI prints
 * exactly the two flags prep-wave.js / generate.js want, and prep-wave refuses a future date.
 *
 * Built from parts, not toLocaleDateString('en-GB', {month:'short'}): ICU renders September as
 * "Sept" there, which is not the "D Mon YYYY" form the corpus uses.
 */
const ZONE = 'America/New_York';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function partsET(d = new Date()) {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)) p[type] = value;
  return { y: p.year, m: p.month, d: p.day };
}
/** "YYYY-MM-DD" in America/New_York. */
const ymdET = (d) => { const { y, m, d: day } = partsET(d); return `${y}-${m}-${day}`; };
/** "D Mon YYYY" (answer.lastVerified form) in America/New_York. */
const verifiedET = (d) => { const { y, m, d: day } = partsET(d); return `${+day} ${MON[+m - 1]} ${y}`; };
/** "D Mon YYYY" → "YYYY-MM-DD", or '' if it does not parse. */
function verifiedToYmd(s) {
  const m = String(s || '').trim().match(/^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/);
  if (!m || !MON.includes(m[2])) return '';
  return `${m[3]}-${String(MON.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/**
 * The prep-wave / prep-songs gate: '' when the pair is usable, else why not. Both flags must name the
 * SAME day, and that day may not be after today in America/New_York — a future stamp is the UTC
 * roll-over, never a real verification date.
 */
function checkWaveDates(verifiedDate, dateModified, now = new Date()) {
  const v = verifiedToYmd(verifiedDate);
  if (!v) return `--verified-date "${verifiedDate}" is not "D Mon YYYY" (e.g. "${verifiedET(now)}")`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateModified))) return `--date-modified "${dateModified}" is not YYYY-MM-DD`;
  if (v !== dateModified) return `--verified-date "${verifiedDate}" and --date-modified "${dateModified}" name different days`;
  if (dateModified > ymdET(now)) return `${dateModified} is after today in ${ZONE} (${ymdET(now)}) — a UTC date? Use: node tools/et-date.js`;
  return '';
}

module.exports = { ZONE, ymdET, verifiedET, verifiedToYmd, checkWaveDates };

if (require.main === module) console.log(`--verified-date "${verifiedET()}" --date-modified "${ymdET()}"`);
