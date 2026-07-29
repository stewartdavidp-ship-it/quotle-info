# Daily merge pass — the one authority that merges routine PRs

A local routine runs this every day at 07:00 ET, after the other four have finished.

The timetable it depends on, each an hour apart so no two overlap and the last finishes well clear:

| time (ET) | routine | where |
|---|---|---|
| 02:00 Mon | weekly discovery | Cloud |
| 03:00 | daily wave | Cloud |
| 04:00 | daily reports | Local |
| 05:00 | daily review | Cloud |
| **07:00** | **this pass** | Local |

The two-hour gap after the last routine is deliberate: a review night with many flags, or a wave that
runs long, still finishes before this starts. If one does not, its PR simply gets `WAIT` and merges
tomorrow — the gap reduces how often that happens, it is not what makes it safe.

## Why this exists rather than each routine merging its own PR

Four routines write to `main` inside four hours — Monday 02:00 discovery, 03:00 wave, 04:00 reports,
05:00 review — and **every one of them rebuilds every page**. Two PRs open at the same time therefore
conflict across ~1,163 generated files. Observed 2026-07-29: #207 went stale the instant #205 merged
and had to be rebuilt from source records, because resolving a conflict in derived HTML is not worth
doing and not safe to do by hand.

While a human merged them one at a time, **that human was the serialization**. Auto-merging each
routine independently does not remove the need for serialization; it removes the serializer. This
pass puts it back as one authority, running after everyone has finished.

**The content gates cannot do this job.** `report-gate.js`, the audit and the skeptic establish that
a *change is correct*. None of them can tell whether a *branch is current*. A perfectly correct PR
built against a superseded `main` silently reverts whatever landed in between — that is not a content
defect, and no content gate will ever catch it. This pass only ever asks mechanical questions.

## Step 0 — current and clean

```bash
cd /Users/davidstewart/Developer/quotle-info
git checkout main && git fetch origin && git merge --ff-only origin/main
git status --porcelain          # must print nothing
```

If `merge --ff-only` fails, or the tree is dirty: **stop and report it.** Do not reconcile. Something
else is using this checkout.

## Step 1 — ask the gate

```bash
node tools/merge-gate.js
```

It prints one verdict per open PR and never merges anything itself:

| verdict | meaning | what you do |
|---|---|---|
| `MERGE` | green, in scope, up to date | merge it — see step 2 |
| `REBUILD` | behind `main` | rebase, rebuild, push, wait for green, re-run the gate |
| `WAIT` | CI still running, or mergeability not computed | leave it; next run picks it up |
| `SKIP` | draft, red CI, conflict, or scope escape | leave it and say why in your summary |
| `HUMAN` | branch is not a known routine prefix | **never touch it** |

Exit codes: `0` something to merge, `4` only rebuilds pending, `3` nothing to do.

`HUMAN` is the important one. The GitHub author is the same account for routine and human PRs, so
the gate cannot tell them apart by authorship and instead uses an **allowlist of branch prefixes**
(`wave-`, `reports/`, `review/`, `discovery/`). It fails closed: anything unrecognised is left alone
forever. **Never merge a `HUMAN` PR, and never "fix" a routine's branch name to make it mergeable** —
if a routine used the wrong prefix, that is a bug in the routine, and the PR waits for a person.

## Step 2 — merge ONE, then re-run the gate

```bash
gh pr merge <number> --squash
node tools/merge-gate.js        # every other branch is now BEHIND
```

**One at a time, re-running between each.** Every merge invalidates every other open branch's build,
so a plan computed before the first merge is wrong by the second. Repeat until the gate returns 3
or 4.

## Step 3 — rebuild anything the gate marks REBUILD

```bash
git fetch origin && git checkout <branch> && git rebase origin/main
```

**If the rebase conflicts, do not resolve it.** Conflicts here are in generated HTML, and hand-merging
built output produces a tree no generator would emit. Instead take the source files and rebuild:

```bash
git checkout origin/main -- . && git checkout <branch> -- data/quotes data/songs
node tools/build.js && node tools/scan.js && node tools/verify-review-spine.js
```

Then commit, push, and let CI run. **Do not merge on the same pass** — wait for green and pick it up
next run, or re-run the gate once checks report. Never merge a branch whose CI has not passed *since*
the rebuild.

## Step 4 — log it

```bash
node tools/routine-log.js --routine daily-merge --outcome <no-op|pr> --processed <merged count> \
  --note "what you skipped and why"
```

A day with nothing to merge is the normal day and still gets a line.

## Do not

- merge a PR whose checks merely FINISHED — a run that stopped being "pending" may have FAILED.
  Gate on the conclusion, not the absence of pending. #210 went in red on 2026-07-29 exactly this way.
- merge anything the gate marked `HUMAN`, or rename a branch to change its verdict
- resolve conflicts in built output by hand
- edit `tools/` or `workflows/` — this pass merges other people's work and writes nothing but its log
- push to `main` directly
