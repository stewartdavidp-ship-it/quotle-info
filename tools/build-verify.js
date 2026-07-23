#!/usr/bin/env node
'use strict';
/*
 * build-verify.js — emit /verify-index.json, the machine verdict index behind the public
 * /verify API (the Cloudflare Worker fetches this file, so the API auto-tracks the live corpus
 * without a Worker redeploy per wave).
 *
 * One entry per verified quote: normalized text (for lookup) + the verdict fields an agent needs
 * — who really said it, who it's misattributed to, confidence, rights, and the canonical URL.
 */
const fs = require('fs');
const path = require('path');
// Reuse template.js's plain() — it decodes accented named entities (æ, è, é…) instead of dropping
// them to a space, so citations/credits like "De Hæresibus" or "Barère" come out right.
const { creditLine, buildImagePrompts, plain, realAuthorName } = require('./template');
const ROOT = path.resolve(__dirname, '..');
const QUOTES_DIR = path.join(ROOT, 'data', 'quotes');
const SONGS_DIR = path.join(ROOT, 'data', 'songs');
const ORIGIN = 'https://quotle.info';
const norm = (s) => String(s).toLowerCase().replace(/[’'‘`"“”]/g, '').replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

const entries = [];
for (const f of fs.readdirSync(QUOTES_DIR)) {
  if (!f.endsWith('.json')) continue;
  let r; try { r = JSON.parse(fs.readFileSync(path.join(QUOTES_DIR, f), 'utf8')); } catch (_) { continue; }
  const q = r.displayQuote || '';
  entries.push({
    slug: r.quoteSlug,
    q,
    n: norm(q),
    c: r.confidence,                                   // verified | attributed | disputed
    real: realAuthorName(r),                           // who really said it (NOT answer.authorName — see template.js)
    credited: plain(r.creditedTo || (r.confidence === 'disputed' && r.misattribution && r.misattribution.items && r.misattribution.items[0] && r.misattribution.items[0].who) || ''), // who it's falsely credited to
    credit: plain(creditLine(r)),                       // paste-ready CORRECT credit line (quote already implied)
    cite: plain((r.cite && r.cite.sourceCitation) || ''), // full authored Chicago citation (for a references slide)
    rights: (r.source && r.source.rights) || 'uncertain', // public-domain | in-copyright | licensed | uncertain (never blank, so machine consumers can gate)
    img: (buildImagePrompts(r)[0] || ''),               // context-grounded image direction (the "in context" one)
    u: `${ORIGIN}/who-said/${r.quoteSlug}/`,
  });
}

// ---- SONGS ----
// The /verify API could answer "who really said X?" and had no idea "who originally recorded X?"
// existed: this file read data/quotes only, so 37 song pages — with their own harvest/generate/audit
// pipeline — were invisible to the agent-facing surface that is the whole point of the API.
//
// Songs go in the SAME array, after the quotes, on purpose:
//  • The Worker fetches this file live (that is why it "auto-tracks the corpus without a Worker
//    redeploy"), and it matches on `n`. Emitting songs here makes them answerable IMMEDIATELY, with
//    no Worker deploy — the fields below are deliberately shaped to the existing contract.
//  • QUOTES ARE EMITTED FIRST AND THAT IS LOAD-BEARING. matchQuote() uses .find() for its exact
//    match, so on a collision the quote wins. Song titles are short ("War", "Fever", "Respect",
//    "Hurt") and a one-word query is far more likely to be a title than a quote — but where a real
//    quote shares the string, the primary corpus must not be displaced by a song.
//  • `t: 's'` is the discriminator. The deployed Worker ignores unknown fields, so it answers song
//    queries with the legacy field names (reallySaidBy = the original artist, misattributedTo = the
//    act mistaken for it — which map honestly enough to be useful before a redeploy). A Worker that
//    understands `t` returns properly-named song fields; see worker/src/index.js.
//
// rights is ALWAYS 'uncertain' for a song, never 'public-domain'. A song page states recording
// history and quotes no lyrics; the composition and every recording remain in copyright to their
// owners. A wrong "public-domain" is the costliest error this site can publish, and there is no
// per-song rights research behind these records to justify any other value.
const songEntries = [];
if (fs.existsSync(SONGS_DIR)) {
  for (const f of fs.readdirSync(SONGS_DIR)) {
    if (!f.endsWith('.json')) continue;
    let s; try { s = JSON.parse(fs.readFileSync(path.join(SONGS_DIR, f), 'utf8')); } catch (_) { continue; }
    const title = plain(s.title || '');
    const orig = plain((s.answer && s.answer.originalArtist) || (s.original && s.original.artist) || '');
    const credited = plain(s.creditedTo || '');
    const year = String((s.original && s.original.year) || (s.schema && s.schema.datePublished) || '');
    const writer = plain((s.original && s.original.writer) || '');
    if (!title || !orig) continue;
    // WHERE THE ORIGINAL WAS RELEASED UNDER A DIFFERENT TITLE, "<page title> was first recorded by
    // <original artist>" IS A FALSE SENTENCE. Roland Gerbeau recorded "La Mer" in 1945; the first
    // recording of the English "Beyond the Sea" was Harry James in 1947. The wave-s1 audit caught
    // exactly this welding in the FAQ JSON-LD, and it would have reappeared here — the API is a
    // second place that composes the same sentence from the same two fields.
    // schema.faqAnswer is the record's own authored answer for these cases; prefer it always.
    const recName = plain((s.schema && s.schema.recordingName) || title);
    const retitled = norm(recName) !== norm(title);
    const answer = plain((s.schema && s.schema.faqAnswer) || '')
      || `"${title}" was first recorded by ${orig}${year ? ` in ${year}` : ''}${credited ? `; ${credited}'s version is a cover` : ''}.`;
    songEntries.push({
      t: 's',                                            // discriminator: this is a SONG, not a quote
      slug: s.songSlug,
      q: title,                                          // the title — the unit of a song page
      n: norm(title),                                    // lookup key
      c: s.confidence,                                   // verified | attributed | disputed
      real: orig,                                        // who RECORDED IT FIRST
      credited,                                          // the cover act it is popularly credited to
      answer,                                            // the authored, safe one-sentence verdict
      ...(retitled ? { originalTitle: recName } : {}),   // the title the ORIGINAL was released under
      credit: retitled
        ? `${title} — originally recorded as "${recName}" by ${orig}${year ? ` (${year})` : ''}`
        : `${title} — first recorded by ${orig}${year ? ` (${year})` : ''}`,
      cite: `${title}. Written by ${writer || 'unknown'}. ${retitled ? `Originally recorded as "${recName}"` : 'First recorded'} by ${orig}${year ? `, ${year}` : ''}.`,
      rights: 'uncertain',
      img: '',
      u: `${ORIGIN}/who-recorded/${s.songSlug}/`,
      // song-specific, read by a `t`-aware Worker; harmlessly ignored by the current one
      year,
      writer,
      cover: plain((s.schema && s.schema.coverArtist) || credited),
      coverYear: String((s.schema && s.schema.coverYear) || ''),
    });
  }
}

const all = entries.concat(songEntries);
fs.writeFileSync(path.join(ROOT, 'verify-index.json'), JSON.stringify(all));
console.log(`  ✓ verify-index.json (${all.length} verdicts for the /verify API — ${entries.length} quotes + ${songEntries.length} songs)`);
