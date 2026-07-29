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
  reports:   { token: false, egress: true,  gh: false, prefix: 'reports/' },
  // `reports-close` is the noon half, and the ONLY routine that can email a reader. It authenticates
  // to /sources and /triage, needs no sources (it reads records off disk), and runs where the token
  // is. A bad token here is not a read-only inconvenience: it decides whether a real person hears
  // back about a page they reported.
  'reports-close': { token: true, egress: false, gh: false, prefix: 'reports/' },
  // Review is flag-driven and usually costs nothing, but a night WITH flags fetches sources to test
  // each remedy — so it needs egress even though most nights never use it.
  review:    { token: false, egress: true,  gh: false, prefix: 'review/' },
  // The merge pass touches no sources and needs no token; it needs to be able to see PRs at all.
  merge:     { token: false, egress: false, gh: true,  prefix: 'merge/' },
  // The 08:00 report reads PR bodies and merge history, so it needs gh; it fetches no sources
  // and authenticates to nothing.
  report:    { token: false, egress: false, gh: true,  prefix: 'report/' },
};

// The hosts this corpus actually cites, apex-first. `*.archive.org` does NOT match the bare apex
// `archive.org`, which is the third most-cited host here (577 citations) — that mismatch cost the
// 2026-07-29 wave its best primary route for two records.
const HOSTS = ['en.wikiquote.org', 'quoteinvestigator.com', 'archive.org', 'www.gutenberg.org'];

const results = [];
const ok = (name, detail) => results.push({ name, ok: true, detail });
const bad = (name, detail, fix) => results.push({ name, ok: false, detail, fix });

function sh(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
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
    const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    branch === 'main' ? ok('git on main', branch) : bad('git on main', `on ${branch}`, 'git checkout main');
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
