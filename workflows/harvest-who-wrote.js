#!/usr/bin/env node
'use strict';
/*
 * harvest-who-wrote.js — the /who-wrote/ candidate harvester.
 *
 * Unlike the quote and /who-recorded/ harvests, this one is DETERMINISTIC — no agents. The best
 * "who wrote it" candidates are already sitting in data/songs: every recording record names its
 * writer (original.writer). A song is a dual-axis candidate when a recognisable artist WROTE it and
 * a different act's recording is what the public knows — which is exactly the shape of a cover-eclipse
 * record. So this scans the recording corpus and stages the writer stories, rather than researching
 * from scratch. (New SINGLE-axis records — a song with no recording record — still need research; see
 * the recipe in workflows/README.md.)
 *
 *   node workflows/harvest-who-wrote.js            # rescan, write the queue + digest
 *   node workflows/harvest-who-wrote.js --report   # print counts only, write nothing
 *
 * Output: data/who-wrote-queue.json (committed) + data/who-wrote-queue.md (digest).
 * Lifecycle per candidate: candidate → selected → ingested (or dropped + dropReason). Human decisions
 * (status, shape, dropReason) are PRESERVED across rescans, keyed by songSlug — the scan only refreshes
 * the derived fields and adds newly-eligible songs.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SONGS_DIR = path.join(ROOT, 'data', 'songs');
const QUEUE = path.join(ROOT, 'data', 'who-wrote-queue.json');
const DIGEST = path.join(ROOT, 'data', 'who-wrote-queue.md');
const REPORT = process.argv.includes('--report');

const plain = (s) => String(s || '')
  .replace(/<[^>]+>/g, '')
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
  .replace(/&amp;/g, '&').replace(/&([a-z]+);/g, ' ').replace(/&#\d+;/g, ' ')
  .replace(/\s+/g, ' ').trim();
const axesOf = (s) => (Array.isArray(s.axes) && s.axes.length ? s.axes : ['recording']);
const norm = (s) => plain(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// A writer string that is not a nameable, creditable person — no "who wrote it" story to tell.
const UNNAMEABLE = /\b(traditional|unknown|uncertain|public domain|anonymous)\b/i;

// The writer prose often carries "(who also recorded it first)". That, or the writer name matching
// the first-recording artist, means the person both wrote AND recorded first (Bowie, Dolly, Otis) —
// on their author hub the song shows under "recorded first" rather than "written by", which is fine.
function writerAlsoRecordedFirst(writerProse, firstArtist) {
  if (/also recorded it first/i.test(writerProse)) return true;
  const w = norm(writerProse), a = norm(firstArtist);
  return !!a && (w === a || w.startsWith(a + ' ') || w.includes(a));
}

function scan() {
  const files = fs.existsSync(SONGS_DIR) ? fs.readdirSync(SONGS_DIR).filter((f) => f.endsWith('.json')) : [];
  const candidates = [];
  let alreadyDual = 0;
  for (const f of files) {
    let s; try { s = JSON.parse(fs.readFileSync(path.join(SONGS_DIR, f), 'utf8')); } catch (_) { continue; }
    const axes = axesOf(s);
    if (axes.includes('writing')) { alreadyDual += axes.includes('recording') ? 1 : 0; continue; } // already enriched
    if (!axes.includes('recording')) continue;                                                      // writing-only, N/A
    const writerProse = plain((s.original && s.original.writer) || '');
    if (!writerProse || UNNAMEABLE.test(writerProse)) continue;                                      // no nameable writer → no story
    // The writer field is prose ("Otis Redding (who also recorded it first)", "Charles Fox (music)
    // and Norman Gimbel (lyrics)"). Take the leading name as the primary writer; the human confirms.
    const primaryWriter = writerProse.replace(/\s*\([^)]*\)/g, '').split(/\s+and\s+|,\s*/)[0].trim();
    const performer = plain(s.creditedTo || '');
    const firstArtist = plain((s.answer && s.answer.originalArtist) || '');
    candidates.push({
      songSlug: s.songSlug,
      title: plain(s.title),
      status: 'candidate',
      suggestedShape: 'misbelief',        // default: the public assumes the famous performer wrote it — HUMAN CONFIRMS (credit vs misbelief vs contested)
      performer,                          // creditedTo — who the public knows the song by
      writer: primaryWriter,              // leading writer name (confirm against writerProse for co-writers/lyric-vs-music)
      writerProse,                        // the full credit string from the record, for review
      firstRecordedBy: firstArtist,
      writerAlsoRecordedFirst: writerAlsoRecordedFirst(writerProse, firstArtist),
      needsReview: 'is the writer a recognisable recording artist (inclusion test 1)? is the shape right?',
    });
  }
  candidates.sort((a, b) => a.title.localeCompare(b.title));
  return { candidates, alreadyDual };
}

function merge(fresh) {
  // Preserve human decisions (status / suggestedShape / dropReason / notes) keyed by songSlug.
  let prev = [];
  try { prev = JSON.parse(fs.readFileSync(QUEUE, 'utf8')); } catch (_) { /* first run */ }
  const prevBy = new Map(prev.map((c) => [c.songSlug, c]));
  return fresh.map((c) => {
    const p = prevBy.get(c.songSlug);
    if (!p) return c;
    return { ...c, status: p.status || c.status, suggestedShape: p.suggestedShape || c.suggestedShape,
      ...(p.dropReason ? { dropReason: p.dropReason } : {}), ...(p.notes ? { notes: p.notes } : {}) };
  });
}

const { candidates, alreadyDual } = scan();
const merged = merge(candidates);
const open = merged.filter((c) => c.status === 'candidate' || c.status === 'selected');

if (REPORT) {
  console.log(`who-wrote harvest: ${merged.length} candidates (${open.length} open), ${alreadyDual} recording records already enriched (dual-axis).`);
  process.exit(0);
}

fs.writeFileSync(QUEUE, JSON.stringify(merged, null, 2) + '\n');
const byShape = open.reduce((m, c) => (m[c.suggestedShape] = (m[c.suggestedShape] || 0) + 1, m), {});
const digest = `# /who-wrote/ candidate queue

Generated by \`workflows/harvest-who-wrote.js\` — deterministic scan of the recording corpus for
songs a recognisable artist WROTE but a different act made famous. **Confirm the writer is a
recognisable recording artist and pick the shape** (credit / misbelief / contested) before ingesting.

- **${merged.length}** candidates, **${open.length}** open. **${alreadyDual}** recording records already enriched.
- Open by suggested shape: ${Object.entries(byShape).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}

| song | writer (leading) | also recorded first? | performer | shape? |
|---|---|---|---|---|
${open.map((c) => `| ${c.title} | ${c.writer} | ${c.writerAlsoRecordedFirst ? 'yes' : 'no'} | ${c.performer} | ${c.suggestedShape} |`).join('\n')}

_Ingest = add \`axes:["recording","writing"]\`, \`shape\`, and a \`writing\` block to \`data/songs/{slug}.json\`
(writer already verified in the record), then \`node tools/build.js\`. See workflows/README.md._
`;
fs.writeFileSync(DIGEST, digest);
console.log(`  ✓ data/who-wrote-queue.json (${merged.length} candidates, ${open.length} open)`);
console.log(`  ✓ data/who-wrote-queue.md`);
