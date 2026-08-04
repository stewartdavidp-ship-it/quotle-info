#!/usr/bin/env node
'use strict';
/*
 * songs.js — manage the song-misattribution BACKLOG that feeds the song ingestion pipeline.
 *
 * The songs equivalent of tools/harvest.js. The backlog (data/song-queue.json) is the pool of
 * documented cover-mistaken-for-original TARGETS produced by the `harvest-songs` Workflow (one Opus
 * agent per vein). Cheap harvesting fills it; expensive ingestion waves draw it down.
 *
 * WHY THIS EXISTS: all 27 original song records were written straight into data/songs/ by hand-
 * rolled agents (commits c8dd10df2, 4b2516a2e, bc8ec8265) — no select, no batch, no ingest, and the
 * queue statuses were updated by hand afterwards. That worked for 27 and does not work for 63.
 *
 * Lifecycle of a candidate:  queued → selected (staged for a wave) → ingested   (or → dropped)
 *
 * NOTE the vocabulary difference from harvest.js: songs use `dropped` + `dropReason`, not `skipped`.
 * That is the existing data's word (Higher Ground is recorded that way) and the reason matters here —
 * a song is dropped for FAILING THE CONFUSION BAR, which is a research finding worth keeping, not a
 * taste call. Do not migrate it to `skipped`.
 *
 * Commands
 *   node tools/songs.js sync  <harvest-output.json> [...]   append new candidates (dedup vs built
 *                                                           records + backlog), record the agents'
 *                                                           `dropped` + `contested` lists, sweep
 *                                                           built ones to 'ingested', rebuild digest
 *   node tools/songs.js select <N> [--wave sN] [--confusion high] [--vein blues]
 *                                                           mark the top-N queued as 'selected'
 *   node tools/songs.js unselect [--wave sN]                revert selected → queued
 *   node tools/songs.js batch  [--wave sN] [--out path]     emit generate-songs.js args (the full
 *                                                           candidate, not a text/author pair —
 *                                                           the researcher needs the whole lead)
 *   node tools/songs.js drop   <slug> [...] --reason "why"  mark candidate(s) 'dropped'
 *   node tools/songs.js undrop <slug> [...]                 put dropped candidate(s) back in the queue
 *   node tools/songs.js report                              print summary + rebuild digest
 *
 * Canonical data:   data/song-queue.json  ({meta, songs})
 * Human digest:     data/song-queue.md    (generated; never hand-edit)
 */
const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');

const ROOT = path.resolve(__dirname, '..');
const SONGS_DIR = path.join(ROOT, 'data', 'songs');
const BACKLOG = path.join(ROOT, 'data', 'song-queue.json');
const DIGEST = path.join(ROOT, 'data', 'song-queue.md');

// The queue file is committed with ONE-space indent — that is how it was first written and how the
// 27 existing entries sit on disk. Reformatting to 2 would churn every line of a 90-entry file for
// nothing, and bury a real one-line change in a 900-line diff. Match what is there.
const INDENT = 1;

// What a default `select` draws first. Only two ranks because the harvest bar forbids `low`:
// a candidate is either a documented public belief (high) or a defensible one (medium).
const CONFUSION_RANK = { high: 0, medium: 1, low: 2 };
const STATUS_RANK = { selected: 0, queued: 1, ingested: 2, dropped: 3 };

// Every field a candidate must carry to be ingestable. `sync` rejects anything missing one rather
// than letting a half-formed lead sit in the queue until a wave trips over it.
const REQUIRED = ['songSlug', 'title', 'creditedTo', 'originalArtist', 'originalYear', 'writer', 'coverArtist', 'coverYear', 'confusion', 'whyNotable', 'sources'];

// ---- helpers ----
function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[’'‘`"“”]/g, '')
    .replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function today() { return new Date().toISOString().slice(0, 10); }
function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function esc(s) { return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' '); }

// The BUILT corpus — data/songs/*.json. This is the authority on what is already published; the
// queue's own `status` is a claim about it that can drift (and did: Tainted Love was built but never
// had a queue entry at all).
function loadBuilt() {
  const slugs = new Set();
  if (!fs.existsSync(SONGS_DIR)) return slugs;
  for (const f of fs.readdirSync(SONGS_DIR)) if (f.endsWith('.json')) slugs.add(f.replace(/\.json$/, ''));
  return slugs;
}

function loadBacklog() {
  if (!fs.existsSync(BACKLOG)) return { meta: {}, songs: [] };
  let data = JSON.parse(fs.readFileSync(BACKLOG, 'utf8'));
  if (Array.isArray(data)) data = { meta: {}, songs: data };
  if (!Array.isArray(data.songs)) data.songs = [];
  return data;
}

function sortCandidates(list) {
  list.sort((a, b) =>
    (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
    (CONFUSION_RANK[a.confusion] ?? 9) - (CONFUSION_RANK[b.confusion] ?? 9) ||
    String(a.title).localeCompare(String(b.title))
  );
}

function save(data) {
  const s = data.songs;
  const count = (pred) => s.filter(pred).length;
  const tally = (key, pred) => s.filter(pred).reduce((m, x) => (m[x[key]] = (m[x[key]] || 0) + 1, m), {});
  sortCandidates(s);
  // Preserve the operator's `note` verbatim — it carries prose nobody wants a script rewriting.
  // Everything else here is DERIVED, so it is safe to recompute and must never be hand-edited.
  const note = data.meta && data.meta.note;
  data.meta = {
    ...(note ? { note } : {}),
    description: 'Song-misattribution backlog for /who-recorded/. A cover mistaken for the ORIGINAL recording. Managed by tools/songs.js — do not hand-edit counts. Lifecycle: queued → selected → ingested (or dropped).',
    updated: today(),
    total: s.length,
    queued: count((x) => x.status === 'queued'),
    selected: count((x) => x.status === 'selected'),
    ingested: count((x) => x.status === 'ingested'),
    dropped: count((x) => x.status === 'dropped'),
    queuedByConfusion: tally('confusion', (x) => x.status === 'queued'),
  };
  fs.writeFileSync(BACKLOG, JSON.stringify(data, null, INDENT) + '\n');
  writeDigest(data);
}

function writeDigest(data) {
  const c = data.songs, m = data.meta;
  const L = [];
  L.push('# Song queue — quotle.info /who-recorded/ backlog', '');
  L.push('> Generated by `tools/songs.js`. Canonical data is `data/song-queue.json`; **do not hand-edit** this file.', '');
  L.push(`**Updated:** ${m.updated} · **Total:** ${m.total} · **Queued:** ${m.queued} · **Selected:** ${m.selected} · **Ingested:** ${m.ingested} · **Dropped:** ${m.dropped}`, '');
  L.push(`Queued by confusion: ${Object.entries(m.queuedByConfusion || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`, '');
  const section = (title, pred, extra) => {
    const rows = c.filter(pred);
    if (!rows.length) return;
    L.push(`## ${title} (${rows.length})`, '');
    L.push(`| # | Conf | Title | Credited to (the belief) | Actually recorded first | Year${extra ? ` | ${extra}` : ''} |`);
    L.push(`|--:|------|-------|--------------------------|-------------------------|------${extra ? '|------' : ''}|`);
    rows.forEach((x, i) => {
      const tail = extra === 'Wave' ? ` | ${x.wave || ''}` : extra === 'Why dropped' ? ` | ${esc(trunc(x.dropReason, 70))}` : '';
      L.push(`| ${i + 1} | ${x.confusion} | ${esc(x.title)} | ${esc(x.creditedTo)} | ${esc(x.originalArtist)} | ${x.originalYear}${tail} |`);
    });
    L.push('');
  };
  section('Selected — staged for the next wave', (x) => x.status === 'selected', 'Wave');
  section('Queued — pipeline order (high confusion first)', (x) => x.status === 'queued');
  section('Ingested', (x) => x.status === 'ingested', 'Wave');
  section('Dropped — failed the confusion bar or unverifiable', (x) => x.status === 'dropped', 'Why dropped');
  fs.writeFileSync(DIGEST, L.join('\n') + '\n');
}

// ---- commands ----
function cmdSync(inputs) {
  const data = loadBacklog();
  const built = loadBuilt();
  const bySlug = new Map(data.songs.map((c) => [c.songSlug, c]));
  const byPair = new Map(data.songs.map((c) => [norm(c.title) + '|' + norm(c.creditedTo), c]));

  // Sweep: the BUILT records are the authority. A candidate whose page exists is ingested whatever
  // the queue thought. This is what kept 26/27 honest by hand and will not scale by hand.
  let swept = 0;
  for (const c of data.songs) {
    if ((c.status === 'queued' || c.status === 'selected') && built.has(c.songSlug)) { c.status = 'ingested'; swept++; }
  }

  let added = 0, dupBuilt = 0, dupQueue = 0, rejected = 0;
  let dropped = 0, dupDrop = 0, caveats = 0, caveatMiss = 0, caveatDup = 0;
  const problems = [];
  for (const src of inputs) {
    const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
    // Accept a bare array, {songs:[]}, {candidates:[]}, or a Workflow return {result:{songs:[]}}.
    const cands = Array.isArray(raw) ? raw
      : Array.isArray(raw.songs) ? raw.songs
      : Array.isArray(raw.candidates) ? raw.candidates
      : (raw.result && Array.isArray(raw.result.songs)) ? raw.result.songs
      : (raw.result && Array.isArray(raw.result.candidates)) ? raw.result.candidates
      : [];
    for (const c of cands) {
      const slug = String(c.songSlug || '').trim();
      if (!slug) { problems.push(`${src}: candidate with no songSlug (${c.title || '?'})`); rejected++; continue; }
      if (!/^[a-z0-9-]+$/.test(slug)) { problems.push(`${slug}: songSlug is not kebab-case`); rejected++; continue; }
      const miss = REQUIRED.filter((f) => c[f] === undefined || c[f] === null || c[f] === '');
      if (miss.length) { problems.push(`${slug}: missing ${miss.join(', ')}`); rejected++; continue; }
      // The harvest bar forbids `low`. Enforce it at the gate rather than trusting every agent to
      // have honoured its prompt — the bar is the whole reason this vertical is worth publishing.
      if (c.confusion === 'low') { problems.push(`${slug}: confusion=low — below the harvest bar, not queued`); rejected++; continue; }
      if (!Array.isArray(c.sources) || !c.sources.length || !c.sources.every((u) => /^https:\/\//.test(String(u)))) {
        problems.push(`${slug}: sources must be a non-empty array of https URLs`); rejected++; continue;
      }
      if (built.has(slug)) { dupBuilt++; continue; }
      if (bySlug.has(slug)) { dupQueue++; continue; }
      const pair = norm(c.title) + '|' + norm(c.creditedTo);
      if (byPair.has(pair)) { dupQueue++; continue; }

      const rec = {
        songSlug: slug,
        title: c.title,
        creditedTo: c.creditedTo,
        originalArtist: c.originalArtist,
        originalYear: String(c.originalYear),
        originalLabel: c.originalLabel || '',
        writer: c.writer,
        coverArtist: c.coverArtist,
        coverYear: String(c.coverYear),
        confusion: c.confusion,
        whyNotable: c.whyNotable,
        sources: c.sources,
        status: 'queued',
        // Lifecycle bookkeeping. `vein` is which harvest lane found it (blues / soul / country /
        // reggae / sync / standards) — carried so a later wave can draw one lane deliberately, the
        // way harvest.js needs --source to reach the game-quote pool past its own default sort.
        vein: c.vein || '',
        wave: null,
        harvestedFrom: path.basename(src),
        harvestedOn: today(),
      };
      data.songs.push(rec); bySlug.set(slug, rec); byPair.set(pair, rec); added++;
    }

    // ---- the agents' REJECTIONS -------------------------------------------------------------
    // A harvest agent returns three lists, and until 2026-08-04 sync read only the first. The other
    // two were discarded at the door, so every sweep re-derived the same negative results: the s4
    // run re-established that Little Red Rooster and Spoonful are famous AS covers, and that Whole
    // Lotta Love is out of scope (Zeppelin's IS the first recording under that title — the dispute
    // is over WRITING credit, a different axis). Higher Ground is the counter-example that proves
    // recording them works: it is the one drop that WAS persisted, and the s4 agent saw the reason
    // and refused to resurface it.
    //
    // A drop is a lead that FAILED, not a half-formed candidate, so REQUIRED does not apply — the
    // agent has a title and a reason and nothing else. It still earns a queue entry, because the
    // exclude list the harvest is called with maps EVERY song regardless of status, so a recorded
    // drop is skipped by the next sweep with no change to harvest-songs.js at all.
    for (const d of listOf(raw, 'dropped')) {
      const title = String((d && d.title) || '').trim();
      const why = String((d && d.why) || '').trim();
      if (!title || !why) { problems.push(`${src}: dropped entry missing title or why`); rejected++; continue; }
      const slug = slugify(title);
      if (!slug) { problems.push(`${src}: dropped "${title}" slugifies to nothing`); rejected++; continue; }
      // Never let a drop overwrite a real candidate or a built record. An agent dropping a title
      // that another vein queued is a disagreement to leave alone, not to resolve by deletion.
      if (built.has(slug) || bySlug.has(slug)) { dupDrop++; continue; }
      const rec = {
        songSlug: slug, title, status: 'dropped', dropReason: why,
        wave: null, harvestedFrom: path.basename(src), harvestedOn: today(),
      };
      data.songs.push(rec); bySlug.set(slug, rec); dropped++;
    }

    // ---- the agents' UNRESOLVED AMBIGUITIES --------------------------------------------------
    // `contested` is NOT drop research, which is what it looks like sitting next to `dropped`. Most
    // of these describe songs that are QUEUED — an ambiguity the agent could not settle and is
    // handing forward (Oh Carolina: "the two Wikipedia pages disagree on the date and do not
    // reconcile"). Losing them means the researcher either re-derives the ambiguity or, worse,
    // does not, and the page asserts a clean date the sources contradict. They ride on the
    // candidate as `caveats` and reach the researcher through cmdBatch.
    for (const note of listOf(raw, 'contested')) {
      const m = /^\s*(?:\[([a-z]+)\]\s*)?([^—]+)—\s*(.+)$/s.exec(String(note || ''));
      if (!m) { caveatMiss++; continue; }
      const target = matchSong(bySlug, data.songs, m[2].trim());
      if (!target) { caveatMiss++; continue; }
      // Idempotent, like every other branch of sync: re-running the same harvest file must not
      // append the same note twice. (It did — a second sync took 45 caveats to 90.)
      const text = m[3].trim().replace(/\s+/g, ' ');
      target.caveats = target.caveats || [];
      if (target.caveats.includes(text)) { caveatDup++; continue; }
      target.caveats.push(text);
      caveats++;
    }
  }
  save(data);
  console.log(`sync: +${added} new · dropped ${dupBuilt} already-built + ${dupQueue} already-queued · swept ${swept} → ingested${rejected ? ` · REJECTED ${rejected}` : ''}`);
  console.log(`      +${dropped} rejection(s) recorded${dupDrop ? ` (${dupDrop} already known)` : ''} · +${caveats} caveat(s) attached${caveatDup ? ` (${caveatDup} already present)` : ''}${caveatMiss ? ` (${caveatMiss} matched no song — not discarded silently, look at them)` : ''}`);
  if (problems.length) { console.log('rejected candidates:'); problems.forEach((p) => console.log(`  ✗ ${p}`)); }
  printSummary(data);
}

// A contested note names its song in prose, so the title will not always slug to the queue's slug —
// "Where Did You Sleep Last Night / In the Pines" is one entry naming two titles, and a parenthetical
// year ("Blue Velvet (1951)") is common. Try the exact slug, then the first of a slashed pair, then
// a normalised prefix match, and give up rather than guess.
function matchSong(bySlug, songs, title) {
  const tries = [title, title.split('/')[0], title.replace(/\s*\([^)]*\)\s*$/, '')];
  for (const t of tries) {
    const hit = bySlug.get(slugify(t.trim()));
    if (hit) return hit;
  }
  const n = norm(title);
  return songs.find((s) => n === norm(s.title) || n.startsWith(norm(s.title) + ' ')) || null;
}

// Read one of the harvest return's three lists, tolerating the Workflow envelope the way the
// candidate reader above already does.
function listOf(raw, key) {
  if (Array.isArray(raw && raw[key])) return raw[key];
  if (raw && raw.result && Array.isArray(raw.result[key])) return raw.result[key];
  return [];
}

function parseFlags(args) {
  const f = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--wave') f.wave = args[++i];
    else if (args[i] === '--confusion') f.confusion = args[++i];
    else if (args[i] === '--vein') f.vein = args[++i];
    else if (args[i] === '--reason') f.reason = args[++i];
    else if (args[i] === '--out') f.out = args[++i];
    else f._ = (f._ || []).concat(args[i]);
  }
  return f;
}

function cmdSelect(args) {
  const n = parseInt((args[0] || '').replace(/[^0-9]/g, ''), 10);
  if (!n) { console.error('usage: select <N> [--wave sN] [--confusion high] [--vein blues]'); process.exit(1); }
  const f = parseFlags(args.slice(1));
  const data = loadBacklog();
  let pool = data.songs.filter((c) => c.status === 'queued');
  if (f.confusion) pool = pool.filter((c) => c.confusion === f.confusion);
  if (f.vein) pool = pool.filter((c) => String(c.vein || '').includes(f.vein));
  sortCandidates(pool);
  const pick = pool.slice(0, n);
  if (!pick.length) { console.error('nothing matched — nothing selected'); process.exit(1); }
  pick.forEach((c) => { c.status = 'selected'; c.wave = f.wave || c.wave || 'next'; });
  save(data);
  console.log(`selected ${pick.length} → wave "${f.wave || 'next'}"${f.confusion ? ` · ${f.confusion}` : ''}${f.vein ? ` · vein~${f.vein}` : ''}`);
  pick.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. [${c.confusion}] ${c.title} — ${c.creditedTo} ← ${c.originalArtist} (${c.originalYear})`));
}

function cmdUnselect(args) {
  const f = parseFlags(args);
  const data = loadBacklog();
  let n = 0;
  for (const c of data.songs) if (c.status === 'selected' && (!f.wave || c.wave === f.wave)) { c.status = 'queued'; c.wave = null; n++; }
  save(data);
  console.log(`unselected ${n}${f.wave ? ` from wave ${f.wave}` : ''}`);
}

function cmdBatch(args) {
  const f = parseFlags(args);
  const data = loadBacklog();
  const sel = data.songs.filter((c) => c.status === 'selected' && (!f.wave || c.wave === f.wave));
  if (!sel.length) { console.error(`no selected candidates${f.wave ? ` for wave ${f.wave}` : ''}. Run: songs.js select <N> --wave sN`); process.exit(1); }
  // Unlike the quote batch ([{text,author,index}]), a song batch carries the WHOLE lead. The
  // researcher is not starting from a bare string: the harvest already established who recorded it
  // first, in what year, on what label, and gave a verified source. Re-deriving that per agent
  // would both waste the harvest and invite a different answer than the queue was reviewed on.
  // `caveats` carries the harvest's UNRESOLVED questions about this song (see cmdSync). Same
  // argument as the rest of the lead, one step further: re-deriving what the harvest already
  // established wastes it, and re-deriving what the harvest could NOT establish invites a
  // confident answer where the sources do not support one.
  const items = sel.map((c) => ({
    songSlug: c.songSlug, title: c.title, creditedTo: c.creditedTo,
    originalArtist: c.originalArtist, originalYear: c.originalYear, originalLabel: c.originalLabel || '',
    writer: c.writer, coverArtist: c.coverArtist, coverYear: c.coverYear,
    confusion: c.confusion, whyNotable: c.whyNotable, sources: c.sources,
    ...(c.caveats && c.caveats.length ? { caveats: c.caveats } : {}),
  }));
  const out = f.out || path.join(ROOT, 'data', `.song-batch${f.wave ? '-' + f.wave : ''}.json`);
  fs.writeFileSync(out, JSON.stringify(items, null, 2) + '\n');
  console.log(`wrote ${items.length} generation items → ${out}`);
  console.log(`feed to generate-songs:  Workflow({scriptPath:"workflows/generate-songs.js", args:{items:<contents of ${path.basename(out)}>, verifiedDate:"D Mon YYYY", dateModified:"YYYY-MM-DD"}})`);
}

function cmdDrop(args) {
  const f = parseFlags(args);
  const slugs = f._ || [];
  if (!slugs.length) { console.error('usage: drop <slug> [...] --reason "why"'); process.exit(1); }
  // A drop without a reason is the thing this vertical most needs to remember. The confusion bar is
  // a judgement, and the NEXT harvest will re-find the same song and re-propose it unless the reason
  // is on the record — which is exactly what happened to Higher Ground, and why it now carries one.
  if (!f.reason) { console.error('ERROR: --reason is required. A drop with no reason gets re-harvested next pass.'); process.exit(1); }
  const data = loadBacklog();
  const set = new Set(slugs);
  let n = 0;
  for (const c of data.songs) if (set.has(c.songSlug) && c.status !== 'ingested') { c.status = 'dropped'; c.dropReason = f.reason; c.wave = null; n++; }
  save(data);
  console.log(`dropped ${n}: ${f.reason}`);
}

function cmdUndrop(args) {
  const data = loadBacklog();
  const set = new Set(args);
  let n = 0;
  for (const c of data.songs) if (set.has(c.songSlug) && c.status === 'dropped') { c.status = 'queued'; delete c.dropReason; n++; }
  save(data);
  console.log(`undropped ${n} → back in the queue`);
}

function printSummary(data) {
  const m = data.meta;
  console.log(`song backlog: ${m.total} total · ${m.queued} queued · ${m.selected} selected · ${m.ingested} ingested · ${m.dropped} dropped`);
  console.log(`  queued confusion: ${JSON.stringify(m.queuedByConfusion)}`);
  console.log(`  digest → ${path.relative(ROOT, DIGEST)}`);
}

// ---- dispatch ----
const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'sync': if (!rest.length) { console.error('usage: sync <harvest-output.json> [...]'); process.exit(1); } cmdSync(rest); break;
  case 'select': cmdSelect(rest); break;
  case 'unselect': cmdUnselect(rest); break;
  case 'batch': cmdBatch(rest); break;
  case 'drop': cmdDrop(rest); break;
  case 'undrop': cmdUndrop(rest); break;
  case 'report': case undefined: { const d = loadBacklog(); save(d); printSummary(d); break; }
  default: console.error(`unknown command: ${cmd}\nsee header of tools/songs.js for usage`); process.exit(1);
}
