'use strict';
/*
 * build-chrome-artifact.js — publish quotle.info's site chrome as /chrome.json
 * so an OFF-ORIGIN property can wear it without duplicating it.
 *
 * WHY THIS EXISTS
 * The quotle.info blog lives on a different origin (quotle.runmast.com — a Mast
 * Managed site, path-split at the edge so /app/ and /checkout.js still reach the
 * platform). It must be visually indistinguishable from quotle.info: same nav,
 * same search, same tokens, same footer. Copying the chrome into that site would
 * drift the first time someone touches the nav here, and nothing would catch it.
 * So chrome.js stays the single source of truth and this emits a consumable
 * build artifact, exactly like search.json / themes.json / verify-index.json.
 *
 * THE OFF-ORIGIN PROBLEM
 * Every URL in the chrome is root-relative — nav hrefs, footer links, the brand,
 * `fetch('/search.json')`, the search "See all" map, and the `u` field on every
 * search result row. Root-relative is correct ON quotle.info and wrong
 * everywhere else: on the blog origin `/who-said/` resolves to the blog and
 * 404s. So this ABSOLUTISES every one of them against BASE.
 *
 * Each rewrite is asserted. If chrome.js is restructured such that a rewrite no
 * longer matches, this FAILS THE BUILD rather than shipping an artifact whose
 * links quietly point at the wrong origin — the failure mode would otherwise be
 * invisible here and only visible on the other property.
 */
const fs = require('fs');
const path = require('path');
const { NAV, CHROME_CSS, SEARCH_JS, FOOTER } = require('./chrome');
const { ROOT_CSS } = require('./tokens');
const { CONTROL, HEAD_SCRIPT, THEME_CSS, SCRIPT } = require('./a11y-widget');

const BASE = 'https://quotle.info';
const OUT = path.join(__dirname, '..', 'chrome.json');

/** Rewrite root-relative href="/x" -> href="https://quotle.info/x". Leaves
 *  already-absolute hrefs (the Blog tab -> runmast) and #anchors alone. */
function absolutiseHrefs(html) {
  return html.replace(/href="\/(?!\/)/g, `href="${BASE}/`);
}

/** Exact-substring replace that fails loudly when the source has moved on. */
function mustReplace(source, find, replace, what) {
  if (!source.includes(find)) {
    throw new Error(
      `build-chrome-artifact: could not find ${what} in chrome.js.\n` +
        `  Looked for: ${find}\n` +
        `  chrome.js has been restructured. Update this rewrite — do NOT skip it, ` +
        `or the published chrome will point off-origin links at the wrong host.`,
    );
  }
  return source.split(find).join(replace);
}

function buildSearchJs() {
  let js = SEARCH_JS;
  js = mustReplace(js, "fetch('/search.json')", `fetch('${BASE}/search.json')`, 'the search index fetch');
  js = mustReplace(
    js,
    "ALL={q:'/who-said/',s:'/who-recorded/',w:'/who-wrote/',t:'/themes/',a:'/authors/',b:'/under-review/'}",
    `ALL={q:'${BASE}/who-said/',s:'${BASE}/who-recorded/',w:'${BASE}/who-wrote/',` +
      `t:'${BASE}/themes/',a:'${BASE}/authors/',b:'${BASE}/under-review/'}`,
    'the "See all" section map',
  );
  // Result rows carry a root-relative `u` from search.json; prefix it so a hit
  // opens on quotle.info rather than 404ing on the consuming origin.
  js = mustReplace(
    js,
    `'<a class="gs-row" href="'+esc(e.u)+'"`,
    `'<a class="gs-row" href="${BASE}'+esc(e.u)+'"`,
    'the search result row href',
  );
  return js;
}

function build() {
  const navKeys = ['home', 'quotes', 'songs', 'themes', 'authors', 'check', 'blog'];
  const navHtmlByActive = {};
  for (const key of navKeys) navHtmlByActive[key] = absolutiseHrefs(NAV(key));

  const artifact = {
    // Bump when the SHAPE changes so a consumer can fail fast on a stale reader.
    version: 1,
    generatedFrom: 'quotle-info/tools/chrome.js + tokens.js + a11y-widget.js',
    base: BASE,
    navHtmlByActive,
    footerHtml: absolutiseHrefs(FOOTER),
    // The "Aa" control is markup + behaviour + a light-theme palette. Shipping
    // only the markup would render a dead button, and omitting THEME_CSS would
    // leave the blog dark-only while quotle.info follows the reader's choice.
    a11yControlHtml: CONTROL,
    a11yHeadScript: HEAD_SCRIPT,
    a11yScript: SCRIPT,
    themeCss: THEME_CSS,
    chromeCss: CHROME_CSS,
    rootCss: ROOT_CSS,
    searchJs: buildSearchJs(),
  };

  // Belt and braces: nothing root-relative may survive into the artifact, or a
  // consumer silently links back into its own origin.
  for (const [k, html] of Object.entries(navHtmlByActive)) {
    if (/href="\/(?!\/)/.test(html)) throw new Error(`chrome.json: nav[${k}] still has a root-relative href`);
  }
  if (/href="\/(?!\/)/.test(artifact.footerHtml)) throw new Error('chrome.json: footer still has a root-relative href');
  if (artifact.searchJs.includes("'/search.json'")) throw new Error('chrome.json: searchJs still fetches a relative index');

  fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2) + '\n');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`  ✓ chrome.json (${navKeys.length} nav states, ${kb} KB) — off-origin chrome for quotle.runmast.com`);
}

if (require.main === module) build();
module.exports = { build, absolutiseHrefs, buildSearchJs, mustReplace, BASE };
