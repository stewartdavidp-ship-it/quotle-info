#!/usr/bin/env node
'use strict';
/*
 * build-check.js — /check/ : "check a quote you already have before you put it on a slide."
 * Paste a line → client-side match against /verify-index.json (same matcher as the Worker /verify
 * API) → verdict: is it real, who really said it, is it safe to reuse, and the correct credit.
 * Resilient by design: the page does the matching itself off the static index, so it works even if
 * the community Worker is down. Deep-linkable via /check/?q=<quote> (auto-runs). Run by build.js.
 */
const fs = require('fs');
const path = require('path');
const { HEAD_SCRIPT, THEME_CSS, CONTROL, SCRIPT } = require('./a11y-widget');
const { ROOT_CSS } = require('./tokens');
const { NAV: siteNav, CHROME_CSS, SEARCH_JS } = require('./chrome');
const { OG_IMAGE_TAGS } = require('./og'); // the one shared social-card image

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'check');
const ORIGIN = 'https://quotle.info';

const STYLE = `${ROOT_CSS}
        * { margin:0; padding:0; box-sizing:border-box; }
        html { scroll-behavior:smooth; -webkit-font-smoothing:antialiased; }
        body { font-family:'Source Serif 4',Georgia,serif; background:var(--bg-deep); color:var(--ink); line-height:1.7; overflow-x:hidden; }
        a { color:inherit; }
        a:focus-visible, button:focus-visible { outline:2px solid var(--sage); outline-offset:3px; border-radius:4px; }
        .breadcrumb { max-width:760px; margin:0 auto; padding:14px 24px 0; font-family:'DM Sans',sans-serif; font-size:0.75rem; color:var(--text-muted); }
        .breadcrumb a { text-decoration:none; } .breadcrumb a:hover { color:var(--slate); }
        .breadcrumb .sep { margin:0 7px; opacity:0.6; }
        main { max-width:760px; margin:0 auto; padding:8px 24px 60px; }
        .kicker { font-family:'DM Sans',sans-serif; text-transform:uppercase; font-size:0.7rem; font-weight:600; letter-spacing:0.2em; color:var(--burgundy); margin-bottom:14px; }
        .hero { padding:38px 0 4px; }
        .hero h1 { font-family:'Playfair Display',serif; font-weight:900; font-size:clamp(2rem,6vw,2.8rem); line-height:1.05; letter-spacing:-0.02em; }
        .hero .lede { font-size:1.05rem; color:var(--slate); margin-top:14px; max-width:620px; }
        .hero .lede b { color:var(--sage); }
        /* the input */
        .check-box { margin-top:28px; }
        #cq { width:100%; min-height:96px; resize:vertical; font-family:'Source Serif 4',Georgia,serif; font-size:1.1rem; font-style:italic; color:var(--ink); background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:18px 20px; outline:none; transition:border-color 0.2s; }
        #cq:focus { border-color:var(--burgundy); }
        #cq::placeholder { color:var(--text-muted); font-style:italic; }
        .check-row { display:flex; align-items:center; gap:14px; margin-top:14px; }
        .check-btn { font-family:'DM Sans',sans-serif; font-weight:600; font-size:0.92rem; color:#fff; background:linear-gradient(135deg,var(--burgundy),var(--burgundy-deep)); border:none; border-radius:999px; padding:12px 26px; cursor:pointer; transition:opacity 0.2s; }
        .check-btn:hover { opacity:0.92; }
        .check-hint { font-family:'DM Sans',sans-serif; font-size:0.8rem; color:var(--text-muted); }
        /* result */
        .result { margin-top:30px; }
        .rcard { background:var(--bg-card); border:1px solid var(--border); border-left:4px solid var(--border); border-radius:16px; padding:26px 26px 28px; }
        .rcard.ok { border-left-color:var(--sage); }
        .rcard.attr { border-left-color:var(--amber); }
        .rcard.bad { border-left-color:var(--caution); }
        .rcard.none { border-left-color:var(--slate); }
        .r-verdict { display:flex; align-items:center; gap:12px; font-family:'Playfair Display',serif; font-weight:900; font-size:1.5rem; letter-spacing:-0.01em; }
        .r-ic { width:34px; height:34px; flex:none; border-radius:50%; display:grid; place-items:center; font-size:1.05rem; font-weight:700; color:var(--bg-deep); }
        .ok .r-ic { background:var(--sage); } .attr .r-ic { background:var(--amber); } .bad .r-ic { background:var(--caution); } .none .r-ic { background:var(--slate); color:#fff; }
        .r-quote { font-style:italic; font-size:1.1rem; color:var(--ink); margin:16px 0 4px; padding-left:15px; border-left:2px solid var(--border); }
        .r-line { font-family:'DM Sans',sans-serif; font-size:0.98rem; color:var(--ink); margin-top:14px; line-height:1.6; }
        .r-line strong { color:var(--ink); }
        .r-sub { font-family:'DM Sans',sans-serif; font-size:0.88rem; color:var(--slate); margin-top:8px; line-height:1.6; }
        .r-reuse { display:flex; gap:9px; font-family:'DM Sans',sans-serif; font-size:0.9rem; line-height:1.6; margin-top:16px; padding:12px 15px; border-radius:10px; background:var(--cream); }
        .r-reuse .ric { flex:none; font-weight:700; }
        .r-reuse.ok .ric { color:var(--sage); } .r-reuse.warn .ric { color:var(--amber); }
        .r-credit-wrap { margin-top:18px; }
        .r-lbl { font-family:'DM Sans',sans-serif; text-transform:uppercase; font-size:0.66rem; font-weight:700; letter-spacing:0.13em; color:var(--slate); margin-bottom:8px; }
        .r-credit { font-family:'Source Serif 4',Georgia,serif; font-size:1rem; color:var(--ink); background:var(--bg-elevated); border:1px solid var(--border); border-radius:10px; padding:13px 16px; }
        .r-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:16px; }
        .r-btn { font-family:'DM Sans',sans-serif; font-size:0.82rem; font-weight:500; color:var(--slate); background:var(--bg-elevated); border:1px solid var(--border); border-radius:999px; padding:9px 16px; cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; gap:6px; }
        .r-btn:hover { background:var(--bg-card-hover); color:var(--ink); }
        .r-btn.primary { color:#fff; background:linear-gradient(135deg,var(--burgundy),var(--burgundy-deep)); border:none; }
        .dym-list { flex-direction:column; align-items:stretch; }
        .dym-item { justify-content:flex-start; text-align:left; white-space:normal; max-width:100%; font-style:italic; line-height:1.5; padding:11px 15px; }
        .dym-item b { font-style:normal; font-family:'DM Sans',sans-serif; font-size:0.8rem; color:var(--slate); }
        .r-note { font-family:'DM Sans',sans-serif; font-size:0.85rem; color:var(--text-muted); margin-top:14px; line-height:1.6; }
        .how { margin-top:44px; padding-top:22px; border-top:1px solid var(--border); font-family:'DM Sans',sans-serif; font-size:0.85rem; color:var(--text-muted); line-height:1.65; }
        .how a { color:var(--sage); text-decoration:none; }
        footer { text-align:center; padding:40px 24px; color:var(--text-muted); font-family:'DM Sans',sans-serif; font-size:0.8rem; border-top:1px solid var(--border); margin-top:48px; }
        footer a { color:var(--burgundy-link); text-decoration:none; }
        .toast { position:fixed; bottom:26px; left:50%; transform:translateX(-50%) translateY(20px); background:var(--ink); color:var(--bg-deep); font-family:'DM Sans',sans-serif; font-size:0.85rem; font-weight:600; padding:11px 20px; border-radius:999px; opacity:0; pointer-events:none; transition:opacity 0.2s,transform 0.2s; z-index:50; }
        .toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
        @media (prefers-reduced-motion: reduce) { html { scroll-behavior:auto; } * { transition:none !important; } }`;

const FOOTER = `    <footer>
        <p>quotle<span style="color:var(--burgundy)">.info</span> — every attribution traced to a primary source and dated. A <a href="https://gameshelf.co">Game Shelf</a> project.</p>
    </footer>`;

const headExtra = `    <title>Check a quote before you use it | Quotle.info</title>
    <meta name="description" content="About to put a quote on a slide? Paste it here — we'll tell you if it's real, who really said it, and whether it's cleared to reuse. Provenance-checked, not AI-guessed.">
    <link rel="canonical" href="${ORIGIN}/check/">
    <meta property="og:title" content="Check a quote before you use it">
    <meta property="og:description" content="Paste a line you're about to present — real? correctly credited? safe to reuse? Verified against the quotle.info corpus.">
    <meta property="og:url" content="${ORIGIN}/check/">
${OG_IMAGE_TAGS}`;

const inner = `    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span class="sep">›</span>Check a quote</nav>
    <main>
        <div class="hero">
            <p class="kicker">Before you present</p>
            <h1>Check a quote before you use it</h1>
            <p class="lede">About to drop a quote on a slide? Paste it below. We&rsquo;ll tell you if it&rsquo;s <b>real</b>, who actually said it, and &mdash; the part AI usually gets wrong &mdash; whether it&rsquo;s <b>cleared to reproduce</b> (free to use, or still under copyright). Checked against primary sources, not guessed.</p>
        </div>
        <div class="check-box">
            <label for="cq" class="visually-hidden">Paste the quote to check</label>
            <textarea id="cq" placeholder="&ldquo;The only thing we have to fear is fear itself&hellip;&rdquo; &mdash; paste the line you&rsquo;re about to use"></textarea>
            <div class="check-row">
                <button class="check-btn" id="cbtn" type="button">Check it</button>
                <span class="check-hint">or press &crarr; &mdash; nothing is stored</span>
            </div>
        </div>
        <div class="result" id="result" aria-live="polite"></div>
        <p class="how">How this works: your text is matched (in your browser) against the ${'${COUNT}'} quotes we&rsquo;ve traced to a primary source. A match returns our verdict, the correct credit, and reuse status; no match means we haven&rsquo;t verified that exact line &mdash; which isn&rsquo;t proof it&rsquo;s fake, only that you shouldn&rsquo;t present it as confirmed. Agents can call the same data at <a href="/verify-index.json">/verify-index.json</a> or the <a href="/verify?q=your+quote">/verify API</a>.</p>
    </main>
    <div class="toast" id="toast" role="status" aria-live="polite">Copied</div>`;

const PAGE_SCRIPT = `    <script>
    (function(){
        var box=document.getElementById('cq'), btn=document.getElementById('cbtn'), out=document.getElementById('result');
        var idx=null, loading=false, escalating=false;
        var API='https://quotle-community.stewartd.workers.dev';
        function esc(s){ var d=document.createElement('div'); d.textContent=(s==null?'':String(s)); return d.innerHTML; }
        function toast(m){ var t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); setTimeout(function(){t.classList.remove('show');},1700); }
        function norm(s){ return String(s).toLowerCase().replace(/[\\u2019'\\u2018\\u0060"\\u201c\\u201d]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\\s+/g,' '); }
        function match(term){
            var t=norm(term); if(!t||!idx) return null;
            for(var i=0;i<idx.length;i++){ if(idx[i].n===t) return idx[i]; }
            var sub=idx.filter(function(e){ return e.n && (e.n.indexOf(t)>-1 || t.indexOf(e.n)>-1); });
            if(sub.length){ sub.sort(function(a,b){ return Math.abs(a.n.length-t.length)-Math.abs(b.n.length-t.length); }); return sub[0]; }
            var tw=t.split(' ').filter(function(w){return w.length>3;});
            if(tw.length>=3){ var set={}; tw.forEach(function(w){set[w]=1;}); var keys=Object.keys(set);
                var best=null,bestCov=0,bestGap=Infinity;
                for(var j=0;j<idx.length;j++){ var ew={}; (idx[j].n||'').split(' ').forEach(function(w){ew[w]=1;}); var hits=0; keys.forEach(function(w){if(ew[w])hits++;});
                    var cov=hits/keys.length, gap=Math.abs((idx[j].n||'').length-t.length);
                    if(cov>bestCov||(cov===bestCov&&gap<bestGap)){bestCov=cov;bestGap=gap;best=idx[j];} }
                if(bestCov>=0.8) return best;
            }
            return null;
        }
        function reuse(r){
            if(r==='public-domain') return {t:'ok',ic:'\\u2713',x:'Free to reuse &mdash; including in commercial and paid decks. No permission needed.'};
            if(r==='in-copyright') return {t:'warn',ic:'\\u00a9',x:'Still under copyright. A short, credited quote is usually fine for talks and internal decks; get permission for commercial or published use.'};
            if(r==='licensed') return {t:'ok',ic:'\\u2713',x:'Cleared for reuse under licence &mdash; keep the credit.'};
            return {t:'warn',ic:'?',x:'Rights unverified &mdash; fine to present as an unverified line, but don\\u2019t assert a specific source.'};
        }
        function creditBlock(hit){
            if(!hit.credit) return '';
            var img = hit.img ? ('<div class="r-credit-wrap"><p class="r-lbl">Image direction <span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--text-muted)">&mdash; grounded in this quote\\u2019s real context</span></p><div class="r-credit" id="rimg">'+esc(hit.img)+'</div><div class="r-actions"><button class="r-btn" id="copyimg" type="button">Copy image prompt</button></div></div>') : '';
            return '<div class="r-credit-wrap"><p class="r-lbl">Paste-ready credit</p><div class="r-credit" id="rcredit">\\u201c'+esc(hit.q)+'\\u201d '+esc(hit.credit)+'</div>'+
                '<div class="r-actions"><button class="r-btn primary" id="copycredit" type="button">Copy quote + credit</button>'+
                '<a class="r-btn" href="'+esc(hit.u)+'">See the full proof \\u2192</a></div></div>'+img;
        }
        // --- no-corpus-match escalation: backlog \\u2192 review queue \\u2192 Wikiquote (server-checked) ---
        function wqSearch(q){ return 'https://en.wikiquote.org/w/index.php?search='+encodeURIComponent(q); }
        function qiSearch(q){ return 'https://quoteinvestigator.com/?s='+encodeURIComponent(q); }
        function noneCard(q){
            return '<div class="rcard none"><div class="r-verdict"><span class="r-ic">?</span>Not in our verified corpus</div>'+
                '<p class="r-quote">\\u201c'+esc(q)+'\\u201d</p>'+
                '<p class="r-line">We haven\\u2019t traced this exact line to a source yet, and we couldn\\u2019t find it on Wikiquote either. <strong>That isn\\u2019t proof it\\u2019s fake</strong> &mdash; only that we can\\u2019t confirm it, so don\\u2019t present it as a verified quote with a named author.</p>'+
                '<div class="r-actions"><a class="r-btn primary" href="/under-review/">Nominate it for review</a>'+
                '<a class="r-btn" target="_blank" rel="noopener" href="'+wqSearch(q)+'">Search Wikiquote \\u2197</a>'+
                '<a class="r-btn" target="_blank" rel="noopener" href="'+qiSearch(q)+'">Search Quote Investigator \\u2197</a></div>'+
                '<p class="r-note">Tip: try a shorter, distinctive phrase from the line.</p></div>';
        }
        function queuedCard(q, lead){
            // already on our list (backlog or pending nomination) \\u2014 not yet verified
            return '<div class="rcard attr"><div class="r-verdict"><span class="r-ic">\\u23f3</span>Already on our list to verify</div>'+
                '<p class="r-quote">\\u201c'+esc(q)+'\\u201d</p>'+
                '<p class="r-line">'+lead+' We haven\\u2019t confirmed the attribution yet, so hold off on presenting it as a verified quote with a named author &mdash; but Wikiquote may have sourcing details you can use now.</p>'+
                '<div class="r-actions"><a class="r-btn primary" target="_blank" rel="noopener" href="'+wqSearch(q)+'">Check Wikiquote for details \\u2197</a>'+
                '<a class="r-btn" target="_blank" rel="noopener" href="'+qiSearch(q)+'">Search Quote Investigator \\u2197</a></div></div>';
        }
        function wikiquoteCard(q, d){
            var added = d.added
                ? 'We haven\\u2019t confirmed this line ourselves yet, but we found it on Wikiquote and <strong>added it to our list to validate</strong>.'
                : 'We haven\\u2019t confirmed this line ourselves yet, but we found it on Wikiquote.';
            return '<div class="rcard attr"><div class="r-verdict"><span class="r-ic">\\u2248</span>Found on Wikiquote &mdash; we\\u2019ll verify it</div>'+
                '<p class="r-quote">\\u201c'+esc(q)+'\\u201d</p>'+
                '<p class="r-line">'+added+' Wikiquote can give you sourcing details right now &mdash; want us to send you over?'+(d.title?(' It appears on their <strong>'+esc(d.title)+'</strong> page.'):'')+'</p>'+
                '<div class="r-actions"><a class="r-btn primary" target="_blank" rel="noopener" href="'+esc(d.wikiquoteUrl||wqSearch(q))+'">Take me to Wikiquote \\u2192</a>'+
                '<a class="r-btn" target="_blank" rel="noopener" href="'+qiSearch(q)+'">Search Quote Investigator \\u2197</a></div>'+
                '<p class="r-note">We\\u2019ll trace it to a primary source and, once confirmed, it\\u2019ll show a full verdict here.</p></div>';
        }
        function escalate(q){
            out.innerHTML='<div class="rcard none"><div class="r-verdict"><span class="r-ic">\\u2026</span>Checking our backlog and Wikiquote\\u2026</div>'+
                '<p class="r-quote">\\u201c'+esc(q)+'\\u201d</p></div>';
            if(escalating) return; escalating=true;
            fetch(API+'/lookup?q='+encodeURIComponent(q)).then(function(r){return r.json();}).then(function(d){
                escalating=false; d=d||{};
                if(d.stage==='backlog') out.innerHTML=queuedCard(q,'You\\u2019re ahead of us &mdash; this line is already queued for verification.');
                else if(d.stage==='nominated') out.innerHTML=queuedCard(q,'Someone\\u2019s already flagged this one for us to verify.');
                else if(d.stage==='wikiquote') out.innerHTML=wikiquoteCard(q,d);
                else if(d.stage==='corpus'&&d.url) out.innerHTML='<div class="rcard ok"><div class="r-verdict"><span class="r-ic">\\u2713</span>We do have this one</div><p class="r-quote">\\u201c'+esc(q)+'\\u201d</p><div class="r-actions"><a class="r-btn primary" href="'+esc(d.url)+'">See the full verdict \\u2192</a></div></div>';
                else out.innerHTML=noneCard(q); // 'none' or 'short' or unknown
            }).catch(function(){ escalating=false; out.innerHTML=noneCard(q); });
        }
        // --- fuzzy "Did you mean?" over our own corpus (discovery is forgiving; the auto-add gate stays strict) ---
        // Character-bigram Dice similarity: tolerates typos (dam/damn), dropped words (my/Scarlett), and reorderings,
        // so a half-remembered line still surfaces the verified quote we already hold instead of falling to "not found".
        function bigrams(s){ var a=[]; for(var i=0;i<s.length-1;i++) a.push(s.slice(i,i+2)); return a; }
        function diceScore(qg, s){
            var bg=bigrams(s||''); if(!qg.length||!bg.length) return 0;
            var m={}; for(var i=0;i<qg.length;i++) m[qg[i]]=(m[qg[i]]||0)+1;
            var inter=0; for(var j=0;j<bg.length;j++){ if(m[bg[j]]>0){ inter++; m[bg[j]]--; } }
            return 2*inter/(qg.length+bg.length);
        }
        function fuzzyCandidates(term){
            var t=norm(term); if(t.length<8||!idx) return [];
            var qg=bigrams(t), scored=[];
            for(var i=0;i<idx.length;i++){ var e=idx[i]; if(!e.n) continue; var s=diceScore(qg,e.n); if(s>=0.45) scored.push({e:e,s:s}); }
            scored.sort(function(a,b){ return b.s-a.s; });
            if(!scored.length||scored[0].s<0.5) return [];
            var top=scored[0].s, outc=[], seen={};
            for(var k=0;k<scored.length&&outc.length<3;k++){ var c=scored[k]; if(c.s<top-0.12) break; if(seen[c.e.u]) continue; seen[c.e.u]=1; outc.push(c.e); }
            return outc;
        }
        function didYouMeanCard(term, cands){
            var items=cands.map(function(e){
                var who=e.real?(' <b>&mdash; '+esc(e.real)+'</b>'):'';
                return '<button class="dym-item r-btn" type="button" data-q="'+esc(e.q)+'">\\u201c'+esc(e.q)+'\\u201d'+who+'</button>';
            }).join('');
            return '<div class="rcard none"><div class="r-verdict"><span class="r-ic">\\u2248</span>Did you mean one of these?</div>'+
                '<p class="r-line">We couldn\\u2019t match \\u201c'+esc(term.trim())+'\\u201d word-for-word, but these verified lines are close. Pick the one you meant to see its verdict and credit:</p>'+
                '<div class="r-actions dym-list">'+items+'</div>'+
                '<p class="r-note"><button class="dym-none" type="button" style="background:none;border:none;color:var(--sage);cursor:pointer;font:inherit;padding:0;text-decoration:underline">None of these &mdash; check the exact line anyway \\u2192</button></p></div>';
        }
        function wireDidYouMean(term){
            var items=out.querySelectorAll('.dym-item');
            for(var i=0;i<items.length;i++){ items[i].addEventListener('click',function(){ box.value=this.getAttribute('data-q'); run(); box.scrollIntoView({block:'nearest'}); }); }
            var none=out.querySelector('.dym-none'); if(none) none.addEventListener('click',function(){ escalate(term.trim()); });
        }
        function render(term){
            var hit=match(term);
            if(!hit){ var cands=fuzzyCandidates(term); if(cands.length){ out.innerHTML=didYouMeanCard(term,cands); wireDidYouMean(term); } else { escalate(term.trim()); } return; }
            var ru=reuse(hit.rights);
            var reuseHtml='<div class="r-reuse '+ru.t+'"><span class="ric">'+ru.ic+'</span><span>'+ru.x+'</span></div>';
            if(hit.c==='disputed'){
                var really = hit.real ? ('<strong>'+esc(hit.real)+'</strong>') : 'no verified author (anonymous / unsourced)';
                out.innerHTML='<div class="rcard bad"><div class="r-verdict"><span class="r-ic">!</span>Careful &mdash; commonly misattributed</div>'+
                    '<p class="r-quote">\\u201c'+esc(hit.q)+'\\u201d</p>'+
                    '<p class="r-line">'+(hit.credited?('Often put on slides as <strong>'+esc(hit.credited)+'</strong> &mdash; that\\u2019s the mistake. '):'')+'Really: '+really+'.</p>'+
                    reuseHtml+creditBlock(hit)+'</div>';
            } else {
                var cls = hit.c==='attributed' ? 'attr' : 'ok';
                var head = hit.c==='attributed' ? 'Credibly attributed' : 'Verified &mdash; safe to use';
                var ic = hit.c==='attributed' ? '\\u2248' : '\\u2713';
                out.innerHTML='<div class="rcard '+cls+'"><div class="r-verdict"><span class="r-ic">'+ic+'</span>'+head+'</div>'+
                    '<p class="r-quote">\\u201c'+esc(hit.q)+'\\u201d</p>'+
                    '<p class="r-line">Correctly credited to <strong>'+esc(hit.real||'\\u2014')+'</strong>.'+(hit.c==='attributed'?' <span class="r-sub">Widely credited to them and consistent with their work, though we couldn\\u2019t pin the exact wording to a single primary source.</span>':'')+'</p>'+
                    reuseHtml+creditBlock(hit)+'</div>';
            }
            var cc=document.getElementById('copycredit');
            if(cc) cc.addEventListener('click',function(){ var el=document.getElementById('rcredit'); if(el&&navigator.clipboard){ navigator.clipboard.writeText(el.textContent.trim()).then(function(){toast('Quote + credit copied');},function(){toast('Copy failed');}); } });
            var ci=document.getElementById('copyimg');
            if(ci) ci.addEventListener('click',function(){ var el=document.getElementById('rimg'); if(el&&navigator.clipboard){ navigator.clipboard.writeText(el.textContent.trim()).then(function(){toast('Image prompt copied');},function(){toast('Copy failed');}); } });
        }
        function run(){ var v=box.value.trim(); if(!v){ out.innerHTML=''; return; }
            if(idx){ render(v); return; }
            if(loading) return; loading=true;
            fetch('/verify-index.json').then(function(r){return r.json();}).then(function(d){ idx=d||[]; loading=false; render(v); }).catch(function(){ loading=false; out.innerHTML='<p class="r-note">Couldn\\u2019t load the verification index &mdash; please retry.</p>'; });
        }
        btn.addEventListener('click',run);
        box.addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); run(); } });
        // deep link: /check/?q=...
        try{ var qp=new URLSearchParams(location.search).get('q'); if(qp){ box.value=qp; run(); } }catch(e){}
    })();
    </script>`;

function build() {
  const count = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'verify-index.json'), 'utf8')).length; } catch (_) { return ''; } })();
  const html = `<!DOCTYPE html>
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
        .visually-hidden { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    </style>
${THEME_CSS}
</head>
<body>
${siteNav('check')}
${inner.replace('${COUNT}', count)}
${FOOTER}
${SEARCH_JS}
${PAGE_SCRIPT}
${SCRIPT}
</body>
</html>
`;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  console.log('  ✓ check/index.html  (paste-a-quote verifier)');
}

build();
