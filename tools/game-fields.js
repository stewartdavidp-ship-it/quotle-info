// The Quotle game's clue fields for quotle.info quotes.
//
// The game needs, per quote: index (its stable game id), author (as the game spells it), gender,
// category, period, difficulty, hint, location, year. quotle.info records don't carry these, so
// they live here, keyed by quoteSlug, in data/game/fields.json — separate from the records so the
// game's data never touches the page records, their validators or the schema budget.
//
// `play: false` keeps a quote in the guess list's history but out of the schedule.
// Vocabulary below is the game's own (gameshelf/quotle/index.html); keep them identical.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'game', 'fields.json');
const CATEGORIES = ['Speech', 'Literature', 'Philosophy', 'Science', 'Activism', 'Business', 'Art', 'Film', 'Music', 'Sports'];
const PERIODS = ['Ancient', '1200s', '1300s', '1400s', '1500s', '1600s', '1700s', '1800s', '1900s', '2000s'];
const GENDERS = ['Male', 'Female'];
const YEAR = /^(\d{1,4}s?|\d{1,4}s? (BCE|CE)|Ancient)$/;

function load() { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
function save(fields) {
  const sorted = {};
  Object.keys(fields).sort().forEach(k => { sorted[k] = fields[k]; });
  fs.writeFileSync(FILE, JSON.stringify(sorted, null, 1) + '\n');
}

// Every problem with one entry, as strings (empty = valid)
function problems(slug, f) {
  const p = [];
  if (!Number.isInteger(f.index) || f.index < 1) p.push('index');
  if (!f.author) p.push('author');
  if (!GENDERS.includes(f.gender)) p.push('gender ' + f.gender);
  if (!CATEGORIES.includes(f.category)) p.push('category ' + f.category);
  if (!PERIODS.includes(f.period)) p.push('period ' + f.period);
  if (!Number.isInteger(f.difficulty) || f.difficulty < 1 || f.difficulty > 10) p.push('difficulty ' + f.difficulty);
  if (!f.hint || f.hint.length > 160) p.push('hint');
  if (!f.location) p.push('location');
  if (!f.year || !YEAR.test(f.year)) p.push('year ' + f.year);
  if (typeof f.play !== 'boolean') p.push('play');
  return p.map(x => slug + ': ' + x);
}

module.exports = { FILE, CATEGORIES, PERIODS, GENDERS, load, save, problems };
