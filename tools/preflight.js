#!/usr/bin/env node
'use strict';
/*
 * preflight.js — assert a routine's environment BEFORE it does any work.
 *
 * WHY THIS EXISTS — one failure shape, four times in one day (2026-07-29).
 * Every environment failure this system has hit presented as "nothing happened" rather than
 * "something failed":
 *
 *   · ADMIN_TOKEN unset      → review.js prints "reader reports skipped" and carries on. `due` still
 *                              emits a full queue ranked on staleness, with every reader report
 *                              silently absent. Indistinguishable from a quiet night.
 *   · ADMIN_TOKEN corrupted  → two runs used `2>&1` on the gcloud call and got 461 characters of
 *                              Python deprecation warning with the real 43-char token inside. Every
 *                              authenticated call 401s, which again reads as an empty queue.
 *   · egress blocked         → the 2026-07-28 wave fell back to WebSearch summaries and shipped 5
 *                              records marked confidence:'verified' whose own PR body said no primary
 *                              page was read.
 *   · gh / GraphQL absent    → merge-gate.js hard-fails at `gh pr list --json`, so the merge pass
 *                              cannot decide anything.
 *   · wrong branch prefix    → merge-gate.js fails closed, the PR sits HUMAN forever, and the morning
 *                              looks quiet.
 *
 * Each of those got a point fix. This is the systematic one: check the environment at second zero,
 * print every result, and exit non-zero so the routine STOPS instead of producing a plausible no-op.
 *
 *   node tools/preflight.js --routine <wave|reports|review|discovery|merge>
 *   node tools/preflight.js --routine wave --json
 *
 * It only ever READS. It never fetches a secret, never writes, and never mutates git.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const ROUTINE = arg('--routine');
const JSON_OUT = argv.includes('--json');

// What each routine actually needs. Kept as data so the requirements are readable in one place
// rather than scattered through five procedure docs that can drift from each other.
const NEEDS = {
  wave:      { token: false, egress: true,  gh: false, prefix: 'wave-' },
  discovery: { token: false, egress: true,  gh: false, prefix: 'discovery/' },
  // The reports pass SPLIT on 2026-07-29 and the two halves have opposite needs.
  //
  // `reports` is the audit half: it reads which pages are disputed from the PUBLIC /reports/pending,
  // then audits, fixes and opens a PR. It needs egress and NO credential — that is what let it move
  // off the operator's laptop into cloud. If you find yourself adding token:true back here, the
  // split has been undone.
  // `api: true` probes QUOTLE_API, which is a DIFFERENT question from `egress`. Egress probes the
  // hosts the corpus CITES; the API is the host a routine cannot START without. On 2026-07-30 this
  // pass returned "safe to proceed" on all 13 checks and then died at step 1, because the cloud
  // proxy was refusing quotle-community.stewartd.workers.dev and nothing here ever asked. Four
  // citation hosts being reachable says nothing about the one host that matters to this routine.
  reports:   { token: false, egress: true,  gh: false, api: true,  prefix: 'reports/' },
  // `reports-close` is the noon half, and the ONLY routine that can email a reader. It authenticates
  // to /sources and /triage, needs no sources (it reads records off disk), and runs where the token
  // is. A bad token here is not a read-only inconvenience: it decides whether a real person hears
  // back about a page they reported.
  // egress:false is right — it reads records off disk and cites nothing. But it POSTs to /sources
  // and /triage, so it needs the API host, and until 2026-07-30 preflight checked NO network for it
  // at all. That is the worst place to have the gap: this is the only routine that can email a real
  // person about a page they reported, so a silent failure here is a reader who never hears back.
  'reports-close': { token: true, egress: false, gh: false, api: true,  prefix: 'reports/' },
  // Review is flag-driven and usually costs nothing, but a night WITH flags fetches sources to test
  // each remedy — so it needs egress even though most nights never use it.
  review:    { token: false, egress: true,  gh: false, prefix: 'review/' },
  // The merge pass runs in .github/workflows/merge.yml now, not as an agent, and merges over REST
  // with MERGE_TOKEN/GITHUB_TOKEN — so it needs neither the `gh` binary nor this preflight. `gh` was
  // only ever a STAND-IN for "can perform the merge write", and standing in for a capability is how
  // this gate refused a pass in the one environment it was scheduled in: cloud has no `gh`, which
  // said nothing about whether the merge could be done there. (It could not, but for a different
  // reason — permissions.push=false, measured in probe/cloud-auth-2026-07-30.) Kept for a human
  // running the pass by hand from a checkout, where the real question is the same one preflight
  // should always ask: is the tree current and clean.
  merge:     { token: false, egress: false, gh: false, prefix: 'merge/' },
  // The 08:00 report only READS — merged PRs, open PRs, the last CI run — and since 2026-07-29 it
  // does that over anonymous REST rather than `gh`. So it needs neither a token nor the gh binary,
  // which is what lets it run in cloud. Leaving gh:true here would have failed the cloud run for a
  // dependency it no longer has: preflight refusing a pass that would have worked is the same
  // silent-morning outcome it exists to prevent, just with an extra step.
  report:    { token: false, egress: false, gh: false, prefix: 'report/' },
};

// The hosts this corpus actually cites, apex-first. `*.archive.org` does NOT match the bare apex
// `archive.org`, which is the third most-cited host here (577 citations) — that mismatch cost the
// 2026-07-29 wave its best primary route for two records.
const HOSTS = ['en.wikiquote.org', 'quoteinvestigator.com', 'archive.org', 'www.gutenberg.org'];

// The Worker the reader-report passes talk to. Read from the environment the SAME way the tools do
// (tools/review.js:40, tools/verify-review-spine.js:34) so an overridden QUOTLE_API is what gets
// probed — checking the default while the routine calls an override is a green light for a host
// nobody is using.
const API_HOST = (() => {
  try { return new URL(process.env.QUOTLE_API || 'https://quotle-community.stewartd.workers.dev').host; }
  catch (_) { return 'quotle-community.stewartd.workers.dev'; }
})();

const results = [];
const ok = (name, detail) => results.push({ name, ok: true, detail });
const bad = (name, detail, fix) => results.push({ name, ok: false, detail, fix });

function sh(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// For commands whose EXIT CODE is the answer rather than an error — `git merge-base --is-ancestor`
// exits 1 to mean "no", which sh() would throw on and the caller would read as "git is broken".
function tryOk(cmd, args) {
  try { execFileSync(cmd, args, { cwd: ROOT, stdio: 'ignore' }); return true; } catch (_) { return false; }
}

// Wikimedia's User-Agent policy REFUSES requests without a descriptive UA — en.wikiquote.org returns
// 403 to a bare Node request even on an unrestricted network. Without this header the check reports
// "egress blocked" on a perfectly good connection, which is the exact false-alarm this file exists
// to prevent. Found by running the check against a machine known to have open egress.
const UA = 'quotle.info-preflight/1.0 (https://quotle.info/; contact help@quotle.info)';

// WHAT THIS CHECK IS ACTUALLY ASKING is "can we reach the origin", NOT "does the origin like us".
// Those are different, and conflating them makes the check useless in both directions:
//   · Wikimedia 403s a bare UA;  Quote Investigator 403s a non-browser UA (Cloudflare).
//     Both are ORIGIN responses — we got through, the site simply answered.
//   · The cloud egress proxy ALSO answers 403 for a host that is not allowlisted, but it labels
//     itself with `x-deny-reason: host_not_allowed`.
// So an HTTP status alone cannot tell blocked from bot-protected. The deny header can, and a
// connection-level error (refused CONNECT, timeout) is unambiguous. Chasing this with ever-more
// browser-like User-Agents would be whack-a-mole that eventually reports success while the proxy is
// still refusing.
const head = (url) => new Promise((resolve) => {
  const req = https.request(url, { method: 'GET', timeout: 12000, headers: { 'User-Agent': UA } }, (res) => {
    res.resume();
    const deny = res.headers['x-deny-reason'];
    resolve(deny ? { blocked: true, detail: `proxy denied: ${deny}` }
                 : { blocked: false, detail: `HTTP ${res.statusCode} (origin reached)` });
  });
  req.on('error', (e) => resolve({ blocked: true, detail: `connection failed: ${(e && e.code) || 'unknown'}` }));
  req.on('timeout', () => { req.destroy(); resolve({ blocked: true, detail: 'timeout' }); });
  req.end();
});

(async () => {
  if (!ROUTINE || !NEEDS[ROUTINE]) {
    console.error(`  usage: preflight.js --routine <${Object.keys(NEEDS).join('|')}>`);
    process.exit(2);
  }
  const need = NEEDS[ROUTINE];

  // ---- git: on main, clean, current ----------------------------------------
  // Not cosmetic. report-gate.js's scope gate reads `git status --porcelain -- tools workflows`
  // INCLUDING untracked files, so a stray scratch file makes it refuse with the wrong reason. And a
  // stale checkout audits records against superseded sources: on 2026-07-29 the reports checkout had
  // drifted 9 commits behind and was missing .claude/settings.json entirely.
  try {
    // Is the LOCAL `main` ref even the same project as origin/main? Ask before telling anyone to
    // check it out. On 2026-08-04 three routines stopped here: the container's `main` pointed at an
    // UNRELATED history (HEAD 0a732f15, #276, 2026-07-30 — a distinct root commit, no merge-base),
    // and the remedy printed below was `git checkout main`. Following it would have moved the tree
    // BACKWARD onto a stale 5-day-old root — precisely the stale-checkout hazard this block exists
    // to catch. The routines refused it and reported instead, which was right, and cost a full day
    // of reports/review/report passes doing nothing.
    //
    // So the diagnosis has to come FIRST and name its own remedy. `git checkout -B main origin/main`
    // repoints the ref; it discards only local `main` commits, which is why this is reported as its
    // own check rather than folded into "git on main" — losing commits deserves its own line.
    sh('git', ['fetch', '-q', 'origin']);
    const sane = tryOk('git', ['merge-base', '--is-ancestor', 'main', 'origin/main']);
    sane ? ok('local main sane', 'ancestor of origin/main')
         : bad('local main sane', 'local main is NOT an ancestor of origin/main (diverged, or an unrelated history)',
             'git checkout -B main origin/main   ← NOT `git checkout main`, which moves you onto the stale ref');

    const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    // Only suggest checking main out when main is worth checking out. Naming a remedy that makes
    // things worse is how a gate teaches people to ignore it.
    branch === 'main' ? ok('git on main', branch)
                      : bad('git on main', `on ${branch}`, sane ? 'git checkout main' : 'git checkout -B main origin/main');
    const dirty = sh('git', ['status', '--porcelain']);
    dirty ? bad('tree clean', `${dirty.split('\n').length} changed`, 'STOP — the tree is not yours to clean; report it')
          : ok('tree clean', 'nothing uncommitted');
    sh('git', ['fetch', '-q', 'origin']);
    const behind = sh('git', ['rev-list', '--count', 'HEAD..origin/main']);
    behind === '0' ? ok('current with origin/main', 'up to date')
                   : bad('current with origin/main', `${behind} commit(s) behind`, 'git merge --ff-only origin/main');
  } catch (e) { bad('git usable', String((e && e.message) || e).slice(0, 80), 'is this a git checkout?'); }

  // ---- the tools the procedure will invoke ---------------------------------
  for (const t of ['build.js', 'scan.js', 'review.js', 'routine-log.js', 'merge-gate.js']) {
    fs.existsSync(path.join(ROOT, 'tools', t)) ? ok(`tools/${t}`, 'present')
      : bad(`tools/${t}`, 'MISSING', 'the checkout is incomplete or very old');
  }

  // ---- ADMIN_TOKEN: present AND the right shape ----------------------------
  if (need.token) {
    const t = process.env.ADMIN_TOKEN || '';
    if (!t) {
      bad('ADMIN_TOKEN set', 'empty', 'export ADMIN_TOKEN=$(gcloud secrets versions access latest --secret=quotle-admin-token --project=word-boxing 2>/dev/null)');
    } else if (t.length !== 43 || /\s/.test(t)) {
      // The specific corruption seen twice: gcloud's stderr folded in by `2>&1`.
      bad('ADMIN_TOKEN shape', `${t.length} chars${/\s/.test(t) ? ', contains whitespace' : ''} — expected 43`,
        'you used 2>&1 and merged gcloud\'s Python warning into the token. Use 2>/dev/null');
    } else ok('ADMIN_TOKEN shape', '43 chars, no whitespace');
  }

  // ---- egress: can we actually FETCH a source? ------------------------------
  if (need.egress) {
    for (const h of HOSTS) {
      const r = await head(`https://${h}/`);
      r.blocked
        ? bad(`reach ${h}`, r.detail,
            'this host is not in the environment allowlist. Do NOT fall back to WebSearch summaries and write records anyway — that is what shipped 5 unverified records on 2026-07-28.')
        : ok(`reach ${h}`, r.detail);
    }
  }

  // ---- the API host this routine cannot start without ----------------------
  // Deliberately NOT folded into the egress loop. A 404 here is a PASS: the root path has no route,
  // and the question is "did we reach the origin", exactly as for the citation hosts. What must fail
  // is the proxy refusing the CONNECT — which head() identifies by `x-deny-reason`, not by status.
  if (need.api) {
    const r = await head(`https://${API_HOST}/`);
    r.blocked
      ? bad(`reach ${API_HOST}`, r.detail,
          'the reader-report API is not in this environment\'s allowlist. STOP — do not route around it. '
          + 'A denied CONNECT is NOT evidence the Worker is down; check it from an unblocked network before concluding anything.')
      : ok(`reach ${API_HOST}`, r.detail);
  }

  // ---- gh: can the merge pass see PRs at all? ------------------------------
  if (need.gh) {
    try {
      sh('gh', ['--version']);
      ok('gh installed', 'yes');
      try {
        const n = JSON.parse(sh('gh', ['pr', 'list', '--state', 'open', '--limit', '1', '--json', 'number'])).length;
        ok('gh can list PRs', `${n} returned — the --json path works`);
      } catch (_) {
        bad('gh can list PRs', 'gh pr list --json failed',
          '--json uses GraphQL, which some proxies refuse. merge-gate.js cannot decide without it.');
      }
    } catch (_) {
      bad('gh installed', 'not found on PATH', 'the merge pass cannot run here — see DAILY-MERGE.md');
    }
  }

  // ---- the branch prefix this routine must use ------------------------------
  // merge-gate.js fails closed, so a routine that opens a PR on the wrong prefix leaves it classed
  // HUMAN forever — invisible, and looking exactly like a quiet morning.
  try {
    const src = fs.readFileSync(path.join(ROOT, 'tools', 'merge-gate.js'), 'utf8');
    src.includes(`'${need.prefix}'`)
      ? ok('branch prefix recognised', `${need.prefix} is in the merge-gate allowlist`)
      : bad('branch prefix recognised', `${need.prefix} is NOT in merge-gate's allowlist`,
          'a PR on this prefix would be classed HUMAN and never merge. Fix ROUTINES in tools/merge-gate.js.');
  } catch (_) { bad('branch prefix recognised', 'could not read merge-gate.js', 'checkout incomplete'); }

  // ---- report --------------------------------------------------------------
  const failures = results.filter((r) => !r.ok);
  if (JSON_OUT) {
    console.log(JSON.stringify({ routine: ROUTINE, ok: failures.length === 0, results }, null, 2));
    process.exit(failures.length ? 1 : 0);
  }
  console.log(`\n  preflight: ${ROUTINE}\n`);
  for (const r of results) console.log(`    ${r.ok ? '✓' : '✗'} ${r.name.padEnd(30)} ${r.detail}`);
  if (failures.length) {
    console.error(`\n  ✗ ${failures.length} check(s) failed — DO NOT PROCEED:\n`);
    failures.forEach((f) => console.error(`      ${f.name}: ${f.detail}\n        → ${f.fix}`));
    console.error('');
    process.exit(1);
  }
  console.log(`\n  ✓ all ${results.length} checks passed — safe to proceed\n`);
})();
