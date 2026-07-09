#!/usr/bin/env node
'use strict';
/*
 * indexnow.js — ping IndexNow (Bing, Yandex, and partners incl. AI browsers) with every URL,
 * so new/updated pages get crawled fast instead of waiting on organic discovery.
 *   node tools/indexnow.js        (submit all sitemap URLs)
 * The key file (${KEY}.txt) must be live at the site root for IndexNow to verify ownership.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const KEY = '5fb4a30bb32f1b3e2558772b4a10e6ef';
const HOST = 'quotle.info';
const ROOT = path.resolve(__dirname, '..');
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const body = JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList });
const req = https.request('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
  let d = ''; res.on('data', (c) => (d += c));
  res.on('end', () => console.log(`IndexNow: HTTP ${res.statusCode} for ${urlList.length} URLs${d ? ' — ' + d : ''}`));
});
req.on('error', (e) => console.error('IndexNow error:', e.message));
req.write(body); req.end();
