#!/usr/bin/env node
'use strict';
/*
 * gh-rest.js — the GitHub reads merge-gate and daily-report need, over REST instead of `gh`.
 *
 * WHY. Both tools called `gh pr list --json …`, which uses GraphQL. In a cloud sandbox `gh` is not
 * installed AND the egress proxy refuses GraphQL, so both hard-failed there. On 2026-07-29 the merge
 * pass worked around it by installing gh and hand-building a REST shim in its scratch directory —
 * correct as a one-off, useless as a nightly arrangement, since the next run starts from nothing.
 *
 * NO CREDENTIAL NEEDED, measured rather than assumed: this repo is public, and anonymous REST
 * answers every read below. The anonymous limit is 60/hr; a merge-gate run with 4 open PRs costs
 * ~57 requests in the worst case and a daily-report run costs 3. If a token is present in the
 * environment it is used, which raises the limit to 5000 — but nothing here requires one.
 *
 *   node tools/gh-rest.js --self-test    exercise the mapping against fixtures, no network
 *   node tools/gh-rest.js --probe        one live call, prints whether it is authenticated
 */
const REPO = process.env.QUOTLE_REPO || 'stewartdavidp-ship-it/quotle-info';
const API = 'https://api.github.com';

// A token is optional. GITHUB_TOKEN reads as the literal 'proxy-injected' placeholder in some cloud
// environments — sending that as a Bearer would be worse than sending nothing, so it is filtered.
function authHeaders() {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const usable = t && t !== 'proxy-injected';
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'quotle.info-gh-rest/1.0',
    ...(usable ? { Authorization: `Bearer ${t}` } : {}),
  };
}

async function api(pathAndQuery) {
  const r = await fetch(`${API}${pathAndQuery}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`GET ${pathAndQuery} -> ${r.status} ${r.statusText}`);
  return r.json();
}

// PAGINATES, and this is not optional. /pulls/{n}/files caps at 100 per page, and a routine PR that
// rebuilds the corpus touches ~1,163 files. merge-gate's scope gate asks "did an agent edit tools/ or
// workflows/" — answering that from the first 100 filenames is answering a different question. GitHub
// stops at 3,000 files, which is stated rather than silently truncated.
async function apiAll(pathBase, cap = 3000) {
  const out = [];
  for (let page = 1; out.length < cap; page++) {
    const batch = await api(`${pathBase}${pathBase.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(batch) || !batch.length) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

// REST calls it `mergeable_state` in lower case; decide() switches on the GraphQL spelling.
// HAS_HOOKS has no REST equivalent — REST reports that state as `clean`, and both already map to
// MERGE in decide(), so nothing is lost.
const upperState = (s) => String(s || 'unknown').toUpperCase();

// CHECK-RUNS ONLY, DELIBERATELY. The obvious-looking move is to also fold in the combined-status
// endpoint, as GraphQL's statusCheckRollup does. Do not: /commits/{sha}/status returns
// `state: "pending"` when a repo has ZERO commit statuses, which is this repo's situation. Folding
// that in would hand decide() a permanent PENDING, so the merge pass would WAIT every night, forever,
// looking exactly like a quiet morning. Verified: this repo returns {"state":"pending","total":0}.
function normaliseChecks(checkRuns) {
  return (checkRuns || []).map((c) => {
    if (c.status === 'queued' || c.status === 'in_progress') return { conclusion: 'PENDING' };
    return { conclusion: String(c.conclusion || 'PENDING').toUpperCase() };
  });
}

async function listOpenPRs() {
  const raw = await api(`/repos/${REPO}/pulls?state=open&per_page=50`);
  return Promise.all(raw.map(async (p) => {
    // mergeable_state is NOT on the list endpoint and is computed lazily — a first read can be
    // `unknown`, which decide() already routes to WAIT rather than guessing.
    const [detail, checks, files] = await Promise.all([
      api(`/repos/${REPO}/pulls/${p.number}`),
      api(`/repos/${REPO}/commits/${p.head.sha}/check-runs`).then((d) => d.check_runs).catch(() => []),
      apiAll(`/repos/${REPO}/pulls/${p.number}/files`),
    ]);
    return {
      number: p.number,
      title: p.title,
      url: p.html_url,
      headRefName: p.head.ref,
      isDraft: Boolean(p.draft),
      createdAt: p.created_at,
      mergeStateStatus: upperState(detail.mergeable_state),
      statusCheckRollup: normaliseChecks(checks),
      files: files.map((f) => ({ path: f.filename })),
    };
  }));
}

async function listMerged(since) {
  const raw = await api(`/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=60`);
  return raw.filter((p) => p.merged_at && (!since || p.merged_at >= since))
    .map((p) => ({ number: p.number, title: p.title, mergedAt: p.merged_at }));
}

async function latestRun(branch = 'main') {
  const d = await api(`/repos/${REPO}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`);
  const r = (d.workflow_runs || [])[0];
  return r ? { conclusion: r.conclusion, displayTitle: r.display_title } : {};
}

module.exports = { listOpenPRs, listMerged, latestRun, normaliseChecks, upperState, api, apiAll };

if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    const cases = [
      ['queued -> PENDING', normaliseChecks([{ status: 'queued' }]), [{ conclusion: 'PENDING' }]],
      ['in_progress -> PENDING', normaliseChecks([{ status: 'in_progress' }]), [{ conclusion: 'PENDING' }]],
      ['success uppercased', normaliseChecks([{ status: 'completed', conclusion: 'success' }]), [{ conclusion: 'SUCCESS' }]],
      ['failure uppercased', normaliseChecks([{ status: 'completed', conclusion: 'failure' }]), [{ conclusion: 'FAILURE' }]],
      ['no checks -> empty', normaliseChecks([]), []],
    ];
    let bad = 0;
    for (const [name, got, want] of cases) {
      if (JSON.stringify(got) !== JSON.stringify(want)) { console.error(`  ✗ ${name}: ${JSON.stringify(got)}`); bad++; }
    }
    for (const [rest, want] of [['clean', 'CLEAN'], ['behind', 'BEHIND'], ['dirty', 'DIRTY'], [undefined, 'UNKNOWN']]) {
      if (upperState(rest) !== want) { console.error(`  ✗ state ${rest} -> ${upperState(rest)}, want ${want}`); bad++; }
    }
    if (bad) { console.error(`\n  ${bad} mapping case(s) failed.\n`); process.exit(1); }
    console.log(`  ✓ gh-rest mapping (${cases.length + 4} cases: check-run states, mergeable_state spelling)`);
    process.exit(0);
  }
  (async () => {
    const r = await fetch(`${API}/repos/${REPO}/pulls?state=open`, { headers: authHeaders() });
    const lim = r.headers.get('x-ratelimit-limit');
    console.log(`  status ${r.status} · ratelimit ${lim} · ${lim === '60' ? 'ANONYMOUS (fine for reads on a public repo)' : 'AUTHENTICATED'}`);
  })();
}
