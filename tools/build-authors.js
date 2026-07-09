#!/usr/bin/env node
'use strict';
/*
 * build-authors.js — generate the author profiles and their browse index:
 *   authors/{slug}/index.html  → served at quotle.info/authors/{slug}
 *   authors/index.html         → served at quotle.info/authors/
 *
 * Aggregates the per-quote author blocks (bio/meta/initials, already on every detail page) into
 * one profile per real author, plus the list of that author's traced quotes. Uses the shared
 * modules (tokens, theme, header control, esc) — no bespoke chrome. Run by tools/build.js.
 */
const fs = require('fs');
const path = require('path');
const { HEAD_SCRIPT, THEME_CSS, CONTROL, SCRIPT } = require('./a11y-widget');
const { ROOT_CSS } = require('./tokens');
const { esc } = require('./esc');
const { CONFIDENCE } = require('./template');
const { aggregateAuthors } = require('./authors');

const ROOT = path.resolve(__dirname, '..');
const QUOTES_DIR = path.join(ROOT, 'data', 'quotes');
const OUT = path.join(ROOT, 'authors');
const ORIGIN = 'https://quotle.info';

// decode HTML entities / strip tags → plain text for JSON-LD string values
const plain = (s) => String(s || '').replace(/<[^>]+>/g, '')
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&middot;/g, '·')
  .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&lsquo;/g, '‘').replace(/&rsquo;/g, '’')
  .replace(/&hellip;/g, '…').replace(/&([a-z]+);/g, (m, e) => ({ amp: '&', quot: '"', lt: '<', gt: '>' }[e] || m))
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/\s+/g, ' ').trim();
const jsonLd = (obj) => JSON.stringify(obj, null, 2).split('\n').map((l, i) => (i === 0 ? l : '    ' + l)).join('\n');

const records = fs.readdirSync(QUOTES_DIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(QUOTES_DIR, f), 'utf8')));
const authors = aggregateAuthors(records);

// ---- shared chrome ----
const { NAV: siteNav, CHROME_CSS, SEARCH_JS } = require('./chrome');
const NAV = siteNav('authors');
const FOOTER = `    <footer>
        <p>quotle<span style="color:var(--burgundy)">.info</span> — every attribution traced to a primary source and dated. A <a href="https://gameshelf.co">Game Shelf</a> project.</p>
    </footer>`;

const STYLE = `${ROOT_CSS}
        * { margin:0; padding:0; box-sizing:border-box; }
        html { scroll-behavior:smooth; -webkit-font-smoothing:antialiased; }
        body { font-family:'Source Serif 4',Georgia,serif; background:var(--bg-deep); color:var(--ink); line-height:1.7; overflow-x:hidden; }
        a { color:inherit; }
        a:focus-visible, button:focus-visible { outline:2px solid var(--sage); outline-offset:3px; border-radius:4px; }
        .topnav { display:flex; align-items:center; justify-content:space-between; max-width:900px; margin:0 auto; padding:20px 24px 0; }
        .brand { display:inline-flex; align-items:center; gap:9px; text-decoration:none; font-family:'Playfair Display',serif; font-weight:900; font-size:1.05rem; }
        .brand-icon { width:30px; height:30px; border-radius:8px; background:linear-gradient(135deg,var(--burgundy),var(--burgundy-deep)); display:grid; place-items:center; font-size:0.95rem; }
        .brand span { color:var(--burgundy); }
        .nav-verify { font-family:'DM Sans',sans-serif; font-size:0.78rem; font-weight:500; color:var(--sage); text-decoration:none; display:inline-flex; align-items:center; gap:6px; padding:7px 13px; border:1px solid rgba(126,179,139,0.3); border-radius:999px; }
        .breadcrumb { max-width:900px; margin:0 auto; padding:14px 24px 0; font-family:'DM Sans',sans-serif; font-size:0.75rem; color:var(--text-muted); }
        .breadcrumb a { text-decoration:none; } .breadcrumb a:hover { color:var(--slate); }
        .breadcrumb .sep { margin:0 7px; opacity:0.6; }
        main { max-width:900px; margin:0 auto; padding:8px 24px 60px; }
        .kicker { font-family:'DM Sans',sans-serif; text-transform:uppercase; font-size:0.7rem; font-weight:600; letter-spacing:0.2em; color:var(--burgundy); margin-bottom:14px; }
        .sec-head { margin:44px 0 20px; }
        .sec-head h2 { font-family:'Playfair Display',serif; font-weight:900; font-size:1.6rem; letter-spacing:-0.015em; }
        /* author hero */
        .author-hero { display:flex; gap:22px; align-items:center; padding:30px 0 8px; }
        .author-avatar { width:66px; height:66px; border-radius:50%; flex-shrink:0; background:linear-gradient(135deg,var(--burgundy),var(--purple)); display:grid; place-items:center; font-family:'Playfair Display',serif; font-weight:900; font-size:1.6rem; color:#fff; }
        .author-hero h1 { font-family:'Playfair Display',serif; font-weight:900; font-size:clamp(1.9rem,5vw,2.6rem); line-height:1.1; letter-spacing:-0.02em; }
        .author-meta { font-family:'DM Sans',sans-serif; font-size:0.85rem; color:var(--text-muted); margin-top:6px; }
        .author-bio { font-size:1.05rem; color:var(--slate); margin-top:18px; max-width:660px; }
        .author-bio strong { color:var(--ink); } .author-bio em { color:var(--ink); }
        /* quote grid + cards */
        .q-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
        .q-card { display:flex; flex-direction:column; gap:14px; text-decoration:none; background:var(--bg-card); border:1px solid var(--border); border-left:3px solid var(--border); border-radius:12px; padding:20px 22px; transition:transform 0.2s,border-color 0.2s; }
        .q-card:hover { transform:translateY(-3px); }
        .q-card.verified { border-left-color:var(--sage); } .q-card.attributed { border-left-color:var(--amber); } .q-card.disputed { border-left-color:var(--caution); }
        .q-text { font-style:italic; font-size:1.05rem; color:var(--ink); }
        .q-conf { display:inline-flex; align-items:center; gap:7px; font-family:'DM Sans',sans-serif; font-weight:600; font-size:0.72rem; }
        .q-conf .dot { width:15px; height:15px; border-radius:50%; display:grid; place-items:center; font-size:0.6rem; font-weight:700; color:var(--bg-deep); }
        .q-card.verified .q-conf { color:var(--sage); } .q-card.verified .dot { background:var(--sage); }
        .q-card.attributed .q-conf { color:var(--amber); } .q-card.attributed .dot { background:var(--amber); }
        .q-card.disputed .q-conf { color:var(--caution); } .q-card.disputed .dot { background:var(--caution); }
        /* authors index */
        .idx-hero { padding:40px 0 4px; }
        .idx-hero h1 { font-family:'Playfair Display',serif; font-weight:900; font-size:clamp(2.1rem,6vw,3rem); line-height:1.05; letter-spacing:-0.02em; }
        .idx-hero .lede { font-size:1.05rem; color:var(--slate); margin-top:14px; }
        .idx-hero .lede b { color:var(--sage); }
        .author-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; margin-top:32px; }
        .ac { display:flex; gap:15px; align-items:center; text-decoration:none; background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:16px 18px; transition:transform 0.2s,border-color 0.2s; }
        .ac:hover { transform:translateY(-3px); border-color:var(--border-accent); }
        .ac .author-avatar { width:48px; height:48px; font-size:1.15rem; }
        .ac-name { font-family:'Playfair Display',serif; font-weight:700; font-size:1.05rem; color:var(--ink); }
        .ac-meta { font-family:'DM Sans',sans-serif; font-size:0.72rem; color:var(--text-muted); margin-top:2px; }
        .ac-count { font-family:'DM Sans',sans-serif; font-size:0.72rem; font-weight:600; color:var(--sage); margin-top:5px; }
        footer { text-align:center; padding:40px 24px; color:var(--text-muted); font-family:'DM Sans',sans-serif; font-size:0.8rem; border-top:1px solid var(--border); margin-top:48px; }
        footer a { color:var(--burgundy-link); text-decoration:none; }
        @media (prefers-reduced-motion: reduce) { html { scroll-behavior:auto; } * { transition:none !important; } }
        @media (max-width:560px) { .author-hero { flex-direction:column; text-align:center; align-items:center; } }`;

function page(inner, headExtra) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
${HEAD_SCRIPT}
${headExtra}
    <meta name="gs-app-id" content="quotle-info">
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
${STYLE}${CHROME_CSS}
    </style>
${THEME_CSS}
</head>
<body>
${NAV}
${inner}
${FOOTER}
${SEARCH_JS}
${SCRIPT}
</body>
</html>
`;
}

const quoteCard = (q) => {
  const c = CONFIDENCE[q.confidence] || CONFIDENCE.verified;
  return `                <a class="q-card ${c.cls}" href="/who-said/${q.slug}/">
                    <p class="q-text">&ldquo;${esc(q.quote)}&rdquo;</p>
                    <span class="q-conf"><span class="dot" aria-hidden="true">${c.glyph}</span>${esc(c.text)}</span>
                </a>`;
};

// ---- per-author pages ----
fs.mkdirSync(OUT, { recursive: true });
for (const a of authors) {
  const n = a.quotes.length;
  const head = `    <title>${esc(a.name)} — quotes traced to source · Quotle.info</title>
    <meta name="description" content="${esc(a.name)}: ${n} quote${n === 1 ? '' : 's'} traced to a primary source, with attribution verified and misattributions untangled.">
    <link rel="canonical" href="${ORIGIN}/authors/${a.slug}">
    <meta property="og:type" content="profile">
    <meta property="og:title" content="${esc(a.name)} — quotes traced to source">
    <meta property="og:url" content="${ORIGIN}/authors/${a.slug}">
    <meta property="og:site_name" content="Quotle.info">
    <script type="application/ld+json">
    ${jsonLd({
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      '@id': `${ORIGIN}/authors/${a.slug}`,
      mainEntity: {
        '@type': 'Person',
        '@id': `${ORIGIN}/authors/${a.slug}#person`,
        name: plain(a.name),
        description: plain(a.metaLine),
        subjectOf: a.quotes.map((q) => ({ '@type': 'Quotation', '@id': `${ORIGIN}/who-said/${q.slug}#quotation`, text: plain(q.quote), url: `${ORIGIN}/who-said/${q.slug}` })),
      },
    })}
    </script>`;
  const inner = `    <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a><span class="sep" aria-hidden="true">›</span>
        <a href="/authors/">Authors</a><span class="sep" aria-hidden="true">›</span>
        <span aria-current="page">${esc(a.name)}</span>
    </nav>
    <main>
        <header class="author-hero">
            <div class="author-avatar" aria-hidden="true">${esc(a.initials || '')}</div>
            <div>
                <h1>${esc(a.name)}</h1>
                <p class="author-meta">${esc(a.metaLine || '')}</p>
            </div>
        </header>
        <div class="author-bio">${a.bio}</div>
        <section aria-labelledby="q-h">
            <div class="sec-head"><p class="kicker">Traced to source</p><h2 id="q-h">${n} quote${n === 1 ? '' : 's'} we&rsquo;ve traced${n > 1 ? ` to ${esc(a.name)}` : ''}</h2></div>
            <div class="q-grid">
${a.quotes.map(quoteCard).join('\n')}
            </div>
        </section>
    </main>`;
  const dir = path.join(OUT, a.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(inner, head));
}

// ---- authors index ----
const totalQuotes = authors.reduce((s, a) => s + a.quotes.length, 0);
const authorCard = (a) => `                <a class="ac" href="/authors/${a.slug}/">
                    <div class="author-avatar" aria-hidden="true">${esc(a.initials || '')}</div>
                    <div>
                        <p class="ac-name">${esc(a.name)}</p>
                        <p class="ac-meta">${esc(a.metaLine || '')}</p>
                        <p class="ac-count">${a.quotes.length} quote${a.quotes.length === 1 ? '' : 's'}</p>
                    </div>
                </a>`;
const idxHead = `    <title>The authors — every voice traced to source · Quotle.info</title>
    <meta name="description" content="${authors.length} authors, ${totalQuotes} quotes traced to a primary source on Quotle.info. Who really said it, with receipts.">
    <link rel="canonical" href="${ORIGIN}/authors/">
    <meta property="og:type" content="website">
    <meta property="og:title" content="The authors — Quotle.info">
    <meta property="og:url" content="${ORIGIN}/authors/">
    <meta property="og:site_name" content="Quotle.info">`;
const idxInner = `    <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a><span class="sep" aria-hidden="true">›</span>
        <span aria-current="page">Authors</span>
    </nav>
    <main>
        <header class="idx-hero">
            <p class="kicker">Every voice, traced</p>
            <h1>The authors</h1>
            <p class="lede"><b>${authors.length}</b> authors · <b>${totalQuotes}</b> quotes traced to a primary source, with the misattributions untangled.</p>
        </header>
        <div class="author-grid">
${authors.map(authorCard).join('\n')}
        </div>
    </main>`;
fs.writeFileSync(path.join(OUT, 'index.html'), page(idxInner, idxHead));

console.log(`  ✓ authors/ (${authors.length} author pages + index, ${totalQuotes} quotes linked)`);
