#!/usr/bin/env node
'use strict';
/*
 * build-index.js — generate who-said/index.html: a browse directory of every
 * verified-provenance page, grouped by confidence. Reads data/manifest.json.
 * Run after tools/build.js.  Output: who-said/index.html (served at quotle.info/who-said/).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const GROUPS = [
  { key: 'verified',   label: 'Verified',   glyph: '✓', blurb: 'A primary source contains the exact line from the named author.' },
  { key: 'attributed', label: 'Attributed', glyph: '≈', blurb: 'Widely and plausibly credited, but no primary source pins it — honest uncertainty.' },
  { key: 'disputed',   label: 'Disputed',   glyph: '?', blurb: 'The famous name is wrong, or the wording is a later paraphrase — here is who really said it.' },
];

const byConf = { verified: [], attributed: [], disputed: [] };
manifest.forEach((m) => { (byConf[m.confidence] || (byConf[m.confidence] = [])).push(m); });
Object.values(byConf).forEach((arr) => arr.sort((a, b) => a.quote.localeCompare(b.quote)));

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

const total = manifest.length;
const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Who Really Said It — verified quote provenance | Quotle.info</title>
    <meta name="description" content="Browse ${total} quotes traced to their real source: who actually said it, the primary source, and the misattributions untangled.">
    <link rel="canonical" href="https://quotle.info/who-said/">
    <meta property="og:title" content="Who Really Said It — verified quote provenance">
    <meta property="og:description" content="${total} quotes traced to a primary source, with the misattributions untangled.">
    <meta property="og:url" content="https://quotle.info/who-said/">
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Source+Serif+4:ital@0;1&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root { --bg-deep:#0f0f1e; --bg-card:#252538; --bg-surface:#1a1a2e; --text-primary:#e8e0f0; --text-secondary:#a8b0c0; --text-muted:#9aa2b2; --burgundy:#d4627a; --burgundy-deep:#8B2635; --sage:#7eb38b; --amber:#e0a24e; --caution:#9aa3d6; --border:rgba(255,255,255,0.07); }
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'Source Serif 4',Georgia,serif; background:var(--bg-deep); color:var(--text-primary); line-height:1.6; -webkit-font-smoothing:antialiased; }
        a { color:inherit; }
        header { max-width:960px; margin:0 auto; padding:48px 24px 8px; }
        .brand { display:inline-flex; align-items:center; gap:9px; text-decoration:none; font-family:'Playfair Display',serif; font-weight:900; font-size:1.05rem; margin-bottom:32px; }
        .brand-icon { width:30px; height:30px; border-radius:8px; background:linear-gradient(135deg,var(--burgundy),var(--burgundy-deep)); display:grid; place-items:center; font-size:0.95rem; }
        .brand span { color:var(--burgundy); }
        h1 { font-family:'Playfair Display',serif; font-weight:900; font-size:clamp(2rem,6vw,3rem); line-height:1.1; letter-spacing:-0.02em; text-wrap:balance; }
        .lede { font-size:1.05rem; color:var(--text-secondary); margin-top:16px; max-width:640px; }
        .lede strong { color:var(--text-primary); }
        main { max-width:960px; margin:0 auto; padding:24px 24px 60px; }
        .grp { margin-top:44px; }
        .grp-head { display:flex; align-items:center; gap:12px; }
        .grp-badge { display:inline-flex; align-items:center; gap:8px; font-family:'DM Sans',sans-serif; font-weight:600; font-size:0.9rem; padding:6px 14px; border-radius:999px; border:1px solid; }
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
        .q-card:hover.verified { border-color:rgba(126,179,139,0.4); } .q-card:hover.attributed { border-color:rgba(224,162,78,0.4); } .q-card:hover.disputed { border-color:rgba(154,163,214,0.45); }
        .q-text { font-style:italic; font-size:1rem; color:var(--text-primary); }
        .q-author { font-family:'DM Sans',sans-serif; font-weight:600; font-size:0.82rem; color:var(--text-muted); margin-top:10px; }
        footer { max-width:960px; margin:0 auto; padding:32px 24px 48px; border-top:1px solid var(--border); font-family:'DM Sans',sans-serif; font-size:0.82rem; color:var(--text-muted); }
        footer a { color:var(--burgundy); text-decoration:none; }
        @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
    </style>
</head>
<body>
    <header>
        <a class="brand" href="/"><span class="brand-icon" aria-hidden="true">📖</span>quotle<span>.info</span></a>
        <h1>Who really said it?</h1>
        <p class="lede">Every quote below is traced to its <strong>real source</strong> — who actually said it, the primary document, and the misattributions untangled with receipts. ${total} quotes verified so far.</p>
    </header>
    <main>
${GROUPS.map(section).join('\n')}
    </main>
    <footer>
        <p>quotle<span style="color:var(--burgundy)">.info</span> — every attribution traced to a primary source and dated. A <a href="https://gameshelf.co">Game Shelf</a> project · <a href="https://gameshelf.co/quotle/">Play Quotle</a></p>
    </footer>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'who-said', 'index.html'), html);
console.log(`  ✓ who-said/index.html  (browse directory, ${total} quotes: ${(byConf.verified||[]).length} verified, ${(byConf.attributed||[]).length} attributed, ${(byConf.disputed||[]).length} disputed)`);
