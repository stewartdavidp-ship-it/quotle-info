# Handoff — correcting the "365 public domain quotes" CONSTRAINT in CLAUDE.md

**Date:** 2026-10-12
**Branch:** `claude/youthful-banach-dd46a6` (pushed)
**PR:** [#1136](https://github.com/stewartdavidp-ship-it/quotle-info/pull/1136) — open, awaiting CI/merge
**Commits:** `6f730704e` (correction) → `63a78666b` (merge main) → `bf7a6a4c6` (re-measure)

## Goal

`CLAUDE.md` asserted a CONSTRAINT that was false on both halves:

> "Quotle's quote database is fixed at 365 quotes — one per calendar day — all verified public domain."

Rewrite it to say what is actually true — corpus size open and wave-driven; rights assessed and recorded per record; short-excerpt quotation for in-copyright material — and sweep the surrounding v1 blocks for the same two falsified facts. Documentation only; no generator changes.

## Done and verified

Measured at `63a78666b` (main `8f85dc28f`), reading every `data/quotes/*.json` and taking each record's `confidence` and `source.rights` literally:

| | claimed | measured |
|---|---|---|
| records | 365 | **2,343** (1,303 disputed / 744 verified / 296 attributed) |
| rights | all public domain | **799 `in-copyright`** vs 769 `public-domain`, of 1,568 with a verdict |

775 records carry no `source.rights` (644 of them `disputed` — no single cleared source text to assess), so **799 is a floor, not a total**. Adds by commit month: 1,254 Jul / 727 Aug / 312 Sep / 50 Oct-to-the-12th.

Rewritten: the CONSTRAINT itself, plus five other spots carrying the same two facts — the Build Objective blurb, anti-pattern (4), the enrichment DECISION, the positioning DECISION, the Go/No-Go.

**Verification:** `node tools/build.js`, `node tools/validate-records.js` (2,343 valid, 361 pre-existing warnings), `node tools/scan.js` (0 flagged) all run clean on the merged tree with **no output diff**. `CLAUDE.md` is the only file changed against main — CI's stale-output check has nothing to catch.

Knowledge-tree node `-P1kq_kcS2JiN-pkkYno` (tree `-OyEYXEZs1VPrQvtnS-B`) updated with the refreshed counts, the drift table and the filters; `lastVerified` set to 2026-10-12.

## In progress — exact next step

Nothing is half-finished. **Next step: confirm PR #1136 went green and merged.**

```bash
gh pr view 1136 --json state,mergeStateStatus,statusCheckRollup
```

If it merged, this work is done. Per the [quotle.info live is not prod](../.claude/projects/) memory note, merging a reviewed PR here is not a gated act — no need to ask.

## Decisions and why

- **Counted rights by `source.rights`, not by date.** The task framing sized the problem by documented date (87 records dated 2000+). That badly undercounts: only 113 records have a `schema.dateCreated` of 2000 or later, because 681 have no `dateCreated` at all and a pre-2000 date does not imply public domain (a 1960 lyric is firmly in copyright). `source.rights` is the field the site publishes and `/verify-batch` returns, so it is what any consumer actually sees — 799 in-copyright, not 87.
- **Narrowed rather than deleted the rights concern.** `llms.txt` sells per-record rights clearance as a headline feature, so the fix was to state the posture accurately (short excerpt for identification/verification/criticism) rather than drop the subject.
- **Kept the no-pagination rule, replaced only its dead rationale.** "365 quotes doesn't need it" is false; one searchable page still beats a pager for this content. Noted that `who-said/index.html` is now ~1.3 MB and is worth revisiting — stated rather than quietly endorsed.
- **Kept "depth over breadth",** rebased on per-quote verification depth instead of a small corpus. The stance survived; only its stated reason died.
- **Re-measured on the way out instead of shipping the first numbers.** See gotcha 1.
- **Flagged, did not fix, the "single HTML file, no build tools, no npm" CONSTRAINT.** It is false, but already explicitly superseded by **Architecture — AS BUILT**, so no session reading top-to-bottom acts on it. Rewriting it needs a product call, not a measurement.

## Open questions for you

1. **The "single HTML file, no build tools, no npm" CONSTRAINT needs your call.** What is the *current* deployment constraint — no framework? no bundler? no runtime dependencies? I left it in place with a note rather than guess. This is the only thing genuinely blocked on you.
2. **In-copyright crossed over to being the larger share** of adjudicated records (799 vs 769) between Sep and Oct 2026, and is growing faster than public-domain. Worth a look at whether the short-excerpt posture should be stated somewhere user-facing, not just in `CLAUDE.md`.
3. **775 records have no rights verdict.** 644 are `disputed` (reasonable — nothing to clear), which leaves ~131 non-disputed records unadjudicated. Possibly a backfill worth queueing; I did not investigate.

## Gotchas

1. **The first pass of this correction was itself stale before it merged.** Measured 2,225 records at `de04416d9` on 2026-09-17; by 2026-10-12 main had moved 223 commits and the corpus was 2,343. Caught it only by diffing against current main before handing off. The measurement block now carries an explicit staleness warning, and this is saved as the memory note `corpus-counts-go-stale-every-wave`. **Cheap pre-check before merging anything with a count in it:** `git ls-tree -r --name-only origin/main -- data/quotes | grep -c '\.json$'`
2. **Corpus tools were not loaded on turn 1.** `ToolSearch "+knowledge_tree"` returned nothing on the first turn and loaded fine on the next — the known deferred-listing snapshot defect. One attempt per turn; retrying within a turn cannot work. This cost nothing here because the node was reachable later.
3. **The knowledge-tree node had already self-corrected.** A parallel session doing the same work on 2026-09-17 independently found the `source.rights` index and had already rewritten the node, naming commit `6f730704e`. No `contradicts`/`qualifies` edge was needed — only a refresh of the counts. Worth checking the node before assuming you need to argue with it.
4. **This branch started 223 commits behind main.** Merged cleanly (doc-only change, no conflicts), but check before assuming a stale worktree branch is safe to PR.
5. **`source.rights` lives on the `source` block, not at record top level,** and is absent rather than null when unadjudicated. Count the absences separately or you will silently misreport the denominator.

## Memory notes (pointers, not copies)

In `~/.claude/projects/-Users-davidstewart-Developer-quotle-info/memory/`:

- **`corpus-counts-go-stale-every-wave`** — new, written this session. The staleness rule and the `source.rights`-not-dates rule.
- `quotle-info-live-is-not-prod` — why merging this PR needs no approval.
- `staged-work-may-already-be-on-main` — diff a dirty tree against `origin/main` before committing.
- `routines-share-the-working-tree-verify-branch-before-commit` — re-verify HEAD before commit/push; routines move branches under you.
- `theme-gate-is-load-bearing` — same re-verify-the-full-manifest discipline.
