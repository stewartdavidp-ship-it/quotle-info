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
const { HEAD_SCRIPT, THEME_CSS, CONTROL, SCRIPT } = require('./a11y-widget');
const { ROOT_CSS } = require('./tokens');
const { esc } = require('./esc'); // shared entity-aware escape (same helper template.js uses)
const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
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

// Research bench: candidates queued for verification (data/harvest-queue.json). These are
// NOT verified content — they are flagged, unverified targets shown for transparency. We never
// assert the reattribution as fact here (that would break the anti-fabrication contract); we
// only say what they're pinned on and link to the catalog entry that flagged them.
let BENCH = [];
try {
  const hq = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'harvest-queue.json'), 'utf8'));
  BENCH = (hq.candidates || []).filter((c) => c.status === 'queued');
} catch (_) { /* backlog optional */ }
const BENCH_SHOWN = 48;
const benchTotal = BENCH.length;
const BENCH_LABEL = { misattributed: 'Likely misattributed', disputed: 'Disputed', 'genuine-famous': 'Verifying source' };

// Interactive layer (Phase 2): +1 voting + nominations via the Cloudflare Worker. Feature-flagged
// on the presence of data/harvest-config.json {votesApi, turnstileSitekey} — both PUBLIC values.
// Absent/empty → display-only bench (the "coming soon" note). So a missing backend never breaks the site.
let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'harvest-config.json'), 'utf8')); } catch (_) { /* optional */ }
const INTERACTIVE = !!(CFG.votesApi && CFG.turnstileSitekey);

const featuredCard = (f) => {
  const m = bySlug[f.slug];
  return `                <a class="feat" href="/who-said/${f.slug}/">
                    <p class="feat-q">&ldquo;${esc(m.quote)}&rdquo;</p>
                    <p class="feat-swap"><span class="feat-no">${esc(f.credited)}</span><span class="feat-arrow" aria-hidden="true">→</span><span class="feat-yes">${esc(f.real)}</span></p>
                </a>`;
};

// plain-text (entity-decoded, lowercased) for the client-side search index in data-s
const searchText = (s) => String(s || '').replace(/&mdash;|&ndash;/g, '-').replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&lsquo;|&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
  .replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const CONF = { verified: '✓', attributed: '≈', disputed: '?' };

const card = (m) => `                <a class="q-card ${m.confidence}" href="/who-said/${m.quoteSlug}/" data-c="${m.confidence}" data-s="${esc(searchText((m.quote || '') + ' ' + (m.author || '')))}">
                    <p class="q-text">&ldquo;${esc(m.quote)}&rdquo;</p>
                    <p class="q-foot"><span class="q-author">${esc(m.author || 'Unknown')}</span><span class="q-badge ${m.confidence}" title="${m.confidence}" aria-hidden="true">${CONF[m.confidence] || ''}</span></p>
                </a>`;

// all quotes in one grid, most-interesting first (disputed → attributed → verified), alpha within
const CONF_RANK = { disputed: 0, attributed: 1, verified: 2 };
const allSorted = [...manifest].sort((a, b) => (CONF_RANK[a.confidence] - CONF_RANK[b.confidence]) || String(a.quote).localeCompare(String(b.quote)));
const chip = (key, label, n) => `<button class="chip${key === 'all' ? ' active' : ''}" data-f="${key}" role="tab" aria-selected="${key === 'all'}">${label} <span>${n}</span></button>`;
const browseBlock = `
        <section class="browse" aria-label="Find a quote">
            <div class="sec-head-row"><h2 class="browse-h">Have one in mind?</h2><p class="browse-sub">Search the exact words, or the name it&rsquo;s pinned on.</p></div>
            <input id="q" class="search" type="search" placeholder="Search a quote or an author…" aria-label="Search quotes and authors" autocomplete="off">
            <div class="chips" role="tablist" aria-label="Filter by attribution">
                ${chip('all', 'All', manifest.length)}
                ${chip('disputed', 'Misattributed', (byConf.disputed || []).length)}
                ${chip('verified', 'Verified', (byConf.verified || []).length)}
                ${chip('attributed', 'Attributed', (byConf.attributed || []).length)}
            </div>
            <div class="q-grid" id="results">
${allSorted.map(card).join('\n')}
            </div>
            <p class="no-results" id="noResults" hidden>No quote matches that. Try fewer words, or <a href="/authors/">browse by author</a>.</p>
        </section>`;

const SEARCH_JS = `    <script>
        (function(){
            var q=document.getElementById('q'), none=document.getElementById('noResults');
            var chips=[].slice.call(document.querySelectorAll('.chip'));
            var cards=[].slice.call(document.querySelectorAll('#results .q-card'));
            var filter='all';
            function apply(){
                var t=(q.value||'').trim().toLowerCase(), shown=0;
                for(var i=0;i<cards.length;i++){ var c=cards[i];
                    var okF = filter==='all' || c.getAttribute('data-c')===filter;
                    var okQ = !t || c.getAttribute('data-s').indexOf(t)>-1;
                    var vis = okF && okQ; c.hidden=!vis; if(vis) shown++;
                }
                none.hidden = shown>0;
            }
            q.addEventListener('input', apply);
            chips.forEach(function(ch){ ch.addEventListener('click', function(){
                chips.forEach(function(x){ x.classList.remove('active'); x.setAttribute('aria-selected','false'); });
                ch.classList.add('active'); ch.setAttribute('aria-selected','true');
                filter=ch.getAttribute('data-f'); apply();
            }); });
            // Deep-linkable search: /?q=term pre-fills and filters (shareable; enables SearchAction).
            try { var pre=new URLSearchParams(location.search).get('q'); if(pre){ q.value=pre; apply(); } } catch(e){}
        })();
    </script>`;

const voteBtn = (c) => `<button class="vote" type="button" data-slug="${esc(c.slug)}" title="Boost this quote up the research queue" aria-label="Boost priority for &ldquo;${esc(c.quote)}&rdquo;"><span class="vote-caret" aria-hidden="true">▲</span> <span class="vote-n">·</span></button>`;
const benchCard = (c) => `                <article class="bench-card ${c.category}">
                    <p class="bench-q">&ldquo;${esc(c.quote)}&rdquo;</p>
                    <div class="bench-foot">
                        <span class="bench-cred">Pinned on ${esc(c.magnetAuthor || 'unknown')}</span>
                        <span class="bench-tag ${c.category}">${BENCH_LABEL[c.category] || 'Queued'}</span>
                    </div>
                    <div class="bench-actions">
${INTERACTIVE ? `                        ${voteBtn(c)}` : ''}
${c.documentedAt ? `                        <a class="bench-src" href="${esc(c.documentedAt)}" target="_blank" rel="noopener">Why we flagged it <span aria-hidden="true">↗</span></a>` : ''}
                    </div>
                </article>`;
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
const benchNote = INTERACTIVE
  ? nomForm
  : `            <p class="bench-note">Voting to prioritise these &mdash; and nominating new authors and quotes &mdash; is coming soon.</p>`;
const benchBlock = benchTotal ? `
        <section class="bench" aria-label="Quotes queued for verification">
            <p class="feat-kicker">On the research bench</p>
            <div class="sec-head-row"><h2 class="browse-h">Queued for verification</h2><p class="browse-sub">Lines we&rsquo;ve flagged as commonly misquoted or misattributed and queued for a full source trace. <strong>Not yet verified</strong> &mdash; each links to the catalog entry that put it on our list.${INTERACTIVE ? ' <strong>Tap ▲ to bump one up the queue.</strong>' : ''} ${benchTotal} in the queue${benchTotal > BENCH_SHOWN ? `, top ${BENCH_SHOWN} shown` : ''}.</p></div>
            <div class="bench-grid">
${BENCH.slice(0, BENCH_SHOWN).map(benchCard).join('\n')}
            </div>
${benchNote}
        </section>` : '';

const TURNSTILE_HEAD = INTERACTIVE ? `    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : '';
const BENCH_JS = INTERACTIVE ? `    <script>
        (function(){
            var API=${JSON.stringify(CFG.votesApi)}, SITEKEY=${JSON.stringify(CFG.turnstileSitekey)};
            var VKEY='quotle-voted', voted={};
            try { voted=JSON.parse(localStorage.getItem(VKEY)||'{}')||{}; } catch(e){}
            function save(){ try{ localStorage.setItem(VKEY,JSON.stringify(voted)); }catch(e){} }
            fetch(API+'/votes').then(function(r){return r.json();}).then(function(d){
                var v=(d&&d.votes)||{};
                [].forEach.call(document.querySelectorAll('.vote'),function(b){
                    var s=b.getAttribute('data-slug');
                    b.querySelector('.vote-n').textContent=v[s]||0;
                    if(voted[s]){ b.classList.add('voted'); b.disabled=true; }
                });
            }).catch(function(){ [].forEach.call(document.querySelectorAll('.vote-n'),function(n){ n.textContent='0'; }); });
            var wid=null, pending=null;
            function ensure(){ if(wid!==null||!window.turnstile) return; var el=document.createElement('div'); el.style.display='none'; document.body.appendChild(el);
                wid=window.turnstile.render(el,{sitekey:SITEKEY,size:'invisible',callback:function(t){ var c=pending; pending=null; if(c)c(t); },'error-callback':function(){ var c=pending; pending=null; if(c)c(null); }}); }
            function token(cb){ ensure(); if(wid===null){ cb(null); return; } pending=cb; try{ window.turnstile.reset(wid); window.turnstile.execute(wid); }catch(e){ pending=null; cb(null); } }
            function vote(b){ var s=b.getAttribute('data-slug'); if(voted[s]||b.disabled) return; b.disabled=true;
                token(function(t){ if(!t){ b.disabled=false; return; }
                    fetch(API+'/vote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:s,token:t})})
                    .then(function(r){return r.json();}).then(function(d){
                        if(d&&d.ok){ b.querySelector('.vote-n').textContent=d.count; b.classList.add('voted'); voted[s]=1; save(); }
                        else { b.disabled=false; }
                    }).catch(function(){ b.disabled=false; }); }); }
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
                    .then(function(r){return r.json();}).then(function(d){
                        if(d&&d.ok){ f.reset(); btn.disabled=false; show(msg,'Thank you \\u2014 added to the review queue.',false); }
                        else { btn.disabled=false; show(msg,(d&&d.error)||'Something went wrong.',true); }
                    }).catch(function(){ btn.disabled=false; show(msg,'Network error \\u2014 please try again.',true); }); }); }); }
        })();
    </script>` : '';

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
${HEAD_SCRIPT}
    <title>Quotle.info — Who really said it? Verified quote provenance</title>
    <meta name="description" content="Every quote traced to its real source: who actually said it, the primary document, and the misattributions untangled with receipts. ${total} quotes verified.">
    <link rel="canonical" href="https://quotle.info/">
    <meta property="og:type" content="website">
    <meta property="og:title" content="Quotle.info — Who really said it?">
    <meta property="og:description" content="${total} quotes traced to a primary source, with the misattributions untangled with receipts.">
    <meta property="og:url" content="https://quotle.info/">
    <meta property="og:site_name" content="Quotle.info">
    <meta name="twitter:card" content="summary_large_image">
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebSite",
          "@id": "https://quotle.info/#website",
          "url": "https://quotle.info/",
          "name": "Quotle.info",
          "description": "Verified quote provenance — who really said it, traced to a primary source, with misattributions untangled.",
          "publisher": { "@id": "https://quotle.info/#org" },
          "potentialAction": {
            "@type": "SearchAction",
            "target": { "@type": "EntryPoint", "urlTemplate": "https://quotle.info/?q={search_term_string}" },
            "query-input": "required name=search_term_string"
          }
        },
        {
          "@type": "Organization",
          "@id": "https://quotle.info/#org",
          "name": "Quotle.info",
          "url": "https://quotle.info/",
          "description": "A verified-provenance fact-check companion to the Quotle game (Game Shelf). Every quote traced to a primary source and dated."
        }
      ]
    }
    </script>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=Source+Serif+4:ital@0;1&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
${TURNSTILE_HEAD}
    <style>
${ROOT_CSS}
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'Source Serif 4',Georgia,serif; background:var(--bg-deep); color:var(--ink); line-height:1.6; -webkit-font-smoothing:antialiased; overflow-x:hidden; }
        a { color:inherit; }
        .topnav { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px 10px; max-width:1000px; margin:0 auto; padding:20px 24px 0; }
        .nav-actions { flex-wrap:wrap; justify-content:flex-end; }
        .brand { display:inline-flex; align-items:center; gap:9px; text-decoration:none; font-family:'Playfair Display',serif; font-weight:900; font-size:1.05rem; }
        .brand-icon { width:30px; height:30px; border-radius:8px; background:linear-gradient(135deg,var(--burgundy),var(--burgundy-deep)); display:grid; place-items:center; font-size:0.95rem; }
        .brand span { color:var(--burgundy); }
        .nav-play { font-family:'DM Sans',sans-serif; font-size:0.78rem; font-weight:600; color:var(--gold); text-decoration:none; padding:7px 14px; border:1px solid rgba(255,211,105,0.3); border-radius:999px; white-space:nowrap; }
        .nav-authors { font-family:'DM Sans',sans-serif; font-size:0.78rem; font-weight:500; color:var(--slate); text-decoration:none; padding:7px 12px; border:1px solid var(--border); border-radius:999px; white-space:nowrap; transition:color 0.2s,border-color 0.2s; }
        .nav-authors:hover { color:var(--ink); border-color:var(--border-accent); }
        .hero { max-width:1000px; margin:0 auto; padding:52px 24px 12px; }
        .hero h1 { font-family:'Playfair Display',serif; font-weight:900; font-size:clamp(2.3rem,7vw,3.6rem); line-height:1.05; letter-spacing:-0.02em; text-wrap:balance; }
        .hero h1 em { font-style:italic; color:var(--burgundy); }
        .hero .lede { font-size:1.12rem; color:var(--slate); margin-top:20px; max-width:640px; }
        .hero .lede strong { color:var(--ink); }
        .hero .stat { font-family:'DM Sans',sans-serif; font-size:0.82rem; color:var(--text-muted); margin-top:18px; letter-spacing:0.02em; }
        .hero .stat b { color:var(--sage); }
        main { max-width:1000px; margin:0 auto; padding:8px 24px 60px; }
        .featured { margin-top:40px; }
        .feat-kicker, .grp-head .grp-badge { font-family:'DM Sans',sans-serif; }
        .feat-kicker { text-transform:uppercase; font-size:0.7rem; font-weight:700; letter-spacing:0.2em; color:var(--burgundy); margin-bottom:16px; }
        .feat-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:12px; }
        .feat { display:block; text-decoration:none; background:linear-gradient(135deg,var(--burgundy-glow),transparent); border:1px solid rgba(212,98,122,0.25); border-radius:14px; padding:20px 22px; transition:transform 0.2s; }
        .feat:hover { transform:translateY(-3px); }
        .feat-q { font-style:italic; font-size:1.02rem; color:var(--ink); }
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
        .q-text { font-style:italic; font-size:1rem; color:var(--ink); }
        .q-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:12px; }
        .q-author { font-family:'DM Sans',sans-serif; font-weight:600; font-size:0.82rem; color:var(--text-muted); }
        .q-badge { flex-shrink:0; width:18px; height:18px; border-radius:50%; display:grid; place-items:center; font-size:0.62rem; font-weight:700; color:var(--bg-deep); }
        .q-badge.verified { background:var(--sage); } .q-badge.attributed { background:var(--amber); } .q-badge.disputed { background:var(--caution); }
        .q-card[hidden] { display:none; }
        /* browse: search + filter chips over one grid */
        .browse { margin-top:48px; }
        .sec-head-row { margin-bottom:16px; }
        .browse-h { font-family:'Playfair Display',serif; font-weight:900; font-size:1.5rem; }
        .browse-sub { font-family:'DM Sans',sans-serif; font-size:0.9rem; color:var(--text-muted); margin-top:4px; }
        .search { width:100%; font-family:'DM Sans',sans-serif; font-size:1rem; color:var(--ink); background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:14px 18px; outline:none; transition:border-color 0.2s; }
        .search:focus { border-color:var(--burgundy); }
        .search::placeholder { color:var(--text-muted); }
        .chips { display:flex; gap:8px; flex-wrap:wrap; margin:16px 0 22px; }
        .chip { font-family:'DM Sans',sans-serif; font-size:0.8rem; font-weight:600; color:var(--slate); background:transparent; border:1px solid var(--border); border-radius:999px; padding:7px 14px; cursor:pointer; display:inline-flex; gap:7px; align-items:center; transition:color 0.2s,border-color 0.2s,background 0.2s; }
        .chip span { color:var(--text-muted); font-weight:500; }
        .chip:hover { color:var(--ink); border-color:var(--border-accent); }
        .chip.active { color:var(--ink); border-color:var(--burgundy); background:var(--burgundy-glow); }
        .chip.active span { color:var(--burgundy); }
        .no-results { font-family:'DM Sans',sans-serif; color:var(--text-muted); text-align:center; padding:34px 20px; }
        .no-results a { color:var(--sage); }
        /* research bench: queued-for-verification candidates (dashed = not yet verified) */
        .bench { margin-top:56px; }
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
        .bench-src { font-family:'DM Sans',sans-serif; font-size:0.75rem; font-weight:500; color:var(--burgundy); text-decoration:none; }
        .bench-src:hover { text-decoration:underline; }
        .bench-note { font-family:'DM Sans',sans-serif; font-size:0.82rem; color:var(--text-muted); text-align:center; margin-top:22px; }
        /* +1 vote button (Phase 2 interactive layer) */
        .vote { font-family:'DM Sans',sans-serif; font-size:0.78rem; font-weight:700; color:var(--slate); background:transparent; border:1px solid var(--border); border-radius:999px; padding:5px 12px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition:color 0.15s,border-color 0.15s,background 0.15s; }
        .vote:hover:not(:disabled) { color:var(--gold); border-color:rgba(255,211,105,0.4); }
        .vote .vote-caret { font-size:0.68rem; line-height:1; }
        .vote .vote-n { min-width:0.9em; text-align:center; font-variant-numeric:tabular-nums; }
        .vote.voted { color:var(--gold); border-color:rgba(255,211,105,0.45); background:rgba(255,211,105,0.08); }
        .vote:disabled { cursor:default; }
        /* nominate form */
        .nom { margin-top:30px; background:var(--bg-card); border:1px solid var(--border); border-radius:16px; padding:26px 24px; display:flex; flex-direction:column; gap:10px; max-width:560px; margin-left:auto; margin-right:auto; }
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
        @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
        @media (max-width:560px){ .hero{padding-top:36px;} }
    </style>
${THEME_CSS}
</head>
<body>
    <nav class="topnav">
        <a class="brand" href="/"><span class="brand-icon" aria-hidden="true">📖</span>quotle<span>.info</span></a>
        <div class="nav-actions">
            <a class="nav-authors" href="/authors/">Authors</a>
            <a class="nav-play" href="https://gameshelf.co/quotle/">Play Quotle →</a>
            ${CONTROL}
        </div>
    </nav>
    <header class="hero">
        <h1>Who <em>really</em> said it?</h1>
        <p class="lede">The internet is full of confident misattributions. Quotle.info traces each quote to its <strong>real source</strong> — who actually said it, the primary document, and the misattributions untangled with receipts.</p>
        <p class="stat"><b>${total}</b> quotes verified · every attribution traced to a primary source and dated</p>
    </header>
    <main>
${featuredBlock}
${browseBlock}
${benchBlock}
        <aside class="game-cta">
            <h2>Think you know your quotes?</h2>
            <p>Quotle is a daily puzzle: guess the author from the words alone.</p>
            <a href="https://gameshelf.co/quotle/">Play today&rsquo;s Quotle <span aria-hidden="true">→</span></a>
        </aside>
    </main>
    <footer>
        <p>quotle<span style="color:var(--burgundy)">.info</span> — every attribution traced to a primary source and dated. A <a href="https://gameshelf.co">Game Shelf</a> project.</p>
    </footer>
${SEARCH_JS}
${BENCH_JS}
${SCRIPT}
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'index.html'), html);
fs.writeFileSync(path.join(ROOT, 'who-said', 'index.html'), html);
console.log(`  ✓ index.html + who-said/index.html  (homepage/browse, ${total} quotes: ${(byConf.verified||[]).length} verified, ${(byConf.attributed||[]).length} attributed, ${(byConf.disputed||[]).length} disputed; ${FEATURED.length} featured)`);
