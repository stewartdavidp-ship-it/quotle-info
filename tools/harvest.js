#!/usr/bin/env node
'use strict';
/*
 * harvest.js — manage the candidate BACKLOG that feeds the ingestion pipeline.
 *
 * The backlog (data/harvest-queue.json) is the source-of-truth pool of documented
 * misattribution / famous-quote TARGETS produced by the `harvest-candidates` Workflow
 * (one Opus agent per magnet author, mining Wikiquote Misattributed/Disputed + Quote
 * Investigator). Cheap harvesting fills it; expensive ingestion waves draw it down.
 *
 * Lifecycle of a candidate:  queued → selected (staged for a wave) → ingested   (or → skipped)
 *
 * Commands
 *   node tools/harvest.js sync  <harvest-output.json> [...]   append new candidates (dedup vs
 *                                                             corpus + backlog), sweep published
 *                                                             ones to 'ingested', rebuild digest
 *   node tools/harvest.js select <N> [--wave rN] [--author "Name"] [--category misattributed]
 *                                                             mark the top-N queued as 'selected'
 *   node tools/harvest.js unselect [--wave rN]                revert selected → queued
 *   node tools/harvest.js batch  [--wave rN] [--out path]     emit ingestion args
 *                                                             [{text,author,index:null}] for the
 *                                                             selected items (feeds generate-r5)
 *   node tools/harvest.js skip   <slug> [<slug> ...]          mark candidate(s) 'skipped'
 *   node tools/harvest.js votes  <votes.json>                 apply vote tallies (curl <worker>/votes)
 *                                                             → boosts upvoted candidates in the queue
 *   node tools/harvest.js report                              print summary + rebuild digest
 *
 * Canonical data:   data/harvest-queue.json  ({meta, candidates})
 * Human digest:     data/harvest-queue.md    (generated; never hand-edit)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QUOTES_DIR = path.join(ROOT, 'data', 'quotes');
const BACKLOG = path.join(ROOT, 'data', 'harvest-queue.json');
const DIGEST = path.join(ROOT, 'data', 'harvest-queue.md');

const CAT_RANK = { misattributed: 1, disputed: 2, 'genuine-famous': 3 };
const RIGHTS_RANK = { 'public-domain': 0, uncertain: 1, 'in-copyright': 2 };
const STATUS_RANK = { selected: 0, queued: 1, ingested: 2, skipped: 3 };

// ---- helpers ----
function slugify(text) {
  let s = String(text).toLowerCase()
    .replace(/[’'‘`]/g, '').replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 60) s = s.slice(0, 60).replace(/-[^-]*$/, '');
  return s;
}
function norm(text) {
  return String(text).toLowerCase().replace(/[’'‘`"“”]/g, '')
    .replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function today() { return new Date().toISOString().slice(0, 10); }

function loadCorpus() {
  const slugs = new Set(), norms = new Set();
  for (const f of fs.readdirSync(QUOTES_DIR)) {
    if (!f.endsWith('.json')) continue;
    slugs.add(f.replace(/\.json$/, ''));
    try { const r = JSON.parse(fs.readFileSync(path.join(QUOTES_DIR, f), 'utf8')); if (r.displayQuote) norms.add(norm(r.displayQuote)); } catch (_) {}
  }
  return { slugs, norms, has: (q) => slugs.has(slugify(String(q).replace(/\s*\.\s*$/, ''))) || norms.has(norm(q)) };
}

function loadBacklog() {
  if (!fs.existsSync(BACKLOG)) return { meta: {}, candidates: [] };
  let data = JSON.parse(fs.readFileSync(BACKLOG, 'utf8'));
  if (Array.isArray(data)) data = { meta: {}, candidates: data };      // migrate legacy flat array
  if (!Array.isArray(data.candidates)) data.candidates = [];
  return data;
}

function priority(c) { return CAT_RANK[c.category] || 9; }
function sortCandidates(cands) {
  cands.sort((a, b) =>
    (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
    ((b.votes || 0) - (a.votes || 0)) ||   // community demand (+1) bubbles up within a status
    priority(a) - priority(b) ||
    (RIGHTS_RANK[a.rightsEra] ?? 9) - (RIGHTS_RANK[b.rightsEra] ?? 9) ||
    String(a.magnetAuthor).localeCompare(String(b.magnetAuthor)) ||
    String(a.slug).localeCompare(String(b.slug))
  );
}

function save(data) {
  const c = data.candidates;
  const count = (pred) => c.filter(pred).length;
  const tally = (key, pred) => c.filter(pred).reduce((m, x) => (m[x[key]] = (m[x[key]] || 0) + 1, m), {});
  sortCandidates(c);
  data.meta = {
    description: 'Candidate backlog for quotle.info ingestion. Documented misattribution/famous-quote targets from Wikiquote + Quote Investigator, harvested by the harvest-candidates Workflow. Managed by tools/harvest.js — do not hand-edit counts. Lifecycle: queued → selected → ingested (or skipped).',
    updated: today(),
    total: c.length,
    queued: count((x) => x.status === 'queued'),
    selected: count((x) => x.status === 'selected'),
    ingested: count((x) => x.status === 'ingested'),
    skipped: count((x) => x.status === 'skipped'),
    queuedByCategory: tally('category', (x) => x.status === 'queued'),
    queuedByRightsEra: tally('rightsEra', (x) => x.status === 'queued'),
  };
  fs.writeFileSync(BACKLOG, JSON.stringify(data, null, 2) + '\n');
  writeDigest(data);
}

function esc(s) { return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' '); }
function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function writeDigest(data) {
  const c = data.candidates, m = data.meta;
  const L = [];
  L.push('# Harvest queue — quotle.info ingestion backlog', '');
  L.push('> Generated by `tools/harvest.js`. Canonical data is `data/harvest-queue.json`; **do not hand-edit** this file.', '');
  L.push(`**Updated:** ${m.updated} · **Total:** ${m.total} · **Queued:** ${m.queued} · **Selected:** ${m.selected} · **Ingested:** ${m.ingested} · **Skipped:** ${m.skipped}`, '');
  L.push(`Queued by category: ${Object.entries(m.queuedByCategory || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}  `);
  L.push(`Queued by rights-era: ${Object.entries(m.queuedByRightsEra || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`, '');
  const section = (title, pred, showWave) => {
    const rows = c.filter(pred);
    if (!rows.length) return;
    L.push(`## ${title} (${rows.length})`, '');
    L.push(`| # | ▲ | Cat | Conf | Rights | Magnet author | Quote | Real origin | Doc${showWave ? ' | Wave' : ''} |`);
    L.push(`|--:|--:|-----|------|--------|---------------|-------|-------------|-----${showWave ? '|------' : ''}|`);
    rows.forEach((x, i) => {
      const doc = x.documentedAt ? `[src](${x.documentedAt})` : '';
      L.push(`| ${i + 1} | ${x.votes || 0} | ${x.category} | ${x.likelyConfidence} | ${x.rightsEra} | ${esc(x.magnetAuthor)} | ${esc(trunc(x.quote, 90))} | ${esc(trunc(x.trueOrigin, 60))} | ${doc}${showWave ? ` | ${x.wave || ''}` : ''} |`);
    });
    L.push('');
  };
  section('Selected — staged for the next wave', (x) => x.status === 'selected', true);
  section('Queued — pipeline order (misattributed → disputed → genuine; PD → uncertain → ©)', (x) => x.status === 'queued');
  section('Ingested', (x) => x.status === 'ingested', true);
  section('Skipped', (x) => x.status === 'skipped');
  fs.writeFileSync(DIGEST, L.join('\n') + '\n');
}

// ---- commands ----
function cmdSync(inputs) {
  const data = loadBacklog();
  const corpus = loadCorpus();
  const byNorm = new Map(data.candidates.map((c) => [norm(c.quote), c]));
  let swept = 0;
  for (const c of data.candidates) if ((c.status === 'queued' || c.status === 'selected') && corpus.has(c.quote)) { c.status = 'ingested'; if (!c.resultSlug) c.resultSlug = slugify(String(c.quote).replace(/\s*\.\s*$/, '')); swept++; }
  let added = 0, dupCorpus = 0, dupBacklog = 0;
  for (const src of inputs) {
    const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
    const cands = Array.isArray(raw) ? raw : Array.isArray(raw.candidates) ? raw.candidates
      : (raw.result && Array.isArray(raw.result.candidates)) ? raw.result.candidates : [];
    for (const c of cands) {
      const q = (c.quote || '').trim().replace(/^["“]|["”]$/g, '');
      if (!q) continue;
      const n = norm(q);
      if (corpus.has(q)) { dupCorpus++; continue; }
      if (byNorm.has(n)) { dupBacklog++; continue; }
      const rec = {
        slug: slugify(q.replace(/\s*\.\s*$/, '')), quote: q,
        magnetAuthor: c.magnetAuthor || c.creditedTo || '', creditedTo: c.creditedTo || '',
        trueOrigin: c.trueOrigin || '', category: c.category || '', whyNotable: c.whyNotable || '',
        likelyConfidence: c.likelyConfidence || '', rightsEra: c.rightsEra || '', documentedAt: c.documentedAt || '',
        status: 'queued', wave: null, resultSlug: null, harvestedFrom: path.basename(src), harvestedOn: today(), notes: '',
      };
      data.candidates.push(rec); byNorm.set(n, rec); added++;
    }
  }
  save(data);
  console.log(`sync: +${added} new · dropped ${dupCorpus} in-corpus + ${dupBacklog} already-queued · swept ${swept} → ingested`);
  printSummary(data);
}

function parseFlags(args) {
  const f = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--wave') f.wave = args[++i];
    else if (args[i] === '--author') f.author = args[++i];
    else if (args[i] === '--category') f.category = args[++i];
    else if (args[i] === '--out') f.out = args[++i];
    else f._ = (f._ || []).concat(args[i]);
  }
  return f;
}

function cmdSelect(args) {
  const n = parseInt((args[0] || '').replace(/[^0-9]/g, ''), 10);
  if (!n) { console.error('usage: select <N> [--wave rN] [--author "Name"] [--category cat]'); process.exit(1); }
  const f = parseFlags(args.slice(1));
  const data = loadBacklog();
  let pool = data.candidates.filter((c) => c.status === 'queued');
  if (f.author) pool = pool.filter((c) => c.magnetAuthor.toLowerCase().includes(f.author.toLowerCase()));
  if (f.category) pool = pool.filter((c) => c.category === f.category);
  sortCandidates(pool);
  const pick = pool.slice(0, n);
  pick.forEach((c) => { c.status = 'selected'; c.wave = f.wave || c.wave || 'next'; });
  save(data);
  console.log(`selected ${pick.length} → wave "${f.wave || 'next'}"${f.author ? ` · author~${f.author}` : ''}${f.category ? ` · ${f.category}` : ''}`);
  pick.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. [${c.category}/${c.likelyConfidence}/${c.rightsEra}] ${c.magnetAuthor}: "${trunc(c.quote, 70)}"`));
}

function cmdUnselect(args) {
  const f = parseFlags(args);
  const data = loadBacklog();
  let n = 0;
  for (const c of data.candidates) if (c.status === 'selected' && (!f.wave || c.wave === f.wave)) { c.status = 'queued'; c.wave = null; n++; }
  save(data);
  console.log(`unselected ${n}${f.wave ? ` from wave ${f.wave}` : ''}`);
}

function cmdBatch(args) {
  const f = parseFlags(args);
  const data = loadBacklog();
  const sel = data.candidates.filter((c) => c.status === 'selected' && (!f.wave || c.wave === f.wave));
  if (!sel.length) { console.error(`no selected candidates${f.wave ? ` for wave ${f.wave}` : ''}. Run: harvest.js select <N> --wave rN`); process.exit(1); }
  const items = sel.map((c) => ({ text: c.quote, author: c.magnetAuthor, index: null }));
  const out = f.out || path.join(ROOT, 'data', `.harvest-batch${f.wave ? '-' + f.wave : ''}.json`);
  fs.writeFileSync(out, JSON.stringify(items, null, 2) + '\n');
  console.log(`wrote ${items.length} ingestion items → ${out}`);
  console.log(`feed to generate-r5:  Workflow(args: <contents of ${path.basename(out)}>)`);
}

function cmdSkip(args) {
  const data = loadBacklog();
  const set = new Set(args);
  let n = 0;
  for (const c of data.candidates) if (set.has(c.slug) && c.status !== 'ingested') { c.status = 'skipped'; n++; }
  save(data);
  console.log(`skipped ${n}`);
}

function cmdVotes(args) {
  const f = parseFlags(args);
  const src = (f._ || [])[0];
  if (!src) { console.error('usage: votes <votes.json>   (from: curl <worker>/votes > votes.json)'); process.exit(1); }
  const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
  const map = raw.votes || raw;
  const data = loadBacklog();
  const bySlug = new Map(data.candidates.map((c) => [c.slug, c]));
  let matched = 0, withVotes = 0;
  for (const [slug, count] of Object.entries(map)) {
    const c = bySlug.get(slug);
    if (c) { c.votes = count | 0; matched++; if (c.votes > 0) withVotes++; }
  }
  save(data);
  console.log(`votes: applied tallies to ${matched} candidates (${withVotes} with >0). Queue re-sorted — upvoted rise within their status.`);
  const top = data.candidates.filter((c) => c.status === 'queued' && (c.votes || 0) > 0).slice(0, 10);
  if (top.length) { console.log('most requested:'); top.forEach((c) => console.log(`  ▲${String(c.votes).padStart(3)}  ${c.magnetAuthor}: "${trunc(c.quote, 60)}"`)); }
}

function printSummary(data) {
  const m = data.meta;
  console.log(`backlog: ${m.total} total · ${m.queued} queued · ${m.selected} selected · ${m.ingested} ingested · ${m.skipped} skipped`);
  console.log(`  queued category: ${JSON.stringify(m.queuedByCategory)}  rights: ${JSON.stringify(m.queuedByRightsEra)}`);
  console.log(`  digest → ${path.relative(ROOT, DIGEST)}`);
}

// ---- dispatch ----
const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'sync': if (!rest.length) { console.error('usage: sync <harvest-output.json> [...]'); process.exit(1); } cmdSync(rest); break;
  case 'select': cmdSelect(rest); break;
  case 'unselect': cmdUnselect(rest); break;
  case 'batch': cmdBatch(rest); break;
  case 'skip': cmdSkip(rest); break;
  case 'votes': cmdVotes(rest); break;
  case 'report': case undefined: { const d = loadBacklog(); save(d); printSummary(d); break; }
  default: console.error(`unknown command: ${cmd}\nsee header of tools/harvest.js for usage`); process.exit(1);
}
