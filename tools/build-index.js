#!/usr/bin/env node
'use strict';
/*
 * build-index.js — generates the three top-level browse pages from data/manifest.json +
 * data/harvest-queue.json, all sharing the nav + universal search from chrome.js:
 *   index.html              → /               lean landing: hero, featured, gateway tiles
 *   who-said/index.html     → /who-said/       "Quotes": search + confidence filter + verified grid
 *   under-review/index.html → /under-review/   the flagged-candidate queue + (when live) vote/nominate
 * Run by tools/build.js (after build-search emits /search.json).
 */
const fs = require('fs');
const path = require('path');
const { HEAD_SCRIPT, THEME_CSS, SCRIPT } = require('./a11y-widget');
const { ROOT_CSS } = require('./tokens');
const { esc } = require('./esc');
const { NAV, CHROME_CSS, SEARCH_JS, FOOTER } = require('./chrome');
const { OG_IMAGE_TAGS } = require('./og'); // the one shared social-card image
// Every number this page states is PULLED from CORPUS (tools/corpus.js) — the one derivation.
// This file counts nothing itself. The Authors tile in particular must report what /authors/
// actually lists (all hubs, song artists included); counting distinct quote-authors here instead
// published "526" on a tile linking to an index headed "593".
const { CORPUS } = require('./corpus');
const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
const bySlug = Object.fromEntries(manifest.map((m) => [m.quoteSlug, m]));

// ---- under-review backlog + interactive (Phase 2) config ----
let BENCH = [];
try {
  const hq = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'harvest-queue.json'), 'utf8'));
  BENCH = (hq.candidates || []).filter((c) => c.status === 'queued');
} catch (_) { /* optional */ }
let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'harvest-config.json'), 'utf8')); } catch (_) { /* optional */ }
const INTERACTIVE = !!(CFG.votesApi && CFG.turnstileSitekey);
const BENCH_LABEL = { misattributed: 'Likely misattributed', disputed: 'Disputed', 'genuine-famous': 'Verifying source' };

// byConf groups the manifest entries for RENDERING (each bucket is a list of quotes to lay out).
// The COUNTS this page prints come from CORPUS, never from these arrays — see the stat line below.
const total = CORPUS.quotes.total;
const byConf = { verified: [], attributed: [], disputed: [] };
manifest.forEach((m) => { (byConf[m.confidence] || (byConf[m.confidence] = [])).push(m); });
const authorCount = CORPUS.authors.total;
const songCount = CORPUS.songs.total;

// ---- shared renderers ----
const searchText = (s) => String(s || '').replace(/&mdash;|&ndash;/g, '-').replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&lsquo;|&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
  .replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const CONF = { verified: '✓', attributed: '≈', disputed: '?' };

const FEATURED = [
  { slug: 'there-is-no-greater-agony-than-bearing-an-untold-story', credited: 'Maya Angelou', real: 'Zora Neale Hurston' },
  { slug: 'stay-hungry-stay-foolish', credited: 'Steve Jobs', real: 'Stewart Brand' },
  { slug: 'quality-is-not-an-act-it-is-a-habit', credited: 'Aristotle', real: 'Will Durant' },
  { slug: 'the-future-belongs-to-those-who-believe-in-the-beauty-of', credited: 'Eleanor Roosevelt', real: 'Anonymous (1978)' },
  { slug: 'the-journey-of-a-thousand-miles-begins-with-a-single-step', credited: 'Confucius', real: 'Lao Tzu' },
  { slug: 'whatever-you-are-be-a-good-one', credited: 'Abraham Lincoln', real: 'Thackeray' },
].filter((f) => bySlug[f.slug]).slice(0, 6);
const featuredCard = (f) => {
  const m = bySlug[f.slug];
  return `                <a class="feat" href="/who-said/${f.slug}/">
                    <p class="feat-q">&ldquo;${esc(m.quote)}&rdquo;</p>
                    <p class="feat-swap"><span class="feat-no">${esc(f.credited)}</span><span class="feat-arrow" aria-hidden="true">→</span><span class="feat-yes">${esc(f.real)}</span></p>
                </a>`;
};

const card = (m) => `                <a class="q-card ${m.confidence} filterable" href="/who-said/${m.quoteSlug}/" data-c="${m.confidence}" data-s="${esc(searchText((m.quote || '') + ' ' + (m.author || '')))}">
                    <p class="q-text">&ldquo;${esc(m.quote)}&rdquo;</p>
                    <p class="q-foot"><span class="q-author">${esc(m.author || 'Unknown')}</span><span class="q-badge ${m.confidence}" title="${m.confidence}" aria-hidden="true">${CONF[m.confidence] || ''}</span></p>
                </a>`;
const CONF_RANK = { disputed: 0, attributed: 1, verified: 2 };
const allSorted = [...manifest].sort((a, b) => (CONF_RANK[a.confidence] - CONF_RANK[b.confidence]) || String(a.quote).localeCompare(String(b.quote)));
const chip = (key, label, n, active) => `<button class="chip${active ? ' active' : ''}" data-f="${key}" role="tab" aria-selected="${!!active}">${label} <span>${n}</span></button>`;

const voteBtn = (c) => `<button class="vote" type="button" data-slug="${esc(c.slug)}" title="Boost this quote up the review queue" aria-label="Boost priority for &ldquo;${esc(c.quote)}&rdquo;"><span class="vote-caret" aria-hidden="true">▲</span> <span class="vote-n">·</span></button>`;
const benchCard = (c) => `                <article class="bench-card ${c.category} filterable" data-c="${c.category}" data-s="${esc(searchText((c.quote || '') + ' ' + (c.magnetAuthor || '')))}">
                    <p class="bench-q">&ldquo;${esc(c.quote)}&rdquo;</p>
                    <div class="bench-foot">
                        <span class="bench-cred">Pinned on ${esc(c.magnetAuthor || 'unknown')}</span>
                        <span class="bench-tag ${c.category}">${BENCH_LABEL[c.category] || 'Queued'}</span>
                    </div>
                    <div class="bench-actions">
${INTERACTIVE ? `                        ${voteBtn(c)}` : ''}
${c.documentedAt ? `                        <a class="bench-src" href="/flagged/?q=${esc(c.slug)}">Why we flagged it <span aria-hidden="true">→</span></a>` : ''}
                    </div>
                </article>`;

// ---- page shell ----
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=Source+Serif+4:ital@0;1&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">`;
const page = ({ title, description, active, canonical, headExtra = '', jsonld = '', body, scripts = '' }) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
${HEAD_SCRIPT}
    <title>${title}</title>
    <meta name="description" content="${description}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:site_name" content="Quotle.info">
${OG_IMAGE_TAGS}
${jsonld}    ${FONTS}
${headExtra}    <style>
${ROOT_CSS}${_baseCss()}${CHROME_CSS}
    </style>
${THEME_CSS}
</head>
<body>
${NAV(active)}
    <main id="main">
${body}
    </main>
${FOOTER}
${SEARCH_JS}
${scripts}${SCRIPT}
</body>
</html>
`;

// ---- local grid filter (chips + in-page search box), reused by Quotes and Under review ----
const FILTER_JS = `    <script>
        (function(){
            var q=document.getElementById('pq'), none=document.getElementById('noResults');
            var chips=[].slice.call(document.querySelectorAll('.chip'));
            var cards=[].slice.call(document.querySelectorAll('.filterable'));
            var filter='all';
            function apply(){ var t=(q&&q.value||'').trim().toLowerCase(), shown=0;
                for(var i=0;i<cards.length;i++){ var c=cards[i];
                    var okF = filter==='all' || c.getAttribute('data-c')===filter;
                    var okQ = !t || (c.getAttribute('data-s')||'').indexOf(t)>-1;
                    var vis=okF&&okQ; c.hidden=!vis; if(vis) shown++; }
                if(none) none.hidden = shown>0; }
            if(q) q.addEventListener('input', apply);
            chips.forEach(function(ch){ ch.addEventListener('click', function(){
                chips.forEach(function(x){ x.classList.remove('active'); x.setAttribute('aria-selected','false'); });
                ch.classList.add('active'); ch.setAttribute('aria-selected','true');
                filter=ch.getAttribute('data-f'); apply(); }); });
            try { var pre=new URLSearchParams(location.search).get('q'); if(pre&&q){ q.value=pre; apply(); } } catch(e){}
        })();
    </script>`;

// ---- HOME ----
const homeJsonLd = `    <script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebSite","@id":"https://quotle.info/#website","url":"https://quotle.info/","name":"Quotle.info","description":"Verified quote provenance and reuse-rights clearance — who really said it, traced to a primary source, and whether it is public-domain or in-copyright before you publish it.","publisher":{"@id":"https://quotle.info/#org"},"potentialAction":{"@type":"SearchAction","target":{"@type":"EntryPoint","urlTemplate":"https://quotle.info/who-said/?q={search_term_string}"},"query-input":"required name=search_term_string"}},
      {"@type":"Organization","@id":"https://quotle.info/#org","name":"Quotle.info","url":"https://quotle.info/","description":"A verified-provenance fact-check companion to the Quotle game (Game Shelf). Every quote traced to a primary source and dated."}
    ]}
    </script>
`;
const homeBody = `        <header class="hero">
            <h1>Real quote? <em>Cleared</em> to use?</h1>
            <p class="lede">Before you put a quote on a slide or in print: Quotle.info traces it to its <strong>real source</strong> — who actually said it — and tells you whether it&rsquo;s <strong>cleared to reproduce</strong> (public domain, or still under copyright). The part an AI usually gets wrong.</p>
            <p class="stat"><b>${total}</b> quotes fact&#8209;checked &mdash; ${CORPUS.quotes.byConfidence.verified} verified, ${CORPUS.quotes.byConfidence.attributed} attributed, ${CORPUS.quotes.byConfidence.disputed} flagged as misquoted &mdash; each traced as far as the record allows, with its reuse rights marked</p>
        </header>
${FEATURED.length ? `        <section class="featured" aria-label="Notable reattributions">
            <p class="feat-kicker">Not who you think</p>
            <div class="feat-grid">
${FEATURED.map(featuredCard).join('\n')}
            </div>
        </section>` : ''}
        <section class="tiles" aria-label="Browse">
            <a class="tile" href="/who-said/"><div class="tile-n">${total}</div><div class="tile-label">Quotes</div><div class="tile-sub">Verified, attributed &amp; misattributed — with the receipts.</div></a>
            <a class="tile" href="/authors/"><div class="tile-n">${authorCount}</div><div class="tile-label">Authors</div><div class="tile-sub">Who really said what, quote by quote.</div></a>
            <a class="tile" href="/under-review/"><div class="tile-n">${BENCH.length}</div><div class="tile-label">Under review</div><div class="tile-sub">Flagged as commonly misquoted — queued for a full trace.</div></a>
        </section>
        <aside class="game-cta">
            <h2>Think you know your quotes?</h2>
            <p>Quotle is a daily puzzle: guess the author from the words alone.</p>
            <a href="https://gameshelf.co/quotle/">Play today&rsquo;s Quotle <span aria-hidden="true">→</span></a>
        </aside>`;

// ---- QUOTES (/who-said/) ----
const quotesBody = `        <header class="page-head">
            <h1>Every quote, traced</h1>
            <p class="lede">Search the exact words or the name it&rsquo;s pinned on. Filter by how solid the attribution is.</p>
        </header>
        <section class="browse" aria-label="Find a quote">
            <input id="pq" class="search" type="search" placeholder="Search a quote or an author…" aria-label="Filter quotes" autocomplete="off">
            <div class="chips" role="tablist" aria-label="Filter by attribution">
                ${chip('all', 'All', manifest.length, true)}
                ${chip('disputed', 'Misattributed', (byConf.disputed || []).length)}
                ${chip('verified', 'Verified', (byConf.verified || []).length)}
                ${chip('attributed', 'Attributed', (byConf.attributed || []).length)}
            </div>
            <div class="q-grid" id="results">
${allSorted.map(card).join('\n')}
            </div>
            <p class="no-results" id="noResults" hidden>No quote matches that. Try fewer words, or <a href="/authors/">browse by author</a>.</p>
        </section>`;

// ---- UNDER REVIEW (/under-review/) ----
const nomForm = `
            <form class="nom" id="nomForm" aria-label="Nominate a quote or author">
                <h3 class="nom-h">Spot a famous fake we&rsquo;re missing?</h3>
                <p class="nom-sub">Nominate a quote or the name it&rsquo;s pinned on. We trace the source before anything goes live &mdash; nothing you submit is published unverified.</p>
                <input class="nom-in" name="author" maxlength="120" placeholder="Who it&rsquo;s usually credited to (required)" autocomplete="off" required>
                <input class="nom-in" name="quote" maxlength="600" placeholder="The quote, if you have it (optional)" autocomplete="off">
                <input class="nom-in" name="note" maxlength="600" placeholder="Anything you know about the real source (optional)" autocomplete="off">
                <button class="nom-btn" type="submit">Submit nomination</button>
                <p class="nom-msg" id="nomMsg" role="status" hidden></p>
            </form>`;
const bcount = BENCH.reduce((m, c) => (m[c.category] = (m[c.category] || 0) + 1, m), {});
const reviewBody = `        <header class="page-head">
            <p class="feat-kicker">On the research bench</p>
            <h1>Under review</h1>
            <p class="lede">Lines we&rsquo;ve flagged as commonly misquoted or misattributed and queued for a full source trace. <strong>Not yet verified</strong> — each links to the catalog entry that flagged it${INTERACTIVE ? ', and you can <strong>▲ bump one up the queue</strong>' : ''}. ${BENCH.length} in the queue.</p>
        </header>
        <section class="browse" aria-label="Filter quotes under review">
            <input id="pq" class="search" type="search" placeholder="Search a quote or an author…" aria-label="Filter quotes under review" autocomplete="off">
            <div class="chips" role="tablist" aria-label="Filter by type">
                ${chip('all', 'All', BENCH.length, true)}
                ${chip('misattributed', 'Misattributed', bcount.misattributed || 0)}
                ${chip('disputed', 'Disputed', bcount.disputed || 0)}
                ${chip('genuine-famous', 'Verifying', bcount['genuine-famous'] || 0)}
            </div>
            <div class="bench-grid" id="results">
${BENCH.map(benchCard).join('\n')}
            </div>
            <p class="no-results" id="noResults" hidden>Nothing under review matches that.</p>
        </section>
${INTERACTIVE ? nomForm : `        <p class="bench-note">Voting to prioritise these &mdash; and nominating new authors and quotes &mdash; is coming soon.</p>`}`;

const TURNSTILE_HEAD = INTERACTIVE ? `    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>\n` : '';
const BENCH_JS = INTERACTIVE ? `    <script>
        (function(){
            var API=${JSON.stringify(CFG.votesApi)}, SITEKEY=${JSON.stringify(CFG.turnstileSitekey)};
            var VKEY='quotle-voted', voted={};
            try { voted=JSON.parse(localStorage.getItem(VKEY)||'{}')||{}; } catch(e){}
            function save(){ try{ localStorage.setItem(VKEY,JSON.stringify(voted)); }catch(e){} }
            fetch(API+'/votes').then(function(r){return r.json();}).then(function(d){
                var v=(d&&d.votes)||{};
                [].forEach.call(document.querySelectorAll('.vote'),function(b){ var s=b.getAttribute('data-slug');
                    b.querySelector('.vote-n').textContent=v[s]||0; if(voted[s]){ b.classList.add('voted'); b.disabled=true; } });
            }).catch(function(){ [].forEach.call(document.querySelectorAll('.vote-n'),function(n){ n.textContent='0'; }); });
            var wid=null, pending=null;
            function ensure(){ if(wid!==null||!window.turnstile) return; var el=document.createElement('div'); el.style.display='none'; document.body.appendChild(el);
                wid=window.turnstile.render(el,{sitekey:SITEKEY,size:'invisible',callback:function(t){ var c=pending; pending=null; if(c)c(t); },'error-callback':function(){ var c=pending; pending=null; if(c)c(null); }}); }
            function token(cb){ ensure(); if(wid===null){ cb(null); return; } pending=cb; try{ window.turnstile.reset(wid); window.turnstile.execute(wid); }catch(e){ pending=null; cb(null); } }
            function vote(b){ var s=b.getAttribute('data-slug'); if(voted[s]||b.disabled) return; b.disabled=true;
                token(function(t){ if(!t){ b.disabled=false; return; }
                    fetch(API+'/vote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:s,token:t})})
                    .then(function(r){return r.json();}).then(function(d){ if(d&&d.ok){ b.querySelector('.vote-n').textContent=d.count; b.classList.add('voted'); voted[s]=1; save(); } else { b.disabled=false; } })
                    .catch(function(){ b.disabled=false; }); }); }
            [].forEach.call(document.querySelectorAll('.vote'),function(b){ b.addEventListener('click',function(){ vote(b); }); });
            var f=document.getElementById('nomForm');
            function show(el,t,err){ el.textContent=t; el.hidden=false; el.className='nom-msg'+(err?' err':''); }
            if(f){ f.addEventListener('submit',function(e){ e.preventDefault();
                var msg=document.getElementById('nomMsg'), btn=f.querySelector('.nom-btn');
                var author=f.author.value.trim(), quote=f.quote.value.trim(), note=f.note.value.trim();
                if(!author&&!quote){ show(msg,'Add at least an author or a quote.',true); return; }
                btn.disabled=true; show(msg,'Checking\\u2026',false);
                token(function(t){ if(!t){ btn.disabled=false; show(msg,'Verification failed \\u2014 please try again.',true); return; }
                    fetch(API+'/nominate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({author:author,quote:quote,note:note,token:t})})
                    .then(function(r){return r.json();}).then(function(d){ if(d&&d.ok){ f.reset(); btn.disabled=false; show(msg,'Thank you \\u2014 added to the review queue.',false); } else { btn.disabled=false; show(msg,(d&&d.error)||'Something went wrong.',true); } })
                    .catch(function(){ btn.disabled=false; show(msg,'Network error \\u2014 please try again.',true); }); }); }); }
        })();
    </script>` : '';

// ---- write ----
const homeHtml = page({ title: 'Quotle.info — Real quote? Cleared to use? Verified provenance + reuse rights', description: `Before you publish a quote: check it's real, who actually said it, and whether it's cleared to reproduce (public domain or in copyright) — the part AI gets wrong. ${total} quotes traced to a primary source.`, active: 'home', canonical: 'https://quotle.info/', jsonld: homeJsonLd, body: homeBody });
const quotesHtml = page({ title: 'Quotes — who really said it | Quotle.info', description: `Search ${total} quotes traced to a primary source. Filter by verified, attributed, or misattributed.`, active: 'quotes', canonical: 'https://quotle.info/who-said/', body: quotesBody, scripts: FILTER_JS });
const reviewHtml = page({ title: 'Under review — quotes queued for verification | Quotle.info', description: `${BENCH.length} commonly-misquoted lines we&rsquo;ve flagged and queued for a full source trace. Not yet verified.`, active: 'review', canonical: 'https://quotle.info/under-review/', headExtra: TURNSTILE_HEAD, body: reviewBody, scripts: FILTER_JS + '\n' + BENCH_JS });

fs.writeFileSync(path.join(ROOT, 'index.html'), homeHtml);
fs.mkdirSync(path.join(ROOT, 'who-said'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'who-said', 'index.html'), quotesHtml);
fs.mkdirSync(path.join(ROOT, 'under-review'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'under-review', 'index.html'), reviewHtml);
console.log(`  ✓ index.html (lean home) + who-said/ (${total} quotes) + under-review/ (${BENCH.length} queued)`);

// ---- base CSS (shared across the three pages; nav/search live in CHROME_CSS) ----
function _baseCss() { return `
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'Source Serif 4',Georgia,serif; background:var(--bg-deep); color:var(--ink); line-height:1.6; -webkit-font-smoothing:antialiased; overflow-x:hidden; }
        a { color:inherit; }
        .hero { max-width:1000px; margin:0 auto; padding:44px 24px 12px; }
        .hero h1 { font-family:'Playfair Display',serif; font-weight:900; font-size:clamp(2.3rem,7vw,3.6rem); line-height:1.05; letter-spacing:-0.02em; text-wrap:balance; }
        .hero h1 em { font-style:italic; color:var(--burgundy); }
        .hero .lede { font-size:1.12rem; color:var(--slate); margin-top:20px; max-width:640px; }
        .hero .lede strong { color:var(--ink); }
        .hero .stat { font-family:'DM Sans',sans-serif; font-size:0.82rem; color:var(--text-muted); margin-top:18px; letter-spacing:0.02em; }
        .hero .stat b { color:var(--sage); }
        .page-head { max-width:1000px; margin:0 auto; padding:38px 24px 4px; }
        .page-head h1 { font-family:'Playfair Display',serif; font-weight:900; font-size:clamp(2rem,6vw,3rem); line-height:1.06; letter-spacing:-0.02em; }
        .page-head .lede { font-size:1.05rem; color:var(--slate); margin-top:14px; max-width:640px; }
        .page-head .lede strong { color:var(--ink); }
        main { max-width:1000px; margin:0 auto; padding:8px 24px 60px; }
        .featured { margin-top:40px; }
        .feat-kicker { font-family:'DM Sans',sans-serif; text-transform:uppercase; font-size:0.7rem; font-weight:700; letter-spacing:0.2em; color:var(--burgundy); margin-bottom:16px; }
        .feat-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
        @media (max-width:820px){ .feat-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        @media (max-width:520px){ .feat-grid { grid-template-columns:1fr; } }
        .feat { display:block; text-decoration:none; background:linear-gradient(135deg,var(--burgundy-glow),transparent); border:1px solid rgba(212,98,122,0.25); border-radius:14px; padding:20px 22px; transition:transform 0.2s; }
        .feat:hover { transform:translateY(-3px); }
        .feat-q { font-style:italic; font-size:1.02rem; color:var(--ink); }
        .feat-swap { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:14px; font-family:'DM Sans',sans-serif; font-size:0.8rem; }
        .feat-no { color:var(--text-muted); text-decoration:line-through; }
        .feat-arrow { color:var(--burgundy); }
        .feat-yes { color:var(--sage); font-weight:600; }
        .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; margin-top:44px; }
        .tile { display:block; text-decoration:none; background:var(--bg-card); border:1px solid var(--border); border-radius:16px; padding:26px 24px; transition:transform 0.2s,border-color 0.2s; }
        .tile:hover { transform:translateY(-4px); border-color:var(--border-accent); }
        .tile-n { font-family:'Playfair Display',serif; font-weight:900; font-size:2.1rem; color:var(--burgundy); line-height:1; }
        .tile-label { font-family:'DM Sans',sans-serif; font-weight:700; font-size:1.08rem; color:var(--ink); margin-top:10px; }
        .tile-sub { font-family:'DM Sans',sans-serif; font-size:0.85rem; color:var(--text-muted); margin-top:6px; line-height:1.5; }
        .browse { margin-top:30px; }
        .search { width:100%; font-family:'DM Sans',sans-serif; font-size:1rem; color:var(--ink); background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:14px 18px; outline:none; transition:border-color 0.2s; }
        .search:focus { border-color:var(--burgundy); }
        .search::placeholder { color:var(--text-muted); }
        .chips { display:flex; gap:8px; flex-wrap:wrap; margin:16px 0 22px; }
        .chip { font-family:'DM Sans',sans-serif; font-size:0.8rem; font-weight:600; color:var(--slate); background:transparent; border:1px solid var(--border); border-radius:999px; padding:7px 14px; cursor:pointer; display:inline-flex; gap:7px; align-items:center; transition:color 0.2s,border-color 0.2s,background 0.2s; }
        .chip span { color:var(--text-muted); font-weight:500; }
        .chip:hover { color:var(--ink); border-color:var(--border-accent); }
        .chip.active { color:var(--ink); border-color:var(--burgundy); background:var(--burgundy-glow); }
        .chip.active span { color:var(--burgundy); }
        .q-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
        .q-card { display:block; text-decoration:none; background:var(--bg-card); border:1px solid var(--border); border-left:3px solid var(--border); border-radius:12px; padding:18px 20px; transition:transform 0.2s,border-color 0.2s; }
        .q-card:hover { transform:translateY(-3px); }
        .q-card.verified { border-left-color:var(--sage); } .q-card.attributed { border-left-color:var(--amber); } .q-card.disputed { border-left-color:var(--caution); }
        .q-text { font-style:italic; font-size:1rem; color:var(--ink); }
        .q-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:12px; }
        .q-author { font-family:'DM Sans',sans-serif; font-weight:600; font-size:0.82rem; color:var(--text-muted); }
        .q-badge { flex-shrink:0; width:18px; height:18px; border-radius:50%; display:grid; place-items:center; font-size:0.62rem; font-weight:700; color:var(--bg-deep); }
        .q-badge.verified { background:var(--sage); } .q-badge.attributed { background:var(--amber); } .q-badge.disputed { background:var(--caution); }
        .filterable[hidden] { display:none; }
        .no-results { font-family:'DM Sans',sans-serif; color:var(--text-muted); text-align:center; padding:34px 20px; }
        .no-results a { color:var(--sage); }
        .bench-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
        .bench-card { background:var(--bg-card); border:1px dashed var(--border-accent); border-radius:12px; padding:18px 20px; display:flex; flex-direction:column; gap:12px; }
        .bench-q { font-style:italic; font-size:1rem; color:var(--ink); }
        .bench-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
        .bench-cred { font-family:'DM Sans',sans-serif; font-weight:600; font-size:0.8rem; color:var(--text-muted); }
        .bench-tag { font-family:'DM Sans',sans-serif; font-size:0.68rem; font-weight:600; padding:3px 9px; border-radius:999px; border:1px solid; white-space:nowrap; }
        .bench-tag.misattributed { color:var(--caution); border-color:rgba(154,163,214,0.45); }
        .bench-tag.disputed { color:var(--amber); border-color:rgba(224,162,78,0.4); }
        .bench-tag.genuine-famous { color:var(--sage); border-color:rgba(126,179,139,0.4); }
        .bench-actions { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:auto; padding-top:4px; }
        .bench-src { font-family:'DM Sans',sans-serif; font-size:0.75rem; font-weight:500; color:var(--burgundy-link); text-decoration:none; }
        .bench-src:hover { text-decoration:underline; }
        .bench-note { font-family:'DM Sans',sans-serif; font-size:0.82rem; color:var(--text-muted); text-align:center; margin-top:22px; }
        .vote { font-family:'DM Sans',sans-serif; font-size:0.78rem; font-weight:700; color:var(--slate); background:transparent; border:1px solid var(--border); border-radius:999px; padding:5px 12px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition:color 0.15s,border-color 0.15s,background 0.15s; }
        .vote:hover:not(:disabled) { color:var(--gold); border-color:rgba(255,211,105,0.4); }
        .vote .vote-caret { font-size:0.68rem; line-height:1; }
        .vote .vote-n { min-width:0.9em; text-align:center; font-variant-numeric:tabular-nums; }
        .vote.voted { color:var(--gold); border-color:rgba(255,211,105,0.45); background:rgba(255,211,105,0.08); }
        .vote:disabled { cursor:default; }
        .nom { margin-top:34px; background:var(--bg-card); border:1px solid var(--border); border-radius:16px; padding:26px 24px; display:flex; flex-direction:column; gap:10px; max-width:560px; }
        .nom-h { font-family:'Playfair Display',serif; font-weight:900; font-size:1.15rem; }
        .nom-sub { font-family:'DM Sans',sans-serif; font-size:0.85rem; color:var(--text-muted); margin-bottom:6px; }
        .nom-in { font-family:'DM Sans',sans-serif; font-size:0.92rem; color:var(--ink); background:var(--bg-deep); border:1px solid var(--border); border-radius:10px; padding:11px 14px; outline:none; transition:border-color 0.2s; }
        .nom-in:focus { border-color:var(--burgundy); }
        .nom-in::placeholder { color:var(--text-muted); }
        .nom-btn { align-self:flex-start; margin-top:4px; font-family:'DM Sans',sans-serif; font-weight:600; font-size:0.88rem; color:#fff; background:linear-gradient(135deg,var(--burgundy),var(--burgundy-deep)); border:none; border-radius:11px; padding:11px 22px; cursor:pointer; }
        .nom-btn:disabled { opacity:0.55; cursor:default; }
        .nom-msg { font-family:'DM Sans',sans-serif; font-size:0.85rem; color:var(--sage); margin-top:4px; }
        .nom-msg.err { color:var(--caution); }
        .game-cta { margin-top:56px; text-align:center; background:linear-gradient(135deg,var(--burgundy-glow),rgba(255,211,105,0.1)); border:1px solid rgba(212,98,122,0.25); border-radius:22px; padding:38px 28px; }
        .game-cta h2 { font-family:'Playfair Display',serif; font-size:1.5rem; margin-bottom:8px; }
        .game-cta p { color:var(--slate); font-size:0.95rem; margin-bottom:20px; }
        .game-cta a { display:inline-flex; align-items:center; gap:10px; padding:13px 30px; background:linear-gradient(135deg,var(--burgundy),var(--burgundy-deep)); border-radius:14px; font-family:'DM Sans',sans-serif; font-weight:600; color:#fff; text-decoration:none; }
        footer { max-width:1000px; margin:0 auto; padding:36px 24px 52px; border-top:1px solid var(--border); font-family:'DM Sans',sans-serif; font-size:0.82rem; color:var(--text-muted); }
        footer a { color:var(--burgundy); text-decoration:none; }
        @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }`; }
