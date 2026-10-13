// List verified quotes that aren't in the Quotle game yet, with what the enrichment agent needs.
// Output feeds the agent pass in workflows/game/BRIEF.md; then tools/game-check.js, game-merge.js.
// Usage: node tools/game-todo.js > /tmp/game-todo.json
const fs = require('fs');
const path = require('path');
const { load } = require('./game-fields');

const fields = load();
const dir = path.join(__dirname, '..', 'data', 'quotes');
const recs = fs.readdirSync(dir).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const anon = n => !n || /anonym|unknown|proverb|various/i.test(n);

// authors already in the game keep their gender/category/period and spelling
const known = {};
for (const r of recs) {
  const f = fields[r.quoteSlug];
  if (f && r.author && r.author.slug) known[r.author.slug] = { name: f.author, gender: f.gender, category: f.category, period: f.period };
}
const todo = recs
  .filter(r => r.confidence === 'verified' && r.author && !anon(r.author.name) && !fields[r.quoteSlug])
  .map(r => ({
    slug: r.quoteSlug, quote: strip(r.displayQuote), author: r.author.name, authorSlug: r.author.slug,
    authorLine: strip(r.author.metaLine), source: strip(r.answer && r.answer.sourceLine).slice(0, 400),
    dateCreated: (r.schema && r.schema.dateCreated) || null, dayNumber: r.dayNumber || null,
    knownAuthor: known[r.author.slug] || null,
  }));
process.stdout.write(JSON.stringify(todo, null, 1) + '\n');
console.error(`${todo.length} verified quote(s) not yet in the game`);
