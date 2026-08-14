# Daily wave — build 5 records from the backlog

A claude.ai routine runs this daily at 07:00 UTC (03:00 ET) against `main`.

## Run the committed pipeline. All of it.

`workflows/README.md` documents the wave as **select → batch → generate → prep-wave → ingest →
build → audit → fix → theme-tag → ship**, and warns in capitals about waves built outside it.

An earlier version of this file told you to skip four of those stages — including both quality
gates — on the grounds that a cloud session has no `Workflow` tool. **That was wrong, and it shipped
fabricated facts.** The five records built that way passed `validate-records`, passed 44 invariants,
and carried a fabricated statistic (a foundation's grants stated as "more than a billion dollars"
against a real $458 million), a fabricated stage prop the primary transcript contradicts in the
speaker's own words, a dead link the page called its "strongest corroboration", and a citation
locator that was wrong inside the copy-to-clipboard string. The audit that caught them returned
**0 PASS / 5 FAIL, 46 issues, 4 blockers**, with 16 of 17 skeptic verdicts confirmed. No mechanical
gate can read prose. Stage 5 is the only thing that can.

**`Workflow` is a PARALLELISATION mechanism, not a capability.** Every stage here is an agent doing
work you can do yourself, one item at a time. The only coupling is a file format: `prep-wave.js` and
`parse-audit.js` read a `journal.jsonl`. Write that file yourself and both CLIs run unchanged, with
every check they carry.

Serial is slower. It is not weaker. Budget roughly **1.5–2M tokens** for 5 records end to end
(measured: audit ~293K/page, fix ~91K/record). If that does not fit, build **fewer records** — never
fewer stages.

## Step 0 — preflight

```bash
node tools/preflight.js --routine wave
```

**If it fails, STOP.** It checks the things that have each, at least once, failed *silently* — a
missing or `2>&1`-corrupted token, blocked egress, a stale or dirty checkout, a branch prefix the
merge gate would classify `HUMAN` forever. Every one of those previously presented as "nothing
happened", which is indistinguishable from a quiet night. Preflight makes them loud, once, before
any work is done.

It only reads. It fetches no secret, writes nothing, and does not touch git state.

**TWO exceptions, and only these two. Both are "run the one command preflight itself printed, then
re-run it".**

**(a) added 2026-08-04 — the `local main sane` recovery.** If the only failures are `local main
sane` (and, consequently, `git on main`) **and `tree clean` PASSED**, run the single command
preflight names — `git checkout -B main origin/main` — then re-run preflight and continue only if
it comes back green.

**(b) added 2026-08-14 — `git on main` ALONE.** If `git on main` is the *only* failure — with
`local main sane`, `tree clean` and `current with origin/main` all PASSING — run preflight's own
printed remedy, `git checkout main`, then re-run and continue only if green. This is the milder
cousin of (a): nothing is discarded at all, because local `main` is already a sane ancestor of
`origin/main` and the tree is already clean; the container simply started off the branch. It fired
on all four passes a day for nine consecutive days (2026-08-06 → 08-14) and every routine
improvised the same recovery in prose — a procedure gap, not four independent judgement calls. It
does NOT close the underlying question: something leaves the container off `main` at start, and
finding it would retire this exception.

Every other preflight failure is still a hard STOP and is not yours to fix.

Both **relax WHO acts, not WHAT is checked**: every check must still pass on the re-run, the tree
must ALREADY be clean so nothing uncommitted is at risk, and the only thing (a) discards is a local
`main` ref that is not an ancestor of `origin/main`. On 2026-08-04 exactly this state stopped the
reports, review and report passes for a full day, and preflight's old remedy (`git checkout main`)
would have made it worse by moving the tree onto the stale root.

## 1. Select

```bash
node tools/harvest.js report
node tools/harvest.js select 5 --wave dYYYYMMDD
node tools/harvest.js batch  --wave dYYYYMMDD   # → data/.harvest-batch-dYYYYMMDD.json
```

If `select` warns that candidates carry no `demandScore`, run `node tools/rank-backlog.js` first, or
the wave silently reverts to alphabetical-by-author.

## 2. Generate — one dossier per quote, written as a journal

This is `generate.js`'s job. Read `workflows/generate.js` for the prompt it uses and its
`DOSSIER_SCHEMA` for the exact field list — **follow that schema**, because it is what forces every
claim into a field that has to be filled from a source. Freehand prose is what drifts into
confident filler.

For each of the 5 batch items, research the quote (defer to Quote Investigator and Wikiquote, find
the earliest documented appearance) and append **two lines** to `/tmp/gen-dYYYYMMDD.jsonl`:

```
{"type":"started","key":"<slug>"}
{"type":"result","result":{ …the dossier… }}
```

`_journal.js` counts `started` and `result` lines and refuses to proceed if starts exceed results,
so write them in pairs. `prep-wave.js` requires `result.meta` and `result.author` on every entry.

Never invent a citation, a date, or an excerpt. A thin record is fine; a fabricated one is not.

## 3. Prep — the gate that was skipped

```bash
node workflows/prep-wave.js --journal /tmp/gen-dYYYYMMDD.jsonl \
  --batch data/.harvest-batch-dYYYYMMDD.json \
  --out workflows/.scratch/records-dYYYYMMDD.json \
  --verified-date "D Mon YYYY" --date-modified "YYYY-MM-DD" --credited
```

Escaping scan, STUB detection, `creditedTo` stamping. If it reports stubs, re-generate those quotes
rather than shipping them.

## 4. Ingest + build

```bash
node tools/_ingest.js workflows/.scratch/records-dYYYYMMDD.json
node tools/build.js
```

If `build.js` fails, fix the record it names. Never bypass the gate.

## 5. Audit — NOT OPTIONAL

For **each** of the 5 built pages: read `who-said/<slug>/index.html`, re-fetch **every** source link,
and test whether it literally supports the specific claim attached to it. Check that the visible
prose and the JSON-LD agree — that pairing is where this corpus fails most. Check `confidence` and
`source.rights` are honest. Read `workflows/audit.js` for the criteria.

Append results to `/tmp/audit-dYYYYMMDD.jsonl` in the same `{"type":"result","result":{…}}` shape,
carrying `{page, verdict, issues:[{severity, location, claim, sourceLink, problem, fix}]}`.

Then re-check every `high` and `blocker` yourself as a skeptic, defaulting to "this finding is
wrong", and drop the ones that do not survive. Roughly 15–20% should not.

```bash
node workflows/parse-audit.js --journal /tmp/audit-dYYYYMMDD.jsonl \
  --out "$(pwd)/workflows/.scratch/current-fixes.json"
```

## 6. Fix

Work through `current-fixes.json` per record, re-verifying every factual replacement against the
cited source before writing it. **Every remedy is refusable** — if the evidence does not support the
prescribed edit, do the alternative and say so.

A defect in a shared generator is **one central edit**, not a per-record fix: report it in the PR
body and change nothing under `tools/`. Then rebuild.

## 7. Theme-tag, then ship

Tag the new records (see the `tag-themes` step in `README.md`) so they appear on `/themes`, rebuild,
then:

```bash
echo '[]' > /tmp/empty.json && node tools/harvest.js sync /tmp/empty.json   # selected → ingested
node tools/build.js   # REQUIRED again here — the sync above just changed the queue, and the
                      # roll-ups (under-review/, index, search) render it, so the step-6 build is
                      # now stale. d20260809 (#404) and d20260810 (#424) both shipped without this
                      # and failed CI's stale-output gate on the same six files.
node tools/scan.js
node tools/routine-log.js --routine daily-wave --outcome pr --built <N> --pr <url> \
  --note "audit: N PASS / N FAIL, N issues; anything you could not establish"
```

**Branch name — load-bearing, not cosmetic.** Name the branch `wave-<waveId>`. `tools/merge-gate.js` (the
07:00 merge pass) decides what may auto-merge from an ALLOWLIST OF BRANCH PREFIXES, because the
GitHub author is the same account for routine and human PRs and cannot distinguish them. It fails
closed: a branch it does not recognise is classed `HUMAN` and left alone forever. Use the wrong
prefix and this PR simply never merges — silently, and looking exactly like a quiet night.

**If today's branch name is already taken** (a run already happened today), add a suffix —
`a distinct wave id, e.g. `wave-d20260729c``. `merge-gate.js` matches on the PREFIX, so a suffix stays in the same lane;
switching to a different prefix would fail closed as `HUMAN` and never merge.

Branch and commit. **Then, before pushing, run CI's staleness check yourself:**

```bash
node tools/build.js && node tools/scan.js
git status --porcelain   # must print NOTHING
```

This is the "Committed output matches the generators" job from `.github/workflows/verify.yml`, run
locally. Any output means the commit is stale — a late stage (the sync above, an audit fix) changed
inputs after the last rebuild. `git add -A && git commit --amend --no-edit`, re-run the check, and
push only when it comes back empty. Ship means CI-green, not build-succeeded.

Push, **open the PR ready — never a draft** (`gh pr create` without `--draft`; a
draft cannot be merged and just waits for a human to click). In the body: the 5 quotes with verdict
and rights, the audit's PASS/FAIL and issue counts, what you fixed, what you refused to fix and
why, and anything you could not establish.

## Do not

- skip stages 5 or 6 — that is what produced the fabrications above
- edit `tools/` or `workflows/` — check `git status --porcelain -- tools workflows`
  (writing this run's shard under `data/routine-log/` is expected and fine)
- hand-edit `data/harvest-queue.json` or `backlog-index.json` — use `harvest.js`
- `harvest.js skip` anything — the bar is hate/harm only
- push to `main`
