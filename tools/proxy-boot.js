#!/usr/bin/env node
'use strict';
/*
 * proxy-boot.js — route Node's global fetch through the sandbox egress proxy.
 *
 * WHY. Node's `fetch` (undici) does NOT honour HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 is set, so
 * `tools/gh-rest.js` went out DIRECT and ANONYMOUS from the cloud sandbox. The 2026-07-29 08:00
 * report measured the consequence: 403 with `x-ratelimit-remaining: 0` before it made a single call.
 * GitHub's anonymous limit is 60/hr PER SOURCE IP, the cloud egress IP is shared, and it was already
 * spent by other tenants. gh-rest.js's header comment budgeted ~57 requests against 60 — the
 * arithmetic was right and the premise was wrong, because the budget was never ours alone.
 *
 * Through the proxy the same calls are authenticated at 15000/hr. Measured both ways in cloud:
 *   node …                    -> 200, x-ratelimit-limit 60,    remaining 0
 *   NODE_USE_ENV_PROXY=1 node -> 200, x-ratelimit-limit 15000, remaining 14993
 *
 * WHY A RE-EXEC AND NOT AN ASSIGNMENT. Node reads NODE_USE_ENV_PROXY once, while it initialises the
 * global dispatcher, before any user code runs. `process.env.NODE_USE_ENV_PROXY = '1'` at the top of
 * a script is therefore a no-op that LOOKS like a fix — the exact defect class this repo keeps
 * finding. Re-exec is the only way to set it from inside a program.
 *
 * WHY NOT JUST EXPORT IT IN THE ROUTINE DOCS. Six docs and six prompts would each have to remember
 * it, and the failure is a whole night of merges not happening. This makes it structural instead.
 * merge-gate.js already fails LOUD on a rate-limited read (#241) rather than reporting an empty
 * queue, so this is about the night working, not about a silent wrong answer.
 *
 * NO-OP unless a proxy is actually configured, so local runs are untouched.
 */
module.exports = function proxyBoot() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  // Already flagged, or nothing to route through: leave the process alone.
  if (!proxy || process.env.NODE_USE_ENV_PROXY) return;

  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    // The guard above is what stops this recursing: the child sees the flag set and returns.
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  if (r.error) {
    console.error(`proxy-boot: could not re-exec through the proxy — ${r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status === null ? 1 : r.status);
};
