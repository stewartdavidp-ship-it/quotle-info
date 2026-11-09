#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { shareCardData } = require('./template');
const { HEAD_SCRIPT, THEME_CSS, SCRIPT, PREF_SYNC } = require('./a11y-widget');
const { ROOT_CSS } = require('./tokens');
const { NAV, CHROME_CSS, SEARCH_JS, FOOTER } = require('./chrome');
const { OG_IMAGE_TAGS } = require('./og');
const { standingUrl } = require('./urls');
const ROOT = path.resolve(__dirname, '..');
const V1_POOL_HASH = '4c8672a244477033ea77cf911c9c5f16e263faf9a4f13716c4e9a42f47266d77';

function validatePool(pool) {
  if (pool.version !== 'v1' || createHash('sha256').update(JSON.stringify(pool)).digest('hex') !== V1_POOL_HASH) {
    throw new Error('Challenge v1 is frozen: changing the pool changes already shared dated sets. Add a new edition while preserving v1.');
  }
}

function questionFromRecord(entry, record) {
  const fact = shareCardData(record);
  // Human-selected, scoped claims, NOT confidence-to-true/false classification. Stop if a later
  // editorial correction changes the claim or rating; the pool needs an explicit review then.
  if (fact.claim !== entry.claim || fact.rating !== entry.rating) throw new Error('Challenge question changed: ' + entry.slug + ' — review its claim and answer before rebuilding.');
  const ranges = { supported: [5], misquoted: [1, 2], unconfirmed: [3] };
  if (!ranges[entry.answer] || !ranges[entry.answer].includes(fact.rating)) throw new Error('Challenge answer contradicts the page: ' + entry.slug);
  if (!fact.answer || !fact.citation) throw new Error('Challenge question needs an explanation and source: ' + entry.slug);
  return { slug: entry.slug, claim: fact.claim, answer: entry.answer, explanation: fact.answer, url: fact.url, authorKey: record.author.slug };
}

function build() {
  const pool = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/challenge-questions.json'), 'utf8'));
  validatePool(pool);
  if (pool.version !== 'v1' || !/^\d{4}-\d{2}-\d{2}$/.test(pool.starts)) throw new Error('Invalid challenge edition');
  if (new Set(pool.questions.map((q) => q.slug)).size !== pool.questions.length) throw new Error('Duplicate challenge question');
  const questions = pool.questions.map((entry) => questionFromRecord(entry, JSON.parse(fs.readFileSync(path.join(ROOT, 'data/quotes', entry.slug + '.json'), 'utf8'))));
  for (const a of ['supported', 'misquoted', 'unconfirmed']) if (questions.filter((q) => q.answer === a).length < 3) throw new Error('Challenge needs at least three reviewed questions per answer');
  const payload = JSON.stringify({ version: pool.version, starts: pool.starts, questions }).replace(/</g, '\\u003c');
  const url = standingUrl('challenge');
  const html = `<!DOCTYPE html>
<html lang="en"><head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
${HEAD_SCRIPT}
    <title>Real or misquoted? The daily quote challenge · Quotle.info</title>
    <meta name="description" content="Three claims. Can you spot the real quotes, misquotes and unconfirmed attributions? Play the free daily challenge, then see the sources.">
    <link rel="canonical" href="${url}">
    <meta property="og:url" content="${url}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="Real or misquoted? Three claims. How many can you spot?">
    <meta property="og:description" content="A free daily quote challenge with source-backed reveals. Share your score, keep the answers a surprise.">
${OG_IMAGE_TAGS}
    <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', '@id': url, url, name: 'Real or misquoted? The daily quote challenge', description: 'Three researched attribution claims each day, with explanations and links to the evidence.', publisher: { '@type': 'Organization', name: 'Quotle.info', url: 'https://quotle.info/' } })}</script>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Source+Serif+4:wght@400;600&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/audience.css">
    <style>${ROOT_CSS}\n${CHROME_CSS}
    *{box-sizing:border-box}body{margin:0;background:var(--bg-deep);color:var(--ink);font:400 1rem/1.65 'Source Serif 4',Georgia,serif}a{color:inherit}button{font:inherit}h1,h2,p{margin-top:0}
    </style>
${THEME_CSS}
    <script src="/assets/audience.js" defer></script>
    <script src="/assets/challenge.js" defer></script>
</head><body>
${NAV('challenge')}
    <main class="challenge-main" id="main">
        <header>
            <p class="challenge-kicker">The daily quote challenge</p>
            <h1>Real or misquoted?</h1>
            <p class="lede">Three claims. Trust your instinct, then check the evidence.</p>
            <p class="challenge-meta">A new set every day at midnight in New York. No account needed.</p>
        </header>
        <div id="challenge-new-day" class="challenge-new-day" hidden>A new challenge is ready. <a href="/challenge/">Play today&rsquo;s set</a></div>
        <div id="challenge-root"><p>Loading the daily challenge&hellip; <a href="/who-said/">Explore the researched quotes</a>.</p></div>
        <noscript><p>The challenge needs JavaScript. You can still <a href="/who-said/">browse the researched quotes</a> and read every source.</p></noscript>
        <p class="challenge-status" id="challenge-status" role="status" aria-live="polite"></p>
        <p class="challenge-note">We check the specific claim shown, including who said it and whether those are the exact words. &ldquo;Not confirmed&rdquo; means the evidence is incomplete &mdash; it does not mean fake. Every reveal links to the research. <a href="/how-we-verify/">How we verify</a>.</p>
    </main>
${FOOTER}
    <script type="application/json" id="challenge-data">${payload}</script>
${SEARCH_JS}
${SCRIPT}
${PREF_SYNC}
</body></html>\n`;
  fs.mkdirSync(path.join(ROOT, 'challenge'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'challenge/index.html'), html);
  console.log('  ✓ /challenge/ (' + questions.length + ' reviewed claims; edition ' + pool.version + ')');
}
if (require.main === module) build();
module.exports = { build, questionFromRecord, validatePool };
