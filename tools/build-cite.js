#!/usr/bin/env node
'use strict';
/*
 * build-cite.js — /cite/ "How we used this source" interstitial.
 *
 * The "Dig deeper" cards on verified quote pages route here (/cite/?q={quoteSlug}&i={linkIndex})
 * instead of jumping straight to Quote Investigator / Wikiquote / etc. This keeps the reader on
 * quotle.info one more beat, credits the source, and shows WHAT WE ACTUALLY PULLED from it for
 * this quote (the record's own per-link `what` note) before offering the outbound jump.
 *
 * One parameterized page: it fetches the quote's record JSON (/data/quotes/{q}.json is served by
 * Pages) and reads externalLinks[i] client-side — no giant embed. noindex (utility page).
 *
 * A "skip this step next time" toggle writes localStorage quotle-skip-cite; detail pages honor it
 * (see template.js) by rewriting the Dig-deeper cards to link straight to the source.
 */
const fs = require('fs');
const path = require('path');
const { HEAD_SCRIPT, THEME_CSS, SCRIPT } = require('./a11y-widget');
const { ROOT_CSS } = require('./tokens');
const { NAV, CHROME_CSS, SEARCH_JS } = require('./chrome');
const ROOT = path.resolve(__dirname, '..');

const STYLE = `${ROOT_CSS}
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'Source Serif 4',Georgia,serif; background:var(--bg-deep); color:var(--ink); line-height:1.7; overflow-x:hidden; }
        a { color:inherit; }
        a:focus-visible, button:focus-visible { outline:2px solid var(--sage); outline-offset:3px; border-radius:4px; }
        main { max-width:640px; margin:0 auto; padding:34px 24px 64px; }
        .kicker { font-family:'DM Sans',sans-serif; text-transform:uppercase; font-size:0.7rem; font-weight:700; letter-spacing:0.2em; color:var(--burgundy); margin-bottom:14px; }
        .src-name { font-family:'Playfair Display',serif; font-weight:900; font-size:clamp(1.7rem,5vw,2.4rem); line-height:1.1; letter-spacing:-0.02em; }
        .src-host { font-family:'DM Sans',sans-serif; font-size:0.8rem; color:var(--text-muted); margin-top:6px; }
        .src-blurb { font-size:1.05rem; color:var(--slate); margin-top:16px; }
        .src-blurb strong { color:var(--ink); }
        .rel { background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:18px 20px; margin:24px 0; }
        .rel-lbl { font-family:'DM Sans',sans-serif; text-transform:uppercase; font-size:0.66rem; font-weight:700; letter-spacing:0.14em; color:var(--text-muted); }
        .rel-q { font-style:italic; font-size:1.05rem; color:var(--ink); margin:8px 0 4px; }
        .rel-q a { color:inherit; text-decoration:none; border-bottom:1px solid var(--border-accent); }
        .rel-q a:hover { border-color:var(--burgundy); }
        h2.what-h { font-family:'Playfair Display',serif; font-weight:900; font-size:1.25rem; margin:26px 0 10px; }
        .what { color:var(--slate); font-size:1rem; }
        .what a { color:var(--burgundy); }
        .actions { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-top:26px; }
        .go { display:inline-flex; align-items:center; gap:9px; font-family:'DM Sans',sans-serif; font-weight:600; font-size:0.92rem; color:#fff; background:linear-gradient(135deg,var(--burgundy),var(--burgundy-deep)); text-decoration:none; padding:12px 22px; border-radius:12px; }
        .go:hover { filter:brightness(1.08); }
        .back { font-family:'DM Sans',sans-serif; font-size:0.9rem; font-weight:600; color:var(--slate); text-decoration:none; padding:12px 8px; }
        .back:hover { color:var(--ink); }
        .skip { margin-top:30px; padding-top:18px; border-top:1px solid var(--border); font-family:'DM Sans',sans-serif; font-size:0.85rem; color:var(--text-muted); display:flex; align-items:center; gap:9px; }
        .skip input { width:16px; height:16px; accent-color:var(--burgundy); cursor:pointer; }
        .skip label { cursor:pointer; }
        @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }`;

const CLIENT = `    <script>
        (function(){
            var SOURCES={
                'quoteinvestigator.com':{n:'Quote Investigator',b:'a widely-cited research project by Garson O&rsquo;Toole (Dr. Gregory Sullivan) that traces sayings back to their earliest documented appearance in print. It is one of our primary anchors.'},
                'en.wikiquote.org':{n:'Wikiquote',b:'Wikimedia&rsquo;s sourced-quotation project; its &ldquo;Misattributed&rdquo; and &ldquo;Disputed&rdquo; sections catalogue lines commonly pinned on the wrong person.'},
                'en.wikipedia.org':{n:'Wikipedia',b:'the collaborative encyclopedia &mdash; we use it for author biographies, works, and publication histories, and follow its citations to primary sources.'},
                'archive.org':{n:'the Internet Archive',b:'full scans of the original books, letters, and documents &mdash; where we confirm exact wording against the primary source.'},
                'www.gutenberg.org':{n:'Project Gutenberg',b:'free full texts of public-domain books &mdash; used to check a quote against the actual work.'},
                'gutenberg.org':{n:'Project Gutenberg',b:'free full texts of public-domain books &mdash; used to check a quote against the actual work.'},
                'goodreads.com':{n:'Goodreads',b:'a large community quotation catalogue &mdash; useful for seeing how a line circulates online, though not itself an authority on where it came from.'},
                'www.goodreads.com':{n:'Goodreads',b:'a large community quotation catalogue &mdash; useful for seeing how a line circulates online, though not itself an authority on where it came from.'},
                'wist.info':{n:'WIST Quotations',b:'a carefully-sourced quotation database that flags attributed-but-unverified lines and records &ldquo;no source found&rdquo; where appropriate.'},
                'checkyourfact.com':{n:'Check Your Fact',b:'a fact-checking outlet that verifies viral quotations against the record.'},
                'www.snopes.com':{n:'Snopes',b:'one of the oldest and most established fact-checking organisations.'},
                'snopes.com':{n:'Snopes',b:'one of the oldest and most established fact-checking organisations.'},
                'www.politifact.com':{n:'PolitiFact',b:'a Pulitzer-winning political fact-checking site.'},
                'www.phrases.org.uk':{n:'Phrases.org.uk',b:'a reference on the meaning and origin of English phrases and sayings.'},
                'phrases.org.uk':{n:'Phrases.org.uk',b:'a reference on the meaning and origin of English phrases and sayings.'},
                'winstonchurchill.org':{n:'the International Churchill Society',b:'the scholarly authority on what Churchill did and did not say.'},
                'history.com':{n:'HISTORY',b:'the popular history outlet &mdash; useful background on how myths take hold.'}
            };
            function srcOf(host){ host=(host||'').replace(/^www\\./,''); if(SOURCES[host]) return SOURCES[host]; if(SOURCES['www.'+host]) return SOURCES['www.'+host]; return {n:host||'this source', b:'a source we consulted while verifying this quote.'}; }
            function esc(s){ var d=document.createElement('div'); d.textContent=(s==null?'':String(s)); return d.innerHTML; }
            var p; try{ p=new URLSearchParams(location.search); }catch(e){ p=null; }
            var q=p&&p.get('q'), i=parseInt((p&&p.get('i'))||'-1',10);
            var el=document.getElementById('card');
            function fail(msg){ el.innerHTML='<p class="kicker">Source</p><h1 class="src-name">'+msg+'</h1><p class="back-wrap"><a class="back" href="/">&larr; Back to quotle.info</a></p>'; }
            if(!q||i<0){ fail('Source not found'); return; }
            fetch('/data/quotes/'+encodeURIComponent(q)+'.json').then(function(r){ if(!r.ok) throw 0; return r.json(); }).then(function(rec){
                var links=rec.externalLinks||[]; var l=links[i];
                if(!l){ fail('Source not found'); return; }
                var s=srcOf(l.host);
                var qurl='/who-said/'+q+'/';
                el.innerHTML=
                    '<p class="kicker">How we used this source</p>'+
                    '<h1 class="src-name">'+esc(s.n)+'</h1>'+
                    '<p class="src-host">'+esc(l.host||'')+'</p>'+
                    '<p class="src-blurb">'+s.b+'</p>'+
                    '<div class="rel"><p class="rel-lbl">For the quote</p><p class="rel-q"><a href="'+qurl+'">&ldquo;'+esc(rec.displayQuote||'')+'&rdquo;</a></p></div>'+
                    '<h2 class="what-h">What we drew from it</h2>'+
                    '<p class="what">'+(l.what||('Background and corroboration for our finding on this quote.'))+'</p>'+
                    '<div class="actions">'+
                        '<a class="go" href="'+esc(l.url)+'" target="_blank" rel="noopener nofollow">Read the full research at '+esc(s.n)+' <span aria-hidden="true">&#8599;</span></a>'+
                        '<a class="back" href="'+qurl+'">&larr; Back to the quote</a>'+
                    '</div>'+
                    '<div class="skip"><input type="checkbox" id="skip"><label for="skip">Take me straight to sources next time (skip this step)</label></div>';
                document.title='How we used '+s.n+' | Quotle.info';
                var cb=document.getElementById('skip');
                try{ cb.checked = localStorage.getItem('quotle-skip-cite')==='1'; }catch(e){}
                cb.addEventListener('change', function(){ try{ if(cb.checked) localStorage.setItem('quotle-skip-cite','1'); else localStorage.removeItem('quotle-skip-cite'); }catch(e){} });
            }).catch(function(){ fail('Source not found'); });
        })();
    </script>`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, follow">
${HEAD_SCRIPT}
    <title>How we used this source | Quotle.info</title>
    <meta name="description" content="How quotle.info used this source to verify a quote — and a link to the full research if you want to dig deeper.">
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,900;1,400&family=Source+Serif+4:ital@0;1&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
${STYLE}${CHROME_CSS}
    </style>
${THEME_CSS}
</head>
<body>
${NAV('')}
    <main>
        <div id="card"><p class="kicker">How we used this source</p><p class="src-blurb">Loading&hellip;</p></div>
    </main>
${CLIENT}
${SEARCH_JS}
${SCRIPT}
</body>
</html>
`;

const outDir = path.join(ROOT, 'cite');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log('  ✓ cite/index.html  (source "how we used it" interstitial)');
