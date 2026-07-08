'use strict';
/*
 * authors.js — shared author helpers, so template.js (which decides whether to LINK an author
 * name) and build-authors.js (which GENERATES /authors/{slug} pages) agree on exactly which
 * authors are profile-able. An author gets a page iff they're a real, identifiable person.
 *
 * Placeholder slugs used for quotes with no known author — `anonymous`, `unknown-anonymous`,
 * `anonymous-traditional-proverb`, etc. — are NOT profile-able: their names render as plain text.
 */
const hasAuthorPage = (slug) => !!slug && !/^(anonymous|unknown)(-|$)/.test(slug);

// Aggregate records into one entry per profile-able author. For an author with several quotes,
// the canonical bio/meta/initials/name come from their richest record (longest bio) — we never
// synthesize new biography, only reuse what a record already carries. Quotes are listed newest
// data first by confidence then quote text.
function aggregateAuthors(records) {
  const bySlug = new Map();
  for (const r of records) {
    const a = r.author || {};
    if (!hasAuthorPage(a.slug)) continue;
    let e = bySlug.get(a.slug);
    if (!e) { e = { slug: a.slug, name: a.name, bio: a.bio || '', metaLine: a.metaLine || '', initials: a.initials || '', quotes: [] }; bySlug.set(a.slug, e); }
    // richest bio wins as canonical; keep its name/meta/initials together
    if ((a.bio || '').length > e.bio.length) { e.bio = a.bio; e.name = a.name; e.metaLine = a.metaLine || e.metaLine; e.initials = a.initials || e.initials; }
    e.quotes.push({ slug: r.quoteSlug, quote: r.displayQuote, confidence: r.confidence });
  }
  const CONF_ORDER = { verified: 0, attributed: 1, disputed: 2 };
  const authors = [...bySlug.values()];
  authors.forEach((e) => e.quotes.sort((x, y) => (CONF_ORDER[x.confidence] - CONF_ORDER[y.confidence]) || x.quote.localeCompare(y.quote)));
  authors.sort((a, b) => a.name.localeCompare(b.name));
  return authors;
}

module.exports = { hasAuthorPage, aggregateAuthors };
