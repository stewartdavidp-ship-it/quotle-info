'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const A = require('../assets/audience');
const C = require('../assets/challenge');
const T = require('./template');
const { questionFromRecord, validatePool } = require('./build-challenge');
const root = path.resolve(__dirname, '..');
const record = (slug) => JSON.parse(fs.readFileSync(path.join(root, 'data/quotes', slug + '.json')));
const pool = JSON.parse(fs.readFileSync(path.join(root, 'data/challenge-questions.json')));
const questions = pool.questions.map((e) => questionFromRecord(e, record(e.slug)));

test('the released question edition cannot silently change saved or shared daily sets', () => {
  assert.doesNotThrow(() => validatePool(pool));
  const changed = JSON.parse(JSON.stringify(pool)); changed.questions.pop();
  assert.throws(() => validatePool(changed), /frozen/);
});

test('uncertainty survives disputed confidence on a share card', () => {
  const r = record('its-too-early-to-tell');
  assert.equal(r.confidence, 'disputed');
  const card = T.shareCardData(r);
  assert.equal(card.rating, 3);
  assert.equal(card.verdict, 'Not confirmed');
  assert.match(card.answer, /not confirmed/);
  assert.match(card.claim, /Mao/);
});
test('same-author wording corrections keep the checked claim and source comparison', () => {
  const card = T.shareCardData(record('when-you-teach-a-child-something-you-take-away-forever-his'));
  assert.equal(card.rating, 2);
  assert.equal(card.verdict, 'Needs context');
  assert.match(card.claim, /exact popular wording/);
  assert.ok(card.comparison);
  assert.notEqual(card.comparison, card.quote);
});
test('copyright caveats and qualified credits are carried in the export payload', () => {
  const r = record('solitude-is-independence'), d = T.shareCardData(r);
  assert.equal(d.rights, T.plain(r.source.rightsNote));
  assert.match(d.rights, /translation/i);
  assert.equal(d.citation, T.plain(r.cite.sourceCitation));
  assert.match(d.url, /\/$/);
});
test('punctuation alone does not create a duplicate source-comparison block', () => {
  const d = T.shareCardData(record('your-body-is-not-a-temple-its-an-amusement-park-enjoy-the'));
  assert.equal(d.comparison, '');
});
test('share data cannot terminate its JSON script element', () => {
  const r = record('black-history-is-american-history');
  r.cite.sourceCitation = 'Source </script><script>alert(1)</script>';
  const html = T.renderPage(r);
  const match = /<script type="application\/json" id="quote-card-data">(.*?)<\/script>/.exec(html);
  assert.ok(match);
  assert.doesNotThrow(() => JSON.parse(match[1]));
  assert.ok(!match[1].includes('<'));
});
test('curated questions fail closed when a later correction changes the reviewed claim or rating', () => {
  const e = pool.questions[0], r = record(e.slug);
  r.schema.claimRatingValue = 3;
  assert.throws(() => questionFromRecord(e, r), /question changed/);
  const r2 = record(e.slug); r2.schema.claimReviewed = 'A different claim.';
  assert.throws(() => questionFromRecord(e, r2), /question changed/);
});
test('New York day boundaries remain correct across midnight and daylight saving changes', () => {
  assert.equal(C.dayInNewYork(new Date('2026-11-10T04:59:59Z')), '2026-11-09');
  assert.equal(C.dayInNewYork(new Date('2026-11-10T05:00:00Z')), '2026-11-10');
  assert.equal(C.dayInNewYork(new Date('2026-07-10T03:59:59Z')), '2026-07-09');
  assert.equal(C.dayInNewYork(new Date('2026-07-10T04:00:00Z')), '2026-07-10');
  assert.equal(C.dayInNewYork(new Date('2026-11-01T05:30:00Z')), '2026-11-01');
  assert.equal(C.dayInNewYork(new Date('2026-11-01T06:30:00Z')), '2026-11-01');
});
test('dated result links keep the shared set and reject invalid or future dates', () => {
  assert.equal(C.requestedDay('#v1/2026-11-09', '2026-11-12', pool.starts), '2026-11-09');
  for (const hash of ['#v1/2026-02-30', '#v1/2027-01-01', '#v1/2020-01-01', '#javascript:alert(1)', '#v2/2026-11-10']) assert.equal(C.requestedDay(hash, '2026-11-12', pool.starts), '2026-11-12');
});
test('a full year of daily sets is stable, diverse and independent of pool order', () => {
  for (let i = 0; i < 366; i++) {
    const day = new Date(Date.parse('2026-11-09T12:00:00Z') + i * 86400000).toISOString().slice(0, 10);
    const set = C.selectQuestions(questions, day, pool.version);
    assert.deepEqual(set, C.selectQuestions(questions.slice().reverse(), day, pool.version));
    assert.equal(new Set(set.map((q) => q.slug)).size, 3);
    assert.equal(new Set(set.map((q) => q.authorKey)).size, 3);
    assert.ok(new Set(set.map((q) => q.answer)).size >= 2);
  }
});
test('malformed saved state is discarded and scores are derived from choices', () => {
  for (const bad of [null, {}, { answers: ['__proto__'] }, { answers: [null] }, { answers: Array(4).fill('supported') }]) assert.deepEqual(C.cleanEntry(bad), { answers: [] });
  assert.equal(C.cleanEntry({ answers: ['supported'], completed: true }).completed, false);
  const set = C.selectQuestions(questions, '2026-11-09', 'v1');
  assert.equal(C.score(set, set.map((q) => q.answer)), 3);
  const text = C.shareText('2026-11-09', set, set.map((q) => q.answer));
  assert.match(text, /3\/3/);
  for (const q of set) { assert.ok(!text.includes(q.claim)); assert.ok(!text.includes(q.explanation)); }
});
test('image wrapping preserves long URLs and all qualifier text instead of clipping', () => {
  const ctx = { measureText: (s) => ({ width: Array.from(s).length * 10 }) };
  const text = 'Not confirmed. ' + 'https://quotle.info/who-said/' + 'long-'.repeat(35);
  const lines = A.wrap(ctx, text, 400);
  assert.ok(lines.every((l) => ctx.measureText(l).width <= 400));
  assert.equal(lines.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.throws(() => A.layout(ctx, { claim: 'long '.repeat(12000), answer: '', citation: '', url: '', verdict: '', rights: '' }), /more space/);
});
test('campaign links retain the canonical path and dated fragment', () => {
  const u = new URL(A.shareUrl('https://quotle.info/challenge/#v1/2026-11-09', 'challenge'));
  assert.equal(u.pathname, '/challenge/'); assert.equal(u.hash, '#v1/2026-11-09'); assert.equal(u.searchParams.get('via'), 'challenge');
});
test('analytics is allowlisted, does not run in previews and honors Do Not Track', () => {
  const script = fs.readFileSync(path.join(root, 'assets/audience.js'), 'utf8');
  function context(hostname, dnt) {
    const events = [], sandbox = { module: { exports: {} }, window: { location: { hostname }, navigator: { doNotTrack: dnt }, goatcounter: { count: (e) => events.push(e) } } };
    vm.runInNewContext(script, sandbox); return { events, api: sandbox.module.exports };
  }
  const live = context('quotle.info'); live.api.track('card-download'); live.api.track('private-user-input');
  assert.equal(live.events.length, 1); assert.equal(live.events[0].path, 'card-download'); assert.equal(live.events[0].event, true);
  assert.deepEqual(Object.keys(live.events[0]).sort(), ['event', 'path', 'title']);
  for (const env of [context('localhost'), context('quotle.info', '1')]) { env.api.track('card-download'); assert.equal(env.events.length, 0); }
});
