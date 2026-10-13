// Plan the Quotle game's daily schedule: data/game/schedule.json = { from, lockedThrough, days[] },
// where days[i] is the game index of the quote for date `from` + i.
//
// The rule that protects players: a day that is past, or inside the lock window, never changes.
// Each run keeps every day up to max(previous lockedThrough, yesterday), re-plans everything after it
// from the playable pool (so quotes added since the last run get worked in), and moves the lock to
// today + LOCK_DAYS. build-game-feed.js fails the build if a locked or past day ever differs from
// the committed schedule.
//
// Planning: one cycle uses every playable quote once. Each day picks, among quotes not yet used this
// cycle, one whose author hasn't appeared in AUTHOR_GAP days (relaxed only if nothing qualifies),
// preferring a different category from the day before and quotes never played in the game before;
// ties break on a hash of the slug, so the plan is deterministic.
//
// Usage: node tools/game-schedule.js [--from YYYY-MM-DD] [--today YYYY-MM-DD]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { load } = require('./game-fields');

const FILE = path.join(__dirname, '..', 'data', 'game', 'schedule.json');
const LOCK_DAYS = 60;
const AUTHOR_GAP = 14;

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ymd = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);

function plan() {
  const today = arg('--today') || ymd(new Date());
  const fields = load();
  const playable = Object.entries(fields).filter(([, f]) => f.play).map(([slug, f]) => ({ slug, ...f }));
  const byIndex = new Map(playable.map(q => [q.index, q]));
  const prev = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
  const from = prev ? prev.from : (arg('--from') || today);

  // keep: locked days and anything already past (never re-plan a day someone may have played)
  const keepThrough = prev ? [prev.lockedThrough, addDays(today, -1)].sort().pop() : addDays(from, -1);
  const keepCount = prev ? Math.min(prev.days.length, Math.max(0, daysBetween(from, keepThrough) + 1)) : 0;
  const days = prev ? prev.days.slice(0, keepCount) : [];

  // "new" = never on the game's old built-in schedule (the game's 310 playable before the feed)
  const seenBefore = new Set(Object.values(fields).filter(f => f.index <= 471).map(f => f.index));
  const hash = s => crypto.createHash('sha1').update(s).digest('hex');

  // which quotes the current cycle has already used (cycles restart once every playable quote is used)
  let used = new Set();
  for (const i of days) { if (used.size >= byIndex.size) used = new Set(); used.add(i); }

  // Lay out one batch of quotes so categories are paced evenly through it (each category's quotes
  // sit at evenly spaced positions, at a per-category phase), authors are spaced evenly within a category, and
  // never-played-before quotes come early within their author. Deterministic.
  const layout = (batch, salt) => {
    const L = batch.length;
    const byCat = {};
    batch.forEach(q => (byCat[q.category] = byCat[q.category] || []).push(q));
    const placed = [];
    for (const [cat, qs] of Object.entries(byCat)) {
      const byAuthor = {};
      qs.forEach(q => (byAuthor[q.author] = byAuthor[q.author] || []).push(q));
      const lists = Object.values(byAuthor).map(l => l.sort((x, y) =>
        (seenBefore.has(x.index) - seenBefore.has(y.index)) || (hash(x.slug + salt) < hash(y.slug + salt) ? -1 : 1)));
      lists.sort((x, y) => (y.length - x.length) || (hash(x[0].slug + salt) < hash(y[0].slug + salt) ? -1 : 1));
      // each author's quotes evenly spaced through the category (so prolific authors don't pile up
      // at the end the way a plain round-robin leaves them)
      const slots = [];
      lists.forEach(l => {
        const ph = parseInt(hash(l[0].author + salt).slice(0, 8), 16) / 0xffffffff;
        l.forEach((q, j) => slots.push({ q, at: (j + ph) / l.length }));
      });
      slots.sort((x, y) => (x.at - y.at) || (hash(x.q.slug + salt) < hash(y.q.slug + salt) ? -1 : 1));
      const seq = slots.map(x => x.q);
      const phase = parseInt(hash(cat + salt).slice(0, 8), 16) / 0xffffffff;
      seq.forEach((q, k) => placed.push({ q, pos: (k + phase) / seq.length * L }));
    }
    placed.sort((x, y) => (x.pos - y.pos) || (hash(x.q.slug + salt) < hash(y.q.slug + salt) ? -1 : 1));
    return placed.map(x => x.q);
  };

  // Append a batch, repairing author spacing: if a quote's author appeared in the last AUTHOR_GAP
  // days, swap in the nearest later quote whose author didn't (best effort near a batch's end).
  const append = seq => {
    for (let i = 0; i < seq.length; i++) {
      const window = new Set(days.slice(-(AUTHOR_GAP - 1)).map(x => byIndex.get(x).author));
      if (window.has(seq[i].author)) {
        const j = seq.findIndex((q, k) => k > i && !window.has(q.author));
        if (j > 0) [seq[i], seq[j]] = [seq[j], seq[i]];
      }
      days.push(seq[i].index); used.add(seq[i].index);
    }
  };

  const total = Math.max(byIndex.size * 2, keepCount + LOCK_DAYS + 30); // ~two cycles ahead
  // finish the current cycle with what it hasn't used, then whole cycles
  let cycle = Math.floor(days.length / Math.max(1, byIndex.size));
  if (used.size < byIndex.size && days.length) append(layout(playable.filter(q => !used.has(q.index)), ':rest' + days.length));
  // whole cycles share one layout, so each quote comes back exactly one cycle later
  while (days.length < total) {
    used = new Set(); cycle++;
    append(layout(playable.slice(), ':layout'));
  }
  days.length = Math.max(days.length, 0);
  const lockedThrough = [prev ? prev.lockedThrough : '', addDays(today, LOCK_DAYS)].sort().pop();
  fs.writeFileSync(FILE, JSON.stringify({ from, lockedThrough, days }, null, 0) + '\n');
  console.log(`schedule: from ${from}, kept ${keepCount} day(s), planned through ${addDays(from, days.length - 1)}, locked through ${lockedThrough}`);
}

if (require.main === module) plan();
module.exports = { FILE, addDays, daysBetween };
