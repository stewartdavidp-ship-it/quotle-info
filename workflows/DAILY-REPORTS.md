# Daily reader-report pass — the procedure a scheduled routine follows

A routine runs this every day at 05:00 ET against `main`. Its prompt is one line — "follow
`workflows/DAILY-REPORTS.md`" — so the procedure lives here, versioned with the code it drives.

This is the DISPUTE lane only: "something on a page here is wrong". The ADD lane (a reader
nominating a missing quote) is answered synchronously by `GET /lookup` at submit time and has no
daily job — deliberately. **No job may call `harvest.js sync` on nomination output**: once a
candidate is queued it IS published (rendered into `/under-review/`, embedded in `/flagged/`,
indexed into `search.json`), so an automated path from anonymous input to a public page would put a
fabricated quote, attributed to a named living person, on a provenance site.

## Why this is a routine and not a cron job

`workflows/audit.js` and `workflows/fix.js` are Workflow-tool scripts, not node CLIs. Nothing
invokable from a shell can run them. Every other step here is a plain command; those two are the
reason a model has to be in the loop.

## Most nights there is nothing to do

That is success. There are currently ~1 pending report, and real report traffic depends on the
indexing work rather than on this pipeline. **An empty queue is not a failure and never justifies
manufacturing work.** The empty path is one authenticated GET and no agents.

## Step 0 — the checkout must be CLEAN

```bash
git status --porcelain
```

**If that prints anything, stop and report it.** `report-gate.js`'s scope gate is
`git status --porcelain -- tools workflows`, which includes UNTRACKED files. A stray scratch file
under `tools/` makes the gate refuse every night, and it refuses with the *wrong reason* — "an agent
edited tools/" — so the failure reads as a scope escape that never happened. A dirty tree also makes
gate 3 (did the record actually change?) meaningless, because it cannot tell this run's edits from
whatever was already sitting there.

Then get the token:

```bash
export ADMIN_TOKEN=$(gcloud secrets versions access latest --secret=quotle-admin-token --project=word-boxing)
```

## Step 1 — is there anything at all?

```bash
node tools/review.js reports
```

**If it prints `no pending reader reports`, you are done.** Do not scan, do not audit, do not open
records. Log the no-op and stop:

```bash
node tools/routine-log.js --routine daily-reports --outcome no-op --processed 0
```

Commit that one line on its own small PR. A no-op day is data: it is what proves the empty path is
cheap, and a missing line is indistinguishable from a run that never happened.

`reports` classifies into four buckets. Three of them never reach the due queue on their own:

| bucket | what it is | what you do |
|---|---|---|
| ROUTABLE | joins to a quote record | continue to step 2 |
| SONGS | `song:<slug>` from one of the ~97 song pages | continue to step 2; they audit via `audit-songs.js` |
| NO SLUG | the reader typed the line instead of pasting a link | identify by hand if you can, else triage `unresolvable` |
| UNKNOWN SLUG | renamed or deleted since the report was filed | triage `unresolvable` — nothing will ever join these |

**Drain the last two in the same run.** A report that joins to no record stays `pending` forever,
and `/sources?status=pending` never draining is the original bug this whole loop was built to fix.

## Step 2 — scan, then pick the work

```bash
node tools/scan.js                 # deterministic, no agents; writes only if findings changed
node tools/review.js due --limit 10
node tools/review.js args --limit 10 > workflows/.scratch/review-args.json
```

`args` emits BOTH shapes in one object: `audit` (quote pages, with confidence + rights) and
`auditSongs` (song pages, with the `song:` prefix already stripped — that prefix is a queue-keying
detail, not part of the record's identity). Reader-reported records sort to the top by construction;
the tier weights are asserted in `tools/verify-review-spine.js`, not merely intended.

## Step 3 — audit (Workflow tool)

Pass the `audit` object as args. If `auditSongs.pages` is non-empty, run `audit-songs.js` for those
in the same way. Both accept `{pages, repo}` and `repo` must be this checkout's absolute path.

```
Workflow audit.js       args=<the .audit object from review-args.json>
Workflow audit-songs.js args=<the .auditSongs object>     # only if it has pages
```

Then turn the journal into a fixes map:

```bash
node workflows/parse-audit.js --journal <auditTranscriptDir>/journal.jsonl \
  --out workflows/.scratch/current-fixes.json
```

`parse-audit.js` pairs each finding against the skeptic's verdict and DROPS the refuted ones, so
everything downstream is skeptic-confirmed by construction. Do not re-derive that judgement.

## Step 4 — fix (Workflow tool)

```
Workflow fix.js args={"slugs":[...FAIL slugs...],"repo":"<this checkout>","kind":"quote"}
```

Songs need a second call with `"kind":"song"`. Fix agents edit **only their own record** and are
told to REPORT generator defects rather than edit them — a defect in a shared generator is one
central edit affecting every page, never a per-record fix buried in a content PR.

## Step 5 — the gate decides, not you

```bash
node tools/report-gate.js --fixes workflows/.scratch/current-fixes.json
```

Four gates, all of which must hold or the item queues: skeptic-confirmed, severity blocker/high,
a real diff in `data/quotes` or `data/songs`, and a clean scope gate. Exit **3** means there is
nothing to PR — **skip the build, the commit and the PR entirely** and go to step 7.

It also prints the current rung of the trust ladder:

- **observe** — runs every gate, records what it WOULD have done, opens nothing. Always exits 3.
- **pr** — opens the PR and stops.
- **merge** — merges on green CI.

**It starts in `observe` and only the operator moves it.** Promotion bar: 5 consecutive runs where
the gate's call matched theirs — no PR they would have rejected, no queued item they would have
wanted as a PR. Miss one and the counter resets. The gate never grades itself; `--judge` is an
operator command. Only runs that actually made a call are recorded, so an empty night cannot inflate
the streak by testing nothing.

## Step 6 — build, PR, and close the loop

Only when the gate exited 0.

```bash
node tools/build.js                              # validators + 27 corpus invariants
node tools/scan.js && node tools/verify-review-spine.js
node tools/review.js stamp <slug> [<slug> …]     # calls /triage — this is the RETURN LEG
```

`stamp` is what closes the reports. Without it a record ships audited, fixed and rebuilt while its
report is still `pending`, so `/sources` keeps returning it and the queue keeps scoring it at the
top forever, starving the staleness lane behind it. Closing is idempotent server-side
(`UPDATE … WHERE id=? AND status='pending'`), so a re-run changes 0 rows and a failed close simply
retries tomorrow.

Do **not** touch `answer.lastVerified` — that is the generator's wave-time claim and means something
different from `review.lastReviewedOn`.

Then branch, commit, push, and open the PR **READY, never as a draft** (`gh pr create` without
`--draft`). A draft cannot be merged, so it sits unmergeable until a human clicks a button. Nothing
here auto-merges below the `merge` rung, so a ready PR still waits for a human either way.

In the PR body state: which reports drove it, what the audit found, what the skeptic confirmed,
what changed — **and anything you deliberately did not change and why.** That last line is the most
useful one in the PR.

## Step 7 — log the run, always

```bash
node tools/routine-log.js --routine daily-reports --outcome <no-op|pr|error> \
  --processed <N> --findings <N> [--pr <url>] [--note "..."]
```

## Do not

- call `harvest.js sync`, `harvest.js skip`, `select`, `batch`, `generate` or `_ingest` — this pass
  never grows the corpus
- auto-correct an attribution because a stranger's link disagrees with ours. Anonymous input
  reaching a published attribution is trivially abusable: submit a plausible link often enough and
  the record moves. Flagging costs one audit cycle and removes the attack surface.
- exempt `data/scan-state.json` from the dirty check to make CI pass. It is a gate.
- push to `main` directly
