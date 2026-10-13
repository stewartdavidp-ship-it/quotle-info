// Publish /data/game/feed.json — the Quotle game's quotes and daily schedule.
//
// The game (gameshelf.co/quotle) fetches this at load, so quotes published here reach the game
// without editing the game. Deterministic: reads only committed files (fields.json, schedule.json,
// the records), so CI's "committed output matches the generators" check holds.
//
// Exits 1 (build fails) on any of:
//   - a field entry with a missing or out-of-vocabulary value (tools/game-fields.js)
//   - two quotes sharing a game index
//   - one author with different name/gender/category/period across quotes (the game compares
//     the guessed author's first quote, so these must agree)
//   - a scheduled day that isn't a playable quote
//   - a day that is past, or inside the committed lock window, differing from the committed schedule
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { load, problems } = require('./game-fields');
const { FILE: SCHEDULE, addDays } = require('./game-schedule');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'game', 'feed.json');
const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, m => ({ '&amp;': '&', '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”', '&mdash;': '—', '&ndash;': '–' }[m] || ' ')).replace(/\s+/g, ' ').trim();

function build() {
  const errors = [];
  const fields = load();
  const schedule = JSON.parse(fs.readFileSync(SCHEDULE, 'utf8'));
  const records = new Map();
  for (const f of fs.readdirSync(path.join(ROOT, 'data', 'quotes'))) {
    const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'quotes', f), 'utf8'));
    records.set(r.quoteSlug, r);
  }

  const seen = new Map();
  const authors = new Map();
  const quotes = [];
  for (const [slug, f] of Object.entries(fields)) {
    errors.push(...problems(slug, f));
    const r = records.get(slug);
    if (!r) { errors.push(slug + ': no record'); continue; }
    if (seen.has(f.index)) errors.push(`index ${f.index}: ${seen.get(f.index)} and ${slug}`);
    seen.set(f.index, slug);
    const aSlug = r.author && r.author.slug;
    // keyed on the game's author name: that is what the game groups guesses by. (Quotes the game
    // credits to someone other than quotle.info's research are play:false, so the names can differ.)
    const sig = [f.gender, f.category, f.period].join('|');
    if (authors.has(f.author) && authors.get(f.author) !== sig) errors.push(`author ${f.author}: "${authors.get(f.author)}" vs "${sig}"`);
    else authors.set(f.author, sig);
    if (!f.play) continue;
    quotes.push({
      index: f.index, slug, text: f.text || strip(r.displayQuote), author: f.author, authorSlug: aSlug || null,
      gender: f.gender, category: f.category, period: f.period, difficulty: f.difficulty,
      hint: f.hint, location: f.location, year: f.year,
    });
  }
  quotes.sort((a, b) => a.index - b.index);
  const playable = new Set(quotes.map(q => q.index));
  schedule.days.forEach((i, n) => { if (!playable.has(i)) errors.push(`schedule ${addDays(schedule.from, n)}: ${i} is not a playable quote`); });

  // locked and past days must match what is committed (catches hand edits before they ship)
  let committed = null;
  try { committed = JSON.parse(execSync('git show HEAD:data/game/schedule.json', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString()); } catch (e) {}
  if (committed) {
    const today = new Date().toISOString().slice(0, 10);
    const frozenThrough = [committed.lockedThrough, addDays(today, -1)].sort().pop();
    if (committed.from !== schedule.from) errors.push(`schedule.from changed: ${committed.from} → ${schedule.from}`);
    committed.days.forEach((i, n) => {
      const date = addDays(committed.from, n);
      if (date <= frozenThrough && schedule.days[n] !== i) errors.push(`schedule ${date} is locked: ${i} → ${schedule.days[n]}`);
    });
  }

  if (errors.length) {
    console.error('✗ game feed:\n  ' + errors.slice(0, 40).join('\n  ') + (errors.length > 40 ? `\n  …and ${errors.length - 40} more` : ''));
    process.exit(1);
  }
  const feed = { version: 1, from: schedule.from, lockedThrough: schedule.lockedThrough, days: schedule.days, quotes };
  fs.writeFileSync(OUT, JSON.stringify(feed) + '\n');
  const ahead = addDays(schedule.from, schedule.days.length - 1);
  console.log(`✓ game feed: ${quotes.length} playable quotes, schedule ${schedule.from} → ${ahead}`);
}

if (require.main === module) build();
module.exports = { build };
