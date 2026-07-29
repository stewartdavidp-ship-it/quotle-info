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
node tools/scan.js
node tools/routine-log.js --routine daily-wave --outcome pr --built <N> --pr <url> \
  --note "audit: N PASS / N FAIL, N issues; anything you could not establish"
```

**Branch name — load-bearing, not cosmetic.** Name the branch `wave-<waveId>`. `tools/merge-gate.js` (the
07:00 merge pass) decides what may auto-merge from an ALLOWLIST OF BRANCH PREFIXES, because the
GitHub author is the same account for routine and human PRs and cannot distinguish them. It fails
closed: a branch it does not recognise is classed `HUMAN` and left alone forever. Use the wrong
prefix and this PR simply never merges — silently, and looking exactly like a quiet night.

Branch, commit, push, **open the PR ready — never a draft** (`gh pr create` without `--draft`; a
draft cannot be merged and just waits for a human to click). In the body: the 5 quotes with verdict
and rights, the audit's PASS/FAIL and issue counts, what you fixed, what you refused to fix and
why, and anything you could not establish.

## Do not

- skip stages 5 or 6 — that is what produced the fabrications above
- edit `tools/` or `workflows/` — check `git status --porcelain -- tools workflows`
  (writing `data/routine-log.jsonl` is expected and fine)
- hand-edit `data/harvest-queue.json` or `backlog-index.json` — use `harvest.js`
- `harvest.js skip` anything — the bar is hate/harm only
- push to `main`
