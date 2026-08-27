# Daily report — what the night did, and what needs a decision

A cloud routine runs this every day at 08:00 ET, after the 07:00 merge pass. It writes
`data/daily-report/<YYYY-MM-DD>.md`, opens a PR, and merges it (see step 4 — it is the only
routine that merges its own work, and the reason is narrow).

The point is that the operator starts a fresh session, says *"review quotle.info daily report"*, and
gets a rundown plus a short list of things they can approve or decline — without having to read five
PR bodies and a merge log.

## What this pass is NOT

It does not fix anything. It does not merge ANYONE ELSE'S work — the 07:00 pass is still the merge
authority for every content PR. It does not open records, edit `data/quotes`, run `scan.js`, or touch
`tools/`. It reads, judges, and writes one report file. Every fix it
identifies is written as a **proposal for the operator**, because the whole value is that a person
decides what gets done and the routines then carry those decisions.

## Step 0 — preflight

```bash
node tools/preflight.js --routine report
git checkout main && git fetch origin && git merge --ff-only origin/main
```

Stop and say so if either fails. A stale checkout reports yesterday's state as today's.

**TWO exceptions, and only these two. Both are "run exactly what preflight itself printed, then
re-run it" — (a) is one command, (b) is two.**

**(a) added 2026-08-04 — the `local main sane` recovery.** If the only failures are
`local main sane` (and, consequently, `git on main`) **and `tree clean` PASSED**, run the single
command preflight names — `git checkout -B main origin/main` — then re-run preflight and continue
only if it comes back green.

**(b) added 2026-08-14, remedy CORRECTED 2026-08-16 — `git on main` ALONE.** If `git on main` is the
*only* failure — with `local main sane`, `tree clean` and `current with origin/main` all PASSING —
run **both** of the commands preflight now prints, then re-run it and continue only if green:

```bash
git checkout main && git merge --ff-only origin/main
```

**The checkout ALONE is not enough, and this exception shipped on 2026-08-14 saying it was.** The
start state is not "off the branch": it is **detached at the current tip with a stale local `main`
ref behind it**. Neither guard sees that gap — `current with origin/main` measures HEAD, which is
level, and `local main sane` measures the REF, which passes because "sane" means *ancestor of*
`origin/main` and a 28-commits-behind ref is a perfectly good ancestor. So the checkout moved the
tree BACKWARD onto the stale ref: 28 commits on three passes and 31 on a fourth, on 2026-08-16, each
failing its own re-run and then improvising the fast-forward — the precise failure (a) warns
`git checkout main` can cause, reached by a route (a)'s condition does not cover. The wave, reports
and review passes each diagnosed it independently that morning and each correctly refused to edit
`workflows/` from inside a content PR.

The fast-forward discards nothing: the tree is clean and the ref is an ancestor. It does NOT close
the underlying question — something leaves the container detached with a stale `main`, and finding
it would retire this exception.

Every other preflight failure is still a hard STOP and is not yours to fix.

Both **relax WHO acts, not WHAT is checked**: every check must still pass on the re-run, the tree
must ALREADY be clean so nothing uncommitted is at risk, and the only thing (a) discards is a local
`main` ref that is not an ancestor of `origin/main`. On 2026-08-04 exactly this state stopped the
reports, review and report passes for a full day, and preflight's old remedy (`git checkout main`)
would have made it worse by moving the tree onto the stale root. **`local main sane` PASSING is what
separates (b) from (a) — it is NOT what makes (b) safe.** That was the 2026-08-14 error: "sane" only
means *ancestor*, so it is satisfied by a ref arbitrarily far behind, and the fast-forward in (b)'s
remedy is what actually closes the gap. The two must still never be collapsed into one rule — (a)'s
ref is not an ancestor at all, so nothing can fast-forward it and only `-B` will do.

## Step 1 — gather the facts mechanically

```bash
node tools/daily-report.js --json > /tmp/report.json
node tools/daily-report.js            # the same thing, readable
```

**Do not re-derive these numbers.** The tool counts what ran, what merged, what is still open, CI
state, corpus size, flag count, ladder position, whether the tree is dirty, and **visitor traffic**. Your job is to say
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
4. **Traffic** — one line from `traffic` in the tool's JSON: today, last 7d, last 30d, all time.

   This is **GoatCounter**, which counts everybody — AI assistants, Bing, DuckDuckGo, direct — and
   it is the only traffic number this report carries. Do NOT substitute or supplement it with
   Search Console. GSC counts Google alone; for six weeks it showed ~8 clicks and the project
   concluded it had no audience, while GoatCounter had recorded 4,163 visits with **chatgpt.com as
   the largest single referrer and Google absent from the top six**. A traffic figure that omits
   the actual audience is worse than none.

   If `traffic` is `null`, say "traffic: unavailable" and check `tool_failures` — that is an
   analytics outage, NOT a quiet day. Never render a missing number as a zero.

   Referrers are not in the JSON (they need the authenticated API). If a night's traffic moves
   enough to matter, say so and note that `node tools/traffic.js --refs` gives the breakdown.
5. **Findings** — what the routines reported, in their own terms, most serious first. Say which
   record or file each concerns.
6. **Needs a decision** — numbered, each one sentence of what is wrong plus one sentence of what
   doing it would involve. This is the section the operator acts on, so keep it short enough to read
   standing up. If there is nothing, say so plainly.
7. **Cost** — what the runs reported, if they reported it.

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
