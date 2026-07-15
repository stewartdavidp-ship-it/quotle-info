'use strict';
/*
 * og-card.js — writes the source HTML for the site's default social card (/og/default.png).
 *
 * NOT part of `node tools/build.js`. This is a ONE-TIME asset generator: the PNG it produces is
 * committed to the repo, so the build stays pure string templating with no rasteriser dependency
 * (see CLAUDE.md CONSTRAINTs: "no build tools, no npm, no framework"). You only need to re-run it
 * if the card art or the brand palette changes.
 *
 * The palette is injected from tokens.js rather than hand-rolled, so the card can never drift from
 * the site (and therefore from the Quotle game's dark theme).
 *
 * Regenerate:
 *   node tools/og-card.js                      # writes /tmp/og-card.html
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
 *     --window-size=1200,630 --virtual-time-budget=10000 \
 *     --screenshot=og/default.png /tmp/og-card.html
 *
 * Chrome is used only to rasterise (it fetches the same Google Fonts the site loads, so the card
 * gets real Playfair Display / DM Sans instead of a local fallback). No brand fonts are installed
 * on the build machine, and no npm rasteriser can render webfonts without one.
 *
 * Deliberately NO quote count on the card: the corpus grows, but this PNG is static and would
 * silently go stale. The card sells the promise; the page's og:description carries the specifics.
 */
const fs = require('fs');
const path = require('path');
const { ROOT_CSS } = require('./tokens.js');

// The logo mark, inlined from logo.svg so the card is a single self-contained file for Chrome.
const LOGO = `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#d4627a"/><stop offset="1" stop-color="#9e3b52"/>
      </linearGradient></defs>
      <rect width="512" height="512" rx="112" fill="url(#g)"/>
      <path fill="#fff" d="M181 342c-34 0-59-26-59-63 0-52 38-93 92-110l16 30c-31 12-51 33-56 57 3-2 8-3 14-3 30 0 52 22 52 51 0 27-24 48-59 48zm168 0c-34 0-59-26-59-63 0-52 38-93 92-110l16 30c-31 12-51 33-56 57 3-2 8-3 14-3 30 0 52 22 52 51 0 27-24 48-59 48z"/>
    </svg>`;

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>quotle.info — default social card</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,900&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${ROOT_CSS}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 1200px; height: 630px; }
    body {
        background: var(--bg-deep);
        font-family: 'DM Sans', system-ui, sans-serif;
        color: var(--ink);
        overflow: hidden;
        position: relative;
    }
    /* Burgundy bloom top-left, gold counter-bloom bottom-right — the site's card depth, scaled up. */
    .bloom-a, .bloom-b { position: absolute; border-radius: 50%; }
    .bloom-a { top: -280px; left: -220px; width: 760px; height: 760px;
               background: radial-gradient(circle, var(--burgundy-glow) 0%, transparent 70%); }
    .bloom-b { bottom: -340px; right: -240px; width: 700px; height: 700px;
               background: radial-gradient(circle, var(--gold-dim) 0%, transparent 70%); }

    .card { position: relative; height: 100%; padding: 64px 72px;
            display: flex; flex-direction: column; justify-content: space-between; }

    /* Oversized closing quote mark anchoring the right third — keeps the composition from
       listing to the left without competing with the headline. */
    .mark { position: absolute; right: 64px; top: 132px;
            font-family: 'Playfair Display', Georgia, serif; font-weight: 900; font-style: italic;
            font-size: 500px; line-height: 1; color: var(--burgundy); opacity: 0.13;
            user-select: none; }

    .brand { display: flex; align-items: center; gap: 16px; }
    .brand svg { width: 52px; height: 52px; border-radius: 12px; display: block; }
    .brand .wordmark { font-size: 27px; font-weight: 700; letter-spacing: -0.01em; color: var(--ink); }
    .brand .wordmark .tld { color: var(--slate); font-weight: 500; }

    h1 { font-family: 'Playfair Display', Georgia, serif; font-weight: 900;
         font-size: 92px; line-height: 1.03; letter-spacing: -0.02em; color: var(--ink); }
    h1 em { font-style: italic; color: var(--gold); }
    .sub { margin-top: 26px; font-size: 27px; line-height: 1.45; font-weight: 400;
           color: var(--slate); max-width: 30ch; }

    /* The three confidence states the site actually grades every quote against. */
    .states { display: flex; gap: 12px; align-items: center; }
    .chip { display: inline-flex; align-items: center; gap: 9px;
            padding: 11px 20px; border-radius: 999px; font-size: 20px; font-weight: 600;
            border: 1px solid var(--border); background: var(--bg-card); }
    .dot { width: 11px; height: 11px; border-radius: 50%; }
    .c-verified   { color: var(--sage);    border-color: var(--sage-dim); }
    .c-verified .dot   { background: var(--sage); }
    .c-attributed { color: var(--amber); }
    .c-attributed .dot { background: var(--amber); }
    .c-disputed   { color: var(--caution); }
    .c-disputed .dot   { background: var(--caution); }

    /* Burgundy→gold hairline: the same accent pairing the site's section heads use. */
    .rule { position: absolute; left: 0; right: 0; bottom: 0; height: 7px;
            background: linear-gradient(90deg, var(--burgundy) 0%, var(--burgundy-deep) 45%, var(--gold) 100%); }
</style>
</head>
<body>
    <div class="bloom-a"></div>
    <div class="bloom-b"></div>
    <div class="card">
        <div class="mark">&rdquo;</div>
        <div class="brand">
            ${LOGO}
            <span class="wordmark">Quotle<span class="tld">.info</span></span>
        </div>
        <div>
            <h1>Real quote?<br><em>Cleared</em> to use?</h1>
            <p class="sub">Verified provenance and reuse rights &mdash; traced to a primary source.</p>
        </div>
        <div class="states">
            <span class="chip c-verified"><span class="dot"></span>Verified</span>
            <span class="chip c-attributed"><span class="dot"></span>Attributed</span>
            <span class="chip c-disputed"><span class="dot"></span>Disputed</span>
        </div>
    </div>
    <div class="rule"></div>
</body>
</html>`;

const out = process.argv[2] || path.join(require('os').tmpdir(), 'og-card.html');
fs.writeFileSync(out, HTML);
console.log(out);
