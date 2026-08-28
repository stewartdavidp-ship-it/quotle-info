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
 *   2. source.rights must be public-domain|in-copyright, or ABSENT
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
const { scanRecord } = require('./html-safety');
const { creditList } = require('./credits'); // creditedTo: string OR array of false credits
const { VERDICT_LEAD_TOKENS } = require('./template'); // the FAQ lead vocabulary, defined once

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : null; };
const since = argOf('--since') ? Number(argOf('--since')) : null;
// --quiet: print only failures/warnings, not the per-record ✓ roll. Lets this run as a mandatory
// pre-build gate (npm run build) without burying the build log under 1058 lines of success.
const QUIET = argv.includes('--quiet');

// Words that appear in an answer.label's "Not X" slot but name no person — so a label built from
// them ("Not Hippocrates' words", "Not a verbatim quote") must not be compared against creditedTo.
const LABEL_NOISE = new Set(['not', 'the', 'his', 'her', 'their', 'own', 'words', 'wording', 'line',
  'quote', 'quotation', 'real', 'documented', 'verified', 'exact', 'canonical', 'actually', 'quite',
  'sourced', 'form', 'this', 'and', 'for', 'from', 'with', 'maxim', 'saying', 'phrase', 'verbatim',
  'scripture', 'text', 'these', 'coined', 'coinage', 'attributed']);
const CONFIDENCE = new Set(['verified', 'attributed', 'disputed']);
const RIGHTS = new Set(['public-domain', 'in-copyright']);
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

  // HTML SAFETY — ~10 record fields are injected into pages RAW (author.bio, answer.sourceLine,
  // misattribution.intro/truthLine, context.pull …). Records are written by agents from fetched web
  // pages, so "attacker's page → agent → record → every rendered page" is a real stored-XSS route.
  // Hard failure, never a warning: there is no benign reason for a script tag in a quote record.
  scanRecord(r).forEach((m) => p.push(`UNSAFE HTML — ${m}`));

  // copyAttribution is the ONE string designed to leave the site — it is written to the clipboard
  // and pasted into slides, books and posts, with no page around it to qualify it. So it must never
  // claim more certainty than the record carries. Six records shipped prose that correctly said
  // "NOT Charlie Chaplin" / "Misattributed to Marcus Aurelius" and then closed with "Verified by
  // Quotle.info" — the only string that travels asserted the opposite of the page it came from.
  // Found by an r25 audit; template.js passes copyAttribution through verbatim, so nothing else
  // was checking it. This is the site's core claim, so it is a hard failure.
  if (typeof r.copyAttribution === 'string' && r.confidence !== 'verified'
      && /\bverified by quotle\.info/i.test(r.copyAttribution)) {
    p.push(`copyAttribution claims "verified by Quotle.info" on a ${r.confidence} record — the clipboard string must not overclaim (use "traced by")`);
  }

  // creditedTo is the machine-readable "this person is FALSELY credited" claim: it drives
  // ClaimReview.claimReviewed, the FAQ question, and the author-page "misattributed to X" list. The
  // page's own answer.label already states who is falsely credited, in the form "Not X — actually Y".
  // When those two disagree, the page argues one thing in prose and asserts another to machines.
  //
  // Wave r46 shipped exactly that: creditedTo "John McTiernan" under a label reading "Not Columbus",
  // so the ClaimReview rated false a claim nobody makes while the real one — Columbus — appeared
  // nowhere in the structured data an answer engine reads. The generator was innocent; it was fed
  // the wrong name by a harvest heuristic.
  //
  // WARNING, not a failure, and calibrated rather than assumed. Naive forms of this check flagged
  // 123 then 66 of 1,972 records — nearly all possessive or short-name variants ("Not Pope's words"
  // vs "Alexander Pope", "Not Napoleon" vs "Napoleon Bonaparte"). Comparing NAME TOKENS with
  // possessives stripped brings it to 5, of which 4 are benign non-person forms and 1 is a real
  // defect. A gate that cries wolf 60 times gets ignored, which is worse than no gate.
  if (r.creditedTo && r.answer && typeof r.answer.label === 'string') {
    const nameTokens = (t) => String(t || '').toLowerCase()
      .replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/'s\b/g, '')
      .replace(/[^a-z\s-]/g, ' ').split(/\s+/)
      .filter((x) => x.length > 2 && !LABEL_NOISE.has(x));
    const m = r.answer.label.replace(/<[^>]*>/g, ' ').replace(/&mdash;|&ndash;/g, '—')
      .match(/^\s*Not\s+(?:quite\s+)?([^—–]+?)\s*(?:[—–]|$)/i);
    const claimed = m ? new Set(nameTokens(m[1])) : null;
    // No tokens left means the label names no person ("Not verified", "Not scripture") — nothing to compare.
    if (claimed && claimed.size) {
      const creds = Array.isArray(r.creditedTo) ? r.creditedTo : String(r.creditedTo).split(';');
      if (!creds.some((c) => nameTokens(c).some((t) => claimed.has(t)))) {
        w.push(`creditedTo ${JSON.stringify(r.creditedTo)} shares no name with the label's "Not ${m[1].trim()}" — `
          + 'the prose and the machine-readable claimant disagree; one of them is wrong');
      }
    }
  }

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

  // The POPULARIZER MISMATCH check that briefly lived here now lives in tools/detectors.js as
  // `coined-verb-mismatch`, with its measurement recorded beside it (8 hits, 0.7%). Two commits
  // landed it in both places within the hour — this file gates the BUILD, detectors.js feeds the
  // REVIEW QUEUE, and a signal defined twice drifts. One definition, two callers.
  const real = r.answer && r.answer.authorName;
  if (!real) p.push('no answer.authorName');
  if (r.confidence === 'disputed') {
    // creditedTo is a string OR an array of false credits (tools/credits.js). Validate EVERY name,
    // not just the first — a bad second credit would otherwise reach an author hub and a
    // ClaimReview unchecked, which is exactly where a wrong name does the most damage.
    const credits = creditList(r);
    if (!credits.length) w.push('disputed but no creditedTo');
    if (Array.isArray(r.creditedTo) && r.creditedTo.length !== credits.length) {
      w.push('creditedTo has blank or duplicate entries — they are dropped, but the record should say what it means');
    }
    for (const c of credits) {
      if (real && norm(real) === norm(c)) {
        w.push(`real == credited ("${real}") — only correct for right-person-wrong-words; else the fake author is being published as real`);
      }
    }
  }

  // schema.verdictLead is the FIRST TOKEN of the FAQ acceptedAnswer — the string a voice assistant
  // reads aloud, and the only part of it a featured snippet reliably keeps. Its whole value is being
  // one of five fixed yes/no answers, so free prose there ("Sort of", "It depends") would defeat the
  // field while looking like it worked. Hard failure, and gated against the renderer's own exported
  // list rather than a copy of it (tools/template.js VERDICT_LEAD_TOKENS) so the two cannot drift.
  // '' is legal and means "no lead — the answer opens with its own sentence".
  const vl = r.schema && r.schema.verdictLead;
  if (vl !== undefined) {
    const bare = String(vl).trim().replace(/\.+$/, '').trim();
    if (bare && !VERDICT_LEAD_TOKENS.some((t) => t.toLowerCase() === bare.toLowerCase())) {
      p.push(`schema.verdictLead "${vl}" is not one of ${VERDICT_LEAD_TOKENS.join(' / ')} (or "" for no lead)`);
    }
  }

  // schema.isPartOf nests exactly ONE level (letter-in-collection, article-in-journal,
  // chapter-in-book — every shape this corpus has; see the note in template.js). Anything a record
  // writes below that, or a nested node with no `name`, is DROPPED by the renderer. That is the
  // silent-edit shape this repo keeps getting burnt by — a record edit that looks applied and ships
  // unchanged markup (the Voltaire pen name, the Eisenhower nickname) — so it fails here instead.
  const ipo = r.schema && r.schema.isPartOf;
  if (ipo && ipo.isPartOf) {
    if (!ipo.isPartOf.name) p.push('schema.isPartOf.isPartOf has no name — the renderer drops it silently');
    if (ipo.isPartOf.isPartOf) p.push('schema.isPartOf nests more than one level — the renderer emits only one, so the deepest work would vanish');
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
    // Under --quiet (the in-build gate) warnings are counted, not printed: there is a standing
    // backlog of ~240, and dumping it at the head of every build would bury the failures that
    // actually stop the build and teach everyone to scroll past this tool. The closing summary
    // states the count and how to see them.
    if (!QUIET) {
      console.log(`⚠ ${String(r.dayNumber ?? '—').padStart(4)}  ${r.quoteSlug}`);
      w.forEach((m) => console.log(`     ? ${m}`));
    }
  } else if (!QUIET) {
    console.log(`✓ ${String(r.dayNumber ?? '—').padStart(4)}  ${r.quoteSlug.slice(0, 56)}`);
  }
}

console.log('');
if (failed) {
  console.log(`*** ${failed} record(s) FAILED, ${warned} with warnings — fix before building ***`);
  process.exit(1);
}
if (QUIET) {
  console.log(`  ✓ ${recs.length} quote record(s) valid${warned ? ` — ${warned} with warnings (node tools/validate-records.js to review)` : ''}`);
} else {
  console.log(`All ${recs.length} record(s) valid${warned ? ` (${warned} with warnings to review)` : ''}.`);
}
