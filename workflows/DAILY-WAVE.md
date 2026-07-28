# Daily wave — build 5 records from the backlog

A claude.ai routine runs this daily at 07:00 UTC (03:00 ET) against `main`.

## READ THIS FIRST — this pass DEVIATES from the committed pipeline

`workflows/README.md` documents the wave as `select → batch → generate.js → prep-wave.js →
_ingest.js → build`, and warns in capitals about waves built outside it (the 2026-07-20/21 waves,
+102 quotes, hand-rolled).

**A cloud routine cannot run that pipeline.** `generate.js` and `prep-wave.js` are a `Workflow`
script and its journal parser, and a scheduled cloud session has no `Workflow` tool. So this pass
writes records directly, and that means it skips `prep-wave.js`'s escaping scan, its STUB detection
and its `creditedTo` stamping.

What replaces them:
- `tools/validate-records.js` runs inside `build.js` and gates 21 conventions, including the
  HTML-safety scan and the double-escaping check that motivated prep-wave's scan.
- `tools/verify-corpus.js` runs last and asserts 43 invariants.
- The daily review pass (`DAILY-REVIEW.md`) scans every new record the next morning.

That is real coverage, but it is NOT the same as the documented path. **Build 5 records, not 40.**
The small batch is the mitigation: a deviation is survivable at 5 a day and was not at 102.

If a wave ever needs to run at full pipeline fidelity, do it from a local session with the
`Workflow` tool, not here.

## The steps

```bash
node tools/harvest.js report                    # confirm the backlog is not empty
node tools/harvest.js select 5 --wave dYYYYMMDD # demand-ordered; see the note below
node tools/harvest.js batch  --wave dYYYYMMDD   # → data/.harvest-batch-dYYYYMMDD.json
```

`select` draws most-looked-up-first (`demandScore`, which folds the category weighting in). If it
warns that candidates carry no `demandScore`, run `node tools/rank-backlog.js` first — otherwise the
unscored ones sort last and the wave silently reverts to alphabetical-by-author.

## Research each of the 5

For each `{text, author}` in the batch, research the quote properly before writing anything:

- **Defer to Quote Investigator and Wikiquote.** They are the authorities this site is built on.
- Find the **earliest documented appearance** and say what it is. If the popular wording differs
  from the sourced one, that difference is the story, not a detail.
- Decide `confidence` honestly: `verified` (real and sourced), `attributed` (credibly credited,
  unpinned), `disputed` (misattributed, fabricated, or reassigned).
- Decide `source.rights`: `public-domain` (source work pre-1931), `in-copyright` (1931+),
  or omit the key entirely to mean uncertain. **Never guess public-domain.**
- On a disputed record, `answer.authorName` must be the REAL author and `creditedTo` the name it is
  falsely pinned on. Publishing the fake author as the real one is the worst failure this site has.

## Write the records

Model the shape on an existing record of the same confidence — read two or three from
`data/quotes/` first. Match the conventions exactly: 2-space indent, HTML entities in prose, a
trailing newline, `quoteSlug` equal to the filename.

Never invent a citation, a date, or a source excerpt. If you cannot establish something, leave the
field out and say so in the PR body — a thin record is fine, a fabricated one is not.

## Finish

```bash
node tools/build.js                                   # validate-records + 43 invariants gate this
echo '[]' > /tmp/empty.json && node tools/harvest.js sync /tmp/empty.json   # sweeps selected → ingested
node tools/scan.js                                    # the new records get flagged now, not in a month
```

If `build.js` fails, fix the record it names — do not bypass the gate.

Then branch, commit, push, open a PR. In the body: the 5 quotes, the verdict and rights for each,
and **anything you could not establish**. That last part is what makes the PR reviewable.

## Record what this run did

```bash
node tools/routine-log.js --routine daily-wave --outcome pr --built <N> --pr <url> \
  --note "anything you could not establish"
```

Commit it with the wave. The token cost of this pass has never been measured — every figure quoted
for it so far is an inference. This line is the denominator that replaces the guess.

## Do not

- edit `tools/` or `workflows/` — check with `git status --porcelain -- tools workflows`. Writing `data/routine-log.jsonl` is expected and fine
- hand-edit `data/harvest-queue.json` or `backlog-index.json` (use `harvest.js`)
- `harvest.js skip` anything — the bar is hate/harm only
- push to `main`
