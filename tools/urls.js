'use strict';
/*
 * urls.js — THE URL contract. Every internal URL the site emits is built here.
 *
 * WHY THIS EXISTS
 * The contract is: a page lives at a DIRECTORY url with a TRAILING SLASH
 * (`/who-said/{slug}/`), because GitHub Pages serves `who-said/{slug}/index.html` there. The
 * no-slash form 301-redirects to it.
 *
 * That single fact was violated in 18 places across 5 generators, and the cost was severe:
 *   - Quote pages emitted a no-slash canonical → Google reported them "unknown, no referring
 *     sitemaps", and indexed sat frozen at 289 while the corpus passed 1,058. Fixed 2026-07-22.
 *   - The SAME bug was still live on 600 author pages and 28 theme pages (canonical + og:url +
 *     Schema @id + 628 sitemap <loc> entries all pointing at redirects) because that fix only
 *     touched who-said. Found by a wave agent, 2026-07-22.
 *   - ~2,900 visible internal links and 1,031 BreadcrumbList JSON-LD items pointed at redirects.
 *
 * A canonical that redirects is close to un-indexable, and it fails SILENTLY — the page returns
 * 200, looks perfect, and simply never ranks. So the contract does not get restated in template
 * literals any more. Import a builder.
 *
 * tools/verify-corpus.js asserts NO built page emits a no-slash section URL, and fails the build
 * if one appears. That is what stops a 19th site being added.
 */
const ORIGIN = 'https://quotle.info';

// Root-relative paths — for href="" in markup.
const quotePath = (slug) => `/who-said/${slug}/`;
const authorPath = (slug) => `/authors/${slug}/`;
const themePath = (slug) => `/themes/${slug}/`;
const songPath = (slug) => `/who-recorded/${slug}/`;
const wrotePath = (slug) => `/who-wrote/${slug}/`;

// Absolute URLs — for canonical, og:url, sitemap <loc>, JSON-LD url/@id.
const quoteUrl = (slug) => `${ORIGIN}${quotePath(slug)}`;
const authorUrl = (slug) => `${ORIGIN}${authorPath(slug)}`;
const themeUrl = (slug) => `${ORIGIN}${themePath(slug)}`;
const songUrl = (slug) => `${ORIGIN}${songPath(slug)}`;
const wroteUrl = (slug) => `${ORIGIN}${wrotePath(slug)}`;

// Fragment ids (`…/#person`). The slash belongs BEFORE the hash: the fragment hangs off the
// canonical document URL, so `/authors/x#person` names a different document than `/authors/x/`.
const frag = (url, id) => `${url}#${id}`;

// The section prefixes that follow the directory contract. verify-corpus uses this list so the
// invariant and the builders can never disagree about what is covered.
const SECTIONS = ['who-said', 'authors', 'themes', 'who-recorded', 'who-wrote'];

// STANDING pages — same directory contract, different shape (no {slug} segment), which is exactly
// why they were missed. They are served from directories (/about/index.html) so the no-slash form
// 301s like everything else, but SECTIONS above only matches `/section/slug`, so neither the
// builders nor verify-corpus ever looked at them. The cost was real: all five sit in the FOOTER of
// every ~2,000 pages AND were listed in sitemap.xml as redirecting URLs, at a time when Google's
// crawl-stats showed 16% of all requests being 301s. Fixing a contract and then writing a guard
// that encodes the same blind spot is how a "fixed" bug stays live.
// `under-review` joins the list for the same directory reason — but note what it carries: the
// site's ONLY correction INPUT, the `#nomForm` nominate form. That form sits ~98% down a 675KB
// page, behind 500+ candidate cards, so an unanchored link to /under-review/ lands the reader on a
// browse list and reads as "there is no way to report anything here". Every correction link must
// therefore be the ANCHORED deep link. See tools/build-static.js.
const STANDING = ['about', 'contact', 'privacy', 'terms', 'how-we-verify', 'vs-ai', 'under-review'];
const standingPath = (name) => `/${name}/`;
const standingUrl = (name) => `${ORIGIN}${standingPath(name)}`;

// THE CORRECTION DEEP LINK. A reader who spots a mistake is on ONE specific quote page, and the
// only correction input on the site is a generic form at the bottom of /under-review/. Sending them
// there unqualified means retyping the quote they were just reading — so carry the slug and let the
// form prefill itself. Order matters: path, then query, then hash. The slash still belongs before
// the query, so this is built here rather than restated at the call site.
const flagPath = (quoteSlug) => `${standingPath('under-review')}?flag=${encodeURIComponent(quoteSlug)}#nomForm`;

module.exports = {
  ORIGIN, SECTIONS, STANDING,
  quotePath, authorPath, themePath, songPath, wrotePath, standingPath,
  quoteUrl, authorUrl, themeUrl, songUrl, wroteUrl, standingUrl,
  frag, flagPath,
};
