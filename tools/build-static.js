#!/usr/bin/env node
'use strict';
/*
 * build-static.js — quotle.info's standing content + trust/utility pages (not per-quote):
 *   /how-we-verify  — methodology / trust page
 *   /about          — who runs it, the goal, is it maintained, how it relates to sources
 *   /privacy        — plain-English privacy policy (accurate to what the site actually collects)
 *   /terms          — terms of use (content + API)
 *   /contact        — contact + corrections
 * All share ONE page shell (nav, theme, display control, footer) via the shared modules.
 * Run by tools/build.js.
 */
const fs = require('fs');
const path = require('path');
const { HEAD_SCRIPT, THEME_CSS, CONTROL, SCRIPT } = require('./a11y-widget');
const { ROOT_CSS } = require('./tokens');
const { NAV, CHROME_CSS, SEARCH_JS, FOOTER } = require('./chrome');
const { OG_IMAGE_TAGS } = require('./og');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://quotle.info';
const EMAIL = 'help@quotle.info';

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
        main { max-width:680px; margin:0 auto; padding:8px 24px 64px; }
        .hero { padding:46px 0 8px; }
        .hero .kicker { font-family:'DM Sans',sans-serif; text-transform:uppercase; font-size:0.7rem; font-weight:700; letter-spacing:0.2em; color:var(--burgundy); margin-bottom:14px; }
        .hero h1 { font-family:'Playfair Display',serif; font-weight:900; font-size:clamp(2.1rem,6vw,3rem); line-height:1.08; letter-spacing:-0.02em; }
        .hero .lede { font-size:1.12rem; color:var(--slate); margin-top:18px; }
        .hero .lede strong { color:var(--ink); }
        section { margin-top:44px; }
        h2 { font-family:'Playfair Display',serif; font-weight:900; font-size:1.5rem; letter-spacing:-0.015em; margin-bottom:16px; }
        h3.sub { font-family:'DM Sans',sans-serif; font-size:1rem; font-weight:700; color:var(--ink); margin:22px 0 6px; }
        p { margin-bottom:16px; }
        p.big { color:var(--slate); }
        ul, ol { color:var(--slate); margin:0 0 16px 1.1em; }
        li { margin-bottom:9px; }
        li strong { color:var(--ink); }
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
        .cta { font-family:'DM Sans',sans-serif; font-size:0.85rem; font-weight:600; color:var(--sage); text-decoration:none; display:inline-flex; align-items:center; gap:6px; padding:8px 15px; border:1px solid rgba(126,179,139,0.3); border-radius:999px; background:var(--sage-dim); }
        .updated { font-family:'DM Sans',sans-serif; font-size:0.8rem; color:var(--text-muted); margin-top:6px; }
        .back { display:inline-flex; align-items:center; gap:8px; margin-top:40px; font-family:'DM Sans',sans-serif; font-weight:600; font-size:0.9rem; color:var(--sage); text-decoration:none; }
        .back:hover { text-decoration:underline; }
        @media (prefers-reduced-motion: reduce) { html { scroll-behavior:auto; } * { transition:none !important; } }`;

// ---- page shell -----------------------------------------------------------
function shell({ slug, active, title, description, ogTitle, ogDesc, kicker, h1, lede, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
${HEAD_SCRIPT}
    <title>${title}</title>
    <meta name="gs-app-id" content="quotle-info">
    <meta name="description" content="${description}">
    <link rel="canonical" href="${ORIGIN}/${slug}">
    <meta property="og:type" content="article">
    <meta property="og:title" content="${ogTitle || title}">
    <meta property="og:description" content="${ogDesc || description}">
    <meta property="og:url" content="${ORIGIN}/${slug}">
    <meta property="og:site_name" content="Quotle.info">
${OG_IMAGE_TAGS}
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
${STYLE}${CHROME_CSS}
    </style>
${THEME_CSS}
</head>
<body>
${NAV(active || '')}
    <main id="main">
        <header class="hero">
            <p class="kicker">${kicker}</p>
            <h1>${h1}</h1>
            <p class="lede">${lede}</p>
        </header>
${body}
        <a class="back" href="/"><span aria-hidden="true">←</span> Browse the verified quotes</a>
    </main>
${FOOTER}
${SEARCH_JS}
${SCRIPT}
</body>
</html>
`;
}

// ---- /how-we-verify -------------------------------------------------------
const howBody = `        <section aria-labelledby="how-h">
            <h2 id="how-h">What &ldquo;verified&rdquo; means here</h2>
            <div>
                <div class="principle"><span class="num">1</span><div><h3>Traced to a primary source</h3><p>We work back to the earliest document that actually carries the words — a first edition, a letter, a transcript, a recording — not a later anthology quoting an anthology.</p></div></div>
                <div class="principle"><span class="num">2</span><div><h3>Cited and dated, with links</h3><p>Each page names the source, the edition or issue, and the date, and links out to the archive or record so you can check it yourself. &ldquo;Trust us&rdquo; is not verification.</p></div></div>
                <div class="principle"><span class="num">3</span><div><h3>Re-checked adversarially</h3><p>Before a page ships, every source link is opened and the claim is tested against it — the goal is to <em>break</em> the attribution, not to confirm what we hoped. Only what survives is published.</p></div></div>
                <div class="principle"><span class="num">4</span><div><h3>Sourced, or honestly marked</h3><p>We don&rsquo;t repeat what other quote sites claim just because they claim it. Every attribution is grounded in a primary source &mdash; or in the documented research that traces to one. When the trail can&rsquo;t be closed, the quote is marked <em>Attributed</em> or <em>Disputed</em>, never asserted as fact. What matters is the source behind a claim, not whether a person or a model did the tracing.</p></div></div>
            </div>
        </section>

        <section aria-labelledby="states-h">
            <h2 id="states-h">Three honest states</h2>
            <p class="big">Certainty is a spectrum, so we don&rsquo;t pretend everything is settled. Every quote wears one of three badges:</p>
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
                    <p class="state-def">Still protected. We quote the single line for identification and commentary; the full work belongs to its author or estate, and verifying who said it is not a grant of reuse rights. Note that a modern <em>translation</em> of an old work can itself still be in copyright.</p>
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
            <p class="big"><a class="cta" href="/under-review/">Flag a correction or a missing quote &rarr;</a></p>
        </section>`;

// ---- /about ---------------------------------------------------------------
const aboutBody = `        <section aria-labelledby="story-h">
            <h2 id="story-h">How this started</h2>
            <p>Quotle.info began as the companion to <a href="https://gameshelf.co/quotle/">Quotle</a>, a daily quote-guessing game in the <a href="https://gameshelf.co">Game Shelf</a>. Building the game meant handling a lot of famous quotations — and it kept surfacing the same uncomfortable pattern: a startling share of &ldquo;famous quotes&rdquo; are misattributed, mangled in the retelling, or simply invented. Einstein and Twain get credited with lines they never said; movie quotes drift a word at a time; proverbs get pinned on the Bible.</p>
            <p>So this site grew out of that curiosity into a focused job: for any given quote, figure out <strong>who really said it</strong>, trace it to a primary source, and &mdash; the part almost every other quote site skips &mdash; say whether it&rsquo;s actually <strong>cleared to reuse</strong>.</p>
        </section>

        <section aria-labelledby="goal-h">
            <h2 id="goal-h">What it&rsquo;s for</h2>
            <p class="big">If you&rsquo;re about to put a quote in a slide deck, a paper, an article, or a post, quotle.info is a fast way to check three things before you do:</p>
            <ul>
                <li><strong>Is it real, and who actually said it?</strong> Not the popular misattribution &mdash; the documented source.</li>
                <li><strong>Can you reuse it?</strong> Public domain, still under copyright, or licensed &mdash; stated plainly.</li>
                <li><strong>How sure are we?</strong> Every quote is marked <em>verified</em>, <em>attributed</em>, or <em>disputed</em>, with the receipts. When we can&rsquo;t confirm something, we say so.</li>
            </ul>
            <p>Our standard is on the <a href="/how-we-verify/">How we verify</a> page.</p>
        </section>

        <section aria-labelledby="maintained-h">
            <h2 id="maintained-h">Is it maintained?</h2>
            <p>Yes. The corpus is actively growing in adversarially-audited batches, and every quote page carries a &ldquo;last verified&rdquo; date so you can see how current it is. Provenance research is never truly finished &mdash; if you can point to a primary source that changes an attribution, <a href="/contact/">tell us</a>; that&rsquo;s exactly the evidence we want.</p>
        </section>

        <section aria-labelledby="indep-h">
            <h2 id="indep-h">Independent, and honest about its sources</h2>
            <p>Quotle.info is <strong>independent and unaffiliated</strong> &mdash; not endorsed by, partnered with, or speaking for anyone. It is grounded in primary sources, and where others have already done the detective work it cites and defers to them: <a href="https://quoteinvestigator.com" rel="nofollow">Quote Investigator</a>, <a href="https://en.wikiquote.org" rel="nofollow">Wikiquote</a>, and archives such as the Internet Archive and Project Gutenberg. We don&rsquo;t claim credibility by association; the sources on each page are the credibility, and you can click every one.</p>
        </section>

        <section aria-labelledby="who-h">
            <h2 id="who-h">Who runs it</h2>
            <p>Quotle.info is a <a href="https://gameshelf.co">Game Shelf</a> project, built and maintained by <strong>David Stewart</strong> and operated by <strong>runMast&nbsp;LLC</strong>. There are no ads and no accounts. Questions, corrections, and rights inquiries: <a href="mailto:${EMAIL}">${EMAIL}</a>.</p>
            <p class="big"><a class="cta" href="/contact/">Contact &amp; corrections &rarr;</a></p>
        </section>`;

// ---- /privacy -------------------------------------------------------------
const privacyBody = `        <section aria-labelledby="p-sum">
            <h2 id="p-sum">The short version</h2>
            <p class="big">No ads. No accounts. No cross-site tracking. No selling or sharing your data. We collect the bare minimum needed to run the site and keep its community features free of spam &mdash; and we&rsquo;re specific about it below.</p>
        </section>

        <section aria-labelledby="p-collect">
            <h2 id="p-collect">What we collect, and why</h2>
            <h3 class="sub">Privacy-friendly analytics</h3>
            <p>We use <a href="https://www.goatcounter.com" rel="nofollow">GoatCounter</a>, a cookieless analytics tool, to see aggregate traffic (which pages are visited, roughly from where). It sets <strong>no cookies</strong>, builds <strong>no cross-site profile</strong>, and does not identify you. It is easily blocked by any ad/tracker blocker or a Do-Not-Track signal.</p>
            <h3 class="sub">Your display preferences</h3>
            <p>Your theme (light/dark) and text-size choices are saved in your browser&rsquo;s <strong>localStorage</strong>. They live on your device and are never sent to us. Clearing your browser storage resets them.</p>
            <h3 class="sub">Community features (voting &amp; nominating)</h3>
            <p>If you vote a quote up or nominate one for review, those are optional actions. To keep them free of bots and spam we use <a href="https://www.cloudflare.com/products/turnstile/" rel="nofollow">Cloudflare Turnstile</a> and we store a <strong>salted, one-way hash of your IP address</strong> to enforce rate limits &mdash; we never store your raw IP, and the hash can&rsquo;t be reversed back to it. Anything you type into a nomination (the quote, a name, a note) is stored so a human can review it before anything is published.</p>
        </section>

        <section aria-labelledby="p-not">
            <h2 id="p-not">What we don&rsquo;t do</h2>
            <ul>
                <li>No advertising or ad-tech trackers.</li>
                <li>No user accounts, logins, or profiles.</li>
                <li>No selling, renting, or sharing of personal data.</li>
                <li>No marketing emails (we have no mailing list).</li>
            </ul>
        </section>

        <section aria-labelledby="p-third">
            <h2 id="p-third">Service providers</h2>
            <p>The site is static and runs on infrastructure from <strong>GitHub Pages</strong> (hosting) and <strong>Cloudflare</strong> (the community API, Turnstile, and network), with <strong>GoatCounter</strong> for analytics. These providers process requests on our behalf; standard server logs may briefly hold IP addresses for security, per their own policies.</p>
        </section>

        <section aria-labelledby="p-contact">
            <h2 id="p-contact">Contact &amp; changes</h2>
            <p>Quotle.info is operated by <strong>runMast&nbsp;LLC</strong>. Privacy questions or requests: <a href="mailto:${EMAIL}">${EMAIL}</a>. If this policy changes, we&rsquo;ll update it here with a new date.</p>
            <p class="updated">Last updated 17 July 2026.</p>
        </section>`;

// ---- /terms ---------------------------------------------------------------
const termsBody = `        <section aria-labelledby="t-use">
            <h2 id="t-use">Using the site</h2>
            <p class="big">Quotle.info is provided free, as-is, for personal and professional reference. By using it you accept these terms. It&rsquo;s operated by <strong>runMast&nbsp;LLC</strong>.</p>
        </section>

        <section aria-labelledby="t-accuracy">
            <h2 id="t-accuracy">Accuracy &amp; no warranty</h2>
            <p>We work hard to trace every attribution to a primary source and to mark our confidence honestly (verified / attributed / disputed). But provenance research is never final and errors happen. The information is provided <strong>without warranty of any kind</strong>. Before you rely on an attribution for anything that matters &mdash; a publication, a legal or academic use, a commercial product &mdash; open the linked primary source and confirm it yourself.</p>
        </section>

        <section aria-labelledby="t-rights">
            <h2 id="t-rights">Quotes &amp; reuse rights</h2>
            <p>The reuse/rights status we show (public domain, in copyright, licensed, or uncertain) is our good-faith assessment to help you, <strong>not legal advice</strong>. Copyright is jurisdiction-specific, and a modern translation of an old work can itself be protected. <strong>You are responsible for clearing the rights for your particular use.</strong> Individual quotations belong to their authors or rightsholders; we reproduce single lines for identification and commentary.</p>
        </section>

        <section aria-labelledby="t-api">
            <h2 id="t-api">The API</h2>
            <p>The public <a href="/openapi.json">verification API</a> (<code>/verify</code>, <code>/verify-batch</code>, <code>/lookup</code>) is offered as-is for reasonable, non-abusive use. Please:</p>
            <ul>
                <li>Cache responses and don&rsquo;t hammer it; rate limits apply and abusive traffic may be blocked.</li>
                <li>Treat results as a first-pass check, not a guarantee &mdash; the same no-warranty terms above apply.</li>
                <li>Attribute quotle.info if you surface our verdicts to your users. A credit link is appreciated.</li>
            </ul>
            <p>There is no uptime or SLA guarantee, and the API may change or be withdrawn.</p>
        </section>

        <section aria-labelledby="t-own">
            <h2 id="t-own">Our content</h2>
            <p>The original commentary, provenance write-ups, structure, and design of quotle.info are &copy; runMast&nbsp;LLC. The underlying quotations belong to their respective authors. You&rsquo;re welcome to link to us and to quote short passages with attribution; please don&rsquo;t bulk-scrape or republish the site wholesale.</p>
        </section>

        <section aria-labelledby="t-contact">
            <h2 id="t-contact">Contact</h2>
            <p>Questions about these terms: <a href="mailto:${EMAIL}">${EMAIL}</a>.</p>
            <p class="updated">Last updated 17 July 2026.</p>
        </section>`;

// ---- /contact -------------------------------------------------------------
const contactBody = `        <section aria-labelledby="c-how">
            <h2 id="c-how">Get in touch</h2>
            <p class="big">Questions, rights inquiries, API questions, press, or just to say a page helped &mdash; email <a href="mailto:${EMAIL}"><strong>${EMAIL}</strong></a>. It&rsquo;s a small project, so replies may take a little while, but real people read it.</p>
        </section>

        <section aria-labelledby="c-fix">
            <h2 id="c-fix">Spotted an error?</h2>
            <p>Corrections are the most useful thing you can send. If an attribution looks wrong, or a famous quote is missing, the fastest path is the flag flow &mdash; and if you can point to a <strong>primary source</strong> (a first edition, a transcript, an archived scan), even better; that&rsquo;s exactly the evidence that moves a verdict.</p>
            <p class="big"><a class="cta" href="/under-review/">Flag a correction or a missing quote &rarr;</a></p>
            <p>Prefer email? Send the quote, the attribution you think is right, and your source to <a href="mailto:${EMAIL}">${EMAIL}</a>.</p>
        </section>

        <section aria-labelledby="c-who">
            <h2 id="c-who">Who you&rsquo;re reaching</h2>
            <p>Quotle.info is a <a href="https://gameshelf.co">Game Shelf</a> project, built and maintained by David Stewart and operated by runMast&nbsp;LLC. More on the <a href="/about/">About</a> page.</p>
        </section>`;

// ---- emit -----------------------------------------------------------------
const PAGES = [
  { slug: 'how-we-verify', active: '', title: 'How we verify · Quotle.info',
    description: 'How Quotle.info verifies every quote: traced to a primary source, dated, cited, and marked with honest confidence — verified, attributed, or disputed.',
    ogTitle: 'How Quotle.info verifies every quote', ogDesc: 'Traced to a primary source, dated, cited, and marked with honest confidence.',
    kicker: 'The standard', h1: 'How we verify',
    lede: 'Every attribution here is traced back to a primary source, dated, and cited — and when the trail runs cold, we say so instead of guessing.', body: howBody },
  { slug: 'about', active: '', title: 'About · Quotle.info',
    description: 'Who runs Quotle.info and why: an independent Game Shelf project that traces quotes to their real source and reuse rights. Built by David Stewart, operated by runMast LLC.',
    ogTitle: 'About Quotle.info', ogDesc: 'An independent project that traces quotes to their real source and reuse rights.',
    kicker: 'About', h1: 'Who really said it — and can you use it?',
    lede: 'Quotle.info traces any quote to who <strong>actually</strong> said it and whether it&rsquo;s cleared to reuse. Here&rsquo;s where it came from and how it works.', body: aboutBody },
  { slug: 'privacy', active: '', title: 'Privacy · Quotle.info',
    description: 'Quotle.info privacy policy: cookieless analytics, no ads, no accounts, no data sold. A salted IP hash (never the raw IP) rate-limits the community features.',
    ogTitle: 'Privacy · Quotle.info', ogDesc: 'No ads, no accounts, no tracking. Exactly what we collect and why.',
    kicker: 'Privacy', h1: 'Privacy policy',
    lede: 'Plain English, and accurate: here is exactly what Quotle.info collects, what it doesn&rsquo;t, and why.', body: privacyBody },
  { slug: 'terms', active: '', title: 'Terms of Use · Quotle.info',
    description: 'Quotle.info terms of use: the information is provided as-is without warranty; confirm attributions against the linked primary source; API usage terms.',
    ogTitle: 'Terms of Use · Quotle.info', ogDesc: 'Provided as-is; confirm against the primary source. Content + API terms.',
    kicker: 'Terms', h1: 'Terms of use',
    lede: 'The short, honest version of how you can rely on this site — and how you can&rsquo;t.', body: termsBody },
  { slug: 'contact', active: '', title: 'Contact & Corrections · Quotle.info',
    description: 'Contact Quotle.info: email help@quotle.info for questions, rights inquiries, or API questions — or flag a correction to an attribution.',
    ogTitle: 'Contact & Corrections · Quotle.info', ogDesc: 'Email help@quotle.info, or flag a correction with a primary source.',
    kicker: 'Contact', h1: 'Contact &amp; corrections',
    lede: 'A small, independent project — and corrections with a primary source are the most useful thing you can send.', body: contactBody },
];

for (const p of PAGES) {
  fs.mkdirSync(path.join(ROOT, p.slug), { recursive: true });
  fs.writeFileSync(path.join(ROOT, p.slug, 'index.html'), shell(p));
}
console.log(`  ✓ ${PAGES.map((p) => '/' + p.slug).join(', ')}  (trust + utility pages)`);
