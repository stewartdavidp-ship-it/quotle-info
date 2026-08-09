#!/usr/bin/env node
'use strict';
/*
 * build-themes.js — make the verified corpus discoverable by INTENT/theme:
 *   themes/index.html        → quotle.info/themes/         (browse all themes)
 *   themes/{slug}/index.html → quotle.info/themes/{slug}/  (verified quotes on a theme + famous fakes)
 *   themes.json              → machine-readable index for AI/agents building decks
 *
 * Reads record.themes (slugs from tools/themes.js, written by workflows/tag-themes.js). Each theme
 * page leads with the usable quotes (verified + attributed, linking to the detail page where the
 * presentation kit lives) and, on-brand, a "commonly shared but misattributed" strip of the fakes
 * tied to that theme. Uses the shared chrome/tokens. Run by tools/build.js.
 */
const fs = require('fs');
const path = require('path');
const { HEAD_SCRIPT, THEME_CSS, CONTROL, SCRIPT, PREF_SYNC } = require('./a11y-widget');
const { ROOT_CSS } = require('./tokens');
const { esc } = require('./esc');
const { CONFIDENCE } = require('./template');
const { primaryCredit, namesCredit } = require('./credits'); // creditedTo: string OR array — cards show the primary
const { NAV: siteNav, CHROME_CSS, SEARCH_JS, FOOTER } = require('./chrome');
const { THEMES, THEME_BY_SLUG, isTheme } = require('./themes');
const { OG_IMAGE_TAGS } = require('./og'); // the one shared social-card image

const ROOT = path.resolve(__dirname, '..');
const QUOTES_DIR = path.join(ROOT, 'data', 'quotes');
const OUT = path.join(ROOT, 'themes');
const ORIGIN = 'https://quotle.info';

const plain = (s) => String(s || '').replace(/<[^>]+>/g, '')
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&middot;/g, '·')
  .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&lsquo;/g, '‘').replace(/&rsquo;/g, '’')
  .replace(/&hellip;/g, '…').replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
  .replace(/&([a-z]+);/g, (m, e) => ({ amp: '&', quot: '"', lt: '<', gt: '>' }[e] || m))
  .replace(/\s+/g, ' ').trim();
const jsonLd = (obj) => JSON.stringify(obj, null, 2).split('\n').map((l, i) => (i === 0 ? l : '    ' + l)).join('\n');

const records = fs.readdirSync(QUOTES_DIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(QUOTES_DIR, f), 'utf8')));

// Read-only join to the harvest queue for demandScore/harvestedOn, which order the capped fakes
// strip — see the note on orderedFakes() below. resultSlug (the built record's slug, when the wave
// renamed it) wins over the candidate's own slug.
const QUEUE_BY_SLUG = {};
for (const c of JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'harvest-queue.json'), 'utf8')).candidates || []) {
  for (const k of [c.slug, c.resultSlug]) if (k) QUEUE_BY_SLUG[k] = c;
}

// theme slug -> { real: [usable quotes], fake: [misattributed quotes] }
const byTheme = {};
for (const t of THEMES) byTheme[t.slug] = { real: [], fake: [] };
for (const r of records) {
  const themes = Array.isArray(r.themes) ? r.themes.filter(isTheme) : [];
  if (!themes.length) continue;
  // Who really said it — answer.realAuthorName first (see the note on it in template.js). A disputed
  // record's answer.authorName is often the FALSELY CREDITED name, and a theme page listing a fake
  // quote under the fake author's byline asserts the very misattribution the entry exists to flag.
  const who = plain((r.answer && (r.answer.realAuthorName || r.answer.authorName)) || (r.author && r.author.name) || 'Unknown');
  const hq = QUEUE_BY_SLUG[r.quoteSlug] || {};
  const entry = {
    slug: r.quoteSlug, quote: plain(r.displayQuote), author: who,
    confidence: r.confidence, rights: (r.source && r.source.rights) || null,
    credited: primaryCredit(r) ? plain(primaryCredit(r)) : null, // the PRIMARY false credit — theme cards show one name
    demandScore: hq.demandScore != null ? hq.demandScore : null, // ordering only — not rendered, not exported
    harvestedOn: hq.harvestedOn || null,
  };
  const bucket = r.confidence === 'disputed' ? 'fake' : 'real';
  for (const th of themes) byTheme[th][bucket].push(entry);
}
// sort usable quotes verified-first
const rank = { verified: 0, attributed: 1, disputed: 2 };
for (const s of Object.keys(byTheme)) {
  byTheme[s].real.sort((a, b) => (rank[a.confidence] - rank[b.confidence]) || a.quote.localeCompare(b.quote));
}

const STYLE = `${ROOT_CSS}
        * { margin:0; padding:0; box-sizing:border-box; }
        html { scroll-behavior:smooth; -webkit-font-smoothing:antialiased; }
        body { font-family:'Source Serif 4',Georgia,serif; background:var(--bg-deep); color:var(--ink); line-height:1.7; overflow-x:hidden; }
        a { color:inherit; }
        a:focus-visible, button:focus-visible { outline:2px solid var(--sage); outline-offset:3px; border-radius:4px; }
        .breadcrumb { max-width:900px; margin:0 auto; padding:14px 24px 0; font-family:'DM Sans',sans-serif; font-size:0.75rem; color:var(--text-muted); }
        .breadcrumb a { text-decoration:none; } .breadcrumb a:hover { color:var(--slate); }
        .breadcrumb .sep { margin:0 7px; opacity:0.6; }
        main { max-width:900px; margin:0 auto; padding:8px 24px 60px; }
        .kicker { font-family:'DM Sans',sans-serif; text-transform:uppercase; font-size:0.7rem; font-weight:600; letter-spacing:0.2em; color:var(--burgundy); margin-bottom:14px; }
        .sec-head { margin:44px 0 18px; }
        .sec-head h2 { font-family:'Playfair Display',serif; font-weight:900; font-size:1.6rem; letter-spacing:-0.015em; }
        .sec-sub { font-family:'DM Sans',sans-serif; font-size:0.9rem; color:var(--text-muted); margin-top:8px; max-width:640px; }
        .idx-hero { padding:40px 0 4px; }
        .idx-hero h1 { font-family:'Playfair Display',serif; font-weight:900; font-size:clamp(2.1rem,6vw,3rem); line-height:1.05; letter-spacing:-0.02em; }
        .idx-hero .lede { font-size:1.05rem; color:var(--slate); margin-top:14px; max-width:660px; }
        .idx-hero .lede b { color:var(--sage); }
        /* theme index cards */
        .theme-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:12px; margin-top:32px; }
        .tc { display:flex; flex-direction:column; gap:7px; text-decoration:none; background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:20px 22px; transition:transform 0.2s,border-color 0.2s; }
        .tc:hover { transform:translateY(-3px); border-color:var(--border-accent); }
        .tc-name { font-family:'Playfair Display',serif; font-weight:700; font-size:1.15rem; color:var(--ink); }
        .tc-blurb { font-family:'DM Sans',sans-serif; font-size:0.82rem; color:var(--text-muted); line-height:1.5; }
        .tc-count { font-family:'DM Sans',sans-serif; font-size:0.72rem; font-weight:600; color:var(--slate); margin-top:4px; }
        .tc-pd { color:var(--sage); }
        /* theme hero */
        .theme-hero { padding:34px 0 4px; }
        .theme-hero h1 { font-family:'Playfair Display',serif; font-weight:900; font-size:clamp(2rem,6vw,2.8rem); line-height:1.05; letter-spacing:-0.02em; }
        .theme-hero .lede { font-size:1.05rem; color:var(--slate); margin-top:12px; max-width:660px; }
        .theme-note { font-family:'DM Sans',sans-serif; font-size:0.85rem; color:var(--text-muted); margin-top:16px; max-width:660px; padding:12px 16px; background:var(--cream); border-left:2px solid var(--gold); border-radius:0 8px 8px 0; }
        /* quote grid + cards (shared look with author pages) */
        .q-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
        .q-card { display:flex; flex-direction:column; gap:14px; text-decoration:none; background:var(--bg-card); border:1px solid var(--border); border-left:3px solid var(--border); border-radius:12px; padding:20px 22px; transition:transform 0.2s,border-color 0.2s; }
        .q-card:hover { transform:translateY(-3px); }
        .q-card.verified { border-left-color:var(--sage); } .q-card.attributed { border-left-color:var(--amber); }
        .q-text { font-style:italic; font-size:1.05rem; color:var(--ink); }
        .q-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:auto; }
        .q-author { font-family:'DM Sans',sans-serif; font-size:0.82rem; font-weight:600; color:var(--slate); }
        .q-conf { display:inline-flex; align-items:center; gap:7px; font-family:'DM Sans',sans-serif; font-weight:600; font-size:0.72rem; }
        .q-conf .dot { width:15px; height:15px; border-radius:50%; display:grid; place-items:center; font-size:0.6rem; font-weight:700; color:var(--bg-deep); }
        .q-card.verified .q-conf { color:var(--sage); } .q-card.verified .dot { background:var(--sage); }
        .q-card.attributed .q-conf { color:var(--amber); } .q-card.attributed .dot { background:var(--amber); }
        .q-use-row { margin-top:2px; }
        .q-use { display:inline-flex; align-items:center; font-family:'DM Sans',sans-serif; font-size:0.68rem; font-weight:700; letter-spacing:0.03em; padding:3px 9px; border-radius:999px; }
        .q-use.pd { color:var(--sage); background:rgba(126,179,139,0.14); }
        .q-use.ic { color:var(--amber); background:rgba(212,160,90,0.12); }
        .q-use.unk { color:var(--text-muted); background:var(--bg-elevated); }
        /* commercial-use toggle */
        .theme-tools { margin:0 0 16px; }
        .pd-toggle { display:inline-flex; align-items:center; gap:9px; font-family:'DM Sans',sans-serif; font-size:0.85rem; color:var(--slate); cursor:pointer; padding:9px 15px; background:var(--bg-card); border:1px solid var(--border); border-radius:999px; }
        .pd-toggle:hover { border-color:var(--border-accent); }
        .pd-toggle input { accent-color:var(--sage); width:15px; height:15px; }
        .pd-toggle b { color:var(--sage); font-weight:700; }
        .q-grid.pd-only .q-card[data-pd="0"] { display:none; }
        .pd-empty { font-family:'DM Sans',sans-serif; font-size:0.9rem; color:var(--text-muted); margin-top:14px; }
        /* fakes strip */
        .mis-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
        .mis-card { display:flex; flex-direction:column; gap:10px; text-decoration:none; background:linear-gradient(135deg,var(--burgundy-glow),transparent); border:1px solid rgba(212,98,122,0.25); border-radius:12px; padding:18px 20px; transition:transform 0.2s; }
        .mis-card:hover { transform:translateY(-3px); }
        .mis-q { font-style:italic; font-size:1rem; color:var(--ink); }
        .mis-real { font-family:'DM Sans',sans-serif; font-size:0.82rem; font-weight:600; color:var(--sage); margin-top:auto; }
        .mis-lbl { color:var(--text-muted); font-weight:500; text-transform:uppercase; font-size:0.66rem; letter-spacing:0.12em; margin-right:6px; }
        footer { text-align:center; padding:40px 24px; color:var(--text-muted); font-family:'DM Sans',sans-serif; font-size:0.8rem; border-top:1px solid var(--border); margin-top:48px; }
        footer a { color:var(--burgundy-link); text-decoration:none; }
        @media (prefers-reduced-motion: reduce) { html { scroll-behavior:auto; } * { transition:none !important; } }`;


// RIGHT PERSON, WRONG WORDS. When the real author IS the name it is credited to, "Really Edison
// &middot; not Edison" is gibberish — and it appeared on /themes/failure/, a page whose entire job is
// establishing credibility. A researcher said it made them briefly distrust the whole list; the
// underlying quote pages were fine, so this was purely a listing-template bug.
//
// template.js already solved this shape for the JSON-LD verdict: the dispute is about the WORDING,
// not the attribution. Say that, rather than dropping the tail and leaving the row looking like an
// ordinary correct attribution sitting in a misattributed list.
//
// The near-miss of the same shape — an author string that CONTAINS the credit rather than equalling
// it ("Unknown — not Benjamin Franklin", "Lao Tzu (misattributed)") — is namesCredit's job; see the
// note on it in credits.js. When the line already draws the contrast in its own words, ALL the
// chrome stands down, kicker included: "Really Lao Tzu (misattributed)" contradicts itself just as
// loudly as the duplicated tail does.
function misReal(q) {
  const same = String(q.author || '').trim().toLowerCase() === String(q.credited || '').trim().toLowerCase();
  if (q.credited && same) return `<span class="mis-lbl">Really</span>${esc(q.author)} &middot; but not in these words`;
  if (namesCredit(q.author, q.credited)) return esc(q.author);
  const tail = q.credited ? ` &middot; not ${esc(q.credited)}` : '';
  return `<span class="mis-lbl">Really</span>${esc(q.author)}${tail}`;
}

function page(inner, headExtra, active) {
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
${siteNav(active)}
${inner}
${FOOTER}
${SEARCH_JS}
${SCRIPT}${PREF_SYNC}
</body>
</html>
`;
}

const realCard = (q) => {
  const c = CONFIDENCE[q.confidence] || CONFIDENCE.verified;
  const pd = q.rights === 'public-domain';
  const use = pd
    ? '<span class="q-use pd" title="Public domain — free to reuse, including commercially">&check; Free to use</span>'
    : (q.rights === 'in-copyright'
      ? '<span class="q-use ic" title="In copyright — a short credited quote is usually fine for talks; get permission for commercial reuse">&copy; In copyright</span>'
      : '<span class="q-use unk" title="Rights not established — present as an unverified line">Rights unverified</span>');
  return `                <a class="q-card ${c.cls}" href="/who-said/${q.slug}/" data-pd="${pd ? 1 : 0}">
                    <p class="q-text">&ldquo;${esc(q.quote)}&rdquo;</p>
                    <div class="q-foot"><span class="q-author">${esc(q.author)}</span><span class="q-conf"><span class="dot" aria-hidden="true">${c.glyph}</span>${esc(c.text)}</span></div>
                    <div class="q-use-row">${use}</div>
                </a>`;
};
const fakeCard = (q) => `                <a class="mis-card" href="/who-said/${q.slug}/">
                    <p class="mis-q">&ldquo;${esc(q.quote)}&rdquo;</p>
                    <p class="mis-real">${misReal(q)}</p>
                </a>`;

// ---- ordering the capped fakes strip (2026-08-09) ----------------------------------------------
// The strip caps at 18 and the bucket used to be UNSORTED — insertion order, i.e. alphabetical by
// record filename — so on busy themes a new record could be correctly tagged and never render:
// measured on the d20260809 wave, two of its three records landed at positions 30–167 (wisdom
// carries 210 disputed entries, character 131, truth 126) while apply-tags reported 3/3 with the
// completeness gate green. The loss was invisible to every existing check. The cap now chooses
// deliberately:
//   * 12 DEMAND slots — highest harvest demandScore first. "Commonly shared but misattributed"
//     should lead with the fakes people actually meet; the score exists on 152 of 833 disputed
//     records (the deliberately-harvested high-demand tracks — 42 on wisdom alone, so demand alone
//     would still bury every new record, which is why it does not get all 18).
//   * 6 FRESHNESS slots — the rest by harvestedOn, newest first (present on 100% of queue-joined
//     records; the ~174 pre-queue records sort last, they had their run on the old alphabet).
// Slug is the final tiebreak in both — output must be deterministic or CI's stale-output gate
// flakes. themes.json is untouched: it always carried the FULL list.
const DEMAND_SLOTS = 12, FAKE_CAP = 18;
const bySlug = (a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
function orderedFakes(fake) {
  const demand = fake.filter((q) => q.demandScore != null)
    .sort((a, b) => (b.demandScore - a.demandScore) || bySlug(a, b)).slice(0, DEMAND_SLOTS);
  const taken = new Set(demand.map((q) => q.slug));
  const fresh = fake.filter((q) => !taken.has(q.slug))
    .sort((a, b) => String(b.harvestedOn || '').localeCompare(String(a.harvestedOn || '')) || bySlug(a, b));
  return demand.concat(fresh).slice(0, FAKE_CAP);
}

// ---- per-theme pages ----
fs.mkdirSync(OUT, { recursive: true });
let pageCount = 0;
const indexCards = [];
const jsonIndex = [];

for (const t of THEMES) {
  const b = byTheme[t.slug];
  const real = b.real, fake = b.fake;
  if (!real.length && !fake.length) continue; // no page for an untagged theme
  pageCount++;

  const url = `${ORIGIN}/themes/${t.slug}/`;
  const headExtra = `    <title>Verified quotes about ${esc(t.label)} | Quotle.info</title>
    <meta name="description" content="Provenance-checked quotes about ${esc(t.label.toLowerCase())} — correctly credited, with rights cleared for reuse and image directions. ${esc(t.blurb)}">
    <link rel="canonical" href="${url}">
    <meta property="og:title" content="Verified quotes about ${esc(t.label)}">
    <meta property="og:description" content="${esc(t.blurb)} Correctly credited, rights-cleared, presentation-ready.">
    <meta property="og:url" content="${url}">
${OG_IMAGE_TAGS}
    <script type="application/ld+json">
    ${jsonLd({
      '@context': 'https://schema.org', '@type': 'CollectionPage',
      '@id': url + '#page', url, name: `Verified quotes about ${t.label}`, description: t.blurb,
      isPartOf: { '@type': 'WebSite', name: 'Quotle.info', url: ORIGIN },
      mainEntity: {
        '@type': 'ItemList', numberOfItems: real.length,
        itemListElement: real.slice(0, 25).map((q, i) => ({
          '@type': 'ListItem', position: i + 1,
          item: { '@type': 'Quotation', text: q.quote, creator: { '@type': 'Person', name: q.author }, url: `${ORIGIN}/who-said/${q.slug}/` },
        })),
      },
    })}
    </script>`;

  const pdReal = real.filter((q) => q.rights === 'public-domain').length;
  const pdToggle = pdReal ? `
            <div class="theme-tools"><label class="pd-toggle"><input type="checkbox" id="pdonly"> Only quotes <b>cleared for commercial use</b> (${pdReal} of ${real.length})</label></div>` : '';
  const realSection = real.length ? `
        <section aria-labelledby="real-h">
            <div class="sec-head"><p class="kicker">Ready for your slide</p><h2 id="real-h">Verified quotes about ${esc(t.label.toLowerCase())}</h2>
            <p class="sec-sub">Each is traced to a real source and correctly credited. <b>&check; Free to use</b> = public domain, cleared for commercial reuse. Open one for a paste-ready credit line and its reuse status.</p></div>${pdToggle}
            <div class="q-grid" id="real-grid">
${real.map(realCard).join('\n')}
            </div>
            <p class="pd-empty" id="pd-empty" hidden>No public-domain quotes on this theme yet &mdash; try another, or use an in-copyright one with attribution.</p>
        </section>
        <script>(function(){var cb=document.getElementById('pdonly'),g=document.getElementById('real-grid'),e=document.getElementById('pd-empty');if(!cb||!g)return;cb.addEventListener('change',function(){g.classList.toggle('pd-only',cb.checked);if(e){var any=g.querySelector('.q-card[data-pd="1"]');e.hidden=!(cb.checked&&!any);}});})();</script>` : '';

  const fakeSection = fake.length ? `
        <section aria-labelledby="fake-h">
            <div class="sec-head"><p class="kicker">Don&rsquo;t get caught out</p><h2 id="fake-h">Commonly shared about ${esc(t.label.toLowerCase())} &mdash; but misattributed</h2>
            <p class="sec-sub">Popular ${esc(t.label.toLowerCase())} lines that get pinned on the wrong name. If you use one, credit it correctly.</p></div>
            <div class="mis-grid">
${orderedFakes(fake).map(fakeCard).join('\n')}
            </div>
        </section>` : '';

  const inner = `    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span class="sep">›</span><a href="/themes/">Themes</a><span class="sep">›</span>${esc(t.label)}</nav>
    <main id="main">
        <div class="theme-hero">
            <p class="kicker">Theme</p>
            <h1>${esc(t.label)}</h1>
            <p class="lede">${esc(t.blurb)}</p>
            <p class="theme-note">Every quote here is provenance-checked. AI will happily put a fake quote on a beautiful slide &mdash; these are the ones you can actually use, with the right name on them.</p>
        </div>
${realSection}${fakeSection}
    </main>`;

  fs.mkdirSync(path.join(OUT, t.slug), { recursive: true });
  fs.writeFileSync(path.join(OUT, t.slug, 'index.html'), page(inner, headExtra, 'themes'));

  indexCards.push({ slug: t.slug, label: t.label, blurb: t.blurb, count: real.length, pd: real.filter((q) => q.rights === 'public-domain').length });
  // Agent channel: order the verified list PUBLIC-DOMAIN first, so a deck-building agent grabs a
  // commercially-safe quote by default (the usefulness test's #10 tail risk was steering toward a
  // worse-to-reuse pick). `rights` is carried per quote so an agent can still filter precisely.
  const jsonReal = [...real].sort((a, b) => (a.rights === 'public-domain' ? 0 : 1) - (b.rights === 'public-domain' ? 0 : 1));
  jsonIndex.push({
    theme: t.slug, label: t.label, url: `${ORIGIN}/themes/${t.slug}/`,
    verified: jsonReal.map((q) => ({ quote: q.quote, author: q.author, url: `${ORIGIN}/who-said/${q.slug}/`, confidence: q.confidence, rights: q.rights, clearedForCommercialUse: q.rights === 'public-domain' })),
    misattributed: fake.map((q) => ({ quote: q.quote, reallyBy: q.author, oftenCreditedTo: q.credited, url: `${ORIGIN}/who-said/${q.slug}/` })),
  });
}

// ---- /themes/ index ----
// The HUMAN browse is ALPHABETICAL; the MACHINE index below stays depth-first. That split is
// deliberate — they have different readers.
//
// This page used to be depth-ordered too, and depth was itself a fix: the original order was the
// vocabulary's declaration order, i.e. the sequence someone typed the themes in (themes.js still
// says "to add a theme: append here", so it decays into authoring chronology), which put wisdom —
// the deepest shelf — at position 9 while failure, the thinnest, held a first-row slot. Do NOT go
// back to that.
//
// But depth had a defect of its own: it is INVISIBLE. A reader's default hypothesis for a list of
// 28 single-word labels is A–Z. They don't get "sorted by number of verified quotes" unless they
// stop and read the counts on every card and infer it — so what they actually notice is that the
// list is NOT alphabetical, with no apparent rule in its place. An order you have to
// reverse-engineer is worse than either option done legibly.
//
// The cost of switching is smaller than it looks, because A–Z happens to open strong here: the
// first row is Change (30) / Character (68) / Courage (56), averaging 51 verified quotes against
// a 34.9 corpus average. Per-card counts still show depth, so nothing is hidden — only the
// ordering rule changes, to the one nobody has to be told.
//
// Sorting by AUTHORS was considered and rejected: it correlates 0.987 with quote count (mean rank
// displacement 1.5 places, identical top 6). It is the same list, not a second view.
//
// Tie-break on slug: the built HTML is COMMITTED, so an unstable sort would churn the diff (and
// the wave/generator merge order) on every rebuild.
indexCards.sort((a, b) => a.label.localeCompare(b.label) || a.slug.localeCompare(b.slug));
// themes.json is the agent-facing discovery index (advertised in llms.txt, linked by the Worker).
// A machine picking a shelf to build a deck from wants the DEEPEST first and has no alphabetical
// expectation to violate — so this one keeps depth ordering. The inconsistency is the point.
jsonIndex.sort((a, b) => (b.verified.length - a.verified.length) || a.theme.localeCompare(b.theme));

const idxHead = `    <title>Browse quotes by theme | Quotle.info</title>
    <meta name="description" content="Find a verified, correctly-credited quote for your talk or slide by theme — resilience, leadership, courage, and more. Provenance-checked and rights-cleared.">
    <link rel="canonical" href="${ORIGIN}/themes/">
    <meta property="og:title" content="Browse quotes by theme">
    <meta property="og:description" content="Find a verified, correctly-credited quote for your talk or slide by theme.">
    <meta property="og:url" content="${ORIGIN}/themes/">
${OG_IMAGE_TAGS}`;
const idxInner = `    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span class="sep">›</span>Themes</nav>
    <main id="main">
        <div class="idx-hero">
            <p class="kicker">Find the right one</p>
            <h1>Quotes by theme</h1>
            <p class="lede">Building a talk or a slide? Pick a theme and get <b>verified, correctly-credited</b> quotes &mdash; each with its reuse status and an image direction, so what you present is real and cleared to use.</p>
        </div>
        <div class="theme-grid">
${indexCards.map((c) => `            <a class="tc" href="/themes/${c.slug}/">
                <span class="tc-name">${esc(c.label)}</span>
                <span class="tc-blurb">${esc(c.blurb)}</span>
                <span class="tc-count">${c.count} verified ${c.count === 1 ? 'quote' : 'quotes'}${c.pd ? ` &middot; <span class="tc-pd">${c.pd} free to use</span>` : ''}</span>
            </a>`).join('\n')}
        </div>
    </main>`;
fs.writeFileSync(path.join(OUT, 'index.html'), page(idxInner, idxHead, 'themes'));

// ---- /themes.json (machine-readable discovery index) ----
fs.writeFileSync(path.join(ROOT, 'themes.json'), JSON.stringify(jsonIndex));

const totalReal = jsonIndex.reduce((s, t) => s + t.verified.length, 0);
console.log(`  ✓ themes/ (${pageCount} theme pages + index, ${totalReal} verified quote-tags) + themes.json`);
