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
const { HEAD_SCRIPT, THEME_CSS, SCRIPT, PREF_SYNC } = require('./a11y-widget');
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
// The tag printed on a card — the SPECIFIC category, so a Shakespeare misquote still says so.
// This used to know only three categories while tools/harvest.js already knew nine, so the 21
// scripture/shakespeare/film cards fell through to a generic "Queued". (They were also
// unreachable: the chips hardcoded the same three and silently summed to 485 under an "All 506".
// harvest.js CAT_RANK carries a comment about exactly this drift on its own copy of the list;
// that one was fixed and this one was not.) An unlisted category now title-cases rather than
// vanishing, so adding one to a harvester cannot strand its cards here.
const CAT_TAG = {
  misattributed: 'Likely misattributed',
  'political-fabrication': 'Political fabrication',
  'meme-misattribution': 'Meme misattribution',
  'science-tech-misattribution': 'Science/tech misattribution',
  disputed: 'Disputed',
  'shakespeare-misquote': 'Shakespeare misquote',
  'scripture-misquote': 'Scripture misquote',
  'film-misquote': 'Film misquote',
  'genuine-famous': 'Verifying source',
};
const titleCase = (k) => String(k || '').replace(/-/g, ' ').replace(/^./, (m) => m.toUpperCase()) || 'Queued';
const catTag = (k) => CAT_TAG[k] || titleCase(k);

// The chips filter on ONE axis: our current stance on the quote. `category` is not that axis —
// it conflates two questions. "Shakespeare / Scripture / Film" answer WHERE A LINE COMES FROM,
// while "Misattributed / Disputed" answer IS IT REAL, and the six rendered side by side read as
// six alternatives to a visitor when they are not. The data says the same thing: every one of
// misattributed, shakespeare-misquote, scripture-misquote and film-misquote is 100%
// likelyConfidence='disputed'. They are misattributions WITH A SOURCE DOMAIN ATTACHED, not peers
// of "misattributed" — which harvest.js CAT_RANK already states outright ("A political
// fabrication or a fake Einstein science line IS a misattribution; that is the product") by
// ranking them identically.
//
// So the whole misattribution family collapses to one chip. Nothing is lost: the card keeps its
// specific tag ("Shakespeare misquote"), its CSS class, and its searchable text. An unmapped
// category groups to ITSELF, which preserves the property that a new category can never be
// stranded without a chip.
const CAT_GROUP = {
  misattributed: 'misattributed',
  'political-fabrication': 'misattributed',
  'meme-misattribution': 'misattributed',
  'science-tech-misattribution': 'misattributed',
  'shakespeare-misquote': 'misattributed',
  'scripture-misquote': 'misattributed',
  'film-misquote': 'misattributed',
  disputed: 'disputed',
  'genuine-famous': 'genuine-famous',
};
const GROUP_ORDER = ['misattributed', 'disputed', 'genuine-famous'];
const GROUP_LABEL = { misattributed: 'Misattributed', disputed: 'Disputed', 'genuine-famous': 'Verifying' };
const catGroup = (k) => CAT_GROUP[k] || k || 'queued';
const groupLabel = (g) => GROUP_LABEL[g] || titleCase(g);

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
// EVERY interpolation here is escaped, including the ones that look like enums. `category` came
// from data/harvest-queue.json, which — unlike data/quotes and data/songs — passes through NO
// safety gate at any stage (html-safety.js is wired into validate-records.js and validate-songs.js
// only). It was interpolated RAW into two class attributes while every sibling field beside it was
// escaped, so `x" onmouseover=...` broke out of the attribute. The values are agent-authored from
// fetched web pages, which is precisely the "attacker's page -> agent -> record -> every rendered
// page" route html-safety.js was written to close. Do not un-escape these because they "should be"
// a fixed vocabulary — nothing enforces that vocabulary.
const benchCard = (c) => `                <article class="bench-card ${esc(c.category)} filterable" data-c="${esc(catGroup(c.category))}" data-s="${esc(searchText((c.quote || '') + ' ' + (c.magnetAuthor || '')))}">
                    <p class="bench-q">&ldquo;${esc(c.quote)}&rdquo;</p>
                    <div class="bench-foot">
                        <span class="bench-cred">Pinned on ${esc(c.magnetAuthor || 'unknown')}</span>
                        <span class="bench-tag ${esc(c.category)}">${catTag(c.category)}</span>
                    </div>
                    <div class="bench-actions">
${INTERACTIVE ? `                        ${voteBtn(c)}` : ''}
${c.documentedAt ? `                        <a class="bench-src" rel="nofollow" href="/flagged/?q=${esc(c.slug)}">Why we flagged it <span aria-hidden="true">→</span></a>` : ''}
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
${scripts}${SCRIPT}${PREF_SYNC}
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
      {"@type":"WebSite","@id":"https://quotle.info/#website","url":"https://quotle.info/","name":"Quotle.info","description":"Verified quote provenance and reuse-rights clearance — who really said it, traced to a primary source where one exists, and whether it is public-domain or in-copyright before you publish it.","publisher":{"@id":"https://quotle.info/#org"},"potentialAction":{"@type":"SearchAction","target":{"@type":"EntryPoint","urlTemplate":"https://quotle.info/who-said/?q={search_term_string}"},"query-input":"required name=search_term_string"}},
      {"@type":"Organization","@id":"https://quotle.info/#org","name":"Quotle.info","url":"https://quotle.info/","description":"A verified-provenance fact-check companion to the Quotle game (Game Shelf). Every quote traced to a primary source and dated \u2014 or honestly marked where the trail cannot be closed."}
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
            <!-- Songs are a SEPARATE content type and get their own tile. The Quotes tile above
                 renders CORPUS.quotes.total, which reads data/quotes only, so songs were never
                 folded into the quote count — but until this tile existed an entire content type
                 (its own harvest/generate/audit pipeline) was reachable from the home page only
                 via the nav bar, and nothing on the front page said it existed. -->
            <a class="tile" href="/who-recorded/"><div class="tile-n">${songCount}</div><div class="tile-label">Songs</div><div class="tile-sub">Who <em>recorded</em> it first, and who <em>wrote</em> it — credited to the wrong artist.</div></a>
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
// Counted by GROUP, not category — derived, not listed, so the chips always sum to "All" and a
// new category can never be stranded without one. See CAT_GROUP above for why they collapse.
const bcount = BENCH.reduce((m, c) => (m[catGroup(c.category)] = (m[catGroup(c.category)] || 0) + 1, m), {});
const benchCats = Object.keys(bcount).sort((a, b) => {
  const ra = GROUP_ORDER.indexOf(a), rb = GROUP_ORDER.indexOf(b);
  return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || bcount[b] - bcount[a] || a.localeCompare(b);
});
const reviewBody = `        <header class="page-head">
            <p class="feat-kicker">On the research bench</p>
            <h1>Under review</h1>
            <p class="lede">Lines we&rsquo;ve flagged as commonly misquoted or misattributed and queued for a full source trace. <strong>Not yet verified</strong> — each links to the catalog entry that flagged it${INTERACTIVE ? ', and you can <strong>▲ bump one up the queue</strong>' : ''}. ${BENCH.length} in the queue.</p>
        </header>
        <section class="browse" aria-label="Filter quotes under review">
            <input id="pq" class="search" type="search" placeholder="Search a quote or an author…" aria-label="Filter quotes under review" autocomplete="off">
            <div class="chips" role="tablist" aria-label="Filter by type">
                ${chip('all', 'All', BENCH.length, true)}
                ${benchCats.map((k) => chip(k, groupLabel(k), bcount[k])).join('\n                ')}
            </div>
            <div class="bench-grid" id="results">
${BENCH.map(benchCard).join('\n')}
            </div>
            <p class="no-results" id="noResults" hidden>Nothing under review matches that.</p>
        </section>
${INTERACTIVE ? `        <p class="bench-note">Know a famous fake we haven&rsquo;t got, or spotted something wrong? <a href="/report/">Report it &rarr;</a></p>` : `        <p class="bench-note">Voting to prioritise these &mdash; and nominating new authors and quotes &mdash; is coming soon.</p>`}`;

// ---- REPORT (/report/) ----
// The nominate form used to live at the BOTTOM OF THIS PAGE — ~98% down a document carrying 500+
// candidate cards, with no anchor. It was there because /under-review/ happened to be the only page
// with the Turnstile plumbing, never because it belonged there. Two readers in a row concluded the
// site had no way to report anything, which is the correct conclusion from what they could see.
//
// ONE FORM, not two. This page shipped with #fixForm and #nomForm stacked on it, which is the same
// sprawl the move here was meant to end — just under a shared URL. A reader does not arrive
// choosing between two forms; they arrive with one thing to tell us. So intent is the FIRST
// question and the fields adapt beneath it:
//   "something on a page here is wrong" → /submit-source     (the record exists; we need to find it)
//   "you're missing a quote"            → /lookup, then /nominate  (it does not exist here yet)
// The per-quote form on every /who-said/ page STAYS. It is contextual, already knows which quote,
// and is strictly the better route when the reader is on the page — deleting it would reintroduce
// the retyping this whole page exists to remove. One report form, plus the in-context one.
//
// No `required` attributes. Half the controls are hidden at any moment, and a hidden required
// field blocks native submission with a console error and NO visible message — the exact silent
// dead-form failure that shipped here once already. Validation is in the submit handler, where it
// can say something.
const reportBody = INTERACTIVE ? `        <header class="page-head">
            <p class="feat-kicker">Corrections and nominations</p>
            <h1>Report something</h1>
            <p class="lede">Tell us what&rsquo;s wrong, or what we&rsquo;re missing. Nothing you send is published unverified &mdash; it goes to a review queue and a human traces the source.</p>
        </header>
        <section class="report-sec" id="report" aria-labelledby="report-h">
            <h2 id="report-h">One form, both jobs</h2>
            <p class="report-sub">If you&rsquo;re on the quote&rsquo;s own page, the report form at the bottom of it is quicker &mdash; it already knows which quote you mean.</p>
            <form class="nom" id="reportForm">
                <fieldset class="rf-intent">
                    <legend>What are you reporting?</legend>
                    <label><input type="radio" name="intent" value="wrong" checked> Something on a page here is wrong</label>
                    <label><input type="radio" name="intent" value="missing"> You&rsquo;re missing a quote</label>
                </fieldset>

                <div class="rf-group" data-when="wrong">
                    <label class="rf-lab" for="rf-ref">Which quote? Paste the link or the line</label>
                    <input class="nom-in" id="rf-ref" name="ref" maxlength="300" autocomplete="off" placeholder="https://quotle.info/who-said/&hellip; &mdash; or just type the line">
                </div>

                <div class="rf-group" data-when="missing">
                    <label class="rf-lab" for="rf-author">Who is it credited to?</label>
                    <input class="nom-in" id="rf-author" name="author" maxlength="120" autocomplete="off" placeholder="The name it&rsquo;s usually pinned on">
                </div>
                <div class="rf-group" data-when="missing">
                    <label class="rf-lab" for="rf-quote">The quote, if you have it <span class="rf-opt">(optional)</span></label>
                    <textarea class="nom-in nom-area" id="rf-quote" name="quote" maxlength="600" rows="2"></textarea>
                </div>

                <div class="rf-group" data-when="wrong">
                    <span class="rf-lab" id="rf-why-lab">What&rsquo;s wrong?</span>
                    <div class="report-why" role="radiogroup" aria-labelledby="rf-why-lab">
                        <label><input type="radio" name="reason" value="wrong-person" checked> The attribution is wrong</label>
                        <label><input type="radio" name="reason" value="wrong-wording"> The wording is wrong</label>
                        <label><input type="radio" name="reason" value="rights"> The rights / copyright information is wrong</label>
                        <label><input type="radio" name="reason" value="dead-link"> A source link is broken</label>
                        <label><input type="radio" name="reason" value="other"> Something else</label>
                    </div>
                </div>

                <div class="rf-group">
                    <label class="rf-lab" for="rf-url">A link that shows it <span class="rf-opt">(optional)</span></label>
                    <input class="nom-in" id="rf-url" name="url" type="url" inputmode="url" autocomplete="off" placeholder="https://&hellip;">
                </div>
                <div class="rf-group">
                    <label class="rf-lab" for="rf-note">Anything else <span class="rf-opt">(optional)</span></label>
                    <textarea class="nom-in nom-area" id="rf-note" name="note" maxlength="600" rows="3"></textarea>
                </div>
                <div class="rf-group">
                    <label class="rf-lab" for="rf-email">Your email <span class="rf-opt">(optional)</span></label>
                    <input class="nom-in" id="rf-email" name="email" type="email" maxlength="200" autocomplete="email" aria-describedby="rf-email-why">
                    <p class="rf-help" id="rf-email-why">Only used to tell you if we act on your report. We never sell or share it.</p>
                </div>

                <button class="nom-btn" type="submit">Send report</button>
                <p class="nom-msg" id="reportMsg" role="status" hidden></p>
            </form>
        </section>` : `        <header class="page-head">
            <h1>Report something</h1>
            <p class="lede">Corrections and nominations are coming soon. In the meantime, email <a href="mailto:help@quotle.info">help@quotle.info</a>.</p>
        </header>`;

const TURNSTILE_HEAD = INTERACTIVE ? `    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>\n` : '';
// /report/ needs its own script: the vote wiring above belongs to the browse page, and shipping
// 500 cards' worth of vote JS to a page with two forms (or the forms to a page with no forms) is
// how the nominate form ended up living on /under-review/ in the first place.
const REPORT_JS = INTERACTIVE ? `    <script>
        (function(){
            var API=${JSON.stringify(CFG.votesApi)}, SITEKEY=${JSON.stringify(CFG.turnstileSitekey)};
            var wid=null, pending=null;
            function ensure(){ if(wid!==null||!window.turnstile) return; var el=document.createElement('div'); el.style.display='none'; document.body.appendChild(el);
                wid=window.turnstile.render(el,{sitekey:SITEKEY,size:'invisible',callback:function(t){ var c=pending; pending=null; if(c)c(t); },'error-callback':function(){ var c=pending; pending=null; if(c)c(null); }}); }
            function token(cb){ ensure(); if(wid===null){ cb(null); return; } pending=cb; try{ window.turnstile.reset(wid); window.turnstile.execute(wid); }catch(e){ pending=null; cb(null); } }
            function show(el,t,err){ el.textContent=t; el.hidden=false; el.className='nom-msg'+(err?' err':''); }

            // ONE form, ONE submit handler, branching on the intent radio. The page used to carry
            // two forms with two handlers; the reader's job is the same either way, so the split
            // was ours, not theirs.
            var f=document.getElementById('reportForm');
            if(f){
              var msg=document.getElementById('reportMsg'), btn=f.querySelector('.nom-btn');
              var groups=[].slice.call(f.querySelectorAll('.rf-group[data-when]'));
              function intent(){ var r=f.querySelector('input[name="intent"]:checked'); return r?r.value:'wrong'; }
              function sync(){ var v=intent(); groups.forEach(function(g){ g.hidden = g.getAttribute('data-when')!==v; }); }
              [].forEach.call(f.querySelectorAll('input[name="intent"]'),function(r){ r.addEventListener('change',sync); });
              sync();
              function fail(t){ btn.disabled=false; show(msg,t,true); }

              // MISSING -> /lookup FIRST, then /nominate only if it is genuinely new.
              //
              // /lookup already walks corpus -> backlog -> pending nomination -> Wikiquote and returns a
              // stage; /check has consumed it since it was written. Asking it BEFORE nominating does three
              // things a daily triage job was going to do later and worse: it dedupes, it applies the
              // acceptance ladder, and — the part no batch job can — it tells the reader the outcome AT
              // SUBMIT TIME. The email field below is optional and unsent-to for now, so that synchronous
              // answer is still the only one most readers will get.
              //
              // It keys on QUOTE TEXT (>=12 chars), not author, so an author-only nomination skips the check
              // and posts as before rather than pretending to have checked something.
              function nominate(author,quote,note,email,okMsg){
                  token(function(t){ if(!t){ fail('Verification failed \\u2014 please try again.'); return; }
                      fetch(API+'/nominate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({author:author,quote:quote,note:note,email:email,token:t})})
                      .then(function(r){return r.json();}).then(function(d){ if(d&&d.ok){ f.reset(); sync(); btn.disabled=false; show(msg,okMsg||'Thank you \\u2014 added to the review queue.',false); } else { fail((d&&d.error)||'Something went wrong.'); } })
                      .catch(function(){ fail('Network error \\u2014 please try again.'); }); });
              }

              function sendMissing(url,note,email){
                  var author=f.author.value.trim(), quote=f.quote.value.trim();
                  if(!author){ show(msg,'Tell us who it is credited to.',true); return; }
                  // /nominate has no url column, so the optional link rides in the note. Losing it
                  // would be worse than an untidy note — it is often the only evidence attached.
                  var full=(note+(url?(note?' \\u2014 ':'')+'link: '+url:'')).slice(0,600);
                  btn.disabled=true; show(msg,'Checking\\u2026',false);
                  if(quote.length<12){ nominate(author,quote,full,email); return; }
                  fetch(API+'/lookup?q='+encodeURIComponent(quote))
                  .then(function(r){return r.json();}).then(function(d){
                      var st=(d&&d.stage)||'none';
                      if(st==='corpus'){ btn.disabled=false; show(msg,'We already have this one \\u2014 open '+(d.url||'/who-said/')+' . If our verdict looks wrong, use the report form at the bottom of that page.',false); return; }
                      if(st==='backlog'){ btn.disabled=false; f.reset(); sync(); show(msg,'Good call \\u2014 it is already on our list, queued for a full source trace.',false); return; }
                      // 'nominated' discards the reader's content for the SAME reason 'wikiquote'
                      // did — an existing pending row, so the client skipped the POST. Fixing only
                      // the wikiquote branch left this one live: once a quote is queued ONCE, every
                      // later reader with real context about it was silently ignored. /nominate
                      // dedupes and enriches, so posting is safe and the note reaches the row.
                      if(st==='nominated'){ nominate(author,quote,full,email,'Someone beat you to it \\u2014 already nominated. We have added your notes to it.'); return; }
                      // DO NOT return early here. /lookup auto-queues a BARE nomination when
                      // Wikiquote confirms (author empty, note "wikiquote-auto"), and skipping the
                      // POST threw away everything the reader wrote — a real submission explaining
                      // that a line is genuinely Beckett, from Worstward Ho, with a strict estate,
                      // was stored as a machine stub. /nominate now dedupes by normalised quote and
                      // ENRICHES that row, so posting is safe and the human's context survives.
                      if(st==='wikiquote'&&d.added){ nominate(author,quote,full,email,'Thank you \\u2014 confirmed against Wikiquote and added to the review queue.'); return; }
                      nominate(author,quote,full,email);
                  })
                  .catch(function(){ nominate(author,quote,full,email); });
              }

              // WRONG -> /submit-source. The reader arrived WITHOUT a page, so there is no slug to
              // send; what they typed goes in the note, prefixed, and a human resolves it. If they
              // pasted a /who-said/<slug>/ link we recover the slug so the report lands on the right
              // record automatically — the common case, and free.
              function sendWrong(url,note,email){
                  var ref=f.ref.value.trim();
                  if(!ref){ show(msg,'Tell us which quote you mean.',true); return; }
                  var reason='other', r=f.querySelector('input[name="reason"]:checked'); if(r) reason=r.value;
                  // Deliberately NO regex here. This lives inside a JS template literal, so a literal
                  // backslash is eaten as an escape at build time: /\\/who-said\\/.../ shipped as
                  // //who-said/...// — a syntax error that killed the WHOLE script, so neither form
                  // submitted and the browser fell back to a native GET. Build was green, CI passed,
                  // 43 invariants passed. Only submitting the form found it. indexOf cannot break that way.
                  var slug='', ix=ref.indexOf('/who-said/');
                  if(ix>-1){ var rest=ref.slice(ix+10), sl=rest.indexOf('/'); slug=(sl>-1?rest.slice(0,sl):rest); }
                  var full='Reported via /report/ for: '+ref+(note?' \\u2014 '+note:'');
                  btn.disabled=true; show(msg,'Sending\\u2026',false);
                  token(function(t){ if(!t){ fail('Verification failed \\u2014 please try again.'); return; }
                      fetch(API+'/submit-source',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:slug,url:url,stance:'refutes',reason:reason,note:full.slice(0,600),email:email,token:t})})
                      .then(function(r){return r.json();}).then(function(d){ if(d&&d.ok){ f.reset(); sync(); btn.disabled=false; show(msg,'Thank you \\u2014 sent to our review queue.',false); } else { fail((d&&d.error)||'Something went wrong.'); } })
                      .catch(function(){ fail('Network error \\u2014 please try again.'); }); });
              }

              f.addEventListener('submit',function(e){ e.preventDefault();
                  var url=f.url.value.trim(), note=f.note.value.trim(), email=f.email.value.trim();
                  if(intent()==='missing') sendMissing(url,note,email); else sendWrong(url,note,email);
              });
            }
        })();
    </script>` : '';

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
        })();
    </script>` : '';

// ---- write ----
const homeHtml = page({ title: 'Quotle.info — Real quote? Cleared to use? Verified provenance + reuse rights', description: `Before you publish a quote: check it's real, who actually said it, and whether it's cleared to reproduce (public domain or in copyright) — the part AI gets wrong. ${total} quotes traced to a primary source \u2014 or marked where none exists.`, active: 'home', canonical: 'https://quotle.info/', jsonld: homeJsonLd, body: homeBody });
const quotesHtml = page({ title: 'Quotes — who really said it | Quotle.info', description: `Search ${total} quotes traced to a primary source &mdash; or marked where none exists. Filter by verified, attributed, or misattributed.`, active: 'quotes', canonical: 'https://quotle.info/who-said/', body: quotesBody, scripts: FILTER_JS });
const reviewHtml = page({ title: 'Under review — quotes queued for verification | Quotle.info', description: `${BENCH.length} commonly-misquoted lines we&rsquo;ve flagged and queued for a full source trace. Not yet verified.`, active: 'review', canonical: 'https://quotle.info/under-review/', headExtra: TURNSTILE_HEAD, body: reviewBody, scripts: FILTER_JS + '\n' + BENCH_JS });

fs.writeFileSync(path.join(ROOT, 'index.html'), homeHtml);
fs.mkdirSync(path.join(ROOT, 'who-said'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'who-said', 'index.html'), quotesHtml);
fs.mkdirSync(path.join(ROOT, 'under-review'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'under-review', 'index.html'), reviewHtml);
// /report/ — the correction + nomination home. Its own page because the two jobs it serves are not
// browsing: one is "a page here is wrong", the other "you're missing one". Neither belonged at the
// bottom of a 500-card list, which is where the nominate form sat until now.
const reportHtml = page({ title: 'Report a correction or a missing quote | Quotle.info', description: 'Tell us if an attribution here is wrong, or nominate a famous misquote we have not covered. Nothing is published unverified — every report goes to a review queue and a human traces the source.', active: '', canonical: 'https://quotle.info/report/', headExtra: TURNSTILE_HEAD, body: reportBody, scripts: REPORT_JS });
fs.mkdirSync(path.join(ROOT, 'report'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'report', 'index.html'), reportHtml);
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
        /* /report/ — ONE form whose fields adapt to the intent radio. Without these the radios
           inherit nothing and render as one run-on paragraph with the dots buried mid-sentence;
           the labels are sentences, so they need a line each. Found by looking at the page, not
           the markup. The .rf-group[hidden] rule is explicit, not a bare [hidden]: these groups set
           display:flex, which wins over the UA stylesheet's [hidden]{display:none} on specificity
           tie-break, so the "hidden" fields would stay visible. (No backticks in this comment: it
           is inside a JS template literal, where one terminates the string. That has broken this
           build three times.) */
        .rf-intent { border:none; padding:0; margin:0 0 6px; display:flex; flex-direction:column; gap:9px; font-family:'DM Sans',sans-serif; font-size:0.9rem; color:var(--ink); }
        .rf-intent legend { padding:0; font-weight:700; font-size:0.9rem; color:var(--ink); margin-bottom:9px; }
        .rf-intent label { display:flex; align-items:flex-start; gap:9px; cursor:pointer; line-height:1.45; }
        .rf-intent input { margin-top:3px; flex-shrink:0; }
        .rf-group { display:flex; flex-direction:column; gap:6px; }
        .rf-group[hidden] { display:none; }
        .rf-lab { font-family:'DM Sans',sans-serif; font-size:0.86rem; font-weight:600; color:var(--ink); }
        .rf-opt { font-weight:400; color:var(--text-muted); }
        .rf-help { font-family:'DM Sans',sans-serif; font-size:0.78rem; color:var(--text-muted); line-height:1.5; margin-top:2px; }
        .report-sec { margin-top:42px; max-width:560px; }
        .report-sec h2 { font-family:'Playfair Display',serif; font-weight:900; font-size:1.45rem; letter-spacing:-0.015em; margin-bottom:8px; }
        .report-sub { font-family:'DM Sans',sans-serif; font-size:0.88rem; color:var(--slate); line-height:1.6; margin-bottom:4px; }
        .report-why { display:flex; flex-direction:column; gap:9px; font-family:'DM Sans',sans-serif; font-size:0.9rem; color:var(--ink); margin:4px 0 2px; }
        .report-why label { display:flex; align-items:flex-start; gap:9px; cursor:pointer; line-height:1.45; }
        .report-why input { margin-top:3px; flex-shrink:0; }
        .nom { margin-top:34px; background:var(--bg-card); border:1px solid var(--border); border-radius:16px; padding:26px 24px; display:flex; flex-direction:column; gap:10px; max-width:560px; }
        .nom-h { font-family:'Playfair Display',serif; font-weight:900; font-size:1.15rem; }
        .nom-sub { font-family:'DM Sans',sans-serif; font-size:0.85rem; color:var(--text-muted); margin-bottom:6px; }
        .nom-area { resize:vertical; min-height:64px; line-height:1.5; font-family:'DM Sans',sans-serif; }
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
