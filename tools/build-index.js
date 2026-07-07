#!/usr/bin/env node
'use strict';
/*
 * build-index.js — generate the quotle.info homepage AND the /who-said/ browse directory
 * from data/manifest.json. Both are the same page (hero + featured + grouped grid), written to:
 *   index.html            → served at quotle.info/       (the site's front door)
 *   who-said/index.html   → served at quotle.info/who-said/
 * Run after tools/build.js (which requires this).  The old Firebase "Context Engine" SPA that
 * previously lived at index.html is preserved in git history.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const bySlug = Object.fromEntries(manifest.map((m) => [m.quoteSlug, m]));

// Hand-picked marquee reattributions for the featured strip (skipped silently if not built yet).
const FEATURED = [
  { slug: 'there-is-no-greater-agony-than-bearing-an-untold-story', credited: 'Maya Angelou', real: 'Zora Neale Hurston' },
  { slug: 'stay-hungry-stay-foolish', credited: 'Steve Jobs', real: 'Stewart Brand' },
  { slug: 'quality-is-not-an-act-it-is-a-habit', credited: 'Aristotle', real: 'Will Durant' },
  { slug: 'the-future-belongs-to-those-who-believe-in-the-beauty-of', credited: 'Eleanor Roosevelt', real: 'Anonymous (1978)' },
].filter((f) => bySlug[f.slug]);

const GROUPS = [
  { key: 'verified',   label: 'Verified',   glyph: '✓', blurb: 'A primary source contains the exact line from the named author.' },
  { key: 'attributed', label: 'Attributed', glyph: '≈', blurb: 'Widely and plausibly credited, but no primary source pins it — honest uncertainty.' },
  { key: 'disputed',   label: 'Disputed',   glyph: '?', blurb: 'The famous name is wrong, or the wording is a later paraphrase — here is who really said it.' },
];
const byConf = { verified: [], attributed: [], disputed: [] };
manifest.forEach((m) => { (byConf[m.confidence] || (byConf[m.confidence] = [])).push(m); });
Object.values(byConf).forEach((arr) => arr.sort((a, b) => a.quote.localeCompare(b.quote)));

const total = manifest.length;

const featuredCard = (f) => {
  const m = bySlug[f.slug];
  return `                <a class="feat" href="/who-said/${f.slug}/">
                    <p class="feat-q">&ldquo;${esc(m.quote)}&rdquo;</p>
                    <p class="feat-swap"><span class="feat-no">${esc(f.credited)}</span><span class="feat-arrow" aria-hidden="true">→</span><span class="feat-yes">${esc(f.real)}</span></p>
                </a>`;
};

const card = (m) => `                <a class="q-card ${m.confidence}" href="/who-said/${m.quoteSlug}/">
                    <p class="q-text">&ldquo;${esc(m.quote)}&rdquo;</p>
                    <p class="q-author">${esc(m.author || 'Unknown')}</p>
                </a>`;

const section = (g) => {
  const items = byConf[g.key] || [];
  if (!items.length) return '';
  return `
        <section class="grp" aria-labelledby="h-${g.key}">
            <div class="grp-head">
                <span class="grp-badge ${g.key}"><span class="grp-dot">${g.glyph}</span>${g.label}</span>
                <span class="grp-count">${items.length}</span>
            </div>
            <p class="grp-blurb">${g.blurb}</p>
            <div class="q-grid">
${items.map(card).join('\n')}
            </div>
        </section>`;
};

const featuredBlock = FEATURED.length ? `
        <section class="featured" aria-label="Notable reattributions">
            <p class="feat-kicker">Not who you think</p>
            <div class="feat-grid">
${FEATURED.map(featuredCard).join('\n')}
            </div>
        </section>` : '';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quotle.info — Who really said it? Verified quote provenance</title>
    <meta name="description" content="Every quote traced to its real source: who actually said it, the primary document, and the misattributions untangled with receipts. ${total} quotes verified.">
    <link rel="canonical" href="https://quotle.info/">
    <meta property="og:type" content="website">
    <meta property="og:title" content="Quotle.info — Who really said it?">
    <meta property="og:description" content="${total} quotes traced to a primary source, with the misattributions untangled with receipts.">
    <meta property="og:url" content="https://quotle.info/">
    <meta property="og:site_name" content="Quotle.info">
    <meta name="twitter:card" content="summary_large_image">
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=Source+Serif+4:ital@0;1&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root { --bg-deep:#0f0f1e; --bg-card:#252538; --bg-surface:#1a1a2e; --text-primary:#e8e0f0; --text-secondary:#a8b0c0; --text-muted:#9aa2b2; --burgundy:#d4627a; --burgundy-deep:#8B2635; --burgundy-glow:rgba(212,98,122,0.15); --gold:#ffd369; --sage:#7eb38b; --amber:#e0a24e; --caution:#9aa3d6; --border:rgba(255,255,255,0.07); }
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'Source Serif 4',Georgia,serif; background:var(--bg-deep); color:var(--text-primary); line-height:1.6; -webkit-font-smoothing:antialiased; overflow-x:hidden; }
        a { color:inherit; }
        .topnav { display:flex; align-items:center; justify-content:space-between; max-width:1000px; margin:0 auto; padding:20px 24px 0; }
        .brand { display:inline-flex; align-items:center; gap:9px; text-decoration:none; font-family:'Playfair Display',serif; font-weight:900; font-size:1.05rem; }
        .brand-icon { width:30px; height:30px; border-radius:8px; background:linear-gradient(135deg,var(--burgundy),var(--burgundy-deep)); display:grid; place-items:center; font-size:0.95rem; }
        .brand span { color:var(--burgundy); }
        .nav-play { font-family:'DM Sans',sans-serif; font-size:0.78rem; font-weight:600; color:var(--gold); text-decoration:none; padding:7px 14px; border:1px solid rgba(255,211,105,0.3); border-radius:999px; }
        .hero { max-width:1000px; margin:0 auto; padding:52px 24px 12px; }
        .hero h1 { font-family:'Playfair Display',serif; font-weight:900; font-size:clamp(2.3rem,7vw,3.6rem); line-height:1.05; letter-spacing:-0.02em; text-wrap:balance; }
        .hero h1 em { font-style:italic; color:var(--burgundy); }
        .hero .lede { font-size:1.12rem; color:var(--text-secondary); margin-top:20px; max-width:640px; }
        .hero .lede strong { color:var(--text-primary); }
        .hero .stat { font-family:'DM Sans',sans-serif; font-size:0.82rem; color:var(--text-muted); margin-top:18px; letter-spacing:0.02em; }
        .hero .stat b { color:var(--sage); }
        main { max-width:1000px; margin:0 auto; padding:8px 24px 60px; }
        .featured { margin-top:40px; }
        .feat-kicker, .grp-head .grp-badge { font-family:'DM Sans',sans-serif; }
        .feat-kicker { text-transform:uppercase; font-size:0.7rem; font-weight:700; letter-spacing:0.2em; color:var(--burgundy); margin-bottom:16px; }
        .feat-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:12px; }
        .feat { display:block; text-decoration:none; background:linear-gradient(135deg,var(--burgundy-glow),transparent); border:1px solid rgba(212,98,122,0.25); border-radius:14px; padding:20px 22px; transition:transform 0.2s; }
        .feat:hover { transform:translateY(-3px); }
        .feat-q { font-style:italic; font-size:1.02rem; color:var(--text-primary); }
        .feat-swap { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:14px; font-family:'DM Sans',sans-serif; font-size:0.8rem; }
        .feat-no { color:var(--text-muted); text-decoration:line-through; }
        .feat-arrow { color:var(--burgundy); }
        .feat-yes { color:var(--sage); font-weight:600; }
        .grp { margin-top:44px; }
        .grp-head { display:flex; align-items:center; gap:12px; }
        .grp-badge { display:inline-flex; align-items:center; gap:8px; font-weight:600; font-size:0.9rem; padding:6px 14px; border-radius:999px; border:1px solid; }
        .grp-dot { width:18px; height:18px; border-radius:50%; display:grid; place-items:center; font-size:0.7rem; font-weight:700; color:var(--bg-deep); }
        .grp-badge.verified { color:var(--sage); border-color:rgba(126,179,139,0.4); } .grp-badge.verified .grp-dot { background:var(--sage); }
        .grp-badge.attributed { color:var(--amber); border-color:rgba(224,162,78,0.4); } .grp-badge.attributed .grp-dot { background:var(--amber); }
        .grp-badge.disputed { color:var(--caution); border-color:rgba(154,163,214,0.45); } .grp-badge.disputed .grp-dot { background:var(--caution); }
        .grp-count { font-family:'DM Sans',sans-serif; font-size:0.8rem; color:var(--text-muted); }
        .grp-blurb { font-family:'DM Sans',sans-serif; font-size:0.85rem; color:var(--text-muted); margin:10px 0 20px; max-width:620px; }
        .q-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
        .q-card { display:block; text-decoration:none; background:var(--bg-card); border:1px solid var(--border); border-left:3px solid var(--border); border-radius:12px; padding:18px 20px; transition:transform 0.2s,border-color 0.2s; }
        .q-card:hover { transform:translateY(-3px); }
        .q-card.verified { border-left-color:var(--sage); } .q-card.attributed { border-left-color:var(--amber); } .q-card.disputed { border-left-color:var(--caution); }
        .q-text { font-style:italic; font-size:1rem; color:var(--text-primary); }
        .q-author { font-family:'DM Sans',sans-serif; font-weight:600; font-size:0.82rem; color:var(--text-muted); margin-top:10px; }
        .game-cta { margin-top:56px; text-align:center; background:linear-gradient(135deg,var(--burgundy-glow),rgba(255,211,105,0.1)); border:1px solid rgba(212,98,122,0.25); border-radius:22px; padding:38px 28px; }
        .game-cta h2 { font-family:'Playfair Display',serif; font-size:1.5rem; margin-bottom:8px; }
        .game-cta p { color:var(--text-secondary); font-size:0.95rem; margin-bottom:20px; }
        .game-cta a { display:inline-flex; align-items:center; gap:10px; padding:13px 30px; background:linear-gradient(135deg,var(--burgundy),var(--burgundy-deep)); border-radius:14px; font-family:'DM Sans',sans-serif; font-weight:600; color:#fff; text-decoration:none; }
        footer { max-width:1000px; margin:0 auto; padding:36px 24px 52px; border-top:1px solid var(--border); font-family:'DM Sans',sans-serif; font-size:0.82rem; color:var(--text-muted); }
        footer a { color:var(--burgundy); text-decoration:none; }
        @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
        @media (max-width:560px){ .hero{padding-top:36px;} }
    </style>
</head>
<body>
    <nav class="topnav">
        <a class="brand" href="/"><span class="brand-icon" aria-hidden="true">📖</span>quotle<span>.info</span></a>
        <a class="nav-play" href="https://gameshelf.co/quotle/">Play Quotle →</a>
    </nav>
    <header class="hero">
        <h1>Who <em>really</em> said it?</h1>
        <p class="lede">The internet is full of confident misattributions. Quotle.info traces each quote to its <strong>real source</strong> — who actually said it, the primary document, and the misattributions untangled with receipts.</p>
        <p class="stat"><b>${total}</b> quotes verified · every attribution traced to a primary source and dated</p>
    </header>
    <main>
${featuredBlock}
${GROUPS.map(section).join('\n')}
        <aside class="game-cta">
            <h2>Think you know your quotes?</h2>
            <p>Quotle is a daily puzzle: guess the author from the words alone.</p>
            <a href="https://gameshelf.co/quotle/">Play today&rsquo;s Quotle <span aria-hidden="true">→</span></a>
        </aside>
    </main>
    <footer>
        <p>quotle<span style="color:var(--burgundy)">.info</span> — every attribution traced to a primary source and dated. A <a href="https://gameshelf.co">Game Shelf</a> project.</p>
    </footer>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'index.html'), html);
fs.writeFileSync(path.join(ROOT, 'who-said', 'index.html'), html);
console.log(`  ✓ index.html + who-said/index.html  (homepage/browse, ${total} quotes: ${(byConf.verified||[]).length} verified, ${(byConf.attributed||[]).length} attributed, ${(byConf.disputed||[]).length} disputed; ${FEATURED.length} featured)`);
