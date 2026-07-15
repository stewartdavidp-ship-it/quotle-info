#!/usr/bin/env node
'use strict';
/*
 * build-static.js — generate quotle.info's standing content pages (not per-quote).
 * Currently: /how-we-verify — the methodology + trust page that every quote's confidence
 * badge, nav pill, and "last verified" footer links to.
 *
 * Uses the SAME shared modules as the rest of the site (tokens.js, a11y-widget.js), so it
 * inherits the one design-token block, the light/dark theme, and the header display control
 * with zero bespoke scaffolding. Run by tools/build.js (which requires this).
 */
const fs = require('fs');
const path = require('path');
const { HEAD_SCRIPT, THEME_CSS, CONTROL, SCRIPT } = require('./a11y-widget');
const { ROOT_CSS } = require('./tokens');
const { NAV, CHROME_CSS, SEARCH_JS } = require('./chrome');
const { OG_IMAGE_TAGS } = require('./og'); // the one shared social-card image
const ROOT = path.resolve(__dirname, '..');

// confidence glyphs/labels mirror template.js CONFIDENCE (kept in sync by hand — 3 states)
const STATES = [
  { cls: 'verified', glyph: '✓', name: 'Verified',
    def: 'A primary source — the actual book, letter, speech, or first printing — contains the exact line, in the named author&rsquo;s own words. We link it.' },
  { cls: 'attributed', glyph: '≈', name: 'Attributed',
    def: 'The credit is old, widespread, and plausible, but no primary source pins it down. We say so plainly rather than manufacture false certainty.' },
  { cls: 'disputed', glyph: '?', name: 'Disputed',
    def: 'The famous name is wrong, or the wording is a later paraphrase. We show who really said it — or that no one verifiably did — with the receipts.' },
];

const stateRow = (s) => `                <div class="state">
                    <span class="state-badge ${s.cls}"><span class="state-dot">${s.glyph}</span>${s.name}</span>
                    <p class="state-def">${s.def}</p>
                </div>`;

const STYLE = `${ROOT_CSS}
        * { margin:0; padding:0; box-sizing:border-box; }
        html { scroll-behavior:smooth; -webkit-font-smoothing:antialiased; }
        body { font-family:'Source Serif 4',Georgia,serif; background:var(--bg-deep); color:var(--ink); line-height:1.7; overflow-x:hidden; }
        a { color:inherit; }
        a:focus-visible, button:focus-visible { outline:2px solid var(--sage); outline-offset:3px; border-radius:4px; }
        .topnav { display:flex; align-items:center; justify-content:space-between; max-width:760px; margin:0 auto; padding:20px 24px 0; }
        .brand { display:inline-flex; align-items:center; gap:9px; text-decoration:none; font-family:'Playfair Display',serif; font-weight:900; font-size:1.05rem; }
        .brand-icon { width:30px; height:30px; border-radius:8px; background:linear-gradient(135deg,var(--burgundy),var(--burgundy-deep)); display:grid; place-items:center; font-size:0.95rem; }
        .brand span { color:var(--burgundy); }
        .nav-verify { font-family:'DM Sans',sans-serif; font-size:0.78rem; font-weight:600; color:var(--sage); text-decoration:none; display:inline-flex; align-items:center; gap:6px; padding:7px 13px; border:1px solid rgba(126,179,139,0.3); border-radius:999px; background:var(--sage-dim); }
        main { max-width:680px; margin:0 auto; padding:8px 24px 64px; }
        .hero { padding:46px 0 8px; }
        .hero .kicker { font-family:'DM Sans',sans-serif; text-transform:uppercase; font-size:0.7rem; font-weight:700; letter-spacing:0.2em; color:var(--burgundy); margin-bottom:14px; }
        .hero h1 { font-family:'Playfair Display',serif; font-weight:900; font-size:clamp(2.1rem,6vw,3rem); line-height:1.08; letter-spacing:-0.02em; }
        .hero .lede { font-size:1.12rem; color:var(--slate); margin-top:18px; }
        .hero .lede strong { color:var(--ink); }
        section { margin-top:44px; }
        h2 { font-family:'Playfair Display',serif; font-weight:900; font-size:1.5rem; letter-spacing:-0.015em; margin-bottom:16px; }
        p { margin-bottom:16px; }
        p.big { color:var(--slate); }
        .principle { display:flex; gap:14px; align-items:flex-start; padding:16px 0; border-bottom:1px solid var(--border); }
        .principle:last-child { border-bottom:none; }
        .principle .num { font-family:'Playfair Display',serif; font-weight:900; font-size:1.1rem; color:var(--gold); flex-shrink:0; width:26px; }
        .principle h3 { font-family:'DM Sans',sans-serif; font-size:1rem; font-weight:700; color:var(--ink); margin-bottom:4px; }
        .principle p { font-size:0.95rem; color:var(--slate); margin-bottom:0; }
        .states { display:flex; flex-direction:column; gap:18px; margin-top:6px; }
        .state { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius-md); padding:18px 20px; }
        .state-badge { display:inline-flex; align-items:center; gap:8px; font-family:'DM Sans',sans-serif; font-weight:600; font-size:0.85rem; padding:6px 13px; border-radius:999px; border:1px solid; margin-bottom:10px; }
        .state-dot { width:18px; height:18px; border-radius:50%; display:grid; place-items:center; font-size:0.68rem; font-weight:700; color:var(--bg-deep); }
        .state-badge.verified { color:var(--sage); background:var(--sage-dim); border-color:rgba(126,179,139,0.35); } .state-badge.verified .state-dot { background:var(--sage); }
        .state-badge.attributed { color:var(--amber); background:rgba(224,162,78,0.12); border-color:rgba(224,162,78,0.35); } .state-badge.attributed .state-dot { background:var(--amber); }
        .state-badge.disputed { color:var(--caution); background:rgba(138,147,201,0.14); border-color:rgba(138,147,201,0.4); } .state-badge.disputed .state-dot { background:var(--caution); }
        .state-def { font-size:0.95rem; color:var(--slate); margin-bottom:0; }
        .note { background:var(--cream); border-left:2px solid var(--sage); border-radius:0 var(--radius-sm) var(--radius-sm) 0; padding:16px 18px; font-family:'DM Sans',sans-serif; font-size:0.9rem; color:var(--slate); }
        .note strong { color:var(--ink); }
        .back { display:inline-flex; align-items:center; gap:8px; margin-top:40px; font-family:'DM Sans',sans-serif; font-weight:600; font-size:0.9rem; color:var(--sage); text-decoration:none; }
        .back:hover { text-decoration:underline; }
        footer { text-align:center; padding:40px 24px; color:var(--text-muted); font-family:'DM Sans',sans-serif; font-size:0.8rem; border-top:1px solid var(--border); margin-top:48px; }
        footer a { color:var(--burgundy-link); text-decoration:none; }
        @media (prefers-reduced-motion: reduce) { html { scroll-behavior:auto; } * { transition:none !important; } }
        @media (max-width:560px) { .topnav { flex-wrap:wrap; gap:10px; } }`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
${HEAD_SCRIPT}
    <title>How we verify · Quotle.info</title>
    <meta name="gs-app-id" content="quotle-info">
    <meta name="description" content="How Quotle.info verifies every quote: traced to a primary source, dated, cited, and marked with honest confidence — verified, attributed, or disputed. Nothing invented.">
    <link rel="canonical" href="https://quotle.info/how-we-verify">
    <meta property="og:type" content="article">
    <meta property="og:title" content="How Quotle.info verifies every quote">
    <meta property="og:description" content="Traced to a primary source, dated, cited, and marked with honest confidence. Nothing invented.">
    <meta property="og:url" content="https://quotle.info/how-we-verify">
    <meta property="og:site_name" content="Quotle.info">
${OG_IMAGE_TAGS}
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
${STYLE}${CHROME_CSS}
    </style>
${THEME_CSS}
</head>
<body>
${NAV('')}
    <main>
        <header class="hero">
            <p class="kicker">The standard</p>
            <h1>How we verify</h1>
            <p class="lede">Most quote sites repeat whatever is already circulating. Quotle.info does the opposite: every attribution here is traced back to a <strong>primary source</strong>, dated, and cited — and when the trail runs cold, we say so instead of guessing.</p>
        </header>

        <section aria-labelledby="how-h">
            <h2 id="how-h">What &ldquo;verified&rdquo; means here</h2>
            <div>
                <div class="principle"><span class="num">1</span><div><h3>Traced to a primary source</h3><p>We work back to the earliest document that actually carries the words — a first edition, a letter, a transcript, a recording — not a later anthology quoting an anthology.</p></div></div>
                <div class="principle"><span class="num">2</span><div><h3>Cited and dated, with links</h3><p>Each page names the source, the edition or issue, and the date, and links out to the archive or record so you can check it yourself. &ldquo;Trust us&rdquo; is not verification.</p></div></div>
                <div class="principle"><span class="num">3</span><div><h3>Re-checked adversarially</h3><p>Before a page ships, every source link is opened and the claim is tested against it — the goal is to <em>break</em> the attribution, not to confirm what we hoped. Only what survives is published.</p></div></div>
                <div class="principle"><span class="num">4</span><div><h3>Never invented</h3><p>Nothing here is a machine-generated guess dressed up as fact. If a quote can&rsquo;t be grounded in a real source, it does not get a confident attribution — full stop.</p></div></div>
            </div>
        </section>

        <section aria-labelledby="states-h">
            <h2 id="states-h">Three honest states</h2>
            <p class="big">Certainty is a spectrum, so every quote wears one of three badges. The badge is the whole point — it tells you exactly how far the evidence goes.</p>
            <div class="states">
${STATES.map(stateRow).join('\n')}
            </div>
        </section>

        <section aria-labelledby="rights-h">
            <h2 id="rights-h">Two separate questions</h2>
            <p class="big">&ldquo;Who really said it?&rdquo; and &ldquo;Is it free to reuse?&rdquo; are different claims, and we keep them apart. A quote can be firmly attributed and still under copyright, or public domain and still misattributed.</p>
            <p class="big">So alongside the attribution badge, each page states a <strong>rights status</strong> — one of three, and marking a line &ldquo;in copyright&rdquo; is honest disclosure, not a claim that we own it:</p>
            <div class="states">
                <div class="state">
                    <span class="state-badge verified"><span class="state-dot">✓</span>Public domain</span>
                    <p class="state-def">Copyright has expired (or never applied). Free to reuse — here, &ldquo;verified&rdquo; and &ldquo;free to reuse&rdquo; both hold.</p>
                </div>
                <div class="state">
                    <span class="state-badge attributed"><span class="state-dot">&copy;</span>In copyright</span>
                    <p class="state-def">Still protected. We quote the single line for identification and commentary; the full work belongs to its author or estate, and verifying who said it is not a grant of reuse rights.</p>
                </div>
                <div class="state">
                    <span class="state-badge verified"><span class="state-dot">✓</span>Used with permission</span>
                    <p class="state-def">Reproduced under a licence from the rightsholder, who retains all reuse rights.</p>
                </div>
            </div>
        </section>

        <section aria-labelledby="wrong-h">
            <h2 id="wrong-h">When we get it wrong</h2>
            <p class="big">Provenance research is never finished — new archives surface and old ones get corrected. If you can point to a primary source that changes an attribution, that is exactly the evidence we want. Every page is dated so you can see how current it is.</p>
        </section>

        <a class="back" href="/"><span aria-hidden="true">←</span> Browse the verified quotes</a>
    </main>
    <footer>
        <p>quotle<span style="color:var(--burgundy)">.info</span> — every attribution traced to a primary source and dated. A <a href="https://gameshelf.co">Game Shelf</a> project.</p>
    </footer>
${SEARCH_JS}
${SCRIPT}
</body>
</html>
`;

fs.mkdirSync(path.join(ROOT, 'how-we-verify'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'how-we-verify', 'index.html'), html);
console.log('  ✓ how-we-verify/index.html  (methodology / trust page)');
