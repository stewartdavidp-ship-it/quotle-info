'use strict';
/*
 * build-songs.js — the SONG-MISATTRIBUTION object: "who originally recorded it?".
 *
 * A sibling object to the quote pages, for the case the operator scoped: a song a band COVERED,
 * where the covering band is mistaken for the ORIGINAL recording artist. Same misattribution
 * mission as /who-said, but a distinct object — so it has its own record schema and this renderer
 * rather than branching the frozen quote template. It REUSES the shared engine: chrome (nav/footer),
 * design tokens, the a11y control, the OG card, and the /submit-source community feature.
 *
 * NO LYRICS, EVER. These pages state authorship + recording history (title, who wrote it, who
 * recorded it first, who covered it) and never reproduce lyric text. Song titles are not
 * copyrightable; that is the whole unit.
 *
 *   data/songs/{slug}.json  ──▶  who-recorded/{slug}/index.html
 *
 * URL contract: https://quotle.info/who-recorded/{songSlug}/  (trailing slash — same as /who-said/,
 * so GitHub Pages serves it directly with no canonical→redirect conflict).
 */
const fs = require('fs');
const path = require('path');
const { esc, escEm } = require('./esc');
const { ROOT_CSS } = require('./tokens');
const { HEAD_SCRIPT, THEME_CSS, CONTROL, SCRIPT } = require('./a11y-widget');
const { NAV, CHROME_CSS, SEARCH_JS, FOOTER } = require('./chrome');
const { plain } = require('./template');
const { OG_IMAGE_TAGS } = require('./og');
const { hasAuthorPage } = require('./authors');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://quotle.info';
const SONGS_DIR = path.join(ROOT, 'data', 'songs');
const canonicalUrl = (slug) => `${ORIGIN}/who-recorded/${slug}/`;
const wroteUrl = (slug) => `${ORIGIN}/who-wrote/${slug}/`;
// A song record carries a recording axis (/who-recorded/), a writing axis (/who-wrote/), or both.
// Default is recording — every record written before the writing axis existed.
const axesOf = (s) => (Array.isArray(s.axes) && s.axes.length ? s.axes : ['recording']);

let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'harvest-config.json'), 'utf8')); } catch (_) { /* optional */ }
const COMMUNITY = !!(CFG.votesApi && CFG.turnstileSitekey);

// v1: song artists are not yet in the author system, so /authors/{slug} pages don't exist for them
// — render names as plain text rather than ship dead links. The NEXT step is to feed song artists
// into build-authors.js so Gloria Jones / Soft Cell / Ed Cobb get real hub pages ("songs wrongly
// credited to…", the operator's "add them as authors"); then this flips to link only real pages.
const authorLink = (a) => (a && a.slug && fs.existsSync(path.join(ROOT, 'authors', a.slug)) ? `/authors/${a.slug}/` : null);

// Shared JSON-LD string helpers (used by both the recording and writing renderers). Plain ASCII
// apostrophe on purpose — these strings land inside <script type="application/ld+json">, where HTML
// entities are NOT decoded, so an &rsquo; would be read out literally by a voice assistant.
const possessive = (name) => { const n = String(name || '').trim(); return /s$/i.test(n) ? `${n}'` : `${n}'s`; };
const splitPeople = (name) => String(name || '')
  .replace(/\([^)]*\)/g, ' ')                      // drop parentheticals: "(credited as John Davenport)"
  .split(/\s*,\s*|\s+and\s+|\s*&\s*|\s*;\s*/)
  .map((x) => x.trim())
  .filter((x) => x.length > 1);
const personNodes = (name) => {
  const people = splitPeople(name);
  if (!people.length) return null;
  return people.length === 1 ? { '@type': 'Person', name: people[0] } : people.map((n) => ({ '@type': 'Person', name: n }));
};

// ---- JSON-LD: MusicRecording (+ composition) the claim is really about, ClaimReview, FAQ, crumb --
function buildJsonLd(s, url) {
  const sc = s.schema || {};
  const orig = s.answer.originalArtist;
  const cover = s.creditedTo;
  // sameAs = STABLE identifiers for the original recording (MusicBrainz, Wikidata). These are the
  // durable half of "where can I hear it": they never rot, they are non-commercial, and they let a
  // search engine resolve THIS recording as the same entity it already knows — which is the whole
  // claim the page is making. The human-facing streaming link (s.listen) is deliberately NOT put
  // here: those rot, and a dead identifier in structured data is worse than none.
  // The composer field is PROSE in the record ("Bert Berns, Solomon Burke and Jerry Wexler") and was
  // emitted as ONE Person carrying all three names — so every consumer read a single songwriter
  // literally called "Bert Berns, Solomon Burke and Jerry Wexler". Split it into real Person nodes.
  // Done HERE rather than by migrating 37 records: the split is deterministic, so the records stay
  // the human-readable prose they already are and nothing needs re-researching.
  // Band names ending in s took a naive 's — "The Rolling Stones's version is a cover" — and the FAQ
  // answer is the one string a voice assistant reads ALOUD, so it is the worst place for it.
  const possessive = (name) => {
    const n = String(name || '').trim();
    // Plain ASCII apostrophe on purpose: this string lands inside <script type="application/ld+json">,
    // where HTML entities are NOT decoded — an &rsquo; here would be read out literally.
    return /s$/i.test(n) ? `${n}'` : `${n}'s`;
  };
  const splitPeople = (name) => String(name || '')
    .replace(/\([^)]*\)/g, ' ')                      // drop parentheticals: "(credited as John Davenport)"
    .split(/\s*,\s*|\s+and\s+|\s*&\s*|\s*;\s*/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1);
  // Accept BOTH shapes. Records carry a prose string ("Bert Berns, Solomon Burke and Jerry
  // Wexler"), but a generate agent that knows better may write a proper array — pass-the-dutchie did,
  // and because this only read `.name` that page silently emitted NO composer node at all. A record
  // being MORE correct than the generator expects must never produce less output than a sloppy one.
  const composers = Array.isArray(sc.composer)
    ? sc.composer.flatMap((c) => splitPeople(c && c.name))
    : splitPeople(sc.composer && sc.composer.name);

  // The ORIGINAL is sometimes released under a different title than the page carries ("La Mer" vs
  // "Beyond the Sea"). alternateName lets the two resolve as ONE composition rather than looking
  // like unrelated works — the same title/artist mismatch that made the FAQ answer false until the
  // record authored its own.
  // A musicbrainz /work/ MBID identifies the COMPOSITION, not the recording — 16 of them sat on the
  // MusicRecording node asserting they identified that specific recording. Route by URL shape; only
  // the /work/ case is unambiguous, so everything else stays on the recording where it was.
  //
  // URL shape is not enough for Wikidata: a QID is opaque, and the SONG item ("original song
  // written and composed by …") and the RECORDING item look identical as strings. Seven wave-s3
  // fix agents filed this independently — Q3645800, Q2707288, Q1488986, Q5996063 and others are
  // composition entities that were being emitted as identifiers OF a specific recording. A record
  // cannot express the distinction in one flat array, so it declares it: `schema.workSameAs` is
  // merged into recordingOf.sameAs and removed from the recording node. Two records had good
  // identifiers DELETED as the only available workaround; both are restored via this field.
  const allSameAs = Array.isArray(s.sameAs) ? s.sameAs : [];
  const declaredWork = Array.isArray(sc.workSameAs) ? sc.workSameAs.map(String) : [];
  const isWork = (u) => /musicbrainz\.org\/work\//.test(String(u)) || declaredWork.includes(String(u));
  const workSameAs = [...new Set([...allSameAs.filter(isWork), ...declaredWork])];
  const recSameAs = allSameAs.filter((u) => !isWork(u));
  const compName = sc.recordingName || s.title;
  const altName = compName && s.title && compName !== s.title ? s.title : null;

  const recording = {
    '@type': 'MusicRecording',
    '@id': `${url}#recording`,
    name: compName,
    // Solo originators are PEOPLE, not bands. Default stays MusicGroup so existing records render
    // unchanged; a record opts in per-artist with schema.byArtist.type = "Person".
    byArtist: { '@type': (sc.byArtist && sc.byArtist.type) || 'MusicGroup', name: (sc.byArtist && sc.byArtist.name) || orig },
    ...(recSameAs.length ? { sameAs: recSameAs } : {}),
    datePublished: sc.datePublished || undefined,
    recordingOf: {
      '@type': 'MusicComposition',
      name: compName,
      ...(altName ? { alternateName: altName } : {}),
      ...(workSameAs.length ? { sameAs: workSameAs } : {}),
      ...(composers.length
        ? {
          composer: composers.length === 1
            ? { '@type': 'Person', name: composers[0] }
            : composers.map((n) => ({ '@type': 'Person', name: n })),
        }
        : {}),
    },
  };

  const claimText = `${cover} originally recorded "${s.title}".`;
  const claimReview = {
    '@type': 'ClaimReview',
    '@id': `${url}#claimreview`,
    url,
    datePublished: s.dateModified,
    claimReviewed: claimText,
    // NO `author` ON THE CLAIM. It used to name the cover act — asserting, in machine-readable
    // form, that Soft Cell claimed to have originated "Tainted Love". They never did; the public
    // believes it. That is the song-side twin of the quote ClaimReview bug that put a false claimant
    // on 59 pages. The claim here has no nameable author, so we assert none.
    itemReviewed: { '@type': 'Claim', text: claimText },
    author: { '@type': 'Organization', name: 'Quotle.info', url: ORIGIN },
    reviewRating: { '@type': 'Rating', ratingValue: 1, bestRating: 5, worstRating: 1, alternateName: 'False — it is a cover' },
  };

  const webPage = {
    '@type': 'WebPage', '@id': url, url,
    name: sc.webPageName || `Who originally recorded '${s.title}'?`,
    dateModified: s.dateModified,
    mainEntity: { '@id': `${url}#recording` },
  };

  const faq = {
    '@type': 'FAQPage', '@id': `${url}#faq`,
    mainEntity: [{
      '@type': 'Question',
      name: `Did ${cover} originally record "${s.title}"?`,
      acceptedAnswer: {
        '@type': 'Answer',
        // WELDING THE PAGE TITLE TO THE ORIGINAL ARTIST PUBLISHES A FALSE CLAIM when the original
        // was released under a DIFFERENT TITLE. "Beyond the Sea" is the case that found this: the
        // page correctly spends four paragraphs explaining that Roland Gerbeau recorded the French
        // "La Mer" in 1945, and that the first recording of the English "Beyond the Sea" was Harry
        // James in 1947 — while this string asserted, in machine-readable form, that Gerbeau first
        // recorded "Beyond the Sea". The prose and the structured data contradicted each other, and
        // only the structured data is what an assistant reads. Records where the two titles differ
        // must be able to state the answer themselves.
        text: sc.faqAnswer
          || `No. "${s.title}" was first recorded by ${orig}${sc.datePublished ? ' in ' + sc.datePublished : ''}; ${possessive(cover)} version is a cover.`,
      },
    }],
  };

  const crumb = {
    '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Who recorded it', item: `${ORIGIN}/who-recorded/` },
      { '@type': 'ListItem', position: 3, name: s.title },
    ],
  };

  return { '@context': 'https://schema.org', '@graph': [recording, claimReview, webPage, faq, crumb] };
}

function docMetaRows(rows) {
  return (rows || []).map((r) => `                    <dt>${esc(r.dt)}</dt><dd${r.ddClass ? ` class="${r.ddClass}"` : ''}>${r.dd}</dd>`).join('\n');
}

function renderAuthors(s) {
  return (s.authors || []).map((a) => {
    const href = authorLink(a);
    const name = href ? `<a href="${href}">${esc(a.name)}</a>` : esc(a.name);
    return `                <div class="song-author">
                    <div class="song-author-av" aria-hidden="true">${esc(a.initials || '')}</div>
                    <div class="song-author-body">
                        <p class="kicker">${esc(a.kicker || '')}</p>
                        <h3>${name}</h3>
                        <p class="song-author-meta">${a.metaLine || ''}</p>
                        <p class="song-author-bio">${a.bio || ''}</p>
                    </div>
                </div>`;
  }).join('\n');
}

// The ORIGINAL recording only — never the famous cover. The page's whole argument is "X recorded
// this first", and the persuasive artifact is the record almost nobody has heard; the cover is one
// search away for anyone. Optional by design: several originals (Numarx, Lulu and the Lampshades)
// have no legitimate official upload, and an absent link is better than a dubious one.
//
// The host and provenance are shown, not hidden behind a bare "Listen" — a reader deciding whether
// to click deserves to know where they are going and why we consider this copy legitimate. Rights
// posture matches the rest of the site: official artist/label/service uploads only, never "the
// first YouTube result", which on a 1964 recording is usually someone else's rip.
function renderListen(s) {
  const l = s.listen;
  if (!l || !l.url) return '';
  return `            <a class="song-listen" href="${esc(l.url)}" target="_blank" rel="noopener">
                <span class="song-listen-cue" aria-hidden="true">▶</span>
                <span class="song-listen-body">
                    <span class="song-listen-what">Hear ${l.what || 'the original recording'}</span>
                    <span class="song-listen-src">${esc(l.host || '')}${l.source ? ` &middot; ${l.source}` : ''}</span>
                </span>
                <span aria-hidden="true">↗</span>
            </a>`;
}

function renderSubmit(s) {
  if (!COMMUNITY) return '';
  return `
        <details class="src-add">
            <summary>Know more about the original &mdash; or think we&rsquo;ve got it wrong? <span class="src-add-cue">Add a source &rarr;</span></summary>
            <form class="src-add-form" id="srcForm" data-slug="song:${esc(s.songSlug)}">
                <p class="src-add-lede">Paste a URL and we&rsquo;ll check it. This doesn&rsquo;t change the page &mdash; it goes to our review queue, and if it holds up we update the record.</p>
                <div class="src-add-stance" role="radiogroup" aria-label="Does this source support or challenge the page?">
                    <label><input type="radio" name="stance" value="supports" checked> It supports this</label>
                    <label><input type="radio" name="stance" value="refutes"> It challenges this</label>
                </div>
                <input class="src-add-url" name="url" type="url" inputmode="url" placeholder="https://&hellip; link to the source" required>
                <input class="src-add-note" name="note" type="text" maxlength="600" placeholder="Optional: what does it show?">
                <div class="src-add-actions">
                    <button class="src-add-btn" type="submit">Submit source</button>
                    <span class="src-add-msg" id="srcMsg" hidden></span>
                </div>
            </form>
        </details>`;
}

// Decode entities in every string of a JSON-LD graph. URLs are left alone: plain() strips tags and
// collapses whitespace, which is right for prose and wrong for an identifier.
function deEntity(node) {
  if (typeof node === 'string') return /^https?:\/\//.test(node) ? node : plain(node);
  if (Array.isArray(node)) return node.map(deEntity);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = deEntity(v);
    return out;
  }
  return node;
}

function renderSong(s) {
  const url = canonicalUrl(s.songSlug);
  const a = s.answer, o = s.original, m = s.misattribution, c = s.context;
  // Song records store PROSE with HTML entities (&rsquo;, &mdash;) because that prose renders into
  // HTML. JSON-LD lives inside <script type="application/ld+json">, where entities are NOT decoded —
  // so a record-authored schema.faqAnswer shipped "Milli Vanilli&rsquo;s version is a cover" to the
  // one consumer that reads it aloud. The quote template has solved this since day one via plain();
  // the song builder simply never applied it. Walk every string in the graph through it.
  const jsonld = JSON.stringify(deEntity(buildJsonLd(s, url)));
  const oa = s.authors && s.authors.find((x) => x.role === 'original');
  const origName = authorLink(oa || {}) ? `<a href="/authors/${(oa || {}).slug}/">${esc(a.originalArtist)}</a>` : esc(a.originalArtist);

  const submitJs = COMMUNITY ? `
    <script>
        (function(){ var f=document.getElementById('srcForm'); if(!f) return;
            var API=${JSON.stringify(CFG.votesApi)}, SITEKEY=${JSON.stringify(CFG.turnstileSitekey)}, wid=null, pending=null;
            function ensure(){ if(wid!==null||!window.turnstile) return; var el=document.createElement('div'); el.style.display='none'; document.body.appendChild(el);
                wid=window.turnstile.render(el,{sitekey:SITEKEY,size:'invisible',callback:function(t){ var k=pending; pending=null; if(k)k(t); },'error-callback':function(){ var k=pending; pending=null; if(k)k(null); }}); }
            function token(cb){ ensure(); if(wid===null){ cb(null); return; } pending=cb; try{ window.turnstile.reset(wid); window.turnstile.execute(wid); }catch(e){ pending=null; cb(null); } }
            var msg=document.getElementById('srcMsg');
            function show(t,err){ msg.textContent=t; msg.hidden=false; msg.className='src-add-msg'+(err?' err':' ok'); }
            f.addEventListener('submit',function(e){ e.preventDefault();
                var url=f.url.value.trim(), note=f.note.value.trim(), slug=f.getAttribute('data-slug');
                var stance='supports', r=f.querySelector('input[name="stance"]:checked'); if(r) stance=r.value;
                if(!url){ show('Add a source URL.',true); return; }
                var btn=f.querySelector('.src-add-btn'); btn.disabled=true; show('Checking\\u2026',false);
                token(function(t){ if(!t){ btn.disabled=false; show('Verification failed \\u2014 please try again.',true); return; }
                    fetch(API+'/submit-source',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:slug,url:url,stance:stance,note:note,token:t})})
                    .then(function(r){return r.json();}).then(function(d){ if(d&&d.ok){ f.reset(); btn.disabled=false; show('Thank you \\u2014 sent to our review queue.',false); } else { btn.disabled=false; show((d&&d.error)||'Something went wrong.',true); } })
                    .catch(function(){ btn.disabled=false; show('Network error \\u2014 please try again.',true); }); }); });
        })();
    </script>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(s.meta.title)}</title>
    <meta name="description" content="${esc(s.meta.description)}">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="${esc(s.meta.ogTitle || s.meta.title)}">
    <meta property="og:description" content="${esc(s.meta.ogDescription || s.meta.description)}">
${OG_IMAGE_TAGS}
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script type="application/ld+json">
${jsonld}
    </script>
${HEAD_SCRIPT}
    <style>
${ROOT_CSS}${CHROME_CSS}
${SONG_CSS}
    </style>
${THEME_CSS}${COMMUNITY ? '\n    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
</head>
<body>
${NAV('songs')}
    <main id="main">
        <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span class="sep" aria-hidden="true">›</span><a href="/who-recorded/">Who recorded it</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">${esc(s.title)}</span></nav>

        <header class="song-hero">
            <p class="kicker">${esc(a.kicker || 'Who recorded it first')}</p>
            <h1>${esc(s.title)}</h1>
            <p class="song-verdict">${esc(a.label)}</p>
            <p class="song-lede">${a.sourceLine}</p>
        </header>

        <section class="song-card" aria-labelledby="rec-h">
            <div class="sec-head"><p class="kicker">${esc(o.kicker || 'The record')}</p><h2 id="rec-h">${esc(o.heading || 'Who recorded it first')}</h2></div>
            <dl class="doc-meta">
${docMetaRows(o.docMeta)}
            </dl>
${[
    // `released` (how the original was actually issued — single? B-side? album track?) and
    // `charted` (very often "did not chart", which is the whole reason the cover could eclipse it)
    // were researched, validated and stored on every song record since the first 27 — and never
    // rendered. They were dead data on all 37 pages until the wave-s1 audit noticed the honest
    // caveat it had written was nowhere on the page. These are inner HTML like o.trail, not esc()'d.
    o.released ? `            <p class="song-fact"><span>Released</span> ${o.released}</p>` : '',
    o.charted ? `            <p class="song-fact"><span>Charted</span> ${o.charted}</p>` : '',
  ].filter(Boolean).join('\n')}
${renderListen(s)}
            <p class="song-trail-title">${esc(o.trailTitle || 'How we traced it')}</p>
            ${(o.trail || []).map((t) => `<p class="song-trail">${t}</p>`).join('\n            ')}
            ${o.sourceLink ? `<a class="song-srclink" href="${esc(o.sourceLink.url)}" target="_blank" rel="noopener">${esc(o.sourceLink.text)} <span aria-hidden="true">↗</span></a>` : ''}
        </section>
${renderSubmit(s)}

        <section class="song-card" aria-labelledby="mis-h">
            <div class="sec-head"><p class="kicker">${esc(m.kicker || 'Fact-check')}</p><h2 id="mis-h">${esc(m.heading || 'The attribution problem')}</h2></div>
            <p class="song-intro">${m.intro}</p>
            ${(m.items || []).map((it) => `<div class="mis-item"><div class="mis-item-head"><span class="mis-scope">${esc(it.scope)}</span><span class="mis-tag">${escEm(it.tag)}</span></div><p class="mis-who">${it.who}</p><p class="mis-why">${it.why}</p></div>`).join('\n            ')}
            <p class="song-truth">${m.truthLine}</p>
        </section>

        <section class="song-card" aria-labelledby="ctx-h">
            <div class="sec-head"><p class="kicker">${esc(c.kicker || 'Context')}</p><h2 id="ctx-h">${esc(c.heading || 'Why the cover eclipsed it')}</h2></div>
            ${(c.lead || []).map((p) => `<p class="song-ctx">${p}</p>`).join('\n            ')}
            ${c.detailsBody ? `<details class="song-timeline"><summary>${esc(c.detailsSummary || 'Timeline')}</summary><ul>${c.detailsBody.map((d) => `<li>${d}</li>`).join('')}</ul></details>` : ''}
            ${c.pull ? `<blockquote class="song-pull">${escEm(c.pull)}</blockquote>` : ''}
        </section>

        <section class="song-authors" aria-label="The people behind the song">
${renderAuthors(s)}
        </section>

        ${s.rights ? `<aside class="song-rights"><p class="kicker">Reuse &amp; rights</p><p>${s.rights.note}</p></aside>` : ''}

        <aside class="game-cta" aria-label="Related game">
            <p class="cta-title">Think you know your quotes?</p>
            <p>Quotle is a daily puzzle: guess the author from the words alone.</p>
            <a class="game-cta-btn" href="https://gameshelf.co/quotle/" target="_blank" rel="noopener">Play today's Quotle <span aria-hidden="true">→</span></a>
        </aside>
    </main>
${FOOTER}
${SEARCH_JS}
${SCRIPT}${submitJs}
</body>
</html>`;
}

// ---- src-add CSS (verbatim from the quote template) + song-page CSS -------
const SONG_CSS = `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Source Serif 4', Georgia, serif; background: var(--bg-deep); color: var(--ink); line-height: 1.7; }
        a { color: inherit; }
        main#main { max-width: 720px; margin: 0 auto; padding: 0 24px 40px; }
        .breadcrumb { padding: 18px 0 6px; font-family: 'DM Sans', sans-serif; font-size: 0.8rem; color: var(--text-muted); }
        .breadcrumb a { text-decoration: none; color: var(--slate); }
        .breadcrumb .sep { margin: 0 8px; opacity: 0.5; }
        .kicker { font-family: 'DM Sans', sans-serif; text-transform: uppercase; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.14em; color: var(--burgundy); margin-bottom: 10px; }
        .song-hero { padding: 26px 0 8px; }
        .song-hero h1 { font-family: 'Playfair Display', serif; font-weight: 900; font-size: clamp(2rem, 6vw, 3rem); line-height: 1.05; }
        .song-verdict { font-family: 'DM Sans', sans-serif; font-weight: 600; color: var(--caution); margin-top: 14px; font-size: 1.05rem; }
        .song-lede { margin-top: 14px; font-size: 1.1rem; color: var(--ink); }
        .sec-head { margin-bottom: 14px; }
        .sec-head h2 { font-family: 'Playfair Display', serif; font-weight: 900; font-size: 1.5rem; }
        .song-card { margin-top: 30px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 26px 26px 28px; }
        .doc-meta { display: grid; grid-template-columns: auto 1fr; gap: 6px 18px; font-family: 'DM Sans', sans-serif; font-size: 0.92rem; margin-bottom: 18px; }
        .doc-meta dt { color: var(--text-muted); text-transform: uppercase; font-size: 0.68rem; letter-spacing: 0.08em; padding-top: 4px; }
        .doc-meta dd { color: var(--ink); }
        .doc-meta dd.title { font-weight: 700; }
        .song-trail-title { font-family: 'DM Sans', sans-serif; text-transform: uppercase; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.12em; color: var(--slate); margin: 6px 0 10px; }
        .song-trail { font-size: 0.98rem; margin-bottom: 10px; color: var(--ink); }
        .song-fact { font-size: 0.95rem; margin-bottom: 8px; color: var(--ink); }
        .song-fact > span { font-family: 'DM Sans', sans-serif; text-transform: uppercase; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.08em; color: var(--text-muted); margin-right: 8px; }
        .song-srclink { display: inline-block; margin-top: 6px; font-family: 'DM Sans', sans-serif; font-size: 0.85rem; color: var(--burgundy-link); text-decoration: none; }
        /* "Hear the original" — a LINK, never an embedded player: a player costs page weight,
           sets third-party cookies on a site that sets none, and breaks the text-first character. */
        .song-listen { display: flex; align-items: center; gap: 12px; margin: 16px 0 4px; padding: 12px 16px; background: var(--bg-card); border: 1px solid var(--border); border-left: 3px solid var(--sage); border-radius: var(--radius-md); text-decoration: none; transition: border-color 0.15s, transform 0.15s; }
        .song-listen:hover { border-left-color: var(--gold); transform: translateY(-1px); }
        .song-listen-cue { color: var(--sage); font-size: 0.9rem; }
        .song-listen-body { display: flex; flex-direction: column; gap: 2px; flex: 1; }
        .song-listen-what { font-family: 'DM Sans', sans-serif; font-size: 0.9rem; font-weight: 600; color: var(--ink); }
        .song-listen-src { font-family: 'DM Sans', sans-serif; font-size: 0.75rem; color: var(--text-muted); }
        .song-intro { font-size: 1rem; color: var(--slate); margin-bottom: 16px; }
        .mis-item { border-left: 2px solid var(--border); padding: 4px 0 4px 16px; margin: 14px 0; }
        .mis-item-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
        .mis-scope { font-family: 'DM Sans', sans-serif; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
        .mis-tag { font-family: 'DM Sans', sans-serif; font-size: 0.72rem; color: var(--caution); }
        .mis-who { font-weight: 700; margin: 4px 0; }
        .mis-why { font-size: 0.95rem; color: var(--ink); }
        .song-truth { margin-top: 16px; padding: 14px 16px; background: var(--sage-dim); border-radius: var(--radius-md); font-size: 0.98rem; }
        .song-ctx { margin-bottom: 12px; }
        .song-timeline { margin: 12px 0; font-family: 'DM Sans', sans-serif; font-size: 0.9rem; }
        .song-timeline summary { cursor: pointer; color: var(--slate); }
        .song-timeline ul { margin: 10px 0 0 18px; color: var(--ink); }
        .song-timeline li { margin-bottom: 5px; }
        .song-pull { margin: 18px 0 4px; padding-left: 16px; border-left: 3px solid var(--burgundy); font-size: 1.15rem; font-style: italic; color: var(--ink); }
        .song-authors { margin-top: 34px; display: flex; flex-direction: column; gap: 18px; }
        .song-author { display: flex; gap: 16px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px 22px; }
        .song-author-av { flex: none; width: 46px; height: 46px; border-radius: 50%; background: var(--burgundy-glow); display: grid; place-items: center; font-family: 'DM Sans', sans-serif; font-weight: 700; color: var(--burgundy); }
        .song-author-body h3 { font-family: 'Playfair Display', serif; font-size: 1.2rem; }
        .song-author-body h3 a { text-decoration: none; color: var(--burgundy-link); }
        .song-author-meta { font-family: 'DM Sans', sans-serif; font-size: 0.78rem; color: var(--text-muted); margin: 2px 0 8px; }
        .song-author-bio { font-size: 0.95rem; color: var(--ink); }
        .song-rights { margin-top: 30px; padding: 18px 20px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); font-family: 'DM Sans', sans-serif; font-size: 0.85rem; color: var(--slate); }
        /* add-a-source (shared with quote pages) */
        .src-add { margin: 22px 0 4px; font-family: 'DM Sans', sans-serif; }
        .src-add > summary { list-style: none; cursor: pointer; font-size: 0.86rem; color: var(--text-muted); padding: 8px 0; border-top: 1px dashed var(--border); }
        .src-add > summary::-webkit-details-marker { display: none; }
        .src-add > summary:hover { color: var(--slate); }
        .src-add-cue { color: var(--burgundy-link); font-weight: 600; white-space: nowrap; }
        .src-add-form { margin-top: 12px; padding: 16px 18px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); display: flex; flex-direction: column; gap: 10px; }
        .src-add-lede { font-size: 0.82rem; color: var(--slate); line-height: 1.55; margin: 0; }
        .src-add-stance { display: flex; flex-wrap: wrap; gap: 16px; font-size: 0.85rem; color: var(--ink); }
        .src-add-stance label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
        .src-add-url, .src-add-note { width: 100%; padding: 10px 12px; background: var(--bg-deep); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--ink); font-family: 'DM Sans', sans-serif; font-size: 0.88rem; }
        .src-add-url:focus, .src-add-note:focus { outline: none; border-color: var(--burgundy); }
        .src-add-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .src-add-btn { padding: 9px 20px; background: linear-gradient(135deg, var(--burgundy), var(--burgundy-deep)); border: none; border-radius: var(--radius-sm); font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 0.85rem; color: white; cursor: pointer; }
        .src-add-btn:disabled { opacity: 0.55; cursor: default; }
        .src-add-msg { font-size: 0.82rem; }
        .src-add-msg.ok { color: var(--sage); }
        .src-add-msg.err { color: var(--caution); }
        .game-cta { margin-top: 40px; text-align: center; background: linear-gradient(135deg, var(--burgundy-glow), var(--gold-dim)); border: 1px solid var(--border-accent); border-radius: var(--radius-lg); padding: 32px 24px; }
        .game-cta .cta-title { font-family: 'Playfair Display', serif; font-size: 1.3rem; margin-bottom: 8px; }
        .game-cta p { color: var(--slate); font-size: 0.92rem; margin-bottom: 18px; }
        .game-cta-btn { display: inline-flex; align-items: center; gap: 10px; padding: 13px 28px; background: linear-gradient(135deg, var(--burgundy), var(--burgundy-deep)); border-radius: var(--radius-md); font-family: 'DM Sans', sans-serif; font-weight: 600; color: white; text-decoration: none; }`;

// ---- /who-recorded/ browse index ----
function renderIndex(songs) {
  const url = `${ORIGIN}/who-recorded/`;
  const cards = songs.map((s) => `                <a class="song-idx-card" href="/who-recorded/${s.songSlug}/">
                    <p class="song-idx-title">${esc(s.title)}</p>
                    <p class="song-idx-rel"><span class="song-idx-credit">Credited to ${esc(s.creditedTo)}</span> &mdash; first recorded by <strong>${esc(s.answer.originalArtist)}</strong>${s.original && s.answer ? '' : ''}</p>
                </a>`).join('\n');
  const n = songs.length;
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Who recorded it? — songs credited to the wrong artist | Quotle.info</title>
    <meta name="description" content="Songs everyone thinks a famous act originated — but that were first recorded by someone else. ${n} traced to the original recording.">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="Who recorded it? — songs credited to the wrong artist">
    <meta property="og:description" content="Famous covers mistaken for originals, traced to who recorded them first.">
${OG_IMAGE_TAGS}
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
${HEAD_SCRIPT}
    <style>
${ROOT_CSS}${CHROME_CSS}
${SONG_CSS}
        .song-idx-grid { display: grid; gap: 14px; margin-top: 26px; }
        @media (min-width: 620px) { .song-idx-grid { grid-template-columns: 1fr 1fr; } }
        .song-idx-card { display: block; background: var(--bg-card); border: 1px solid var(--border); border-left: 3px solid var(--caution); border-radius: var(--radius-md); padding: 18px 20px; text-decoration: none; transition: border-color 0.15s, transform 0.15s; }
        .song-idx-card:hover { border-left-color: var(--burgundy); transform: translateY(-2px); }
        .song-idx-title { font-family: 'Playfair Display', serif; font-weight: 700; font-size: 1.2rem; color: var(--ink); }
        .song-idx-rel { font-family: 'DM Sans', sans-serif; font-size: 0.85rem; color: var(--slate); margin-top: 6px; }
        .song-idx-credit { color: var(--text-muted); }
    </style>
${THEME_CSS}
</head>
<body>
${NAV('songs')}
    <main id="main">
        <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">Who recorded it</span></nav>
        <header class="song-hero">
            <p class="kicker">Who recorded it first</p>
            <h1>Songs credited to the wrong artist</h1>
            <p class="song-lede">Famous versions everyone takes for the original &mdash; but the song was first recorded by someone else, and a later cover took the credit. ${n === 1 ? 'One song' : `${n} songs`} traced to the original recording. No lyrics, just the record.</p>
        </header>
        <div class="song-idx-grid">
${cards}
        </div>
        <aside class="song-rights" style="margin-top:34px"><p class="kicker">The scope</p><p>These are songs a band <strong>covered</strong> where the cover is mistaken for the original recording. We correct who recorded it first &mdash; the songwriter is noted as context, and we never reproduce lyrics.</p><p style="margin-top:10px">Looking for who <strong>wrote</strong> a song rather than who recorded it first? See <a href="/who-wrote/">Who wrote it &rarr;</a></p></aside>
    </main>
${FOOTER}
${SEARCH_JS}
${SCRIPT}
</body>
</html>`;
}

// ======================================================================================
// THE WRITING AXIS — /who-wrote/ : "who WROTE this song?"
// A second axis on the music object. The performer is correctly credited AS the performer; the
// page reveals (or, for a `misbelief` record, corrects a false belief about) who WROTE it. Three
// shapes, from workflows/SCOPE-who-wrote-it.md:
//   credit    — the writer is not the definitive performer (revelation → NO ClaimReview)
//   misbelief — the public thinks the performer wrote it (fact-check → ClaimReview rates it false)
//   contested — litigated/disputed authorship (disputed by the facts → NO false-claim rating)
// ======================================================================================
function buildWroteJsonLd(s, url) {
  const sc = s.schema || {};
  const w = s.writing || {};
  const performer = s.creditedTo;                       // correctly credited AS the performer
  const writer = w.writer;
  const compName = sc.recordingName || s.title;
  const altName = compName && s.title && compName !== s.title ? s.title : null;
  const allSameAs = Array.isArray(s.sameAs) ? s.sameAs : [];
  const declaredWork = Array.isArray(sc.workSameAs) ? sc.workSameAs.map(String) : [];
  const isWork = (u) => /musicbrainz\.org\/work\//.test(String(u)) || declaredWork.includes(String(u));
  const workSameAs = [...new Set([...allSameAs.filter(isWork), ...declaredWork])];
  const recSameAs = allSameAs.filter((u) => !isWork(u));

  // Composer nodes come from schema.composer when the record gives one (an array of {name}, or a
  // single {name}) — the controllable, machine-clean source — and fall back to splitting the prose
  // `writing.writer` string only when it doesn't. The prose ("… with Matthew Fisher (co-author,
  // established 2009)") is written for humans and splits messily, so a record that names its
  // composers explicitly is always preferred.
  const composers = Array.isArray(sc.composer)
    ? sc.composer.flatMap((c) => splitPeople(c && c.name))
    : ((sc.composer && sc.composer.name) ? splitPeople(sc.composer.name) : splitPeople(writer));
  const composerNode = composers.length === 1
    ? { '@type': 'Person', name: composers[0] }
    : composers.map((n) => ({ '@type': 'Person', name: n }));
  const composition = {
    '@type': 'MusicComposition',
    name: compName,
    ...(altName ? { alternateName: altName } : {}),
    ...(workSameAs.length ? { sameAs: workSameAs } : {}),
    ...(composers.length ? { composer: composerNode } : {}),
  };
  const recording = {
    '@type': 'MusicRecording',
    '@id': `${url}#recording`,
    name: compName,
    byArtist: { '@type': (sc.byArtist && sc.byArtist.type) || 'MusicGroup', name: (sc.byArtist && sc.byArtist.name) || performer },
    ...(recSameAs.length ? { sameAs: recSameAs } : {}),
    datePublished: sc.datePublished || undefined,
    recordingOf: composition,
  };

  const webPage = {
    '@type': 'WebPage', '@id': url, url,
    name: sc.webPageName || `Who wrote '${s.title}'?`,
    dateModified: s.dateModified,
    mainEntity: { '@id': `${url}#recording` },
  };

  const faq = {
    '@type': 'FAQPage', '@id': `${url}#faq`,
    mainEntity: [{
      '@type': 'Question',
      name: `Who wrote "${s.title}"?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: sc.faqAnswer
          || `"${s.title}" was written by ${writer}. ${possessive(performer)} recording is the version most people know.`,
      },
    }],
  };

  const crumb = {
    '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Who wrote it', item: `${ORIGIN}/who-wrote/` },
      { '@type': 'ListItem', position: 3, name: s.title },
    ],
  };

  const graph = [recording, webPage, faq, crumb];

  // ClaimReview ONLY on `misbelief` — the one writing shape that adjudicates a false belief (the
  // public thinks the PERFORMER wrote it). credit and contested assert no false claim, so they emit
  // no ClaimReview: a page whose thesis is "nothing here is false" must not carry a machine-readable
  // false-rating (the mistake the recording-side ClaimReview note warns about).
  if (s.shape === 'misbelief') {
    const claimText = `${performer} wrote "${s.title}".`;
    graph.splice(1, 0, {
      '@type': 'ClaimReview',
      '@id': `${url}#claimreview`,
      url,
      datePublished: s.dateModified,
      claimReviewed: claimText,
      itemReviewed: { '@type': 'Claim', text: claimText },
      author: { '@type': 'Organization', name: 'Quotle.info', url: ORIGIN },
      reviewRating: { '@type': 'Rating', ratingValue: 1, bestRating: 5, worstRating: 1, alternateName: `False — written by ${writer}` },
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

function renderWrote(s) {
  const url = wroteUrl(s.songSlug);
  const w = s.writing || {}, c = s.context, m = s.misattribution;
  const jsonld = JSON.stringify(deEntity(buildWroteJsonLd(s, url)));

  const factCheck = (s.shape === 'misbelief' && m) ? `
        <section class="song-card" aria-labelledby="mis-h">
            <div class="sec-head"><p class="kicker">${esc(m.kicker || 'Fact-check')}</p><h2 id="mis-h">${esc(m.heading || 'The attribution problem')}</h2></div>
            <p class="song-intro">${m.intro}</p>
            ${(m.items || []).map((it) => `<div class="mis-item"><div class="mis-item-head"><span class="mis-scope">${esc(it.scope)}</span><span class="mis-tag">${escEm(it.tag)}</span></div><p class="mis-who">${it.who}</p><p class="mis-why">${it.why}</p></div>`).join('\n            ')}
            <p class="song-truth">${m.truthLine}</p>
        </section>` : '';

  const contextSec = c ? `
        <section class="song-card" aria-labelledby="ctx-h">
            <div class="sec-head"><p class="kicker">${esc(c.kicker || 'Context')}</p><h2 id="ctx-h">${esc(c.heading || 'The story behind the credit')}</h2></div>
            ${(c.lead || []).map((p) => `<p class="song-ctx">${p}</p>`).join('\n            ')}
            ${c.detailsBody ? `<details class="song-timeline"><summary>${esc(c.detailsSummary || 'Timeline')}</summary><ul>${c.detailsBody.map((d) => `<li>${d}</li>`).join('')}</ul></details>` : ''}
            ${c.pull ? `<blockquote class="song-pull">${escEm(c.pull)}</blockquote>` : ''}
        </section>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(s.meta.title)}</title>
    <meta name="description" content="${esc(s.meta.description)}">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="${esc(s.meta.ogTitle || s.meta.title)}">
    <meta property="og:description" content="${esc(s.meta.ogDescription || s.meta.description)}">
${OG_IMAGE_TAGS}
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script type="application/ld+json">
${jsonld}
    </script>
${HEAD_SCRIPT}
    <style>
${ROOT_CSS}${CHROME_CSS}
${SONG_CSS}
    </style>
${THEME_CSS}
</head>
<body>
${NAV('')}
    <main id="main">
        <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span class="sep" aria-hidden="true">›</span><a href="/who-wrote/">Who wrote it</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">${esc(s.title)}</span></nav>

        <header class="song-hero">
            <p class="kicker">${esc(w.kicker || 'Who wrote it')}</p>
            <h1>${esc(s.title)}</h1>
            <p class="song-verdict">${esc(w.label || '')}</p>
            <p class="song-lede">${w.sourceLine || ''}</p>
        </header>

        <section class="song-card" aria-labelledby="rec-h">
            <div class="sec-head"><p class="kicker">${esc(w.recordKicker || 'The credit')}</p><h2 id="rec-h">${esc(w.recordHeading || 'Who wrote it')}</h2></div>
            <dl class="doc-meta">
${docMetaRows(w.docMeta)}
            </dl>
${w.definitiveVersion ? `            <p class="song-fact"><span>Definitive version</span> ${w.definitiveVersion}</p>` : ''}
${renderListen(s)}
            <p class="song-trail-title">${esc(w.trailTitle || 'How we traced it')}</p>
            ${(w.trail || []).map((t) => `<p class="song-trail">${t}</p>`).join('\n            ')}
            ${w.sourceLink ? `<a class="song-srclink" href="${esc(w.sourceLink.url)}" target="_blank" rel="noopener">${esc(w.sourceLink.text)} <span aria-hidden="true">↗</span></a>` : ''}
        </section>
${renderSubmit(s)}
${factCheck}
${contextSec}

        <section class="song-authors" aria-label="The people behind the song">
${renderAuthors(s)}
        </section>

        ${s.rights ? `<aside class="song-rights"><p class="kicker">Reuse &amp; rights</p><p>${s.rights.note}</p></aside>` : ''}

        <aside class="game-cta" aria-label="Related game">
            <p class="cta-title">Think you know your quotes?</p>
            <p>Quotle is a daily puzzle: guess the author from the words alone.</p>
            <a class="game-cta-btn" href="https://gameshelf.co/quotle/" target="_blank" rel="noopener">Play today's Quotle <span aria-hidden="true">→</span></a>
        </aside>
    </main>
${FOOTER}
${SEARCH_JS}
${SCRIPT}
</body>
</html>`;
}

// ---- /who-wrote/ browse index ----
function renderWroteIndex(songs) {
  const url = `${ORIGIN}/who-wrote/`;
  const cards = songs.map((s) => `                <a class="song-idx-card" href="/who-wrote/${s.songSlug}/">
                    <p class="song-idx-title">${esc(s.title)}</p>
                    <p class="song-idx-rel"><span class="song-idx-credit">Recorded by ${esc(s.creditedTo)}</span> &mdash; written by <strong>${esc((s.writing || {}).writer || '')}</strong></p>
                </a>`).join('\n');
  const n = songs.length;
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Who wrote it? — the songwriter behind the hit | Quotle.info</title>
    <meta name="description" content="Songs the public knows by the performer — but written by someone else. ${n} traced to who actually wrote them.">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="Who wrote it? — the songwriter behind the hit">
    <meta property="og:description" content="Songs you know by the singer, written by someone else — traced to who actually wrote them.">
${OG_IMAGE_TAGS}
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
${HEAD_SCRIPT}
    <style>
${ROOT_CSS}${CHROME_CSS}
${SONG_CSS}
        .song-idx-grid { display: grid; gap: 14px; margin-top: 26px; }
        @media (min-width: 620px) { .song-idx-grid { grid-template-columns: 1fr 1fr; } }
        .song-idx-card { display: block; background: var(--bg-card); border: 1px solid var(--border); border-left: 3px solid var(--caution); border-radius: var(--radius-md); padding: 18px 20px; text-decoration: none; transition: border-color 0.15s, transform 0.15s; }
        .song-idx-card:hover { border-left-color: var(--burgundy); transform: translateY(-2px); }
        .song-idx-title { font-family: 'Playfair Display', serif; font-weight: 700; font-size: 1.2rem; color: var(--ink); }
        .song-idx-rel { font-family: 'DM Sans', sans-serif; font-size: 0.85rem; color: var(--slate); margin-top: 6px; }
        .song-idx-credit { color: var(--text-muted); }
    </style>
${THEME_CSS}
</head>
<body>
${NAV('')}
    <main id="main">
        <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">Who wrote it</span></nav>
        <header class="song-hero">
            <p class="kicker">Who wrote it</p>
            <h1>The songwriter behind the hit</h1>
            <p class="song-lede">Songs the public knows by the singer &mdash; but written by someone else, who often had the bigger career as a writer than a performer. ${n === 1 ? 'One song' : `${n} songs`} traced to who actually wrote them. No lyrics, just the credit.</p>
        </header>
        <div class="song-idx-grid">
${cards}
        </div>
        <aside class="song-rights" style="margin-top:34px"><p class="kicker">The scope</p><p>These are songs where the performer is correctly credited &mdash; but a different, often well-known, artist WROTE the song. We name the writer and the definitive recording, and we never reproduce lyrics.</p><p style="margin-top:10px">Looking for a famous <strong>cover</strong> mistaken for the original recording? See <a href="/who-recorded/">Who recorded it first &rarr;</a></p></aside>
    </main>
${FOOTER}
${SEARCH_JS}
${SCRIPT}
</body>
</html>`;
}

// ---- build ----
function build() {
  if (!fs.existsSync(SONGS_DIR)) return;
  const files = fs.readdirSync(SONGS_DIR).filter((f) => f.endsWith('.json'));
  const recording = [];
  const writing = [];
  for (const f of files) {
    const s = JSON.parse(fs.readFileSync(path.join(SONGS_DIR, f), 'utf8'));
    const axes = axesOf(s);
    if (axes.includes('recording')) {
      const dir = path.join(ROOT, 'who-recorded', s.songSlug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), renderSong(s));
      recording.push(s);
    }
    if (axes.includes('writing')) {
      const dir = path.join(ROOT, 'who-wrote', s.songSlug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), renderWrote(s));
      writing.push(s);
    }
  }
  recording.sort((a, b) => a.title.localeCompare(b.title));
  fs.mkdirSync(path.join(ROOT, 'who-recorded'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'who-recorded', 'index.html'), renderIndex(recording));
  console.log(`  ✓ who-recorded/ (${recording.length} song page${recording.length === 1 ? '' : 's'} + index)`);
  if (writing.length) {
    writing.sort((a, b) => a.title.localeCompare(b.title));
    fs.mkdirSync(path.join(ROOT, 'who-wrote'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'who-wrote', 'index.html'), renderWroteIndex(writing));
    console.log(`  ✓ who-wrote/ (${writing.length} song page${writing.length === 1 ? '' : 's'} + index)`);
  }
}

build();
module.exports = { canonicalUrl };
