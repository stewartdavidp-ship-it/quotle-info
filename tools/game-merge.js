// Merge enrichment output (the agent pass described in workflows/README.md § "Quotle game fields")
// into data/game/fields.json. New quotes get a game index: their record's dayNumber if it has one,
// else the next free number above every index and dayNumber in use. Author names follow the game's
// existing spelling for authors already in the game.
// Usage: node tools/game-merge.js <todo.json> <enriched.json>
const fs = require('fs');
const path = require('path');
const { load, save, problems } = require('./game-fields');

const [todoF, outF] = process.argv.slice(2);
const todo = new Map(JSON.parse(fs.readFileSync(todoF, 'utf8')).map(t => [t.slug, t]));
const out = JSON.parse(fs.readFileSync(outF, 'utf8'));
const fields = load();
const decode = s => String(s).replace(/&[a-z]+;/gi, m => ({ '&iuml;': 'ï', '&eacute;': 'é', '&ograve;': 'ò', '&rsquo;': '’', '&amp;': '&', '&nbsp;': ' ', '&ldquo;': '“', '&rdquo;': '”', '&auml;': 'ä', '&ouml;': 'ö', '&uuml;': 'ü', '&aacute;': 'á', '&oacute;': 'ó', '&iacute;': 'í', '&ntilde;': 'ñ', '&ccedil;': 'ç', '&egrave;': 'è', '&agrave;': 'à' }[m.toLowerCase()] || m));

const dir = path.join(__dirname, '..', 'data', 'quotes');
let next = 0;
for (const f of fs.readdirSync(dir)) { const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (r.dayNumber) next = Math.max(next, r.dayNumber); }
for (const f of Object.values(fields)) next = Math.max(next, f.index);

let added = 0;
for (const o of out.slice().sort((a, b) => a.slug.localeCompare(b.slug))) {
  const t = todo.get(o.slug);
  if (!t || fields[o.slug]) continue;
  fields[o.slug] = {
    index: t.dayNumber || ++next, author: t.knownAuthor ? t.knownAuthor.name : decode(t.author),
    gender: o.gender, category: o.category, period: o.period, difficulty: o.difficulty,
    hint: o.hint, location: o.location, year: o.year, play: true,
  };
  added++;
}
const bad = Object.entries(fields).flatMap(([s, f]) => problems(s, f));
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
save(fields);
console.log(`merged ${added}; ${Object.keys(fields).length} quotes, ${Object.values(fields).filter(f => f.play).length} playable`);
