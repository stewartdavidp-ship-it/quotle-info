#!/usr/bin/env node
'use strict';
/*
 * build-flagged.js — /flagged/ context page for a research-bench candidate.
 *
 * The homepage "research bench" links here (/flagged/?q=<slug>) instead of sending readers
 * straight to Quote Investigator / Wikiquote. This page keeps them on quotle.info first: it
 * names the credible source we flagged the quote from, explains the quote is QUEUED and NOT
 * yet verified by us, and then offers the outbound link as a choice ("read their write-up").
 *
 * One parameterized page (not one per candidate) — the queued candidates are embedded as a
 * slug→data map and looked up client-side from ?q=. It carries <meta robots noindex> because
 * it is interim, unverified content and we don't want it competing with our verified pages.
 *
 * Shares the site chrome (tokens.js, a11y-widget.js). Run by tools/build.js.
 */
const fs = require('fs');
const path = require('path');
const { HEAD_SCRIPT, THEME_CSS, CONTROL, SCRIPT } = require('./a11y-widget');
const { ROOT_CSS } = require('./tokens');
const { NAV, CHROME_CSS, SEARCH_JS } = require('./chrome');
const ROOT = path.resolve(__dirname, '..');

// Credible-source descriptions (shown so the reader knows WHO flagged it and why they're trusted).
const SOURCES = {
  'quoteinvestigator.com': { name: 'Quote Investigator', blurb: 'a widely-cited quote-research project by Garson O&rsquo;Toole that traces sayings back to their earliest documented appearance in print.' },
  'en.wikiquote.org': { name: 'Wikiquote', blurb: 'Wikimedia&rsquo;s sourced-quotation project, whose &ldquo;Misattributed&rdquo; and &ldquo;Disputed&rdquo; sections catalogue quotes commonly pinned on the wrong person.' },
  'snopes.com': { name: 'Snopes', blurb: 'one of the oldest and most established fact-checking organisations.' },
};
function sourceOf(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (SOURCES[h]) return SOURCES[h];
    return { name: h, blurb: 'a documented quotation-research source.' };
  } catch (_) { return { name: 'the source', blurb: 'a documented quotation-research source.' }; }
}

let queued = [];
try {
  const hq = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'harvest-queue.json'), 'utf8'));
  queued = (hq.candidates || []).filter((c) => c.status === 'queued');
} catch (_) { /* optional */ }

const DATA = {};
for (const c of queued) {
  if (!c.slug || !c.documentedAt) continue;
  const s = sourceOf(c.documentedAt);
  DATA[c.slug] = { q: c.quote, a: c.magnetAuthor || 'unknown', c: c.category, sn: s.name, sb: s.blurb, u: c.documentedAt };
}
// embed safely: JSON with < neutralized so it can't break out of the <script>
const DATA_JSON = JSON.stringify(DATA).replace(/</g, '\\u003c');

const STYLE = `${ROOT_CSS}
        * { margin:0; padding:0; box-sizing:border-box; }
        html { -webkit-font-smoothing:antialiased; }
        body { font-family:'Source Serif 4',Georgia,serif; background:var(--bg-deep); color:var(--ink); line-height:1.7; overflow-x:hidden; }
        a { color:inherit; }
        a:focus-visible, button:focus-visible { outline:2px solid var(--sage); outline-offset:3px; border-radius:4px; }
        .topnav { display:flex; align-items:center; justify-content:space-between; max-width:680px; margin:0 auto; padding:20px 24px 0; }
        .brand { display:inline-flex; align-items:center; gap:9px; text-decoration:none; font-family:'Playfair Display',serif; font-weight:900; font-size:1.05rem; }
        .brand-icon { width:30px; height:30px; border-radius:8px; background:linear-gradient(135deg,var(--burgundy),var(--burgundy-deep)); display:grid; place-items:center; font-size:0.95rem; }
        .brand span { color:var(--burgundy); }
        main { max-width:640px; margin:0 auto; padding:34px 24px 64px; }
        .kicker { font-family:'DM Sans',sans-serif; text-transform:uppercase; font-size:0.7rem; font-weight:700; letter-spacing:0.2em; color:var(--burgundy); margin-bottom:16px; }
        .fq { font-family:'Playfair Display',serif; font-style:italic; font-weight:700; font-size:clamp(1.5rem,4.5vw,2rem); line-height:1.25; letter-spacing:-0.01em; color:var(--ink); margin-bottom:16px; }
        .cred { font-family:'DM Sans',sans-serif; font-size:0.95rem; color:var(--slate); }
        .cred strong { color:var(--ink); }
        .notice { background:var(--bg-card); border:1px dashed var(--border-accent); border-radius:var(--radius-md,12px); padding:16px 18px; margin:24px 0; }
        .notice p { font-size:0.95rem; color:var(--slate); margin:0; }
        .notice strong { color:var(--ink); }
        h2 { font-family:'Playfair Display',serif; font-weight:900; font-size:1.35rem; letter-spacing:-0.015em; margin:30px 0 12px; }
        main p.body { color:var(--slate); margin-bottom:16px; }
        main p.body strong { color:var(--ink); }
        .handoff { font-family:'DM Sans',sans-serif; font-size:0.9rem; color:var(--text-muted); margin:22px 0 12px; }
        .src-btn { display:inline-flex; align-items:center; gap:9px; font-family:'DM Sans',sans-serif; font-weight:600; font-size:0.9rem; color:#fff; background:linear-gradient(135deg,var(--burgundy),var(--burgundy-deep)); text-decoration:none; padding:12px 22px; border-radius:12px; }
        .src-btn:hover { filter:brightness(1.08); }
        .back { font-family:'DM Sans',sans-serif; font-size:0.85rem; color:var(--text-muted); margin-top:34px; padding-top:20px; border-top:1px solid var(--border); }
        .back a { color:var(--burgundy); text-decoration:none; }
        .back a:hover { text-decoration:underline; }
        @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }`;

const CLIENT = `    <script>
        (function(){
            var DATA = ${DATA_JSON};
            function esc(s){ var d=document.createElement('div'); d.textContent = (s==null?'':String(s)); return d.innerHTML; }
            var slug=''; try { slug=new URLSearchParams(location.search).get('q')||''; } catch(e){}
            var d = slug && DATA[slug];
            var el=document.getElementById('card');
            if(!d){
                el.innerHTML='<p class="kicker">Research bench</p><h1 class="fq">Not in the queue</h1>'+
                    '<p class="body">This flag isn&rsquo;t in our research queue &mdash; it may already be verified, or the link is out of date.</p>'+
                    '<p class="back"><a href="/">&larr; Back to quotle.info</a></p>';
                document.title='Not found | Quotle.info';
                return;
            }
            var lead, why;
            if(d.c==='genuine-famous'){
                lead='a genuine, well-known line';
                why='This is a real, widely-quoted line that <strong>'+esc(d.sn)+'</strong> has sourced. We&rsquo;ve queued it to verify against the primary source ourselves and give it a full page.';
            } else {
                var lbl = d.c==='disputed' ? 'disputed' : 'likely misattributed';
                lead=lbl;
                why='This quote is documented as <strong>'+lbl+'</strong> by <strong>'+esc(d.sn)+'</strong> &mdash; '+d.sb;
            }
            el.innerHTML=
                '<p class="kicker">On the research bench</p>'+
                '<blockquote class="fq">&ldquo;'+esc(d.q)+'&rdquo;</blockquote>'+
                '<p class="cred">Commonly attributed to <strong>'+esc(d.a)+'</strong></p>'+
                '<div class="notice"><p><strong>Not yet verified by us.</strong> We&rsquo;ve flagged this as <strong>'+esc(lead)+'</strong> and queued it for a full, primary-source trace. Until we&rsquo;ve done that work, we won&rsquo;t publish a verdict of our own.</p></div>'+
                '<h2>Why we flagged it</h2>'+
                '<p class="body">'+why+'</p>'+
                '<p class="handoff">Want to read their write-up? We&rsquo;ll take you there &mdash; it opens in a new tab:</p>'+
                '<a class="src-btn" href="'+esc(d.u)+'" target="_blank" rel="noopener nofollow">Read it at '+esc(d.sn)+' <span aria-hidden="true">&#8599;</span></a>'+
                '<p class="back"><a href="/#bench">&larr; Back to the research bench</a> &middot; <a href="/">Browse verified quotes</a></p>';
            document.title='Why we flagged this quote | Quotle.info';
        })();
    </script>`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, follow">
${HEAD_SCRIPT}
    <title>On the research bench | Quotle.info</title>
    <meta name="description" content="A quote we&rsquo;ve flagged for verification, and the credible source that documented it.">
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,900;1,700&family=Source+Serif+4:ital@0;1&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
${STYLE}${CHROME_CSS}
    </style>
${THEME_CSS}
</head>
<body>
${NAV('review')}
    <main>
        <div id="card"><p class="kicker">On the research bench</p><p class="body">Loading&hellip;</p></div>
    </main>
${CLIENT}
${SEARCH_JS}
${SCRIPT}
</body>
</html>
`;

const outDir = path.join(ROOT, 'flagged');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`  ✓ flagged/index.html  (research-bench context page; ${Object.keys(DATA).length} candidates embedded)`);
