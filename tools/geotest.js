#!/usr/bin/env node
// geotest.js — multi-geography response-time check for quotle.info
//
// Uses the free Globalping API (globalping.io, jsDelivr's open probe network)
// to fetch pages from real probes around the world and print DNS/TCP/TLS/TTFB/
// total timings plus the Fastly cache verdict per region.
//
// Free tier: no signup needed; unauthenticated callers get a daily probe-test
// budget (~250). Each run consumes (#paths x #probes) tests — the default run
// uses ~16.
//
// Usage:
//   node tools/geotest.js                                   # homepage + 1 random deep page
//   node tools/geotest.js --paths /,/authors/mark-twain/
//   node tools/geotest.js --countries US,GB,JP --paths /
//   node tools/geotest.js --random 3                        # 3 random sitemap pages
//
// Companion to tools/loadtest.js (concurrency from here) — this answers
// "how fast is the site from elsewhere in the world?"

'use strict';

const https = require('node:https');
const zlib = require('node:zlib');

const API = 'api.globalping.io';
const HOST = 'quotle.info';

// ---------- args ----------
const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
}
const COUNTRIES = argVal('countries', 'US,US,GB,DE,IN,AU,JP,BR').split(',').map((s) => s.trim());
const RANDOM_N = parseInt(argVal('random', '0'), 10);
const PATHS_ARG = argVal('paths', null);

// ---------- tiny https helpers ----------
function request(method, host, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host, path, method, headers: body
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
          : {} },
      (res) => {
        let stream = res;
        const enc = res.headers['content-encoding'];
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
        let buf = '';
        stream.on('data', (c) => (buf += c));
        stream.on('end', () => resolve({ status: res.statusCode, body: buf }));
        stream.on('error', reject);
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- page selection ----------
async function randomSitemapPaths(n) {
  const res = await request('GET', HOST, '/sitemap-full.xml');
  if (res.status !== 200) throw new Error(`sitemap fetch failed: HTTP ${res.status}`);
  const urls = [...res.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  const picks = [];
  while (picks.length < n && urls.length) {
    const i = Math.floor(Math.random() * urls.length);
    picks.push(urls.splice(i, 1)[0]);
  }
  return picks;
}

// ---------- globalping ----------
async function measure(path) {
  const body = JSON.stringify({
    type: 'http',
    target: HOST,
    locations: COUNTRIES.map((c) => ({ country: c, limit: 1 })),
    measurementOptions: { protocol: 'HTTPS', request: { path, method: 'GET' } },
  });
  const created = await request('POST', API, '/v1/measurements', body);
  if (created.status === 429) throw new Error('Globalping rate limit hit — free daily budget exhausted, try later');
  if (created.status !== 202) throw new Error(`measurement create failed: HTTP ${created.status} ${created.body}`);
  const { id } = JSON.parse(created.body);
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const res = await request('GET', API, `/v1/measurements/${id}`);
    const m = JSON.parse(res.body);
    if (m.status === 'finished') return m;
  }
  throw new Error(`measurement ${id} did not finish in 60s`);
}

// ---------- report ----------
const ms = (v) => (v == null ? '   -' : String(Math.round(v)).padStart(4));
function printMeasurement(path, m) {
  console.log(`\n${HOST}${path}`);
  console.log('  probe                    status  dns   tcp   tls  ttfb  total  cache');
  const ttfbs = [];
  for (const r of m.results.sort((a, b) => (a.probe.country + a.probe.city).localeCompare(b.probe.country + b.probe.city))) {
    const t = r.result.timings || {};
    const cache = ((r.result.headers || {})['x-cache'] || '-').split(',')[0].trim();
    const status = r.result.statusCode ?? r.result.status ?? '-';
    if (t.firstByte != null && status === 200) ttfbs.push(t.firstByte);
    console.log(
      `  ${`${r.probe.city}, ${r.probe.country}`.padEnd(24)} ${String(status).padEnd(6)}` +
      ` ${ms(t.dns)}  ${ms(t.tcp)}  ${ms(t.tls)}  ${ms(t.firstByte)}   ${ms(t.total)}  ${cache}`
    );
  }
  if (ttfbs.length) {
    ttfbs.sort((a, b) => a - b);
    console.log(`  TTFB world: best ${Math.round(ttfbs[0])}ms  median ${Math.round(ttfbs[Math.floor(ttfbs.length / 2)])}ms  worst ${Math.round(ttfbs[ttfbs.length - 1])}ms`);
  }
  const bad = m.results.filter((r) => (r.result.statusCode ?? 0) !== 200);
  if (bad.length) console.log(`  !! ${bad.length} probe(s) did not get HTTP 200`);
}

// ---------- main ----------
(async () => {
  let paths;
  if (PATHS_ARG) paths = PATHS_ARG.split(',').map((s) => s.trim());
  else if (RANDOM_N > 0) paths = await randomSitemapPaths(RANDOM_N);
  else paths = ['/', ...(await randomSitemapPaths(1))];

  console.log(`geotest: ${paths.length} page(s) from [${COUNTRIES.join(', ')}] via Globalping (free tier)`);
  for (const path of paths) {
    const m = await measure(path);
    printMeasurement(path, m);
  }
  console.log('');
})().catch((err) => {
  console.error('geotest failed:', err.message);
  process.exit(1);
});
