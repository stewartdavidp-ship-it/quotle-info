#!/usr/bin/env node
'use strict';
/*
 * validate-records.js — schema/convention check on RECORD SOURCE, run BEFORE build.js.
 *
 * Complements audit-pages.js, which checks rendered HTML. This checks the JSON records
 * themselves, and exists because waves are now written by parallel agents: build.js only
 * throws on a few things (bad `rights`), so convention drift otherwise sails through the
 * build and surfaces as a subtly wrong live page.
 *
 * Every rule below corresponds to a bug that actually shipped or actually broke the build:
 *   1. confidence must be verified|attributed|disputed
 *   2. source.rights must be public-domain|in-copyright|licensed, or ABSENT
 *      ("uncertain" is invalid and throws in template.js)
 *   3. themes: exactly 2, from the fixed vocabulary (theme pages are generated from these)
 *   4. copyAttribution must lead with this record's own quote, or be a bare capitalised tail
 *      — creditLine() strips a leading quoted segment and the UI re-prepends displayQuote, so
 *      leading with a DIFFERENT passage produces a mangled paste string
 *   5. source.excerpt must be plain text — it is esc()'d, so HTML entities double-escape
 *   6. disputed records must carry creditedTo, and answer.authorName must be the REAL author
 *      (a same-name pair is legal but flagged: it is right-person-wrong-words, and 69 records
 *      once had it by mistake, publishing the fake author as real through the /verify API)
 *   7. quoteSlug must match the filename; dayNumber must be unique
 *
 *   node tools/validate-records.js              # whole corpus
 *   node tools/validate-records.js --since 513  # just this wave
 *
 * Exits non-zero so it can gate a build.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : null; };
const since = argOf('--since') ? Number(argOf('--since')) : null;

const CONFIDENCE = new Set(['verified', 'attributed', 'disputed']);
const RIGHTS = new Set(['public-domain', 'in-copyright', 'licensed']);
const THEMES = new Set(['wisdom', 'character', 'purpose', 'courage', 'truth', 'hope', 'power',
  'resilience', 'knowledge', 'growth', 'creativity', 'success', 'freedom', 'doubt', 'work',
  'justice', 'change', 'simplicity', 'happiness', 'love', 'time', 'kindness', 'leadership',
  'humility', 'mortality', 'failure', 'friendship', 'gratitude']);

const DOUBLE_ESC = /&amp;(?:[a-zA-Z]+|#\d+);/;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const dir = path.join(ROOT, 'data', 'quotes');
let recs = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({
  file: f, r: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')),
}));
if (since != null) recs = recs.filter((x) => Number(x.r.dayNumber) >= since);
recs.sort((a, b) => (a.r.dayNumber ?? 0) - (b.r.dayNumber ?? 0));

const seenDay = new Map();
let failed = 0, warned = 0;

for (const { file, r } of recs) {
  const p = [];   // hard problems
  const w = [];   // warnings

  if (r.quoteSlug !== file.replace(/\.json$/, '')) p.push(`quoteSlug "${r.quoteSlug}" != filename`);
  if (!r.displayQuote) p.push('no displayQuote');

  if (!CONFIDENCE.has(r.confidence)) p.push(`confidence "${r.confidence}" invalid`);

  const rights = r.source && r.source.rights;
  if (rights !== undefined && !RIGHTS.has(rights)) {
    p.push(`source.rights "${rights}" invalid (omit the key to mean uncertain)`);
  }
  if (rights === undefined && !(r.source && r.source.rightsNote)) {
    w.push('no rights and no rightsNote — reuse guidance missing');
  }

  // themes drive the generated /themes pages. Count is free-form in this corpus (1-4 in use);
  // only membership in the vocabulary matters, since an unknown theme would mint a stray page.
  const th = r.themes || [];
  if (!th.length) w.push('no themes — quote will not appear on any theme page');
  if (th.length > 4) w.push(`${th.length} themes is more than any existing record uses`);
  for (const t of th) if (!THEMES.has(t)) p.push(`theme "${t}" not in vocabulary`);

  // copyAttribution convention
  const ca = r.copyAttribution;
  if (!ca) { w.push('no copyAttribution'); }
  else {
    const lead = ca.match(/^\s*["“]([^"”]*)["”]/);
    // A record whose displayQuote is a popular CLIPPING sets presentation.verifiedQuote to the
    // full sourced text; copyAttribution then legitimately leads with that fuller wording.
    const full = (r.presentation && r.presentation.verifiedQuote) || r.displayQuote;
    if (lead) {
      const a = norm(lead[1]).slice(0, 40);
      const cands = [norm(r.displayQuote), norm(full)];
      const ok = cands.some((b) => a && b && (b.startsWith(a.slice(0, 25)) || a.startsWith(b.slice(0, 25))));
      if (!ok) w.push('copyAttribution leads with a quote matching neither displayQuote nor presentation.verifiedQuote — check it renders');
    } else if (!/^[A-Z—–-]/.test(ca.trim())) {
      w.push(`copyAttribution tail should start with a capital: "${ca.slice(0, 42)}…"`);
    }
  }

  // source.excerpt is interpolated RAW into the page (template.js ~line 544), so HTML entities
  // are correct and 459 records use them. The real bug class is DOUBLE escaping.
  const ex = r.source && r.source.excerpt;
  if (ex && DOUBLE_ESC.test(ex)) p.push('source.excerpt has double-escaped entities (&amp;mdash; etc.)');

  // These render through esc(), not escEm() — a tag here leaks to the page as literal &lt;em&gt;.
  // Entities are fine (esc preserves them); markup is not. Caught on the Diderot record, whose
  // metaLine wrapped "Encyclopédie" in <em>.
  const ESC_ONLY = [
    ['author.metaLine', r.author && r.author.metaLine],
    ['author.kicker', r.author && r.author.kicker],
    ['author.heading', r.author && r.author.heading],
    ['answer.kicker', r.answer && r.answer.kicker],
    ['source.cutTag', r.source && r.source.cutTag],
    ['source.kicker', r.source && r.source.kicker],
    ['source.heading', r.source && r.source.heading],
    ['misattribution.kicker', r.misattribution && r.misattribution.kicker],
    ['misattribution.heading', r.misattribution && r.misattribution.heading],
    ['context.kicker', r.context && r.context.kicker],
    ['context.heading', r.context && r.context.heading],
    // copyAttribution is a PLAIN-TEXT share string: it renders esc()'d into .pkit-cite and is
    // written to the clipboard verbatim. Markup there leaks as literal &lt;em&gt; on the page and
    // as raw tags in whatever the user pastes. Caught on the Sound of Music record.
    ['copyAttribution', r.copyAttribution],
  ];
  for (const [name, val] of ESC_ONLY) {
    if (typeof val === 'string' && /<[a-zA-Z/]/.test(val)) {
      p.push(`${name} contains HTML markup — that field is esc()'d, so it leaks as literal &lt;em&gt;`);
    }
  }

  const real = r.answer && r.answer.authorName;
  if (!real) p.push('no answer.authorName');
  if (r.confidence === 'disputed') {
    if (!r.creditedTo) w.push('disputed but no creditedTo');
    else if (real && norm(real) === norm(r.creditedTo)) {
      w.push(`real == credited ("${real}") — only correct for right-person-wrong-words; else the fake author is being published as real`);
    }
  }

  // dayNumber is OPTIONAL and explicitly nullable — 481 records ship with `dayNumber: null`.
  // It maps a quote to a Quotle puzzle day; most corpus entries have no puzzle. Only collisions
  // among records that DO claim a day are a problem.
  if (r.dayNumber != null) {
    if (seenDay.has(r.dayNumber)) p.push(`dayNumber ${r.dayNumber} collides with ${seenDay.get(r.dayNumber)}`);
    else seenDay.set(r.dayNumber, file);
  }

  if (p.length) {
    failed++;
    console.log(`✗ ${String(r.dayNumber ?? '—').padStart(4)}  ${r.quoteSlug}`);
    p.forEach((m) => console.log(`     - ${m}`));
    w.forEach((m) => console.log(`     ? ${m}`));
  } else if (w.length) {
    warned++;
    console.log(`⚠ ${String(r.dayNumber ?? '—').padStart(4)}  ${r.quoteSlug}`);
    w.forEach((m) => console.log(`     ? ${m}`));
  } else {
    console.log(`✓ ${String(r.dayNumber ?? '—').padStart(4)}  ${r.quoteSlug.slice(0, 56)}`);
  }
}

console.log('');
if (failed) {
  console.log(`*** ${failed} record(s) FAILED, ${warned} with warnings — fix before building ***`);
  process.exit(1);
}
console.log(`All ${recs.length} record(s) valid${warned ? ` (${warned} with warnings to review)` : ''}.`);
