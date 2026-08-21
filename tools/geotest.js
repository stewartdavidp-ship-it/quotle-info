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
//
// Failure semantics (perf-check.yml relies on these):
//   exit 1 only when a region got an HTTP non-200 AND a one-shot retry of that
//   region repeated it. One-off 503s (GitHub Pages/Fastly emit them rarely) and
//   probes that never respond (volunteer-node flakiness) are printed as '~'
//   warnings and do not fail the run.

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
async function measure(path, countries = COUNTRIES) {
  const body = JSON.stringify({
    type: 'http',
    target: HOST,
    locations: countries.map((c) => ({ country: c, limit: 1 })),
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
// prints one measurement and returns its problems:
//   {kind:'http', country, city, status} — the site answered with a non-200 (gate-worthy)
//   {kind:'probe', country, city}        — the probe never got a response (volunteer-node
//                                          flakiness far more often than an outage; warn only)
function printMeasurement(path, m, indent = '  ') {
  console.log(`${indent}probe                    status  dns   tcp   tls  ttfb  total  cache`);
  const ttfbs = [];
  const problems = [];
  for (const r of m.results.sort((a, b) => (a.probe.country + a.probe.city).localeCompare(b.probe.country + b.probe.city))) {
    const t = r.result.timings || {};
    const cache = ((r.result.headers || {})['x-cache'] || '-').split(',')[0].trim();
    const status = r.result.statusCode ?? r.result.status ?? '-';
    if (t.firstByte != null && status === 200) ttfbs.push(t.firstByte);
    if (typeof status === 'number' && status !== 200) {
      problems.push({ kind: 'http', country: r.probe.country, city: r.probe.city, status });
    } else if (typeof status !== 'number') {
      problems.push({ kind: 'probe', country: r.probe.country, city: r.probe.city });
    }
    console.log(
      `${indent}${`${r.probe.city}, ${r.probe.country}`.padEnd(24)} ${String(status).padEnd(6)}` +
      ` ${ms(t.dns)}  ${ms(t.tcp)}  ${ms(t.tls)}  ${ms(t.firstByte)}   ${ms(t.total)}  ${cache}`
    );
  }
  if (ttfbs.length) {
    ttfbs.sort((a, b) => a - b);
    console.log(`${indent}TTFB world: best ${Math.round(ttfbs[0])}ms  median ${Math.round(ttfbs[Math.floor(ttfbs.length / 2)])}ms  worst ${Math.round(ttfbs[ttfbs.length - 1])}ms`);
  }
  return problems;
}

// ---------- main ----------
(async () => {
  let paths;
  if (PATHS_ARG) paths = PATHS_ARG.split(',').map((s) => s.trim());
  else if (RANDOM_N > 0) paths = await randomSitemapPaths(RANDOM_N);
  else paths = ['/', ...(await randomSitemapPaths(1))];

  console.log(`geotest: ${paths.length} page(s) from [${COUNTRIES.join(', ')}] via Globalping (free tier)`);
  let confirmed = 0; // non-200s that survived a retry
  let probeFlakes = 0;
  for (const path of paths) {
    const m = await measure(path);
    console.log(`\n${HOST}${path}`);
    const problems = printMeasurement(path, m);
    probeFlakes += problems.filter((p) => p.kind === 'probe').length;

    // A single transient non-200 (GitHub Pages/Fastly throw the occasional one-off 503)
    // should not fail a canary run — re-test exactly the regions that erred, once, and
    // only count what repeats.
    const httpBad = problems.filter((p) => p.kind === 'http');
    if (httpBad.length) {
      console.log(`  ~ ${httpBad.map((p) => `${p.city} ${p.status}`).join(', ')} — retrying those region(s) once:`);
      const retry = await measure(path, httpBad.map((p) => p.country));
      const still = printMeasurement(path, retry, '    ');
      confirmed += still.filter((p) => p.kind === 'http').length;
    }
  }
  if (probeFlakes) {
    console.log(`\n~ ${probeFlakes} probe(s) returned no result (volunteer-node flakiness; not counted against the site)`);
  }
  if (confirmed) {
    console.log(`\n!! ${confirmed} probe(s) did not get HTTP 200 even after retry`);
    process.exitCode = 1;
  }
  console.log('');
})().catch((err) => {
  console.error('geotest failed:', err.message);
  process.exit(1);
});
