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
const { OG_IMAGE_TAGS } = require('./og'); // the one shared social-card image

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

// Source data and the author aggregation come from corpus.js — ONE read, ONE aggregation, shared
// with build-index/build-search/build-sitemap. This file used to read the directories and call
// aggregateAuthors itself, which is how its author total could differ from the home page's.
// (Song-misattribution records contribute hubs too: original recorder / cover artist / writer.)
const { CORPUS, records, songs: songRecords, authors, ERAS, UNDATED, eraOf } = require('./corpus');

// ---- misattribution intelligence for author pages ----
// Same slug function the records were built with — these keys are matched against author.slug.
const { slugify: kebab } = require('./slugify');
const { falseCredits } = require('./credits'); // creditedTo is a string OR an array — read it once, there
// "Often misattributed to X": disputed records whose creditedTo (the magnet name) is X, real author ≠ X.
const misattrBy = {};
for (const r of records) {
  if (r.confidence !== 'disputed') continue;
  // creditedTo may name SEVERAL false credits (tools/credits.js). Fan out over all of them: a quote
  // pinned on both Churchill and Rockefeller belongs on both hubs. Keying off a single value meant
  // a magnet author's hub silently omitted every line where they were the second-most-common wrong
  // credit — invisible, because the page still looked complete.
  //
  // The "is this credit actually FALSE?" rule used to live inline here. It is the same rule /verify
  // needs and did not have, so it moved to credits.js (falseCredits) — the module that exists to be
  // the one reading of creditedTo. Same comparison, same result: a credit whose slug matches the
  // real author's is dropped, which is what keeps genuine and right-person-wrong-words records off
  // the hubs and stops the "actually" line printing "misattributed to Jefferson — actually Jefferson".
  const explicitReal = r.answer && r.answer.realAuthorName;
  const real = explicitReal || (r.answer && r.answer.authorName) || 'Unknown';
  for (const credited of falseCredits(r)) {
    (misattrBy[kebab(credited)] = misattrBy[kebab(credited)] || []).push({ slug: r.quoteSlug, quote: r.displayQuote, real });
  }
}
// "Under review — pinned on X": queued backlog candidates grouped by magnet author.
const reviewBy = {};
try {
  const hq = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'harvest-queue.json'), 'utf8'));
  for (const c of (hq.candidates || [])) {
    // only questionable attributions belong under "commonly pinned on X" — genuine-famous
    // candidates are real quotes by X awaiting a page, not misattributions.
    if (c.status !== 'queued' || c.category === 'genuine-famous' || !c.magnetAuthor || !c.slug) continue;
    const s = kebab(c.magnetAuthor);
    (reviewBy[s] = reviewBy[s] || []).push({ slug: c.slug, quote: c.quote, category: c.category });
  }
} catch (_) { /* backlog optional */ }

const misattrCard = (m) => `                <a class="mis-card" href="/who-said/${m.slug}/">
                    <p class="mis-q">&ldquo;${esc(m.quote)}&rdquo;</p>
                    <p class="mis-real"><span class="mis-lbl">actually</span> ${esc(m.real)}</p>
                </a>`;
const REV_LABEL = { misattributed: 'Likely misattributed', disputed: 'Disputed', 'genuine-famous': 'Verifying' };
// rel="nofollow" — /flagged/ is a noindex research-bench page and the site links 441 distinct
// ?q= permutations of it. Same reasoning as the /cite/ links in template.js: stop Googlebot
// spending crawl budget discovering URLs it can never index.
const reviewCard = (c) => `                <a class="rev-card" rel="nofollow" href="/flagged/?q=${esc(c.slug)}">
                    <p class="rev-q">&ldquo;${esc(c.quote)}&rdquo;</p>
                    <p class="rev-tag">${REV_LABEL[c.category] || 'Queued'} <span aria-hidden="true">→</span></p>
                </a>`;

const ASK_JS = `    <script>
        (function(){
            var sec=document.querySelector('.ask'); if(!sec) return;
            var author=sec.getAttribute('data-author')||'';
            var input=document.getElementById('ask-q'), out=document.getElementById('ask-out');
            var idx=null, loading=false;
            function load(cb){ if(idx){cb();return;} if(loading) return; loading=true;
                fetch('/search.json').then(function(r){return r.json();}).then(function(d){ idx=d||[]; loading=false; cb(); }).catch(function(){ loading=false; }); }
            function esc(s){ var d=document.createElement('div'); d.textContent=(s==null?'':String(s)); return d.innerHTML; }
            var TYPE={q:'Verified',a:'Author',b:'Under review'};
            function wikiquote(){ return 'https://en.wikiquote.org/wiki/'+encodeURIComponent(author.replace(/ /g,'_')); }
            function render(term){
                var t=term.trim().toLowerCase();
                if(t.length<4){ out.innerHTML=''; return; }
                var hits=[];
                for(var i=0;i<idx.length;i++){ var e=idx[i]; if((e.x+' '+(e.a||'')).toLowerCase().indexOf(t)>-1){ hits.push(e); if(hits.length>=6) break; } }
                if(hits.length){
                    out.innerHTML='<p class="ask-lead">We&rsquo;ve got this &mdash; here&rsquo;s what we know:</p>'+hits.map(function(e){
                        return '<a class="ask-hit" href="'+esc(e.u)+'"><span class="ask-hx">'+(e.t==='a'?'':'&ldquo;')+esc(e.x)+(e.t==='a'?'':'&rdquo;')+'</span><span class="ask-ht">'+(TYPE[e.t]||'')+(e.a?' &middot; '+esc(e.a):'')+'</span></a>'; }).join('');
                } else {
                    out.innerHTML='<div class="ask-none"><p class="ask-lead">We haven&rsquo;t traced that one yet &mdash; here&rsquo;s where to look:</p>'+
                        '<a class="ask-src" href="'+wikiquote()+'" target="_blank" rel="noopener nofollow">'+esc(author)+' on Wikiquote (Misattributed &amp; Disputed) <span aria-hidden="true">↗</span></a>'+
                        '<a class="ask-src" href="https://quoteinvestigator.com/?s='+encodeURIComponent(term)+'" target="_blank" rel="noopener nofollow">Search Quote Investigator <span aria-hidden="true">↗</span></a>'+
                        '<a class="ask-src ask-nom" href="/under-review/">Nominate it &mdash; we&rsquo;ll trace it <span aria-hidden="true">→</span></a></div>';
                }
            }
            var deb; input.addEventListener('input', function(){ clearTimeout(deb); var v=input.value; deb=setTimeout(function(){ load(function(){ render(v); }); }, 160); });
        })();
    </script>`;

// ---- shared chrome ----
const { NAV: siteNav, CHROME_CSS, SEARCH_JS, FOOTER } = require('./chrome');
const NAV = siteNav('authors');

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
        .sec-sub { font-family:'DM Sans',sans-serif; font-size:0.9rem; color:var(--text-muted); margin-top:8px; max-width:620px; }
        /* often misattributed to X */
        .mis-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
        .mis-card { display:flex; flex-direction:column; gap:12px; text-decoration:none; background:linear-gradient(135deg,var(--burgundy-glow),transparent); border:1px solid rgba(212,98,122,0.25); border-radius:12px; padding:18px 20px; transition:transform 0.2s; }
        .mis-card:hover { transform:translateY(-3px); }
        .mis-q { font-style:italic; font-size:1rem; color:var(--ink); }
        .mis-q::before, .mis-q::after { content:none; }
        .mis-real { font-family:'DM Sans',sans-serif; font-size:0.82rem; font-weight:600; color:var(--sage); margin-top:auto; }
        .mis-lbl { color:var(--text-muted); font-weight:500; text-transform:uppercase; font-size:0.66rem; letter-spacing:0.12em; margin-right:6px; }
        /* under review — pinned on X */
        .rev-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
        .rev-card { display:flex; flex-direction:column; gap:12px; text-decoration:none; background:var(--bg-card); border:1px dashed var(--border-accent); border-radius:12px; padding:18px 20px; transition:transform 0.2s; }
        .rev-card:hover { transform:translateY(-3px); }
        .rev-q { font-style:italic; font-size:1rem; color:var(--ink); }
        .rev-tag { font-family:'DM Sans',sans-serif; font-size:0.75rem; font-weight:600; color:var(--burgundy); margin-top:auto; }
        .rev-more { margin-top:16px; font-family:'DM Sans',sans-serif; font-size:0.85rem; }
        .rev-more a { color:var(--burgundy); text-decoration:none; font-weight:600; }
        .rev-more a:hover { text-decoration:underline; }
        /* did they really say it? */
        .ask { margin-top:44px; }
        .ask-in { width:100%; max-width:620px; font-family:'DM Sans',sans-serif; font-size:1rem; color:var(--ink); background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:14px 18px; outline:none; transition:border-color 0.2s; }
        .ask-in:focus { border-color:var(--burgundy); }
        .ask-in::placeholder { color:var(--text-muted); }
        .ask-out { max-width:620px; margin-top:14px; }
        .ask-lead { font-family:'DM Sans',sans-serif; font-size:0.85rem; color:var(--text-muted); margin-bottom:10px; }
        .ask-hit { display:flex; flex-direction:column; gap:3px; text-decoration:none; padding:12px 14px; border:1px solid var(--border); border-radius:11px; margin-bottom:8px; transition:border-color 0.2s,background 0.2s; }
        .ask-hit:hover { border-color:var(--burgundy); background:var(--burgundy-glow); }
        .ask-hx { font-style:italic; font-size:0.98rem; color:var(--ink); }
        .ask-ht { font-family:'DM Sans',sans-serif; font-size:0.75rem; color:var(--text-muted); }
        .ask-none { background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:18px 20px; }
        .ask-src { display:block; font-family:'DM Sans',sans-serif; font-size:0.9rem; font-weight:600; color:var(--burgundy); text-decoration:none; padding:8px 0; }
        .ask-src:hover { text-decoration:underline; }
        .ask-nom { color:var(--sage); }
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
        .ac-mag { font-family:'DM Sans',sans-serif; font-size:0.72rem; font-weight:600; color:var(--caution); margin-top:3px; }
        /* authors filter bar */
        .fbar { margin-top:28px; display:flex; flex-direction:column; gap:14px; }
        .fbar-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
        .fbar-lbl { font-family:'DM Sans',sans-serif; font-size:0.72rem; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:var(--text-muted); margin-right:2px; }
        .f-in { flex:1; min-width:220px; font-family:'DM Sans',sans-serif; font-size:0.95rem; color:var(--ink); background:var(--bg-card); border:1px solid var(--border); border-radius:12px; padding:12px 16px; outline:none; transition:border-color 0.2s; }
        .f-in:focus { border-color:var(--border-accent); }
        .chip { font-family:'DM Sans',sans-serif; font-size:0.8rem; font-weight:600; color:var(--slate); background:var(--bg-card); border:1px solid var(--border); border-radius:999px; padding:7px 14px; cursor:pointer; transition:border-color 0.2s,color 0.2s,background 0.2s; }
        .chip:hover { border-color:var(--border-accent); color:var(--ink); }
        .chip[aria-pressed="true"] { background:var(--burgundy-glow); border-color:var(--burgundy); color:var(--ink); }
        .chip .n { color:var(--text-muted); font-weight:500; }
        .chip[aria-pressed="true"] .n { color:var(--slate); }
        .f-count { font-family:'DM Sans',sans-serif; font-size:0.8rem; color:var(--text-muted); margin-top:4px; }
        .ac[hidden] { display:none; }
        /* the display:block below beats the UA's [hidden]{display:none}, so restate it explicitly —
           otherwise el.hidden=true leaves a dead "Show all" button sitting there (same trap as .ac). */
        .f-more { display:block; margin:26px auto 0; font-family:'DM Sans',sans-serif; font-size:0.85rem; font-weight:600; color:var(--ink); background:var(--bg-card); border:1px solid var(--border-accent); border-radius:999px; padding:11px 24px; cursor:pointer; transition:transform 0.2s; }
        .f-more[hidden] { display:none; }
        .f-more:hover { transform:translateY(-2px); }
        .f-none { display:none; background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:18px 20px; margin-top:20px; font-family:'DM Sans',sans-serif; font-size:0.9rem; color:var(--slate); }
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

// A song entry on an author hub. The relationship line is role-aware: the cover artist's hub frames
// its songs as "actually a cover" (the misattribution), the original recorder's as "recorded first".
// A song entry links to the page it belongs to: recording-axis → /who-recorded/, writing-only →
// /who-wrote/ (recording wins for a dual-axis record, matching its primary page in build-songs).
const songRoute = (s) => ((s.axes || ['recording']).includes('recording') ? 'who-recorded' : 'who-wrote');
const songCard = (s) => {
  const writing = songRoute(s) === 'who-wrote';
  // rel is role- AND axis-aware. On a writing page the writer's line points at the performer (there is
  // no "first recorded by" — the performer IS the definitive recording), and the performer's line
  // points back at the writer.
  const rel = s.role === 'cover' ? `Cover &mdash; originally recorded by ${esc(s.originalArtist)}`
    : s.role === 'performer' ? `Recorded it &mdash; written by ${esc(s.writer)}`
    : s.role === 'writer' ? (writing
      ? `Written by them &mdash; recorded by ${esc(s.creditedTo)}`
      : `Written by them &mdash; first recorded by ${esc(s.originalArtist)}`)
    : `Recorded it first &mdash; now often credited to ${esc(s.creditedTo)}`;
  const cls = s.role === 'cover' ? 'disputed' : 'verified';
  return `                <a class="q-card ${cls}" href="/${songRoute(s)}/${s.slug}/">
                    <p class="q-text">${esc(s.title)}</p>
                    <span class="q-conf"><span class="dot" aria-hidden="true">♪</span>${rel}</span>
                </a>`;
};
const songSectionHeading = (a) => {
  const roles = new Set(a.songs.map((s) => s.role));
  if (roles.size === 1 && roles.has('cover')) return `Songs credited to ${esc(a.name)} that are covers`;
  if (roles.size === 1 && roles.has('writer')) return `Songs written by ${esc(a.name)}`;
  if (roles.size === 1 && roles.has('original')) return `Songs ${esc(a.name)} recorded first`;
  if (roles.size === 1 && roles.has('performer')) return `Songs ${esc(a.name)} recorded`;
  return `Songs involving ${esc(a.name)}`;
};

// ---- per-author pages ----
fs.mkdirSync(OUT, { recursive: true });
for (const a of authors) {
  const n = a.quotes.length;
  const ns = a.songs.length;
  const parts = [];
  if (n) parts.push(`${n} quote${n === 1 ? '' : 's'}`);
  if (ns) parts.push(`${ns} song${ns === 1 ? '' : 's'}`);
  const summary = parts.join(' and ') || 'entries';
  const mis = misattrBy[a.slug] || [];
  const rev = reviewBy[a.slug] || [];
  const head = `    <title>${esc(a.name)} — provenance traced to source · Quotle.info</title>
    <meta name="description" content="${esc(a.name)}: ${summary} traced to a primary source, with attribution verified and misattributions untangled.">
    <link rel="canonical" href="${ORIGIN}/authors/${a.slug}/">
    <meta property="og:type" content="profile">
    <meta property="og:title" content="${esc(a.name)} — provenance traced to source">
    <meta property="og:url" content="${ORIGIN}/authors/${a.slug}/">
    <meta property="og:site_name" content="Quotle.info">
${OG_IMAGE_TAGS}
    <script type="application/ld+json">
    ${jsonLd({
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      '@id': `${ORIGIN}/authors/${a.slug}/`,
      mainEntity: {
        '@type': 'Person',
        '@id': `${ORIGIN}/authors/${a.slug}/#person`,
        name: plain(a.name),
        description: plain(a.metaLine),
        subjectOf: [
          ...a.quotes.map((q) => ({ '@type': 'Quotation', '@id': `${ORIGIN}/who-said/${q.slug}/#quotation`, text: plain(q.quote), url: `${ORIGIN}/who-said/${q.slug}/` })),
          ...a.songs.map((s) => ({ '@type': 'MusicRecording', '@id': `${ORIGIN}/${songRoute(s)}/${s.slug}/#recording`, name: plain(s.title), url: `${ORIGIN}/${songRoute(s)}/${s.slug}/` })),
        ],
      },
    })}
    </script>`;
  const inner = `    <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a><span class="sep" aria-hidden="true">›</span>
        <a href="/authors/">Authors</a><span class="sep" aria-hidden="true">›</span>
        <span aria-current="page">${esc(a.name)}</span>
    </nav>
    <main id="main">
        <header class="author-hero">
            <div class="author-avatar" aria-hidden="true">${esc(a.initials || '')}</div>
            <div>
                <h1>${esc(a.name)}</h1>
                <p class="author-meta">${esc(a.metaLine || '')}</p>
            </div>
        </header>
        <div class="author-bio">${a.bio}</div>
${n ? `        <section aria-labelledby="q-h">
            <div class="sec-head"><p class="kicker">Traced to source</p><h2 id="q-h">${n} quote${n === 1 ? '' : 's'} we&rsquo;ve traced${n > 1 ? ` to ${esc(a.name)}` : ''}</h2></div>
            <div class="q-grid">
${a.quotes.map(quoteCard).join('\n')}
            </div>
        </section>` : ''}
${ns ? `        <section aria-labelledby="s-h">
            <div class="sec-head"><p class="kicker">Who recorded it</p><h2 id="s-h">${songSectionHeading(a)}</h2></div>
            <div class="q-grid">
${a.songs.map(songCard).join('\n')}
            </div>
        </section>` : ''}
${mis.length ? `        <section aria-labelledby="mis-h">
            <div class="sec-head"><p class="kicker">Not actually ${esc(a.name)}</p><h2 id="mis-h">Often misattributed to ${esc(a.name)}</h2><p class="sec-sub">Famous lines widely pinned on ${esc(a.name)} that we&rsquo;ve traced to someone else.</p></div>
            <div class="mis-grid">
${mis.map(misattrCard).join('\n')}
            </div>
        </section>` : ''}
${rev.length ? `        <section aria-labelledby="rev-h">
            <div class="sec-head"><p class="kicker">On the research bench</p><h2 id="rev-h">Commonly pinned on ${esc(a.name)} &mdash; under review</h2><p class="sec-sub">${rev.length} line${rev.length === 1 ? '' : 's'} flagged as pinned on ${esc(a.name)} and queued for a full source trace &mdash; not yet verified.</p></div>
            <div class="rev-grid">
${rev.slice(0, 12).map(reviewCard).join('\n')}
            </div>
${rev.length > 12 ? `            <p class="rev-more"><a href="/under-review/?q=${encodeURIComponent(a.name)}">See all ${rev.length} under review <span aria-hidden="true">→</span></a></p>` : ''}
        </section>` : ''}
        <section class="ask" data-author="${esc(a.name)}" aria-labelledby="ask-h">
            <div class="sec-head"><p class="kicker">Did they really say it?</p><h2 id="ask-h">Thought ${esc(a.name)} said something else?</h2><p class="sec-sub">Type a quote you think ${esc(a.name)} said &mdash; we&rsquo;ll tell you what we know, or point you to the best sources.</p></div>
            <input id="ask-q" class="ask-in" type="search" placeholder="Type or paste the quote&hellip;" aria-label="Type or paste a quote you think ${esc(a.name)} said" autocomplete="off">
            <div id="ask-out" class="ask-out"></div>
        </section>
    </main>
${ASK_JS}`;
  const dir = path.join(OUT, a.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(inner, head));
}

// ---- authors index ----
// Every figure below is PULLED from CORPUS (tools/corpus.js) — this file counts nothing itself.
const totalQuotes = CORPUS.quotes.linkedToAuthor; // internal bookkeeping only (build log), never printed on a page
// Song artists share the /authors/ hubs but carry NO quotes, so the index summary must not imply
// every listed person is a quote author — a large minority are here purely for a song. State
// quotes and songs as separate totals rather than pairing one headcount with one quote total.
const songArtists = CORPUS.authors.songArtists;
const totalSongs = CORPUS.songs.total;
// The page states the CORPUS size, not the quote→hub link count: they differ by the quotes whose
// author is Anonymous/Unknown and so has no hub, a distinction nobody reading a summary line cares
// about — but showing the link count here against the corpus size elsewhere reads as a bug.
const corpusQuotes = CORPUS.quotes.total;

// Browse facets. A flat A–Z list of every author is useless past a few hundred (66% of authors
// carry a single quote), so the index ships three lenses instead of an alphabet:
//   mag  — how many quotes are WRONGLY credited to this person (records[].creditedTo). This is the
//          site's own thesis rendered as a browse, and the default sort.
//   n    — quote count; separates the substantial profiles from the single-quote long tail.
//   era  — parsed from the author's metaLine dates ("1809–1865", "b. 1961", "c. 620–564 BCE").
// Every author still ships in the static HTML (crawlable); the filters only hide client-side.
// The "mag" facet counts how many quotes are WRONGLY credited to this person — and it reads that
// count straight off misattrBy, the SAME per-magnet list the author page renders under "Often
// misattributed to X" (keyed by a.slug, line ~289). Deriving both from one source is the point:
// the browse chip ("N quotes wrongly credited to them") and the list it links to can never disagree.
//
// It must NOT be recomputed from bare creditedTo. A Track A wave stamps creditedTo on every record
// it harvested, including the ones that turn out GENUINE (Reagan really did say "trust, but verify")
// and the RIGHT-PERSON-WRONG-WORDS ones (the person did say a version of the line) — neither is a
// misattribution. misattrBy already excludes both, via credSlug === trueSlug, resolving the real
// author through answer.realAuthorName (which is why name-comparison against answer.authorName does
// not work — "Not Thomas Jefferson" carries authorName "Thomas Jefferson"). Counting bare creditedTo
// by name, as this did before, over-stated the chip by 200 records against a list it contradicted.

// ERAS / UNDATED / eraOf and the bucket counts all live in corpus.js — the era row is a PARTITION
// of the author set, so its definition belongs with the figures it has to reconcile against.
// tools/verify-corpus.js fails the build if the buckets ever stop summing to the author total.
authors.forEach((a) => { a.mag = (misattrBy[a.slug] || []).length; a.era = a.era || eraOf(a.metaLine); });
const magnets = authors.filter((a) => a.mag > 0).length;
const deep = authors.filter((a) => a.quotes.length >= 3).length;
const eraCounts = CORPUS.authors.eraCounts;
// default order = the ranked head: biggest misattribution magnets, then depth, then name
authors.sort((a, b) => (b.mag - a.mag) || (b.quotes.length - a.quotes.length) || a.name.localeCompare(b.name));

const authorCard = (a) => `                <a class="ac" href="/authors/${a.slug}/" data-name="${esc(plain(a.name).toLowerCase())}" data-n="${a.quotes.length}" data-s="${a.songs.length}" data-mag="${a.mag}" data-era="${a.era}">
                    <div class="author-avatar" aria-hidden="true">${esc(a.initials || '')}</div>
                    <div>
                        <p class="ac-name">${esc(a.name)}</p>
                        <p class="ac-meta">${esc(a.metaLine || '')}</p>
                        <p class="ac-count">${[a.quotes.length ? `${a.quotes.length} quote${a.quotes.length === 1 ? '' : 's'}` : '', a.songs.length ? `${a.songs.length} song${a.songs.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' &middot; ') || 'no entries'}</p>
                        ${a.mag ? `<p class="ac-mag">${a.mag} quote${a.mag === 1 ? '' : 's'} wrongly credited to them</p>` : ''}
                    </div>
                </a>`;
const idxHead = `    <title>The authors — every voice traced to source · Quotle.info</title>
    <meta name="description" content="${authors.length} authors and artists, ${corpusQuotes} quotes and ${totalSongs} songs traced to a primary source on Quotle.info. Who really said it — and who really recorded it — with receipts.">
    <link rel="canonical" href="${ORIGIN}/authors/">
    <meta property="og:type" content="website">
    <meta property="og:title" content="The authors — Quotle.info">
    <meta property="og:url" content="${ORIGIN}/authors/">
    <meta property="og:site_name" content="Quotle.info">
${OG_IMAGE_TAGS}`;
const idxInner = `    <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a><span class="sep" aria-hidden="true">›</span>
        <span aria-current="page">Authors</span>
    </nav>
    <main id="main">
        <header class="idx-hero">
            <p class="kicker">Every voice, traced</p>
            <h1>The authors</h1>
            <p class="lede"><b>${authors.length}</b> authors &amp; artists &middot; <b>${corpusQuotes}</b> quotes and <b>${totalSongs}</b> songs traced to a primary source, with the misattributions untangled.</p>
        </header>
        <div class="fbar">
            <div class="fbar-row">
                <input id="f-q" class="f-in" type="search" placeholder="Find an author by name&hellip;" autocomplete="off" aria-label="Filter authors by name">
            </div>
            <div class="fbar-row">
                <span class="fbar-lbl">Show</span>
                <button class="chip" data-lens="mag" aria-pressed="true">Most misattributed <span class="n">${magnets}</span></button>
                <button class="chip" data-lens="deep" aria-pressed="false">3+ quotes <span class="n">${deep}</span></button>
                <button class="chip" data-lens="song" aria-pressed="false">Song artists <span class="n">${songArtists}</span></button>
                <button class="chip" data-lens="all" aria-pressed="false">Everyone <span class="n">${authors.length}</span></button>
            </div>
            <div class="fbar-row">
                <span class="fbar-lbl">Era</span>
                <button class="chip" data-era="" aria-pressed="true">All <span class="n">${authors.length}</span></button>
${ERAS.map((e) => `                <button class="chip" data-era="${e.id}" aria-pressed="false">${e.label} <span class="n">${eraCounts[e.id] || 0}</span></button>`).join('\n')}
                <button class="chip" data-era="${UNDATED}" aria-pressed="false">Undated <span class="n">${eraCounts[UNDATED] || 0}</span></button>
            </div>
            <p id="f-count" class="f-count" role="status" aria-live="polite"></p>
        </div>
        <div id="a-grid" class="author-grid">
${authors.map(authorCard).join('\n')}
        </div>
        <p id="f-none" class="f-none">No author matches that. Try <b>Everyone</b>, or clear the era filter.</p>
        <button id="f-more" class="f-more" hidden>Show all</button>
    </main>
    <script>
        (function(){
            var PAGE = 60, lens = 'mag', era = '', term = '', shown = PAGE, mode = 'reset';
            var grid = document.getElementById('a-grid');
            var cards = [].slice.call(grid.querySelectorAll('.ac'));
            var qEl = document.getElementById('f-q'), countEl = document.getElementById('f-count');
            var moreEl = document.getElementById('f-more'), noneEl = document.getElementById('f-none');
            function matches(c){
                if (term && c.getAttribute('data-name').indexOf(term) === -1) return false;
                if (era && c.getAttribute('data-era') !== era) return false;
                if (lens === 'mag' && +c.getAttribute('data-mag') === 0) return false;
                if (lens === 'deep' && +c.getAttribute('data-n') < 3) return false;
                if (lens === 'song' && +c.getAttribute('data-s') === 0) return false;
                return true;
            }
            function render(){
                var hits = 0, i;
                for (i = 0; i < cards.length; i++) if (matches(cards[i])) hits++;
                // Only cap a genuinely long list. Hiding a handful behind a button ("showing 60 of 61")
                // is pure friction, so absorb any small overflow instead.
                var limit = hits <= shown + 24 ? hits : shown;
                var seen = 0;
                for (i = 0; i < cards.length; i++) {
                    var ok = matches(cards[i]);
                    if (ok) seen++;
                    cards[i].hidden = !ok || seen > limit;
                }
                noneEl.style.display = hits ? 'none' : 'block';
                // The button is the way FORWARD from the end of the list, so it stays useful whenever
                // anyone is being withheld — whether by the cap or by the active lens/era/search. It
                // only disappears once all 332 are actually on screen, so it is never a dead control.
                var reveal = limit < hits ? hits : cards.length; // uncap within the filter, else drop it
                mode = limit < hits ? 'uncap' : 'reset';
                moreEl.hidden = limit >= cards.length;
                moreEl.textContent = 'Show all ' + reveal + ' authors';
                // Always the same sentence: how many the filter MATCHED. Whether the list is capped
                // is the Show-all button's job to say — a count that changes shape between pills
                // ("48 authors" vs "Showing 60 of 130 authors") reads as a different metric each time.
                countEl.textContent = hits ? hits + ' author' + (hits === 1 ? '' : 's') : '';
            }
            // Scope to .chip — the author cards carry data-era/data-mag/data-n too, so a bare
            // [data-era] selector would wire every card as a filter button.
            function press(sel, attr, val){
                [].forEach.call(document.querySelectorAll(sel), function(b){
                    b.setAttribute('aria-pressed', b.getAttribute(attr) === val ? 'true' : 'false');
                });
            }
            [].forEach.call(document.querySelectorAll('.chip[data-lens]'), function(b){
                b.addEventListener('click', function(){
                    lens = b.getAttribute('data-lens'); shown = PAGE;
                    press('.chip[data-lens]', 'data-lens', lens); render();
                });
            });
            [].forEach.call(document.querySelectorAll('.chip[data-era]'), function(b){
                b.addEventListener('click', function(){
                    var v = b.getAttribute('data-era');
                    era = (era === v) ? '' : v; shown = PAGE;
                    press('.chip[data-era]', 'data-era', era); render();
                });
            });
            qEl.addEventListener('input', function(){
                term = qEl.value.trim().toLowerCase();
                // typing a name is a known-item lookup — search the whole corpus, not the active lens
                if (term) { lens = 'all'; press('.chip[data-lens]', 'data-lens', 'all'); }
                shown = PAGE; render();
            });
            moreEl.addEventListener('click', function(){
                shown = 1e9;
                if (mode === 'reset') { // drop the lens/era/search that were withholding people
                    lens = 'all'; era = ''; term = ''; qEl.value = '';
                    press('.chip[data-lens]', 'data-lens', 'all');
                    press('.chip[data-era]', 'data-era', '');
                }
                render();
            });
            render();
        })();
    </script>`;
fs.writeFileSync(path.join(OUT, 'index.html'), page(idxInner, idxHead));

console.log(`  ✓ authors/ (${authors.length} author pages + index, ${totalQuotes} quotes linked, ${songArtists} song artists across ${totalSongs} songs)`);
