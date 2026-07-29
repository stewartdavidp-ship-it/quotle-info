# Daily review pass — the procedure a scheduled cloud routine follows

A claude.ai routine runs this every day at 09:00 UTC (05:00 ET in summer) against `main`. Its prompt is one
line — "follow `workflows/DAILY-REVIEW.md`" — so the procedure lives here, versioned with the code
it drives, and can change without editing the routine.

## Most days there is nothing to do

That is success, not failure. The queue is flag-driven: if no detector fired, there is no work, and
the run should cost almost nothing. **Never manufacture work.** A day with no PR is the normal day.

## Step 0 — preflight

```bash
node tools/preflight.js --routine review
```

**If it fails, STOP.** It checks the things that have each, at least once, failed *silently* — a
missing or `2>&1`-corrupted token, blocked egress, a stale or dirty checkout, a branch prefix the
merge gate would classify `HUMAN` forever. Every one of those previously presented as "nothing
happened", which is indistinguishable from a quiet night. Preflight makes them loud, once, before
any work is done.

It only reads. It fetches no secret, writes nothing, and does not touch git state.

## The steps

```bash
node tools/scan.js          # tier 1 — deterministic, no agents, no tokens
node tools/vocab-sweep.js   # discovery — unused generator vocabulary
```

**If `scan` reports `flagged: 0`, STOP INVESTIGATING.** Report one line — records scanned,
0 flagged, any vocab-sweep warnings. Open no records, run no `scan-fixes.js`, change no records,
run no build. Then skip straight to "Record what this run did" below, which still applies: the
no-op line is the whole point of a clean day and needs its own small PR to survive.

(An earlier draft of this file said "no commit, no PR" here, which contradicted that section three
paragraphs down. A routine hit the contradiction on its second run, followed the log instruction,
and reported the conflict rather than silently picking one — which is the right behaviour and the
reason this now says what it means.)

**If records are flagged:**

```bash
node tools/scan-fixes.js --out workflows/.scratch/current-fixes.json
```

That writes `{ "<slug>": [ {severity, location, problem, fix}, … ] }`. The `fix` line is the
detector's `remedy`.

Fix each record yourself. A cloud routine has no `Workflow` tool, so do not try to spawn subagents —
there are rarely more than one or two flagged records, which is why this route is cheap.

For each flagged record:

1. Read `data/quotes/<slug>.json` in full.
2. **Every remedy is conditional and refusable.** It names a check to run first and what to do when
   that check fails. Run the check against the record's own cited sources — fetch them and read
   them. Do not take the remedy's first branch on trust.
3. If the evidence does not support the primary edit, **take the alternative the remedy names** and
   say so in the PR body. Precedent worth knowing: a record labelled *"Not coined by Selfridge"* was
   deliberately **not** given `schema.claimVerb`, because no source showed Selfridge ever said the
   line — Quote Investigator names him once in a 1911 list of retailers, and the 1909 "always right"
   wording is the British press's. The label was reworded instead. Refusing the instructed edit was
   the correct outcome.
4. **Never invent a citation.** If you cannot verify, leave the record alone and say why.

## Scope

Edit **only** `data/quotes/*.json` (plus this run's own shard under `data/routine-log/`, which
`routine-log.js` writes for you). Never `tools/` or `workflows/`. Check before committing:

```bash
git status --porcelain -- tools workflows   # must print nothing
```

A defect in a shared generator is one central edit affecting every page, not a per-record fix — if
you find one, report it in the PR body and change nothing.

## Record what this run did — even when it did nothing

```bash
node tools/routine-log.js --routine daily-review --outcome no-op --scanned <N> --flagged 0
```

Do this on the `flagged: 0` path too, and commit the line on its own small PR. **A no-op day is
data**: it is what proves the flag-driven route is cheap, and a missing line is indistinguishable
from a run that never happened.

When there was work: `--outcome pr --scanned <N> --flagged <N> --processed <N> --pr <url>`, plus
`--note` for anything you refused to change and why.

## Finish

**Order matters: stamp FIRST, scan LAST.**

```bash
node tools/review.js stamp <slug> [<slug> …]   # FIRST — mutates records. Records that these were reviewed today
node tools/build.js         # gates: validate-records, validate-songs, validate-workflows, 43 invariants
node tools/scan.js          # LAST — the flags you fixed should be gone, and record hashes are refreshed
```

`stamp` writes a `review` block into each record, which changes that record's **content hash**. Run
`scan.js` before it and `data/scan-state.json` keeps the pre-stamp hash — so the tree is stale the
moment you commit, and CI fails on "Committed output is stale". `verify.yml` runs `scan.js` itself
(added 2026-07-29), which is what makes this ordering load-bearing rather than cosmetic: the same
inversion turned `main` red the day the check landed.

`review.js stamp` writes `record.review.lastReviewedOn`. Do **not** touch `answer.lastVerified` —
that is the generator's wave-time claim and means something different.

**Branch name — load-bearing, not cosmetic.** Name the branch `review/<YYYY-MM-DD>`. `tools/merge-gate.js` (the
07:00 merge pass) decides what may auto-merge from an ALLOWLIST OF BRANCH PREFIXES, because the
GitHub author is the same account for routine and human PRs and cannot distinguish them. It fails
closed: a branch it does not recognise is classed `HUMAN` and left alone forever. Use the wrong
prefix and this PR simply never merges — silently, and looking exactly like a quiet night.

**If today's branch name is already taken** (a run already happened today), add a suffix —
``review/<YYYY-MM-DD>-log``. `merge-gate.js` matches on the PREFIX, so a suffix stays in the same lane;
switching to a different prefix would fail closed as `HUMAN` and never merge.

Then branch, commit, push, and open a PR. In the body state: what was flagged, what you verified,
what you changed, **and anything you deliberately did not change and why**. That last part is the
most useful line in the PR.

**Open the PR READY, never as a draft** (`gh pr create` without `--draft`). A draft cannot be
merged, so every draft leaves an unmergeable PR sitting until a human clicks "Ready for review" —
which happened on the first two routine runs before anyone noticed. Draft/ready is now load-bearing in a second way: the
07:00 merge pass (`workflows/DAILY-MERGE.md`) SKIPS drafts, so a draft is never merged and never
chased — it simply sits until someone notices.

## Do not

- run `harvest`, `select`, `batch`, `generate` or `_ingest` — this pass never grows the corpus
- edit `data/harvest-queue.json` or `backlog-index.json` by hand
- `harvest.js skip` anything — the skip bar is hate/harm only
- push to `main` directly
