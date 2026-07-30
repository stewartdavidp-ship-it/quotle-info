# Daily merge pass — the one authority that merges routine PRs

**This pass is `.github/workflows/merge.yml`. It is not an agent and this document is not its
procedure — it is the explanation of what that workflow does and why.** Run it by hand from a
checkout with `node tools/merge-run.js` (dry run) or `--execute`; the sections below are the same
steps, for a human doing it manually or debugging a run.

> **Where it runs, and where the schedule lives.** The schedule is the `cron:` in `merge.yml` —
> 11:00 UTC / 07:00 ET, after the other routines have opened their PRs. **This file used to restate
> the whole timetable in a table, and the table went stale** the day the routines moved to cloud: it
> still said this pass ran "Local" weeks later, which is what sent a diagnosis looking at the wrong
> machine. A doc that keeps a second copy of the scheduler will always drift from it, so it no longer
> keeps one. For what runs when, read the triggers.
>
> The routines are spaced an hour apart so no two overlap, and this pass runs after the last of them.
> If one runs long its PR simply gets `WAIT` and merges on the next pass — the gap reduces how often
> that happens, it is not what makes it safe.

**Why it is a workflow and not an unattended session.** Every decision here is already in
`tools/merge-gate.js`, which has fixtures and a self-test; the agent that used to wrap it contributed
no judgement and three failure modes — it could not run where it was scheduled (cloud has no `gh`,
and its API identity has `push:false`, measured in `probe/cloud-auth-2026-07-30`), a stop left no
artifact anywhere so a broken night looked like a quiet one, and the procedure lived in prose and
drifted from the code. Actions keeps a permanent run log for every execution, pass or fail.

## Why this exists rather than each routine merging its own PR

Four routines write to `main` inside four hours — Monday 02:00 discovery, 03:00 wave, 04:00 reports,
05:00 review — and every one of them rebuilds every page. They still need serializing, but for a
narrower reason than this file first claimed: with branch protection on `strict: true`, merging any
one PR puts every other one BEHIND, so they must go in one at a time, bringing each current between. Merge two
in parallel and the second is refused, not corrupted.

While a human merged them one at a time, **that human was the serialization**. Auto-merging each
routine independently does not remove the need for serialization; it removes the serializer. This
pass puts it back as one authority, running after everyone has finished.

**The content gates cannot do this job.** `report-gate.js`, the audit and the skeptic establish that
a *change is correct*. None of them can tell whether a *branch is current*. A perfectly correct PR
built against a superseded `main` silently reverts whatever landed in between — that is not a content
defect, and no content gate will ever catch it. This pass only ever asks mechanical questions.

## Step 0 — current and clean

```bash
git checkout main && git fetch origin && git merge --ff-only origin/main
git status --porcelain          # must print nothing
```

If `merge --ff-only` fails, or the tree is dirty: **stop and report it.** Do not reconcile. Something
else is using this checkout.

**This comes FIRST, before preflight.** It used to come second — and both sections were numbered
"Step 0", which is the tell. Preflight checks that you are on `main` and current, so running it
before the step that puts you there fails on any fresh clone: a cloud container starts on a detached
HEAD, so the pass stopped on a condition its own next section would have fixed. `merge.yml` gets
this right for free (`actions/checkout` lands on the branch), so this ordering matters for a human
running it by hand.

## Step 1 — preflight

```bash
node tools/preflight.js --routine merge
```

**If it fails, STOP.** It checks the things that have each, at least once, failed *silently* — a
missing or `2>&1`-corrupted token, blocked egress, a stale or dirty checkout, a branch prefix the
merge gate would classify `HUMAN` forever. Every one of those previously presented as "nothing
happened", which is indistinguishable from a quiet night. Preflight makes them loud, once, before
any work is done.

It only reads. It fetches no secret, writes nothing, and does not touch git state.

It no longer requires the `gh` binary. `gh` was a stand-in for "can perform the merge write", and a
stand-in is not the capability — it failed the pass in cloud for a missing binary while the real
blocker there was a different thing entirely (`permissions.push:false`). The write now goes over
REST from `merge.yml`.

## Step 1 — ask the gate

```bash
node tools/merge-gate.js
```

It prints one verdict per open PR and never merges anything itself:

| verdict | meaning | what you do |
|---|---|---|
| `MERGE` | green, in scope, up to date | merge it — see step 2 |
| `REBUILD` | behind `main` | merge main in, rebuild, push, wait for green, re-run the gate |
| `WAIT` | CI still running, or mergeability not computed | leave it; next run picks it up |
| `SKIP` | draft, red CI, conflict, or scope escape | leave it and say why in your summary |
| `HUMAN` | branch is not a known routine prefix | **never touch it** |

Exit codes: `0` something to merge, `4` only rebuilds pending, `3` nothing to do.

`HUMAN` is the important one. The GitHub author is the same account for routine and human PRs, so
the gate cannot tell them apart by authorship and instead uses an **allowlist of branch prefixes**
(`wave-`, `reports/`, `review/`, `discovery/`). It fails closed: anything unrecognised is left alone
forever. **Never merge a `HUMAN` PR, and never "fix" a routine's branch name to make it mergeable** —
if a routine used the wrong prefix, that is a bug in the routine, and the PR waits for a person.

## Branch protection enforces this — the gate only advises

Since 2026-07-29 `main` requires the `verify` check to pass AND requires branches to be up to date
before merging (`strict: true`). Force-pushes and branch deletion are off.

That is the difference between a gate and a rule. `merge-gate.js` CHECKS staleness and CI; GitHub
now REFUSES the merge regardless of what any session decides. It is the backstop for the failure this
whole pass exists to prevent — a correct PR built against a superseded `main` silently reverting what
landed in between — and it would have blocked #210, which went in red because a merge command waited
for CI to stop being *pending* rather than to *pass*.

`enforce_admins` is deliberately **false**, so a human keeps an emergency override. Nothing automated
has that override: routines authenticate as a normal user.

**Expect more `REBUILD` verdicts because of this.** With `strict: true`, merging the first PR
immediately puts every other one behind, so the second must be brought current and rebuilt before it can go.
That is the designed path (step 3), not a fault — but some nights the second PR will land the
following morning, and that is fine.

## Step 2 — merge ONE, then re-run the gate

```bash
gh pr merge <number> --squash
node tools/merge-gate.js        # every other branch is now BEHIND
```

**One at a time, re-running between each.** Every merge invalidates every other open branch's build,
so a plan computed before the first merge is wrong by the second. Repeat until the gate returns 3
or 4.

## Step 3 — rebuild anything the gate marks REBUILD

**Do NOT rebase.** A rebase rewrites history and can only be pushed with `--force`, which is DENIED
repo-wide in `.claude/settings.json` — so the rebase would succeed locally and the push would be
refused, leaving you stuck mid-operation. This file prescribed a rebase in four places until
2026-07-29, when a run hit exactly that wall and correctly used the non-rewriting route instead.

Bring the branch current by MERGING main into it, which is a fast-forwardable push:

```bash
git fetch origin && git checkout <branch>
git merge origin/main -m "Merge main"      # NOT rebase — force-push is denied
node tools/build.js                        # regenerate against the new base
git add -A && git commit -m "Rebuild after merging main"   # only if the build changed anything
git push origin HEAD:<branch>              # ordinary push, no force
```

GitHub's "Update branch" button does the same thing and is equally fine.

**Generated output does NOT conflict — that assumption was wrong and cost a day.** This file used to
claim two routine PRs collide across ~1,163 rebuilt pages. Measured on 2026-07-29 with `git merge-tree`
against three real PRs: the generated HTML and JSON merged cleanly every time, including #224's 31
built files. The ONLY file that ever conflicted was `data/routine-log.jsonl`, because five routines
appended to one shared tail — since fixed by giving each run its own file in `data/routine-log/`.

So a `REBUILD` is normally just merging main in and rebuilding. If that DOES conflict, do not hand-resolve built output —
take the source files and rebuild them, which is deterministic where a hand-merge is not:

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
