'use strict';
/*
 * esc.js — the ONE HTML-escaping helper, shared by template.js and build-index.js so the two
 * generators can never diverge on encoding again. (They previously used different escapes: the
 * homepage's naive `&`→`&amp;` double-encoded entity-form author names like "Niccol&ograve;"
 * into visible mojibake, while the detail pages rendered them correctly.)
 *
 * Entity-aware: turns a BARE & into &amp; but leaves an existing entity (&ldquo; &amp; &#8217;
 * &#x2019;) intact, so fields that already carry HTML entities and fields with raw text can both
 * be escaped uniformly with no risk of double-encoding.
 */
const esc = (s) => String(s)
  .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

module.exports = { esc };
