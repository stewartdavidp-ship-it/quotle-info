'use strict';
/*
 * slugify.js — the ONE slug function, shared the way tokens.js shares the palette.
 *
 * Slugs are the URL contract (who-said/{quoteSlug}, authors/{authorSlug}), so drift between
 * copies of this function shows up as duplicate pages. It has happened: an earlier version
 * dropped accented HTML entities before slugifying, so "Niccol&ograve; Machiavelli" slugged as
 * BOTH `niccolo-machiavelli` and `niccol-machiavelli` and split his quotes across two pages.
 * Accented letters are now transliterated to ASCII (ò→o, é→e) rather than dropped.
 *
 * DUPLICATED VERBATIM in workflows/generate.js — that file is a Workflow script and runs in a
 * sandbox with no require(). Change one, change the other.
 *
 * Only ACCENT entities are decoded here. Every other entity (&rsquo; &ldquo; &amp; &thinsp;)
 * must keep falling through to the generic entity→space pass: decoding &rsquo; to ’ would let
 * the curly-quote strip above it fuse words, turning `john-l-o-sullivan` into `john-l-osullivan`
 * and churning live URLs.
 */

// Entity name → ASCII. Object.create(null) so a name like "constructor" can't inherit a match.
const ACCENT_ENTITIES = Object.assign(Object.create(null), {
  agrave: 'a', aacute: 'a', acirc: 'a', atilde: 'a', auml: 'a', aring: 'a', aelig: 'ae',
  ccedil: 'c', egrave: 'e', eacute: 'e', ecirc: 'e', euml: 'e',
  igrave: 'i', iacute: 'i', icirc: 'i', iuml: 'i', ntilde: 'n',
  ograve: 'o', oacute: 'o', ocirc: 'o', otilde: 'o', ouml: 'o', oslash: 'o', oelig: 'oe',
  ugrave: 'u', uacute: 'u', ucirc: 'u', uuml: 'u', yacute: 'y', yuml: 'y',
  szlig: 'ss', eth: 'd', thorn: 'th',
});

// Raw letters NFD can't decompose (the mark isn't separable), so they need an explicit mapping.
const RAW_LETTERS = Object.assign(Object.create(null), {
  ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', þ: 'th', ł: 'l', ħ: 'h', ı: 'i',
});

function slugify(text) {
  let s = String(text).toLowerCase()
    .replace(/[’'‘`]/g, '')
    .replace(/&([a-z]+);/g, (m, name) => ACCENT_ENTITIES[name] || m)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[ßæœøđðþłħı]/g, (ch) => RAW_LETTERS[ch] || ch)
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > 60) { s = s.slice(0, 60).replace(/-[^-]*$/, ''); }
  return s;
}
const authorSlugOf = (name) => slugify(name);

module.exports = { slugify, authorSlugOf };
