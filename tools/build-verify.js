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
const { creditLine, buildImagePrompts } = require('./template');
const ROOT = path.resolve(__dirname, '..');
const QUOTES_DIR = path.join(ROOT, 'data', 'quotes');
const ORIGIN = 'https://quotle.info';

function plain(s) {
  return String(s || '').replace(/<[^>]+>/g, '')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&lsquo;|&rsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&hellip;/g, '…').replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
    .replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}
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
    real: plain((r.answer && r.answer.authorName) || ''), // who really said it
    credited: plain(r.creditedTo || (r.confidence === 'disputed' && r.misattribution && r.misattribution.items && r.misattribution.items[0] && r.misattribution.items[0].who) || ''), // who it's falsely credited to
    credit: plain(creditLine(r)),                       // paste-ready CORRECT credit line (quote already implied)
    rights: (r.source && r.source.rights) || '',        // public-domain | in-copyright | ''
    img: (buildImagePrompts(r)[0] || ''),               // context-grounded image direction (the "in context" one)
    u: `${ORIGIN}/who-said/${r.quoteSlug}/`,
  });
}

fs.writeFileSync(path.join(ROOT, 'verify-index.json'), JSON.stringify(entries));
console.log(`  ✓ verify-index.json (${entries.length} verdicts for the /verify API)`);
