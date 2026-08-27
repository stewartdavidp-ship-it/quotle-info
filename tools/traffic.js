#!/usr/bin/env node
'use strict';
/*
 * traffic.js — REAL VISITOR NUMBERS, from the terminal, with no login and no credential.
 *
 * WHY THIS EXISTS
 * For six weeks this project measured itself with Google Search Console and concluded the site
 * had almost no audience: 8 clicks, ever. That was true and completely misleading. GSC counts
 * GOOGLE ONLY. GoatCounter — installed site-wide on 2026-07-09 (PR #13) and quietly recording the
 * whole time — showed 4,163 visits, with chatgpt.com as the single largest referrer and Google
 * absent from the top six. A measurement that omits your actual audience is worse than none.
 *
 * So: this tool reads the numbers that include everybody. Run it before quoting any traffic figure.
 *
 * NO AUTH BY DESIGN
 * The dashboard is set to "Dashboard viewable by: Anyone", which exposes GoatCounter's counter
 * endpoint publicly. That is the whole integration — no token, no secret, nothing to leak from a
 * public repo. If someone flips the dashboard back to private this tool starts returning 403 and
 * you will know why.
 *
 * REFERRERS NEED A TOKEN (optional)
 * Referrers/browsers/locations are client-rendered on the dashboard, so the public endpoint cannot
 * see them. They come from the authenticated API instead. The token is read from
 * $GOATCOUNTER_TOKEN or ~/.quotle-goatcounter-token — NEVER from this repo, which is public.
 * Without a token everything else still works; --refs just says the token is missing.
 * (Token page is under the USER menu, not Settings: /user/api, permission "Read statistics".)
 * Do not scrape the dashboard HTML for referrers — it is JS-loaded and would break silently.
 *
 * USAGE
 *   node tools/traffic.js                       # site totals: today, 2d, 7d, 30d, all-time
 *   node tools/traffic.js --refs                # + referrer breakdown (needs token)
 *   node tools/traffic.js /who-said/some-slug/  # visits for specific paths (repeatable)
 *   node tools/traffic.js --json                # machine-readable, for the daily report
 */
const SITE = 'https://quotle.goatcounter.com';

const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return iso(d); };
// GoatCounter renders thousands with a non-breaking-ish space: "4 163" -> 4163
const num = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;

async function counter(path, start, end) {
  const q = start ? `?start=${start}&end=${end}` : '';
  const url = `${SITE}/counter/${path}.json${q}`;
  const res = await fetch(url);
  if (res.status === 403 || res.status === 401) {
    throw new Error(`${res.status} from GoatCounter — the dashboard is no longer public.\n` +
      `Fix: GoatCounter -> Settings -> "Dashboard viewable by" -> Anyone.`);
  }
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const j = await res.json();
  return { count: num(j.count), unique: num(j.count_unique) };
}

function token() {
  if (process.env.GOATCOUNTER_TOKEN) return process.env.GOATCOUNTER_TOKEN.trim();
  try {
    const os = require('os'), fs = require('fs'), path = require('path');
    return fs.readFileSync(path.join(os.homedir(), '.quotle-goatcounter-token'), 'utf8').trim();
  } catch { return null; }
}

async function topRefs(start, end) {
  const tok = token();
  if (!tok) return null;
  const url = `${SITE}/api/v0/stats/toprefs?start=${start}&end=${end}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
  if (res.status === 401 || res.status === 403) throw new Error('GoatCounter token rejected — recreate it at /user/api with "Read statistics".');
  if (!res.ok) throw new Error(`${res.status} fetching referrers`);
  const j = await res.json();
  return (j.stats || []).map((s) => ({ ref: s.name || '(direct / unknown)', visits: s.count }));
}

(async () => {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const paths = args.filter((a) => a.startsWith('/'));
  const today = iso(new Date());

  if (paths.length) {
    const rows = [];
    for (const p of paths) {
      const r = await counter(p.replace(/^\//, '/'), null, null);
      rows.push({ path: p, visits: r.unique });
    }
    if (asJson) return console.log(JSON.stringify({ pages: rows }, null, 2));
    console.log('\nvisits (all time) by page\n');
    rows.forEach((r) => console.log(`  ${String(r.visits).padStart(7)}  ${r.path}`));
    console.log();
    return;
  }

  const windows = [
    ['today', today, today],
    ['last 2 days', daysAgo(1), today],
    ['last 7 days', daysAgo(6), today],
    ['last 30 days', daysAgo(29), today],
  ];
  const out = { site: 'quotle.info', pulledAt: new Date().toISOString(), windows: {} };
  for (const [label, start, end] of windows) {
    out.windows[label] = (await counter('TOTAL', start, end)).unique;
  }
  out.allTime = (await counter('TOTAL', null, null)).unique;

  if (args.includes('--refs')) {
    out.referrers7d = await topRefs(daysAgo(6), today);
  }

  if (asJson) return console.log(JSON.stringify(out, null, 2));
  console.log('\nquotle.info — visits (GoatCounter, all referrers incl. AI assistants)\n');
  for (const [label] of windows) {
    console.log(`  ${label.padEnd(14)} ${String(out.windows[label]).padStart(7)}`);
  }
  console.log(`  ${'all time'.padEnd(14)} ${String(out.allTime).padStart(7)}`);

  if (args.includes('--refs')) {
    console.log('\n  referrers, last 7 days\n');
    if (!out.referrers7d) {
      console.log('    (no token — set $GOATCOUNTER_TOKEN or ~/.quotle-goatcounter-token)');
    } else {
      const tot = out.referrers7d.reduce((a, r) => a + r.visits, 0) || 1;
      out.referrers7d.forEach((r) => console.log(
        `    ${String(r.visits).padStart(6)}  ${String(Math.round(r.visits / tot * 100)).padStart(3)}%  ${r.ref}`));
    }
  }
  console.log('\n  NB: Search Console counts Google only and has shown ~8 clicks ever.\n');
})().catch((e) => { console.error('traffic.js:', e.message); process.exit(1); });
