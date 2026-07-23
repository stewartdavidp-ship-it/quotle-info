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
// Aggregate quote records — and, optionally, SONG records — into one entry per profile-able author.
// A song contributes an author entry for each of its people (original recorder / cover artist /
// writer), so a song artist gets a real /authors/{slug} hub even with no quotes. Each author entry
// carries both `quotes` and `songs`; the render decides which sections to show.
function aggregateAuthors(records, songs = []) {
  const bySlug = new Map();
  const get = (a) => {
    let e = bySlug.get(a.slug);
    if (!e) { e = { slug: a.slug, name: a.name, bio: a.bio || '', metaLine: a.metaLine || '', initials: a.initials || '', quotes: [], songs: [] }; bySlug.set(a.slug, e); }
    // richest bio wins as canonical; keep its name/meta/initials together
    if ((a.bio || '').length > e.bio.length) { e.bio = a.bio; e.name = a.name; e.metaLine = a.metaLine || e.metaLine; e.initials = a.initials || e.initials; }
    return e;
  };
  for (const r of records) {
    const a = r.author || {};
    if (!hasAuthorPage(a.slug)) continue;
    get(a).quotes.push({ slug: r.quoteSlug, quote: r.displayQuote, confidence: r.confidence });
  }
  const axesOf = (s) => (Array.isArray(s.axes) && s.axes.length ? s.axes : ['recording']);
  for (const s of songs) {
    for (const a of (s.authors || [])) {
      if (!hasAuthorPage(a.slug)) continue;
      get(a).songs.push({
        slug: s.songSlug, title: s.title, role: a.role || '',
        axes: axesOf(s),                                   // routes the card to /who-recorded/ or /who-wrote/
        creditedTo: s.creditedTo || '',
        originalArtist: (s.answer && s.answer.originalArtist) || '',
        writer: (s.writing && s.writing.writer) || (s.original && s.original.writer) || '',
      });
    }
  }
  const CONF_ORDER = { verified: 0, attributed: 1, disputed: 2 };
  const authors = [...bySlug.values()];
  authors.forEach((e) => {
    e.quotes.sort((x, y) => (CONF_ORDER[x.confidence] - CONF_ORDER[y.confidence]) || x.quote.localeCompare(y.quote));
    e.songs.sort((x, y) => x.title.localeCompare(y.title));
  });
  authors.sort((a, b) => a.name.localeCompare(b.name));
  return authors;
}

module.exports = { hasAuthorPage, aggregateAuthors };
