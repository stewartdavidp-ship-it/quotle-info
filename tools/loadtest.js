#!/usr/bin/env node
// loadtest.js — concurrent-visitor load harness for quotle.info
//
// Simulates N virtual users (VUs) browsing the live site at the same time.
// Each VU gets its own keep-alive HTTPS agent (own connections, like a real
// browser), walks a random journey through real pages pulled from the live
// sitemap, and records per-request timings.
//
// Usage:
//   node tools/loadtest.js                        # 10 VUs, 60s, https://quotle.info
//   node tools/loadtest.js --vus 25 --duration 120
//   node tools/loadtest.js --base https://quotle.info --think 500-2000
//   node tools/loadtest.js --out /tmp/results.json
//
// Measures document (HTML) fetches only — server/CDN response time, not
// browser render. TTFB = first response byte; total = body fully received.
// Reports overall + per-section percentiles and Fastly cache HIT/MISS split.

'use strict';

const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');
const fs = require('node:fs');

// ---------- args ----------
const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
}
const VUS = parseInt(argVal('vus', '10'), 10);
const DURATION_S = parseInt(argVal('duration', '60'), 10);
const BASE = argVal('base', 'https://quotle.info').replace(/\/$/, '');
const [THINK_MIN, THINK_MAX] = argVal('think', '1000-3000').split('-').map(Number);
const OUT = argVal('out', null);
const MAX_VUS = 50; // static-host politeness cap; raise deliberately, not by typo

if (!Number.isFinite(VUS) || VUS < 1 || VUS > MAX_VUS) {
  console.error(`--vus must be 1..${MAX_VUS} (got ${argVal('vus', '10')})`);
  process.exit(1);
}

// ---------- one instrumented GET ----------
function timedGet(urlStr, agent, { redirectsLeft = 3 } = {}) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const mod = url.protocol === 'http:' ? http : https;
    const t0 = process.hrtime.bigint();
    let ttfbMs = null;
    let bytes = 0;
    const req = mod.get(
      url,
      {
        agent,
        headers: {
          'user-agent': 'quotle-loadtest/1.0 (site-owner performance test)',
          'accept': 'text/html',
          'accept-encoding': 'gzip, br',
        },
      },
      (res) => {
        const status = res.statusCode;
        // follow same-origin redirects (e.g. no-trailing-slash 301s) so a
        // redirect chain is measured as one user-visible page load
        if (status >= 301 && status <= 308 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          const next = new URL(res.headers.location, url).href;
          timedGet(next, agent, { redirectsLeft: redirectsLeft - 1 }).then((r) =>
            resolve({ ...r, url: urlStr, redirected: true })
          );
          return;
        }
        res.once('data', () => {
          ttfbMs = Number(process.hrtime.bigint() - t0) / 1e6;
        });
        res.on('data', (chunk) => (bytes += chunk.length));
        res.on('end', () => {
          const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;
          resolve({
            url: urlStr,
            status,
            ttfbMs: ttfbMs ?? totalMs,
            totalMs,
            bytes,
            cache: (res.headers['x-cache'] || '').split(',')[0].trim() || null,
            servedBy: (res.headers['x-served-by'] || '').split(',').pop()?.trim() || null,
            redirected: false,
            error: null,
          });
        });
      }
    );
    req.setTimeout(15000, () => req.destroy(new Error('timeout 15s')));
    req.on('error', (err) => {
      resolve({
        url: urlStr, status: 0, ttfbMs: null,
        totalMs: Number(process.hrtime.bigint() - t0) / 1e6,
        bytes, cache: null, servedBy: null, redirected: false,
        error: err.message,
      });
    });
  });
}

// ---------- page pool from the live sitemap ----------
async function loadPagePool() {
  const agent = new https.Agent({ keepAlive: false });
  const res = await timedGet(`${BASE}/sitemap-full.xml`, agent);
  if (res.error || res.status !== 200) {
    throw new Error(`could not fetch sitemap-full.xml: ${res.error || 'HTTP ' + res.status}`);
  }
  // re-fetch body (timedGet discards it) — small, one-off
  const xml = await new Promise((resolve, reject) => {
    let buf = '';
    https
      .get(`${BASE}/sitemap-full.xml`, { agent }, (r) => {
        let stream = r;
        const zlib = require('node:zlib');
        const enc = r.headers['content-encoding'];
        if (enc === 'gzip') stream = r.pipe(zlib.createGunzip());
        else if (enc === 'br') stream = r.pipe(zlib.createBrotliDecompress());
        stream.on('data', (c) => (buf += c));
        stream.on('end', () => resolve(buf));
        stream.on('error', reject);
      })
      .on('error', reject);
  });
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (urls.length === 0) throw new Error('sitemap parsed to 0 URLs');
  return urls;
}

// ---------- VU journey ----------
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nextUrl(pool) {
  // real visitors land on the homepage sometimes, deep pages (search) mostly
  return Math.random() < 0.15 ? `${BASE}/` : pick(pool);
}

async function runVU(id, pool, deadline, results) {
  const agent = new https.Agent({ keepAlive: true, maxSockets: 6 }); // browser-ish
  // stagger starts so VUs don't fire in lockstep
  await sleep(rand(0, 2000));
  while (Date.now() < deadline) {
    const r = await timedGet(nextUrl(pool), agent);
    results.push({ vu: id, at: Date.now(), ...r });
    if (Date.now() >= deadline) break;
    await sleep(rand(THINK_MIN, THINK_MAX));
  }
  agent.destroy();
}

// ---------- reporting ----------
function pct(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
function stats(rows, field) {
  const v = rows.map((r) => r[field]).filter((x) => x != null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  return { n: v.length, p50: pct(v, 50), p90: pct(v, 90), p99: pct(v, 99), max: v[v.length - 1] };
}
const fmt = (s) =>
  s ? `p50 ${s.p50.toFixed(0)}ms  p90 ${s.p90.toFixed(0)}ms  p99 ${s.p99.toFixed(0)}ms  max ${s.max.toFixed(0)}ms` : 'n/a';

function section(url) {
  const path = new URL(url).pathname;
  const seg = path.split('/').filter(Boolean)[0];
  return seg ? `/${seg}/` : '/ (home)';
}

function report(results, wallMs) {
  const ok = results.filter((r) => !r.error && r.status === 200);
  const errs = results.filter((r) => r.error || r.status !== 200);
  console.log('\n================ RESULTS ================');
  console.log(`requests: ${results.length} ok: ${ok.length} errors/non-200: ${errs.length}`);
  console.log(`wall time: ${(wallMs / 1000).toFixed(1)}s  throughput: ${(results.length / (wallMs / 1000)).toFixed(1)} req/s`);
  console.log(`TTFB   overall: ${fmt(stats(ok, 'ttfbMs'))}`);
  console.log(`Total  overall: ${fmt(stats(ok, 'totalMs'))}`);

  const hits = ok.filter((r) => /^HIT/i.test(r.cache || ''));
  const misses = ok.filter((r) => /^MISS/i.test(r.cache || ''));
  if (hits.length || misses.length) {
    console.log(`\nCDN cache: ${hits.length} HIT / ${misses.length} MISS` +
      (ok.length - hits.length - misses.length ? ` / ${ok.length - hits.length - misses.length} other` : ''));
    if (hits.length) console.log(`  HIT  TTFB: ${fmt(stats(hits, 'ttfbMs'))}`);
    if (misses.length) console.log(`  MISS TTFB: ${fmt(stats(misses, 'ttfbMs'))}`);
  }
  const pops = [...new Set(ok.map((r) => r.servedBy).filter(Boolean))];
  if (pops.length) console.log(`edge pop(s): ${pops.join(', ')}`);

  console.log('\nby section (TTFB):');
  const bySec = new Map();
  for (const r of ok) {
    const s = section(r.url);
    if (!bySec.has(s)) bySec.set(s, []);
    bySec.get(s).push(r);
  }
  for (const [sec, rows] of [...bySec.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${sec.padEnd(18)} n=${String(rows.length).padStart(4)}  ${fmt(stats(rows, 'ttfbMs'))}`);
  }

  const slow = [...ok].sort((a, b) => b.totalMs - a.totalMs).slice(0, 5);
  console.log('\nslowest 5 requests:');
  for (const r of slow) {
    console.log(`  ${r.totalMs.toFixed(0)}ms  ${r.cache || '-'}  ${new URL(r.url).pathname}`);
  }
  if (errs.length) {
    console.log('\nerrors / non-200:');
    for (const r of errs.slice(0, 10)) {
      console.log(`  ${r.error || 'HTTP ' + r.status}  ${new URL(r.url).pathname}`);
    }
    if (errs.length > 10) console.log(`  ... and ${errs.length - 10} more`);
  }
  console.log('=========================================\n');
}

// ---------- main ----------
(async () => {
  console.log(`loadtest: ${VUS} VUs x ${DURATION_S}s against ${BASE} (think ${THINK_MIN}-${THINK_MAX}ms)`);
  const pool = await loadPagePool();
  console.log(`page pool: ${pool.length} URLs from sitemap-full.xml`);

  const results = [];
  const t0 = Date.now();
  const deadline = t0 + DURATION_S * 1000;
  const ticker = setInterval(() => {
    process.stdout.write(`\r  ${((Date.now() - t0) / 1000).toFixed(0)}s  ${results.length} requests...`);
  }, 2000);

  await Promise.all(Array.from({ length: VUS }, (_, i) => runVU(i + 1, pool, deadline, results)));
  clearInterval(ticker);
  const wallMs = Date.now() - t0;

  report(results, wallMs);

  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify({
      config: { vus: VUS, durationS: DURATION_S, base: BASE, thinkMs: [THINK_MIN, THINK_MAX] },
      startedAt: new Date(t0).toISOString(),
      wallMs,
      requests: results,
    }, null, 2));
    console.log(`raw results written to ${OUT}`);
  }
})().catch((err) => {
  console.error('loadtest failed:', err.message);
  process.exit(1);
});
