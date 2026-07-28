# Daily review pass — the procedure a scheduled cloud routine follows

A claude.ai routine runs this every day at 10:00 UTC (06:00 ET) against `main`. Its prompt is one
line — "follow `workflows/DAILY-REVIEW.md`" — so the procedure lives here, versioned with the code
it drives, and can change without editing the routine.

## Most days there is nothing to do

That is success, not failure. The queue is flag-driven: if no detector fired, there is no work, and
the run should cost almost nothing. **Never manufacture work.** A day with no PR is the normal day.

## The steps

```bash
node tools/scan.js          # tier 1 — deterministic, no agents, no tokens
node tools/vocab-sweep.js   # discovery — unused generator vocabulary
```

**If `scan` reports `flagged: 0`, STOP.** Report one line — records scanned, 0 flagged, any
vocab-sweep warnings — and exit. No commit, no PR, no further steps.

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

Edit **only** `data/quotes/*.json`. Never `tools/` or `workflows/`. Check before committing:

```bash
git status --porcelain -- tools workflows   # must print nothing
```

A defect in a shared generator is one central edit affecting every page, not a per-record fix — if
you find one, report it in the PR body and change nothing.

## Finish

```bash
node tools/build.js         # gates: validate-records, validate-songs, validate-workflows, 43 invariants
node tools/scan.js          # the flags you fixed should now be gone
node tools/review.js stamp <slug> [<slug> …]   # records that these were reviewed today
```

`review.js stamp` writes `record.review.lastReviewedOn`. Do **not** touch `answer.lastVerified` —
that is the generator's wave-time claim and means something different.

Then branch, commit, push, and open a PR. In the body state: what was flagged, what you verified,
what you changed, **and anything you deliberately did not change and why**. That last part is the
most useful line in the PR.

## Do not

- run `harvest`, `select`, `batch`, `generate` or `_ingest` — this pass never grows the corpus
- edit `data/harvest-queue.json` or `backlog-index.json` by hand
- `harvest.js skip` anything — the skip bar is hate/harm only
- push to `main` directly
