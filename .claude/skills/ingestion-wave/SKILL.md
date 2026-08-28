---
name: ingestion-wave
description: Run a quotle.info quote ingestion wave end to end — both backlog waves (select from the existing harvest queue) and harvest waves (sweep new candidates first, then ingest). Use whenever the user asks to run, start, or do an ingestion wave, a backlog wave, a new wave, a harvest wave, an r-wave, or to ingest/build quote pages for quotle.info. Also use when they ask to top up or harvest into the backlog without ingesting.
---

# Ingestion wave — router and checklist

**You are not reading the procedure here. This file routes you to it and tells you what to verify.**

The procedure is `workflows/README.md` § **"One wave, end to end"** — seven numbered steps, with the
reason for each written beside it. Read that section in full before you run anything, and follow it
literally. For the scheduled 5-quote version, the procedure is `workflows/DAILY-WAVE.md` instead.

**This file deliberately does not restate the steps.** A second copy of a procedure drifts from the
first and then quietly contradicts it — the failure this repo keeps paying for (a schedule table that
still said "Local" weeks after the move; two files disagreeing on the same measured rate limit; two
copies of `toRecord` that must be hand-synced). If you find this file and the README disagreeing,
**the README wins and the disagreement is a bug to report.**

## 1. Which wave is this?

| what they said | what to run |
|---|---|
| "backlog wave", "ingestion wave", "run a wave", no qualifier | **Backlog wave** — README step **1** onward. Skip step 0; the queue already has candidates. |
| "new candidates", "harvest", "top up the backlog", "we're running low" | **Harvest first** — README step **0**, then 1 onward. |
| "harvest only", "just top up the backlog" | Step **0 only**, ending at `harvest.js sync`. Do not select or generate. |
| a track named — misattributions / PD greats / film / Quotle game | That track's harvest (step 0), then 1 onward. |

Check the queue before deciding: `node tools/harvest.js` prints `queued`. If **queued < 40**, a
backlog wave cannot fill a normal batch — say so and offer to harvest first rather than quietly
shipping a short wave.

**If it is genuinely ambiguous, ask. Do not pick one and proceed.** A wrong guess here costs an
Opus wave of tokens and ships the wrong kind of record.

**Out of scope:** songs are a separate pipeline (`harvest-songs.js` / `generate-songs.js` /
`prep-songs.js`). If they asked for songs, do not use this skill's route.

## 2. Wave id

Manual waves are `rN`. Get N from the shipped COMMITS, never from memory and never from branches:

```bash
git log --oneline --all | grep -oE 'wave\(r[0-9]+\)' | sed 's/wave(r//;s/)//' | sort -n | tail -1
```

Next wave is that + 1.

**Do NOT use `git ls-remote --heads origin 'refs/heads/wave-r*'`** — this file said to until
2026-08-28 and it is wrong: wave branches are DELETED on squash-merge, so it only ever sees waves
that have not landed yet. Measured the day r46 was drawn: `ls-remote` answered **r44** while r45 and
r46 had both shipped. Following it literally would have reused r45 — the same batch file, records
file and branch name as a wave already on main. The commit message survives the branch deletion,
which is why it is the source of truth. Scheduled daily waves use `dYYYYMMDD` instead. Never reuse an id — the batch
file, records file and branch all key off it.

## 3. `--credited` is the one flag that can publish something false

`prep-wave.js --credited` stamps `creditedTo`, which means **"this quote is falsely credited to X"**.
It drives the author-page "misattributed to X" list, the ClaimReview node, and the `/verify` API's
`misattributedTo`. Stamped on a record whose credited person IS the real author, it asserts the
opposite of the truth about a named person.

Baseline: **Track A → pass it; Tracks B / C / D → omit it.**

**But do not treat that as sufficient, and do not lean on the in-code guard.** `README.md`'s gotchas
carry a worked example — the guard compares last words, so `"Confucius (Kong Qiu)"` and
`"Socrates, as written by Plato"` both trip it on the *same* person and would be stamped. The same
signal can also be a true positive (`John D. Rockefeller` → `…Jr.`, genuinely two people), so it is a
review trigger, not a rule. **Read that gotcha before step 3**; on a mostly-Track-B wave the README's
instruction is to omit the flag and hand-check instead.

## 4. Before you start

- On `main`, clean, current: `git checkout main && git fetch origin && git merge --ff-only origin/main && git status --porcelain` (must print nothing).
- **If this session is in a git worktree** (it is, if it started from a task chip): every `Workflow`
  call needs the **object form with `repo: "$(pwd)"`**, and `parse-audit.js` needs an explicit
  `--out`. Without it the audit agents read the *main* checkout's pages and return a clean PASS
  against the wrong site. README step 5 says this in full — do not skip it.

## 5. Verify these before you ship — each has failed a real wave

Pointers, not instructions; the README step tells you what to do.

- [ ] **Stubs** (step 3) — if prep reports stubs excluded, re-generate just those and ingest them too, or the wave silently ships short.
- [ ] **Fix-agent scope gate** (step 5) — `git status --porcelain -- tools workflows` must print nothing. Fix agents once shipped +94/−14 of `template.js` inside a content wave.
- [ ] **Generator findings** (step 5) — fix agents report generator bugs in `remaining`. Apply each ONCE, centrally, as its own commit. Never smuggled into the wave.
- [ ] **Theme-tag** (step 6) — untagged records never appear on `/themes`.
- [ ] **`node tools/scan.js`** (step 7) — REQUIRED. CI fails the PR without it; this recipe omitted it until r27 and the wave went red.
- [ ] **Rebase-rebuild before merge** (step 7) — built HTML is committed, so a wave branched before a generator fix and merged after it silently reverts that fix on every page it rebuilt.

## 6. When something does not fit the doc

**Stop and report it. Do not invent a workaround.** The documented failure mode of this repo is a
session reconstructing a process that already exists, or routing around a gate rather than reporting
it. A wave left unrun is recoverable; a wave that shipped 40 wrong pages is 40 corrections.

If a rule in the README has no stated reason, that is a defect in the doc — say so in the PR body.
