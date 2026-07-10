'use strict';
/*
 * chrome.js — the shared site frame: one nav bar + one universal search, used by EVERY page
 * generator (home, quotes, authors, under-review, flagged, how-we-verify, detail pages).
 *
 * Universal search is backed by a single build-time index at /search.json spanning all three
 * domains — verified quotes, authors, and under-review candidates — so any page's search box
 * returns grouped results ("Verified quotes 3 · Authors 1 · Under review 2"), each routed to the
 * right place. Search.json is emitted by build.js.
 *
 * Exports:
 *   NAV(active)   — the <nav> markup; `active` ∈ 'home'|'quotes'|'authors'|'review' highlights the tab
 *   CHROME_CSS    — nav + search-dropdown styles (append to each page's <style>)
 *   SEARCH_JS     — the client script wiring the universal search (include once per page, before </body>)
 */
const { CONTROL } = require('./a11y-widget');

const NAV_LINKS = [
  { key: 'quotes', label: 'Quotes', href: '/who-said/' },
  { key: 'themes', label: 'Themes', href: '/themes/' },
  { key: 'authors', label: 'Authors', href: '/authors/' },
  { key: 'check', label: 'Check a quote', href: '/check/' },
];

const NAV = (active) => `    <nav class="topnav">
        <a class="brand" href="/"><span class="brand-icon" aria-hidden="true">📖</span>quotle<span>.info</span></a>
        <div class="nav-search">
            <input id="gsearch" class="gsearch" type="search" placeholder="Search quotes, authors&hellip;" aria-label="Search quotes, authors, and quotes under review" autocomplete="off">
            <div id="gsearch-panel" class="gs-panel" role="listbox" aria-label="Search results" hidden></div>
        </div>
        <div class="nav-links">
${NAV_LINKS.map((l) => `            <a class="nav-link${active === l.key ? ' active' : ''}" href="${l.href}">${l.label}</a>`).join('\n')}
            <a class="nav-play" href="https://gameshelf.co/quotle/">Play Quotle &rarr;</a>
            ${CONTROL}
        </div>
    </nav>`;

const CHROME_CSS = `
        /* shared nav + universal search */
        .topnav { display:flex; align-items:center; gap:14px 16px; flex-wrap:wrap; max-width:1000px; margin:0 auto; padding:16px 24px 0; }
        .brand { display:inline-flex; align-items:center; gap:9px; text-decoration:none; font-family:'Playfair Display',serif; font-weight:900; font-size:1.05rem; flex-shrink:0; }
        .brand-icon { width:30px; height:30px; border-radius:8px; background:linear-gradient(135deg,var(--burgundy),var(--burgundy-deep)); display:grid; place-items:center; font-size:0.95rem; }
        .brand span { color:var(--burgundy); }
        .nav-search { position:relative; flex:1 1 240px; min-width:180px; order:3; width:100%; }
        @media (min-width:720px){ .nav-search { order:0; width:auto; } }
        .gsearch { width:100%; font-family:'DM Sans',sans-serif; font-size:0.9rem; color:var(--ink); background:var(--bg-card); border:1px solid var(--border); border-radius:999px; padding:9px 16px; outline:none; transition:border-color 0.2s; }
        .gsearch:focus { border-color:var(--burgundy); }
        .gsearch::placeholder { color:var(--text-muted); }
        .gs-panel { position:absolute; top:calc(100% + 8px); left:0; right:0; z-index:50; background:var(--bg-card); border:1px solid var(--border-accent); border-radius:14px; box-shadow:0 18px 50px rgba(0,0,0,0.45); max-height:min(70vh,520px); overflow-y:auto; padding:6px; }
        .gs-group { padding:6px 4px; }
        .gs-group + .gs-group { border-top:1px solid var(--border); }
        .gs-h { font-family:'DM Sans',sans-serif; text-transform:uppercase; font-size:0.66rem; font-weight:700; letter-spacing:0.14em; color:var(--text-muted); padding:8px 12px 6px; display:flex; gap:8px; align-items:center; }
        .gs-h span { color:var(--burgundy); }
        .gs-row { display:flex; flex-direction:column; gap:2px; padding:8px 12px; border-radius:9px; text-decoration:none; }
        .gs-row:hover, .gs-row:focus { background:var(--burgundy-glow); }
        .gs-x { font-family:'Source Serif 4',serif; font-size:0.92rem; color:var(--ink); line-height:1.3; }
        .gs-sub { font-family:'DM Sans',sans-serif; font-size:0.75rem; color:var(--text-muted); }
        .gs-all { display:inline-block; font-family:'DM Sans',sans-serif; font-size:0.78rem; font-weight:600; color:var(--burgundy); text-decoration:none; padding:6px 12px; }
        .gs-all:hover { text-decoration:underline; }
        .gs-none { font-family:'DM Sans',sans-serif; font-size:0.85rem; color:var(--text-muted); padding:16px 14px; }
        .nav-links { display:flex; align-items:center; gap:6px 8px; flex-wrap:wrap; margin-left:auto; }
        .nav-link { font-family:'DM Sans',sans-serif; font-size:0.8rem; font-weight:500; color:var(--slate); text-decoration:none; padding:7px 12px; border:1px solid transparent; border-radius:999px; white-space:nowrap; transition:color 0.2s,border-color 0.2s,background 0.2s; }
        .nav-link:hover { color:var(--ink); border-color:var(--border-accent); }
        .nav-link.active { color:var(--ink); border-color:var(--burgundy); background:var(--burgundy-glow); }
        .nav-play { font-family:'DM Sans',sans-serif; font-size:0.78rem; font-weight:600; color:var(--gold); text-decoration:none; padding:7px 14px; border:1px solid rgba(255,211,105,0.3); border-radius:999px; white-space:nowrap; }`;

const SEARCH_JS = `    <script>
        (function(){
            var input=document.getElementById('gsearch'), panel=document.getElementById('gsearch-panel');
            if(!input||!panel) return;
            var idx=null, loading=false;
            function load(cb){ if(idx){cb();return;} if(loading) return; loading=true;
                fetch('/search.json').then(function(r){return r.json();}).then(function(d){ idx=d||[]; loading=false; cb(); }).catch(function(){ loading=false; }); }
            function esc(s){ var d=document.createElement('div'); d.textContent=(s==null?'':String(s)); return d.innerHTML; }
            var LABEL={q:'Verified quotes',t:'Themes',a:'Authors',b:'Under review'}, ALL={q:'/who-said/',t:'/themes/',a:'/authors/',b:'/under-review/'};
            function row(e){
                var wrap = (e.t==='q'||e.t==='b');
                var sub = (e.t==='a'||e.t==='t') ? (e.n+' quote'+(e.n===1?'':'s')) : esc(e.a||'');
                return '<a class="gs-row" href="'+esc(e.u)+'"><span class="gs-x">'+(wrap?'&ldquo;':'')+esc(e.x)+(wrap?'&rdquo;':'')+'</span><span class="gs-sub">'+sub+'</span></a>';
            }
            function group(t,items,term){
                if(!items.length) return '';
                var top=items.slice(0,5);
                var more = items.length>5 ? '<a class="gs-all" href="'+ALL[t]+'?q='+encodeURIComponent(term)+'">See all '+items.length+' &rarr;</a>' : '';
                return '<div class="gs-group"><p class="gs-h">'+LABEL[t]+' <span>'+items.length+'</span></p>'+top.map(row).join('')+more+'</div>';
            }
            function render(term){
                var t=term.trim().toLowerCase();
                if(!t){ panel.hidden=true; panel.innerHTML=''; return; }
                var g={q:[],t:[],a:[],b:[]};
                for(var i=0;i<idx.length;i++){ var e=idx[i]; var hay=(e.x+' '+(e.a||'')).toLowerCase();
                    if(hay.indexOf(t)>-1 && g[e.t] && g[e.t].length<200) g[e.t].push(e); }
                var html=group('q',g.q,t)+group('t',g.t,t)+group('a',g.a,t)+group('b',g.b,t);
                panel.innerHTML = html || ('<p class="gs-none">No matches for &ldquo;'+esc(term)+'&rdquo;.</p>');
                panel.hidden=false;
            }
            var deb;
            input.addEventListener('input', function(){ clearTimeout(deb); var v=input.value; deb=setTimeout(function(){ load(function(){ render(v); }); }, 110); });
            input.addEventListener('focus', function(){ if(input.value.trim()) load(function(){ render(input.value); }); });
            input.addEventListener('keydown', function(e){
                if(e.key==='Escape'){ panel.hidden=true; input.blur(); }
                else if(e.key==='Enter'){ var f=panel.querySelector('.gs-row'); if(f){ e.preventDefault(); location.href=f.getAttribute('href'); } }
            });
            document.addEventListener('click', function(e){ if(e.target!==input && !panel.contains(e.target)) panel.hidden=true; });
        })();
    </script>`;

module.exports = { NAV, CHROME_CSS, SEARCH_JS };
