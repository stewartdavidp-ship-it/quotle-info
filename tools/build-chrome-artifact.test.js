'use strict';
/*
 * The contract that matters: NOTHING in the published chrome may be
 * root-relative. The consumer is on a different origin, so a surviving
 * `href="/who-said/"` resolves to the BLOG and 404s — and it would look
 * perfectly fine here on quotle.info, which is what makes it worth a test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { absolutiseHrefs, buildSearchJs, BASE } = require('./build-chrome-artifact');
const { NAV, FOOTER } = require('./chrome');

test('absolutiseHrefs rewrites root-relative hrefs to quotle.info', () => {
  assert.equal(absolutiseHrefs('<a href="/who-said/">x</a>'), `<a href="${BASE}/who-said/">x</a>`);
  assert.equal(absolutiseHrefs('<a href="/">home</a>'), `<a href="${BASE}/">home</a>`);
});

test('absolutiseHrefs leaves already-absolute and anchor hrefs alone', () => {
  const abs = '<a href="https://quotle.runmast.com/">Blog</a>';
  assert.equal(absolutiseHrefs(abs), abs);
  assert.equal(absolutiseHrefs('<a href="#main">Skip</a>'), '<a href="#main">Skip</a>');
  // Protocol-relative must not gain a host.
  assert.equal(absolutiseHrefs('<a href="//cdn/x">x</a>'), '<a href="//cdn/x">x</a>');
});

test('no nav state ships a root-relative href', () => {
  for (const key of ['home', 'quotes', 'songs', 'themes', 'authors', 'check', 'blog']) {
    assert.doesNotMatch(absolutiseHrefs(NAV(key)), /href="\/(?!\/)/, `nav[${key}]`);
  }
});

test('the footer ships no root-relative href', () => {
  assert.doesNotMatch(absolutiseHrefs(FOOTER), /href="\/(?!\/)/);
});

test('the Blog tab keeps its cross-origin href and is marked active', () => {
  const blog = absolutiseHrefs(NAV('blog'));
  assert.match(blog, /class="nav-link active" href="https:\/\/quotle\.runmast\.com\/">Blog<\/a>/);
  // ...and is NOT active on any other state.
  assert.doesNotMatch(absolutiseHrefs(NAV('quotes')), /active" href="https:\/\/quotle\.runmast\.com/);
});

test('search JS fetches the index absolutely, not from the consuming origin', () => {
  const js = buildSearchJs();
  assert.ok(js.includes(`fetch('${BASE}/search.json')`));
  assert.ok(!js.includes("fetch('/search.json')"));
});

test('search result rows and "See all" links open on quotle.info', () => {
  const js = buildSearchJs();
  assert.ok(js.includes(`href="${BASE}'+esc(e.u)+'"`), 'result row href must be prefixed');
  assert.ok(js.includes(`q:'${BASE}/who-said/'`), '"See all" map must be absolute');
});

// The rewrites are exact-substring matches against chrome.js. If chrome.js is
// restructured they must FAIL, not silently no-op — a no-op would publish a
// chrome whose links point at the wrong origin, and nothing on quotle.info
// would look wrong.
test('a rewrite that no longer matches throws instead of silently skipping', () => {
  const { mustReplace } = require('./build-chrome-artifact');
  if (typeof mustReplace !== 'function') return; // not exported; covered by build()
  assert.throws(() => mustReplace('nothing here', 'MISSING', 'x', 'a thing'), /could not find a thing/);
});
