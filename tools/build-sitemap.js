#!/usr/bin/env node
'use strict';
/*
 * build-sitemap.js — machine-discoverability outputs so crawlers, search engines, and AI agents
 * reach every quote and author page directly:
 *   sitemap.xml  — every canonical URL (home, how-we-verify, authors index + each author, each quote)
 *   llms.txt     — the llmstxt.org convention: a markdown map of the site for LLMs/agents, linking
 *                  the methodology, the machine-readable manifest, and every author + quote page.
 * robots.txt is a static file (points here). Run by tools/build.js after the pages exist.
 */
const fs = require('fs');
const path = require('path');
const { aggregateAuthors } = require('./authors');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://quotle.info';
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
const records = fs.readdirSync(path.join(ROOT, 'data', 'quotes')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'quotes', f), 'utf8')));
const authors = aggregateAuthors(records);

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// ---- sitemap.xml (with lastmod per URL so crawlers see freshness) ----
const modOf = {};
records.forEach((r) => { modOf[r.quoteSlug] = (r.schema && r.schema.dateModified) || null; });
const latest = records.map((r) => r.schema && r.schema.dateModified).filter(Boolean).sort().pop() || null;
const urls = [
  { loc: `${ORIGIN}/`, lastmod: latest },
  { loc: `${ORIGIN}/how-we-verify`, lastmod: latest },
  { loc: `${ORIGIN}/authors/`, lastmod: latest },
  ...authors.map((a) => ({ loc: `${ORIGIN}/authors/${a.slug}`, lastmod: latest })),
  ...manifest.map((m) => ({ loc: m.url, lastmod: modOf[m.quoteSlug] || latest })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${xmlEsc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap);

// ---- llms.txt ----
const stripTags = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/&ldquo;|&rdquo;/g, '"').replace(/&lsquo;|&rsquo;/g, "'").replace(/&ndash;/g, '–').replace(/&middot;/g, '·').replace(/&hellip;/g, '…').replace(/\s+/g, ' ').trim();
const byConf = { verified: [], attributed: [], disputed: [] };
manifest.forEach((m) => (byConf[m.confidence] || (byConf[m.confidence] = [])).push(m));

const llms = `# Quotle.info

> Verified quote provenance. Every quote is traced to a primary source — who really said it, the primary document, and the misattributions untangled with receipts. ${manifest.length} quotes, ${authors.length} authors. Attribution is human- and web-verified (never AI-fabricated) and carries an honest confidence state (verified / attributed / disputed) and a rights status (public-domain / in-copyright / licensed).

Quotle.info answers "who really said it?" for commonly quoted — and commonly misquoted — lines. Each quote has a page at \`/who-said/{slug}\` with the source, a verification trail of fetched-and-confirmed links, misattribution analysis, and Schema.org \`Quotation\` structured data (JSON-LD). Each author has a profile at \`/authors/{slug}\`. The canonical URL for a quote is always \`${ORIGIN}/who-said/{quoteSlug}\`.

## Methodology
- [How we verify](${ORIGIN}/how-we-verify): the standard — traced to a primary source, dated, cited, adversarially re-checked; three honest confidence states; rights stated separately from attribution.

## Data
- [Machine-readable index (JSON)](${ORIGIN}/data/manifest.json): every quote as \`{ dayNumber, quote, author, quoteSlug, confidence, url }\`.
- [Sitemap](${ORIGIN}/sitemap.xml)

## Authors
- [All authors](${ORIGIN}/authors/)
${authors.map((a) => `- [${stripTags(a.name)}](${ORIGIN}/authors/${a.slug}) — ${stripTags(a.metaLine)}`).join('\n')}

## Quotes — disputed / misattributed (who really said it)
${byConf.disputed.map((m) => `- [${stripTags(m.quote)}](${m.url}) — really: ${stripTags(m.author || 'unknown')}`).join('\n')}

## Quotes — verified
${byConf.verified.map((m) => `- [${stripTags(m.quote)}](${m.url}) — ${stripTags(m.author || 'unknown')}`).join('\n')}

## Quotes — attributed (widely credited, no primary source pinned)
${byConf.attributed.map((m) => `- [${stripTags(m.quote)}](${m.url}) — ${stripTags(m.author || 'unknown')}`).join('\n')}
`;
fs.writeFileSync(path.join(ROOT, 'llms.txt'), llms);

console.log(`  ✓ sitemap.xml (${urls.length} URLs) + llms.txt (${authors.length} authors, ${manifest.length} quotes)`);
