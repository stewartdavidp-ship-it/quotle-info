# Daily report — what the night did, and what needs a decision

A local routine runs this every day at 08:00 ET, after the 07:00 merge pass. It writes
`data/daily-report/<YYYY-MM-DD>.md` and opens a PR.

The point is that the operator starts a fresh session, says *"review quotle.info daily report"*, and
gets a rundown plus a short list of things they can approve or decline — without having to read five
PR bodies and a merge log.

## What this pass is NOT

It does not fix anything. It does not merge anything. It does not open records, edit `data/quotes`,
run `scan.js`, or touch `tools/`. It reads, judges, and writes one report file. Every fix it
identifies is written as a **proposal for the operator**, because the whole value is that a person
decides what gets done and the routines then carry those decisions.

## Step 0 — preflight

```bash
node tools/preflight.js --routine report
git checkout main && git fetch origin && git merge --ff-only origin/main
```

Stop and say so if either fails. A stale checkout reports yesterday's state as today's.

## Step 1 — gather the facts mechanically

```bash
node tools/daily-report.js --json > /tmp/report.json
node tools/daily-report.js            # the same thing, readable
```

**Do not re-derive these numbers.** The tool counts what ran, what merged, what is still open, CI
state, corpus size, flag count, ladder position and whether the tree is dirty. Your job is to say
what it MEANS. If you find yourself counting, you are doing the tool's job and will eventually
disagree with it.

The one thing it can state that a chat log cannot: **a routine that did not run at all.** It compares
against the expected set, so a missing shard is a missing *file*, not an absence of evidence. A
routine that never fired and a routine that ran and found nothing look identical everywhere else.

## Step 2 — read what the routines actually said

For each PR merged since yesterday, read the body. The routines are instructed to report defects
rather than work around them, so **the PR bodies are where the real findings are** — not in the
counts.

Look specifically for:

- anything a routine flagged as **needing a person** — environment mismatches, doc contradictions,
  generator defects it deliberately did not fix
- anything it **could not establish** and left out of a record
- any **detector candidate** proposed but not admitted (admission is deliberately serial)
- any place a routine **deviated from its doc** and said why

A routine reporting a defect is the system working. Treat those as the headline, not as noise.

## Step 3 — write the report

Write `data/daily-report/<YYYY-MM-DD>.md` with these sections, in this order:

1. **One-line verdict.** Did the night work? "All five ran, nothing needs attention" is a complete
   and good report.
2. **What ran** — the table from `daily-report.js`, plus anything missing.
3. **What shipped** — records built, records audited, reports closed. Numbers from the tool.
4. **Findings** — what the routines reported, in their own terms, most serious first. Say which
   record or file each concerns.
5. **Needs a decision** — numbered, each one sentence of what is wrong plus one sentence of what
   doing it would involve. This is the section the operator acts on, so keep it short enough to read
   standing up. If there is nothing, say so plainly.
6. **Cost** — what the runs reported, if they reported it.

**Numbered proposals, not prose.** The operator should be able to reply "do 1 and 3" and have that be
unambiguous.

## Step 4 — ship it

```bash
node tools/routine-log.js --routine daily-report --outcome <no-op|pr> --note "..."
```

Branch `report/<YYYY-MM-DD>`, PR ready not draft. **Then merge it yourself** once CI is green.

**This is the one routine that merges its own PR, and the exception is narrow.** Everything else
stops at a PR because it changes published content, and two content PRs merging in parallel is how a
page ends up half-rebuilt. This pass writes one markdown file under `data/daily-report/` plus its own
log shard. Nothing builds it, nothing renders it, nothing reads it but a person — verified: no tool,
workflow or CI step references the directory. A wrong report is a wrong sentence in a file, not a
wrong page on the site.

The alternative was leaving it for the 07:00 merge pass, which runs **the next morning** — so
"review quotle.info daily report" in a fresh session would return yesterday's report, or none. That
defeats the only thing this pass exists to do. A second scheduled routine to merge one harmless
document would be more machinery than the document is worth.

Run `node tools/merge-gate.js` first and merge only if it marks your PR `MERGE` — that still checks
CI is green, the branch is current, and nothing escaped scope. If it says anything else, leave it and
say so; the 07:00 pass will collect it tomorrow.

## Honesty rules

- **A quiet night is a real result.** Do not manufacture findings to justify the run. "Nothing needs
  attention" is the most valuable report to be able to trust.
- **Never repeat a routine's claim as fact if it contradicts the tool.** If a run says it built 5 and
  the log says 3, report the discrepancy — that is exactly the sort of thing this pass exists to
  catch.
- **Do not soften a failure.** If a routine did not run, say it did not run; do not describe it as
  "no activity".
- Quote a routine's own words when reporting its finding. Paraphrasing an audit finding loses the
  specificity that makes it actionable.
