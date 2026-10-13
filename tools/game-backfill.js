// One-off: seed data/game/fields.json from the Quotle game's built-in quote list, so the 445 quotes
// already in the game keep their exact clues, index and author spelling.
// Usage: node tools/game-backfill.js /path/to/gameshelf/quotle/index.html
const fs = require('fs');
const path = require('path');
const { save, problems } = require('./game-fields');

const html = fs.readFileSync(process.argv[2], 'utf8');
const a = html.indexOf('const allQuotes = [');
const b = html.indexOf('];', a);
const game = eval(html.slice(a + 'const allQuotes = '.length, b + 1)); // the game's own literal
const byIndex = new Map(game.map(q => [q.index, q]));

const dir = path.join(__dirname, '..', 'data', 'quotes');
const fields = {};
for (const f of fs.readdirSync(dir)) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const q = r.dayNumber != null && byIndex.get(r.dayNumber);
  if (!q) continue;
  fields[r.quoteSlug] = {
    index: q.index, text: q.text, author: q.author, gender: q.gender, category: q.category, period: q.period,
    difficulty: q.difficulty, hint: q.hint, location: q.location, year: String(q.year), play: q.verified === true,
  };
}
const bad = Object.entries(fields).flatMap(([s, f]) => problems(s, f));
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
save(fields);
console.log('seeded', Object.keys(fields).length, 'quotes;', Object.values(fields).filter(f => f.play).length, 'playable');
