# Daily reader-report pass — the procedure a scheduled routine follows

A routine runs this every day at 04:00 ET against `main`. Its prompt is one line — "follow
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

**If you do not have the `Workflow` tool — a cloud routine does not — do the audit and the fix
YOURSELF, serially, one record at a time. Never skip the stage.** `Workflow` is a parallelisation
mechanism, not a capability: every stage is an agent doing work you can do one item at a time, and
the only coupling is a file format. Write the `journal.jsonl` yourself and `parse-audit.js` runs
unchanged with every check it carries.

This is not hypothetical. `DAILY-WAVE.md` records what happened the last time a routine reasoned
from "no Workflow tool" to "skip the stage": five records passed `validate-records` and 44
invariants and shipped a fabricated statistic, a fabricated stage prop the primary transcript
contradicts, a dead link the page called its "strongest corroboration", and a citation locator that
was wrong inside the copy-to-clipboard string. The audit that caught them returned **0 PASS / 5
FAIL, 46 issues, 4 blockers**. No mechanical gate can read prose. Serial is slower; it is not
weaker. If the budget does not fit, do **fewer records** — never fewer stages.

## Most nights there is nothing to do

That is success. There are currently ~1 pending report, and real report traffic depends on the
indexing work rather than on this pipeline. **An empty queue is not a failure and never justifies
manufacturing work.** The empty path is one authenticated GET and no agents.

## Step 0 — the checkout must be CURRENT and CLEAN

```bash
node tools/preflight.js --routine reports    # STOP if this fails
git checkout main && git fetch origin && git merge --ff-only origin/main
git status --porcelain
```

Preflight checks the token is present AND the right shape (43 chars — a `2>&1` gives you 461 of
gcloud warning), that sources are reachable, and that `reports/` is still in the merge gate's
allowlist. Each of those has failed silently at least once.

**Update before you check clean, in that order.** This pass runs in a long-lived local checkout, and
three other routines open PRs against `main` around it — the 03:00 wave, the 05:00 review, the
Monday 02:00 discovery audit — and the 07:00 merge pass lands them. Nothing pulls for you. Measured on 2026-07-29: the checkout had drifted **9 commits
behind** and was missing `.claude/settings.json` entirely, which would have made every command prompt
for permission with nobody awake. A stale checkout also audits records against superseded
sources and rebuilds pages from an old generator, so the PR it opens reverts whatever landed since.

If `merge --ff-only` fails, the checkout has local commits or has diverged. **Stop and report it** —
do not merge, rebase, or reset. Something else is using this tree.

**If that prints anything, stop and report it.** `report-gate.js`'s scope gate is
`git status --porcelain -- tools workflows`, which includes UNTRACKED files. A stray scratch file
under `tools/` makes the gate refuse every night, and it refuses with the *wrong reason* — "an agent
edited tools/" — so the failure reads as a scope escape that never happened. A dirty tree also makes
gate 3 (did the record actually change?) meaningless, because it cannot tell this run's edits from
whatever was already sitting there.

Then get the token. `/sources`, `/triage` and `/mail` are all ADMIN_TOKEN-gated, so **without it this
pass can do nothing at all** — it cannot read the queue and it cannot close a report.

```bash
export ADMIN_TOKEN=$(gcloud secrets versions access latest --secret=quotle-admin-token --project=word-boxing 2>/dev/null)
```

**`2>/dev/null`, never `2>&1`.** `gcloud` prints a Python-version deprecation warning to stderr on
every invocation. Fold that into the variable with `2>&1` and `ADMIN_TOKEN` becomes ~461 characters
of warning text with the real 43-character token buried in it — every authenticated call then 401s
for a reason that looks nothing like its cause. Two separate runs (2026-07-29) reached for `2>&1` to
quieten the warning and both had to notice and re-read. Discard stderr; do not merge it.

Sanity check if anything 401s: `echo ${#ADMIN_TOKEN}` should print **43**.

That line needs an authenticated `gcloud`. **If `ADMIN_TOKEN` is empty, stop and say so — do not
proceed.** `review.js` degrades politely on a missing token ("reader reports skipped"), which means
a tokenless run looks exactly like a quiet night: `due` still prints a full queue, ranked purely on
staleness, with every reader report silently absent from it. That is the silent-queue failure this
whole loop exists to prevent, so it has to be loud here.

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

A report line ending `reply-to: <address>` means the reader left an optional email. It is printed so
you know which reports have a person waiting on an answer, and it is the one thing on that line the
reader is owed.

**SENDING IS ON. Closing a report emails a real person.** `worker/wrangler.jsonc` ships
`"EMAIL_MODE": "send"`, and `/triage` calls `replyToReport` on the call that actually closes a
report. So `review.js stamp --close-reports --verdict FIXED` in step 6 — which calls `/triage` with `accepted` — is an
OUTBOUND ACTION, not just a database write. Treat it as one.

An earlier version of this file said "Nothing sends", which was true when it was written and wrong
by the time it merged: #201 turned sending on and #202 was written against the state before it. A
routine following that text would have mailed a stranger while believing it could not. Re-read
`EMAIL_MODE` in `worker/wrangler.jsonc` rather than trusting this paragraph.

Three guards make it safe, and they are worth knowing because they shape what you may do:
  · **Only `accepted` sends.** A rejection or an unresolvable report writes back nothing — telling
    someone "we looked and changed nothing" is noise dressed as courtesy.
  · **Only the call that actually closed the report sends.** The reply is gated on the UPDATE's
    `changed` count, so the idempotency guard and the one-reply-per-report guarantee are the same
    guarantee rather than two that have to agree.
  · **The body is composed entirely from our own facts** — the verdict and the page URL. None of the
    reader's note, quote or submitted URL is ever echoed back.

**Do not stamp a report as `accepted` unless the fix actually shipped.** With sending on, that is no
longer only a bookkeeping error — it mails someone "we fixed it" about a page that did not change.
`GET /mail` (admin) shows what was sent. **Do not flip `EMAIL_MODE`**; that is an operator decision,
not a step in this pass.

If you reply, reply once, by hand. One reply per report, ever. The form promises exactly that and
/privacy/ says the same. Never echo the reader's own text back at them: the address is optional and
unauthenticated, so anyone can file a report carrying someone else's address, and a reply that
quoted the submission would make us a reputable-looking delivery service for arbitrary text to
arbitrary strangers.

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

## Step 3 — audit

**With the `Workflow` tool.** Pass the `audit` object as args. If `auditSongs.pages` is non-empty,
run `audit-songs.js` for those in the same way. Both accept `{pages, repo}`, and `repo` must be this
checkout's absolute path — the agents Read freshly built HTML off disk, and pointed at the wrong
checkout every one of them silently finds nothing.

```
Workflow audit.js       args=<the .audit object from review-args.json>
Workflow audit-songs.js args=<the .auditSongs object>     # only if it has pages
```

**Without it.** Read `workflows/audit.js` and follow the agent prompt inside it against each page
yourself, one at a time: read the rendered HTML, re-fetch every source link and confirm it
*literally* supports the specific claim it is attached to, check confidence + rights honesty and the
URL/JSON-LD contract, then re-check each high/blocker as a skeptic. Append one
`{"type":"result","result":{…}}` line per page audit and per skeptic verdict to a `journal.jsonl`
you write yourself — that file is the entire interface to the next step.

Then turn the journal into a fixes map:

```bash
node workflows/parse-audit.js --journal <auditTranscriptDir>/journal.jsonl \
  --out workflows/.scratch/current-fixes.json
```

`parse-audit.js` pairs each finding against the skeptic's verdict and DROPS the refuted ones, so
everything downstream is skeptic-confirmed by construction. Do not re-derive that judgement.

## Step 4 — fix

```
Workflow fix.js args={"slugs":[...FAIL slugs...],"repo":"<this checkout>","kind":"quote"}
```

Songs need a second call with `"kind":"song"`. Without the `Workflow` tool, apply the fixes yourself
from `current-fixes.json`, re-verifying every factual replacement against the cited source before
editing — that re-verification is the point of the stage, not a formality.

Either way the rules are identical: edit **only** the record itself, and **REPORT** generator
defects rather than fixing them. A defect in a shared generator is one central edit affecting every
page, never a per-record fix buried in a content PR — r20 shipped +94/-14 of `template.js` change
inside a content wave, which is why gate 4 exists.

**Never invent a citation.** If you cannot verify a replacement, leave the record alone and say why
in the PR body. Refusing an instructed edit is a correct outcome.

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
- **merge** — SUPERSEDED as of 2026-07-29. Do not use it, and do not merge your own PR.

**Merging is no longer this pass's job.** `workflows/DAILY-MERGE.md` runs at 07:00 as the single
merge authority for all four routines. That exists because every routine rebuilds every page, so two
PRs open at once conflict across ~1,163 generated files — while a human merged them one at a time,
that human WAS the serialization, and auto-merging each routine independently removes the serializer
rather than the need for one. Merging your own PR here would race the 07:00 pass for the same reason.

So the live rungs are `observe` (decide, record, open nothing) and `pr` (open it and STOP). Open the
PR with the right branch prefix and finish.

**It starts in `observe` and only the operator moves it.** Promotion bar: 5 consecutive runs where
the gate's call matched theirs — no PR they would have rejected, no queued item they would have
wanted as a PR. Miss one and the counter resets. The gate never grades itself; `--judge` is an
operator command. Only runs that actually made a call are recorded, so an empty night cannot inflate
the streak by testing nothing.

### What to do with the fix-stage edits when the gate exits 3

The fix stage has already edited records on disk by the time the gate speaks. On `observe` the gate
opens nothing, which leaves those edits sitting in the working tree — and step 0 of the NEXT run
refuses on a dirty tree. So doing nothing is not an option; the first real run hit exactly this and
had to improvise.

**Push them to a held branch and open no PR:**

```bash
git checkout -b reports/<YYYY-MM-DD>-observed-fixes
node tools/build.js                    # so the branch is mergeable if the operator wants it
git add -A && git commit -m "..."      # records + rebuilt pages
git push -u origin HEAD                # NO gh pr create
```

Then return to `main` clean and land only the bookkeeping (`data/report-queue.json`,
this run's shard under `data/routine-log/`) as its own small PR.

Discarding the edits would be the wrong call: an audit that cost real tokens verified them, and
throwing them away means re-deriving the same fixes at the same cost the next night. Committing them
to the bookkeeping PR would be the other wrong call — that is opening a content PR, which is exactly
what `observe` says not to do. A held branch preserves the work without acting on it, and it is what
the operator reads when judging whether the gate's call was right.

**Do not stamp** in this case. `review.js stamp --close-reports` closes the reader's report, and closing a report
whose fix never shipped loses it — the reader is told it was dealt with when the page is unchanged.
Nothing shipped, so the report stays `pending` and resurfaces tomorrow. That is correct.

**Known cost of this, stated rather than discovered:** because nothing is stamped, the same records
stay at the top of the queue and are re-audited every night until the ladder is promoted. The first
run audited 10 records with 26 agents. At a 5-run promotion bar that is roughly five times the same
work. It is the price of `observe` being an honest rehearsal, and it is bounded by the promotion
bar — but if it bites, the answer is to judge the runs and promote, not to start stamping records
whose fixes never shipped.

## Step 6 — build, PR, and close the loop

Only when the gate exited 0.

**Order matters, and an earlier version of this file had it wrong.**

```bash
node tools/review.js stamp <slug> [<slug> …] --verdict FIXED --close-reports   # FIRST — mutates records
node tools/build.js                              # validators + corpus invariants
node tools/scan.js                               # AFTER the stamp — see below
node tools/verify-review-spine.js
```

`stamp` writes a `review` block into each record, which changes that record's **content hash**. If
`scan.js` ran before it, `data/scan-state.json` still holds the pre-stamp hash, the tree is stale the
moment you commit, and CI fails on "Committed output is stale" — the same one-line drift that turned
`main` red on 2026-07-29 when this file listed `scan.js` first. Stamp, then rebuild, then rescan.

`stamp` is what closes the reports. Without it a record ships audited, fixed and rebuilt while its
report is still `pending`, so `/sources` keeps returning it and the queue keeps scoring it at the
top forever, starving the staleness lane behind it. Closing is idempotent server-side
(`UPDATE … WHERE id=? AND status='pending'`), so a re-run changes 0 rows and a failed close simply
retries tomorrow.

Do **not** touch `answer.lastVerified` — that is the generator's wave-time claim and means something
different from `review.lastReviewedOn`.

**Branch name — load-bearing, not cosmetic.** Name the branch `reports/<YYYY-MM-DD>`. `tools/merge-gate.js` (the
07:00 merge pass) decides what may auto-merge from an ALLOWLIST OF BRANCH PREFIXES, because the
GitHub author is the same account for routine and human PRs and cannot distinguish them. It fails
closed: a branch it does not recognise is classed `HUMAN` and left alone forever. Use the wrong
prefix and this PR simply never merges — silently, and looking exactly like a quiet night.

**If today's branch name is already taken** (a run already happened today), add a suffix —
``reports/<YYYY-MM-DD>-log``. `merge-gate.js` matches on the PREFIX, so a suffix stays in the same lane;
switching to a different prefix would fail closed as `HUMAN` and never merge.

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
