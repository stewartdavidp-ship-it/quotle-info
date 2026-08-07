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
 * NO CREDENTIAL NEEDED for the reads below — but READ THE NEXT PARAGRAPH before trusting the budget.
 *
 * This header used to say the anonymous 60/hr limit was enough, because a merge-gate run with 4 open
 * PRs costs ~57 requests worst case. The arithmetic was right and the premise was wrong: the cloud
 * egress IP is SHARED, so that 60 was never ours alone and was measured at 0 remaining. Callers must
 * go through tools/proxy-boot.js, which routes Node's fetch via the sandbox proxy — measured in cloud
 * on 2026-07-30 (branch probe/cloud-auth-2026-07-30): direct = 403 at limit 60, through the proxy =
 * 200 at limit 15000, authenticated as stewartdavidp-ship-it. merge-gate.js and daily-report.js both
 * require proxy-boot at the top for exactly this reason.
 *
 * READS ONLY, and that is not an oversight. The same probe found the proxy-injected identity carries
 * permissions {admin:false, push:false, …} — it can read anything and write nothing. Anything that
 * needs a WRITE (merging a PR) needs a real token and lives in tools/merge-run.js, not here.
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
    // behind_by is asked for EXPLICITLY rather than inferred from mergeable_state === 'behind',
    // because that spelling only ever appears while branch protection has strict:true. Once
    // staleness is judged per-file by merge-gate instead of blanket-enforced by GitHub, `behind`
    // stops being reported at all — and a gate that reads staleness off a field the setting
    // silently switches off is a gate that reports every stale branch as current.
    const [detail, checks, files, cmp] = await Promise.all([
      api(`/repos/${REPO}/pulls/${p.number}`),
      api(`/repos/${REPO}/commits/${p.head.sha}/check-runs`).then((d) => d.check_runs).catch(() => []),
      apiAll(`/repos/${REPO}/pulls/${p.number}/files`),
      // NOT caught. A swallowed compare would read as behindBy:null, which decide() treats as
      // "GitHub already called it CLEAN" — fine while strict:true, a silent hole once it is off.
      // The caller already exits(1) loudly on a read failure; this belongs in that same class.
      api(`/repos/${REPO}/compare/${encodeURIComponent(p.base.ref)}...${p.head.sha}`),
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
      // null (not 0) when the compare failed, so decide() can tell "current" from "unknown".
      behindBy: cmp && typeof cmp.behind_by === 'number' ? cmp.behind_by : null,
    };
  }));
}

async function listMerged(since) {
  const raw = await api(`/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=60`);
  return raw.filter((p) => p.merged_at && (!since || p.merged_at >= since))
    .map((p) => ({ number: p.number, title: p.title, mergedAt: p.merged_at }));
}

// WHAT "CI IS GREEN" MEANS, AND WHY THIS IS NOT `per_page=1`.
// This used to read `/actions/runs?branch=main&per_page=1` — the newest run of ANY workflow on the
// branch. Three workflows land on main (verify, merge every 3h, and GitHub's built-in Pages
// deploy), so which one answered was a race. On 2026-08-06 it reported `success` for main while
// `pages build and deployment` had failed TWICE on that exact commit: the newest run happened to be
// a green merge pass. The daily report printed "CI on main: success" and no one learned the site's
// deploy was timing out. A health signal that reports the wrong workflow is worse than none, because
// it is trusted.
//
// So: pin to the branch TIP commit, and read the named gate (`verify`, the required context) for it.
// Any OTHER workflow that failed on the same commit is returned separately in `otherFailures` rather
// than folded into `conclusion` — verify is the gate that blocks a merge, but a red Pages deploy is
// the thing that silently serves stale pages, and the caller should be able to say which is which.
//
// `cancelled` is deliberately NOT treated as a failure here: this repo's concurrency groups
// (merge-authority) cancel overlapping runs by design, and counting those would alarm every time two
// passes overlapped. `failure` and `timed_out` are real. Note the test is on the RUN's conclusion,
// which is what GitHub's own UI shows — a run can report `failure` while a job inside it reads
// `cancelled`, and that still surfaces here. That is intended: under-reporting is the defect being
// fixed, and a human can dismiss a concurrency artefact far more cheaply than they can notice a
// deploy that never happened.
async function latestRun(branch = 'main', workflow = 'verify') {
  let sha = null;
  try {
    const head = await api(`/repos/${REPO}/commits/${encodeURIComponent(branch)}`);
    sha = head && head.sha;
  } catch { /* fall back to branch-wide below; a missing sha must not blank the whole health block */ }

  const q = `/repos/${REPO}/actions/runs?branch=${encodeURIComponent(branch)}`
    + (sha ? `&head_sha=${sha}` : '') + '&per_page=50';
  const d = await api(q);
  const runs = (d.workflow_runs || []).filter((r) => r.status === 'completed');

  const isGate = (r) => r.name === workflow || String(r.path || '').endsWith(`/${workflow}.yml`);

  // ONE verdict per workflow: the LATEST run. A workflow can run repeatedly against the same commit
  // (merge.yml fires every 3h and re-runs happen), so a plain filter would keep reporting a failure
  // that a later green run had already superseded. The API returns newest-first, so first-seen wins.
  const latestPerWorkflow = [];
  const seen = new Set();
  for (const r of runs) if (!seen.has(r.name)) { seen.add(r.name); latestPerWorkflow.push(r); }

  const gate = latestPerWorkflow.find(isGate);
  const otherFailures = latestPerWorkflow
    .filter((r) => !isGate(r) && (r.conclusion === 'failure' || r.conclusion === 'timed_out'))
    .map((r) => ({ name: r.name, conclusion: r.conclusion }));

  return {
    // 'unknown' (not 'success') when the gate has not reported for this commit — an absent check is
    // not a passing one. Actions can stall; on 2026-08-06 it scheduled nothing for over two hours.
    conclusion: gate ? gate.conclusion : 'unknown',
    displayTitle: gate ? gate.display_title : undefined,
    sha,
    otherFailures,
  };
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
