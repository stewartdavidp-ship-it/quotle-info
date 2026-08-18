# quotle.info content pipeline — the march to 2000

Everything needed to keep growing the corpus toward **2,000 quotes** (to match Quote Investigator),
**durably across context compaction**. All scripts here are committed; a fresh session can run a full
wave by following this file. Per-wave intermediates go in gitignored `workflows/.scratch/`.

## Current state (update this line each wave)
- **Corpus: 1722** quotes + **95** songs. **Target: 2000** quotes.
- **Next wave number: r40.** (Waves r6–r39 shipped via this pipeline. Numbering is just a label for batch/scratch files.)
  **These lines were three waves stale** (they read 1506 / r35 while r35, r36 and r37 had all shipped),
  which is why the runbook says to take N from `git ls-remote --heads origin 'refs/heads/wave-r*'` and
  never from this file. Bump them, but do not trust them.
- **`creditedTo` ON A DISPUTED RECORD WHOSE AUTHOR *IS* THE MAGNET: STAMP IT.** The instinct to
  withhold — "the record's author matches the magnet, so nobody is falsely credited" — is right for a
  **verified** record (that is the Dr. Seuss / Richard P. Feynman name-expansion trap, where stamping
  asserts a genuine quote is false) and **backwards for a disputed one**. `rightPersonWrongWords()`
  (`tools/template.js:2054`) requires `primaryCredit()` to be non-empty AND equal to the hero name, so
  on a disputed record the match IS the signal. Withhold it and the page falls through to the
  fabrication defaults: `1/"False"` plus *"This attribution is disputed. Actually by ⟨the author the
  page credits⟩"* — the contradiction measured across ~53 live pages during r35. Stamp it and the page
  renders rating 2 with *"Yes and no."* and *"…is the author, but this popular wording is not what they
  wrote"*. r37 verified both in the rendered JSON-LD (Balzac, Mae West). Note it is easy to miss: it
  only looked like a reassignment there because `Honor&eacute; de Balzac` is entity-encoded; in plain
  ASCII the names match exactly and a name-equality check skips it silently.
  **IT IS A CONFIDENCE TEST, NOT A NAME TEST — and `attributed` is the third case (r38).**
  `rightPersonWrongWords()` gates on `q.confidence === 'disputed'` **explicitly**, so an `attributed`
  record cannot reach the rating-2 / *"Yes and no."* path at all no matter what `creditedTo` says.
  Stamping one therefore buys no better rendering; it only asserts a false credit against a page that
  credits that person. **WITHHOLD on `attributed`** — r38 withheld 6 (Powell ×4, Drucker ×2) on exactly
  this reasoning and stamped only the 7 disputed. `falseCredits()` (`tools/credits.js`) filters any
  credit whose slug equals the true author's out of the author hubs and `/verify`, so a wrong stamp on
  an EQUAL record is inert there — but inert and wrong is still wrong, and the same filter is what makes
  the disputed-EQUAL stamp safe rather than merely tolerable.
  **The name-expansion trap has a second form that substring checks miss: a MIDDLE INITIAL.** r38's
  generator returned `Peter F. Drucker` for 4 records and `Peter Drucker` for 4 others. Neither string
  contains the other, so a `includes()` comparison classifies the expansion as a REASSIGNMENT and would
  have stamped 4 genuine Drucker quotes as falsely credited to Drucker. Compare on `schema.creator.sameAs`
  (both carried `.../wiki/Peter_Drucker`), not on the name string.
  **r34 shipped 39, not 40** — a fix agent found one record duplicated a page the corpus already had
  (the Ali "so fast" joke, under a different wording), so it was dropped along with its rendered
  directory. `sync` dedups on EXACT normalised text, so a reworded variant of an already-built quote
  passes selection untouched; the duplicate is not visible until an agent that can see sibling files
  reads them. Until dedup is variant-aware, **check a draw for near-duplicates of built pages before
  generating**, not after. Deleting a record does not delete its page — `rm -rf who-said/<slug>/` too,
  or the rendered-pages invariant fails the build.
  **r38 found the worse shape of this: two variants of ONE quote inside the SAME draw.** Drucker's
  "Thirty years from now the big university campuses will be relics" was queued twice, bare and with
  its trailing clause, and both **slugify to the same string** — so they would not have shipped as two
  pages, they would have COLLIDED into one record file, with whichever generated last overwriting the
  other and one slot of the wave silently lost. The batch-vs-corpus check does not see this; the
  intra-batch check does. Run the near-duplicate pass BOTH ways — every batch item against every built
  `displayQuote`, AND every batch item against the others — and also just assert that the batch's
  slugified texts are unique, which is one line and catches the collision exactly.
- **THE MISATTRIBUTION SEAM IS NEARLY OUT.** 250 queued, but only **12 misattributed** and **41
  disputed** against **184 genuine-famous** (r39, from `harvest.js report`). THREE waves running
  (r37, r38, r39) have drawn essentially NO misattribution material — the count has not moved off 12,
  because none of the 12 ranks into a draw on demand. Track A is overdue, not merely recommended. Track A is what refills the differentiator — the
  misattribution pages are what the site is *for*, and a backlog draw now returns mostly
  correctly-attributed famous lines. Run `harvest-candidates.js` over magnet authors before the next
  backlog wave, or the corpus keeps growing in the direction that does not distinguish it.
  **`tag-themes.js` drops a record per wave — FIXED 2026-08-07, and the fix is an argument you must
  pass.** r32 returned `covered: 39, total: 40` and r33 did the same — Epictetus and
  `i-never-said-most-of-the-things-i-said` respectively, the latter at manifest position 22 of 40, so
  not a chunk boundary (an agent returned 9 of its own 10). An untagged record never appears on
  `/themes` and nothing downstream flagged it: `apply-tags.js` wrote what it got and printed success,
  so the only thing catching it both times was a human reading a counter. Now:
  **`apply-tags.js --manifest` is REQUIRED** and diffs the manifest against the records on disk — it
  names every dropped slug, writes `<manifest>-missing.json` for a `chunks:1` re-run, and exits 1.
  The journal cannot do this itself: what an agent never returned leaves no trace in it, which is why
  the manifest is mandatory rather than optional. `tag-themes.js` also computes each strided slice's
  expected size from `total`/`chunks` and **retries a short slice once** before giving up, so the
  common case repairs itself. Same swallow existed in `cite-styles.js` → `_ingest-cites.js`; that one
  now takes `--expect`.
- **A known-corrupt candidate now leads every draw.** `friendship-is-born-at-that-moment-when-one-man-says-to`
  is stored truncated mid-sentence (`…myself . . .`, with a `"What!` that never closes) and sits at
  **demand-rank #1** of the queued pool, so `select` puts it first every time. Four waves — the
  2026-08-06 daily wave, r32, r33, and one before — have each spent a slot discovering it. Until
  `harvest.js` gains a way to repair stored text (or the operator decides to lose the quote), draw
  N+1 and drop it from the BATCH — never hand-edit `harvest-queue.json`, and never `skip` it, which
  is reserved for hate/harm.
  **`harvest.js unselect` IGNORES a positional slug** — it releases EVERY selected candidate, filtered
  only by `--wave` (`cmdUnselect`, tools/harvest.js:294). It reads as slug-aware because callers keep
  invoking it when exactly one candidate happens to be selected, and it then reports `unselected 1`;
  two separate sessions used it that way on 2026-08-06 and both looked correct. Running it mid-wave
  would release the whole draw. To release ONE candidate from a wave: run `harvest.js sync` FIRST so
  everything actually built sweeps to `ingested`, leaving only the stragglers `selected`, then
  `unselect --wave rN`. That is how r32 released the corrupt candidate below without touching its
  other 40.
  **r30 and r31 ran CONCURRENTLY on 2026-08-04** — two sessions, two waves, one repo. It worked, and
  what made it work is worth keeping. r31 ran from a separate **git worktree** on its own branch, and
  copied r30's *uncommitted* `selected` marks into its queue before drawing: `select` draws only from
  `status === 'queued'`, so their 40 were excluded mechanically rather than by agreement — zero
  overlap, no coordination between the sessions. `sync`'s sweep is safe under concurrency for the
  same kind of reason: it promotes `selected → ingested` only when `corpus.has(quote)`, so one
  branch cannot mark the *other* wave's picks ingested. r30 merged first; r31 then did the
  rebase-rebuild below and verified **40 additions / 0 modifications** to r30's records before
  merging. There is no lock on the queue — `4de8f8a9c`'s "one writer" gate is about which code path
  writes the file, not about concurrent sessions, so do not expect it to protect you.
- Harvest backlog: `data/harvest-queue.json` (committed) — **250 queued** after r39. **Track B was refilled 2026-08-03**
  (harvest-only run, no ingest): 8 themes chosen for DEMAND rather than to fill gaps — gratitude,
  friendship, money-wealth, discipline-habit, grief-loss, forgiveness, patience, nature. Six of those
  had **no theme tag on the corpus at all**; gratitude (23) and friendship (33) were the two thinnest
  that existed. +76 candidates, 73 of them public-domain, taking queued `public-domain` from 97 →
  **170** and `genuine-famous` 314 → **390**. The rest is 111 `disputed`, 30 `misattributed`,
  7 `film-misquote`, 7 `scripture-misquote`.
  **Ranked after syncing, and the new harvest took 25 of the top 30 demand slots** — skip the rank
  and every one of them sorts LAST instead (the r29 lesson, step 1). 60 candidates still carry no
  demand signal and want a manual look.
  **Track A was refilled 2026-07-30** (+107 candidates: 8 magnet authors + 4 film titles).
  Either track can draw ~40 without harvesting first.
- **Who-wrote axis (`/who-wrote/`, added 2026-07-23):** the second music axis — "who WROTE this song?". Harvest is deterministic (`node workflows/harvest-who-wrote.js` scans the recording corpus → `data/who-wrote-queue.json`). ~14 records shipped (single-axis + dual-axis enrichment); ~78 dual-axis candidates queued. Recipe: the "Songs — the `/who-wrote/` axis" section below.
- **Songs: next wave number s4, and the backlog is REFILLED.** (s1 2026-07-22: 10 records. s2 2026-07-23: 27. s3 2026-07-23: 26, the tail of the backlog, 26/26 survived.) Song backlog `data/song-queue.json` — **79 queued** (62 `high` / 17 `medium` confusion), 89 ingested, 1 dropped. Harvested 2026-08-03 across all six veins, 11–15 each; **all 79 were new** because the run passed the 96 built-or-queued slugs as `exclude`, so no agent spent budget re-finding Tainted Love. ~3 waves' worth. Digest: `data/song-queue.md`.
  - **`sync` now records what the agents REJECTED, not just what they queued** (2026-08-04). A
    harvest returns three lists and sync used to read only `candidates`, so every sweep re-derived
    the same negative results. Both other lists are now persisted:
    - **`dropped`** → a queue entry with `status:'dropped'` + `dropReason`, slug from `tools/slugify.js`.
      `REQUIRED` deliberately does not apply: a drop is a lead that FAILED, and the agent has only a
      title and a reason. This needs no change to `harvest-songs.js`, because the `exclude` one-liner
      maps EVERY song regardless of status — so a recorded drop is skipped by the next sweep for free.
      Higher Ground is the proof this works: it is the one drop that was already persisted, and the
      s4 agent read the reason and refused to resurface it.
    - **`contested`** → `caveats[]` on the matching candidate, carried through `batch` into the
      generator prompt. These are NOT drop research (which is what they look like sitting next to
      `dropped`) — most describe QUEUED songs, and they are the ambiguity the harvest could not
      settle. `generate-songs.js` is told to resolve each or set `confidence:"disputed"`, because a
      caveat that vanishes silently is how a page asserts a date its own sources contradict.
    A rejection that matches an existing song is never allowed to overwrite it, and re-running the
    same file is idempotent. Notes matching no song are COUNTED in the output rather than dropped
    silently — look at them.

> **Do not trust the three lines above** — they are hand-maintained and have been wrong before (they
> read "1058 / r22 / 318 queued" while the real backlog was 451). The numbers that are *derived* and
> therefore always correct live in **`data/corpus-state.json`**, rewritten by every build and
> asserted by `tools/verify-corpus.js`. For live state run:
> ```bash
> node -e "const{CORPUS}=require('./tools/corpus');console.log(JSON.stringify(CORPUS,null,2))"
> node tools/harvest.js report
> ```
> Still bump the lines above each wave — but check them against those two commands, not memory.

> ⚠️ **Waves of 2026-07-20/21 (dayNumbers 502–612, +102 quotes) were built OUTSIDE this pipeline** —
> hand-rolled agents and inline dedup instead of `harvest.js sync` → `generate.js` → `prep-wave.js` →
> `audit.js`. They shipped straight to `main` rather than via a `wave-rN` branch + PR. Consequences to
> know about: the harvest queue was not driving them (so `select`/`batch` were never used and the
> wave-number sequence skips), `prep-wave.js`'s escaping-scan and stub-detection never ran, and
> `audit.js` was run only retroactively. **Do not take those waves as a model — follow the runbook
> below.** The gap they exposed is real though: see `tools/validate-records.js`, added during them,
> which gates record SOURCE conventions before build (complements `prep-wave.js`, which gates
> generator OUTPUT after it).
- Four tracks (see below). Track A ≈ 123 magnet authors harvested (count it, don't guess: distinct
  `magnetAuthor` on queue entries whose category is `misattributed` or `disputed`); Track B covered 24 themes;
  Track C (film) seeded; Track D (Quotle game) has **161 queued — ~4 waves**, and every one of them
  is a puzzle the game currently refuses to show.

## The skip bar — hate/harm ONLY (operator policy, 2026-07-14)
`harvest.js skip` is for **hate or harm**, nothing else. The two standing skips are the racist
Darwin fabrication and an Ali/Hitler line — that is the bar. A quote being crude, tasteless, or
useless-in-a-slide-deck is **not** grounds to skip it: if it is a real, documented misattribution
it gets a page. The corpus targets QI parity, QI documents these, and the Quote Googler ("did X
really say this?") is exactly who that page serves.

This exists because an agent skipped the Steve-Jobs-attributed Emo Philips joke on taste grounds;
the operator reversed it and set the bar here. **Do not make taste calls on the operator's behalf** —
the bar is bright-line so it needs no judgement. `harvest.js unskip <slug>` reverses a bad skip.

## Applying a rule — intent first, then the letter

Before you invoke one of the rules in these docs, **say what it protects against, then check that
risk is actually present.** If it is not, the rule does not apply, and saying so is following it —
not bending it. Machinery built to honour a rule in a case it was never about is overhead the
operator carries forever.

The case that set this (2026-07-29): *"only the 07:00 pass merges"* exists so two **content** PRs
can't merge in parallel and leave a page half-rebuilt. The daily report writes one markdown file
under `data/daily-report/` that nothing builds, renders or reads but a person. None of that risk is
present. A whole second scheduled routine was nonetheless built to merge that one document, and the
operator cut it: *"it is a harmless document, can not impact anything even if its wrong."*

- **Relax WHO acts before you relax WHAT is checked.** `DAILY-REPORT.md` merges its own PR, but
  still only if `merge-gate.js` returns `MERGE` — green CI, current branch, clean scope. Narrow the
  exception to the actor and keep every check.
- **Write the reasoning where the exception lives**, so the next session inherits the judgement
  instead of re-litigating it or quietly widening it.
- **A rule with no stated reason is a rule you cannot apply well.** If you find one here, that is a
  defect in the doc — report it in the PR body.

**This is not a licence to loosen the bright-line rules.** Some are deliberately judgement-free
*because* case-by-case reasoning is the failure mode — the skip bar above ("so it needs no
judgement"), and **never weaken a gate to make a build pass**. Those say so in their own text. Read
the rule's stated reason; it tells you which kind you are holding.

## The two tracks
- **Track A — misattributions** (the bulk toward 2000; the differentiator + long-tail fakes agents don't know).
  Author-driven: `workflows/harvest-candidates.js` (one agent per magnet author → Wikiquote Misattributed/
  Disputed + QI). Records come out mostly `disputed`. **Stamp `creditedTo`** (prep `--credited`) — powers the
  author-page "misattributed to X" feature.
- **Track B — canonical public-domain greats** (the sourcing moat + rights-cleared depth for /themes).
  Theme-driven: `workflows/harvest-verified-by-theme.js` (one agent per theme → most famous, correctly-
  attributed, PD-preferred lines). Records come out mostly `verified` + public-domain. **Do NOT stamp
  creditedTo** (omit `--credited`). Also **theme-tag** the new records after ingest.
- For 2000, run mostly Track A with periodic Track B top-ups. QI is the anchor/target — work their catalog.

### Track C (film) yields ~4-5 per title, not a full cap — budget it differently
Do not size a film sweep like an author sweep. On 2026-07-30 four titles at `perTitle:8` returned
**18, not 32**, and three of the four agents independently reported the same cause: **a film's own
Wikiquote page usually has no "Misattributed"/"Disputed" section at all.** The misattribution material
for a screen line is indexed under *the person it is wrongly credited to*, not under the film — The
Godfather's best items live on the **Sun Tzu** page and under QI's **Mario Puzo** tag; Cool Hand Luke
and A Few Good Men have no QI coverage whatsoever, so Wikiquote's transcription is the only authority
and it establishes wording only.

Consequences worth knowing before you spend agents here:
- **Expect ~4-5 candidates per title**, roughly half of them `genuine-famous` anchors rather than misquotes.
- **Shape (B) — a screen line pinned on a real historical figure — is rare.** Three of the four titles
  returned zero, and the agents said so explicitly rather than manufacturing one. That is the correct
  behaviour; a thin honest harvest beats a padded one.
- **The richest film seam is reachable from Track A instead.** Sweeping the *misattributed-to* person
  (Sun Tzu, Balzac, Machiavelli) picks up the screen lines pinned on them, with the provenance already
  documented. Prefer that over adding titles when you want volume.

## Scripts (all committed)
| File | Kind | Purpose |
|---|---|---|
| `harvest-candidates.js` | Workflow | Track A: magnet-author misattribution sweep. args `{authors:[...], perAuthor:12}` |
| `harvest-verified-by-theme.js` | Workflow | Track B: theme-driven PD-greats. args `{themes:[{slug,label,blurb,target}]}` |
| `generate.js` | Workflow | Research each quote → dossier. args `{items:[{text,author,index:null}], verifiedDate, dateModified}` |
| `audit.js` | Workflow | Adversarial audit of built pages + skeptic. args `[{slug,confidence,rights}, ...]` |
| `fix.js` | Workflow | Apply confirmed fixes. args `["slug", ...]`; reads `.scratch/current-fixes.json` |
| `prep-wave.js` | node CLI | **Journal → ingest-ready records** (toRecord + escaping-scan + STUB-detect + creditedTo). |
| `parse-audit.js` | node CLI | Audit journal → `current-fixes.json` + FAIL slug list. |
| `apply-tags.js` | node CLI | Tag-workflow journal → write `record.themes`. **`--manifest` required** — it is the completeness gate. |
| `review.js` | node CLI | **Corrections + re-review spine.** Picks which PUBLISHED records go back to audit.js (reader reports, staleness); stamps outcomes. Does not audit. |
| `harvest-dedup.js` | node CLI | Standalone dedup (reference; superseded by `tools/harvest.js sync`). |
| `audit-songs.js` | Workflow | **Songs:** adversarial audit of built /who-recorded/ pages + skeptic. args `{pages, repo}` |
| `harvest-songs.js` | Workflow | **Songs:** candidate sweep, one agent per vein. args `{veins:[...], perVein:12, exclude:[slugs]}` |
| `generate-songs.js` | Workflow | **Songs:** research each queued song → dossier. args `{items:[...], verifiedDate, dateModified}` |
| `prep-songs.js` | node CLI | **Songs:** journal → ingest-ready records (toRecord + escaping + stub + LYRIC + axis checks). |

Workflow scripts run via the `Workflow` tool (`{scriptPath, args}`); they can't `require()` repo modules
(sandbox), so `generate.js` has an INLINE `toRecord` that must stay in sync with `prep-wave.js`'s copy.
The Workflow launch result prints a **Transcript dir** — its `journal.jsonl` is the input to the node CLIs.

## Corrections + re-review (the standing process)

Two live factual errors sat on the public site until a human found them by hand (2026-07-27):
`nature-does-not-hurry…` asserted the line was "not in any standard Tao Te Ching translation" — it
is **Archie J. Bahm, 1958, ch. 73**, verbatim; and `he-who-opens-a-school-door…` credited
"Louis-Charles Jourdan" when the authorities say **Louis Jourdan (1810-1881)**.

Neither was hard to find. **Nothing was looking.** A page is audited ONCE, on the wave that builds
it, and never again — and `/submit-source` has been collecting reader evidence into a D1 table that
no tool had ever read.

`tools/review.js` is the spine. It does **not** audit: `workflows/audit.js` already re-fetches every
source link, tests whether it literally supports the claim attached to it, checks confidence + rights
honesty and runs a skeptic over every blocker — and it takes an arbitrary slug list. review.js
decides WHICH records go to it and records the outcome. **Do not write a second auditor.**

```bash
node tools/review.js due --limit 25          # what is due, and why
node tools/review.js reports                 # pending reader reports (needs ADMIN_TOKEN)
node tools/review.js risk                    # mechanical contradictions, no audit needed
node tools/review.js args --limit 25 > /tmp/review-args.json
#   Workflow audit.js args=<contents of that file>          <- the existing auditor
#   Workflow fix.js   args={ slugs:[…FAIL slugs], repo:"$(pwd)" }
node tools/review.js stamp <slug…> --verdict PASS|FIXED --by recheck
#   add --close-reports ONLY if you read the reader's report. Without it no report is touched.
node tools/build.js                          # rebuild, then PR as normal
```

**Priority order** (highest first): a reader `refutes` report · any reader report · mechanical flag ·
overdue · never re-reviewed. Cycles: **365d** ordinary, **180d** flagged. All 1,158 records currently
read "never re-reviewed" because `review.lastReviewedOn` is new — that is correct, not a bug.

**Reactive lane.** `POST /submit-source` already accepts `{slug, url, stance: supports|refutes, note}`
into a moderation queue that never auto-publishes. `review.js reports` is the consumer that was
missing. A `refutes` report jumps the queue.

**Proactive lane.** `review.js due` picks the stalest records. Run it on a cadence; the point is that
a shipped record is re-tested against its sources rather than trusted forever.

### What was tried here and does NOT work

Three heuristics for detecting wrong records by pattern-matching were built and cut. Recorded so they
are not re-invented:

1. **Absolute-negative claim shapes** ("in no translation", "never said") — fired on **703/1158**
   records. It matched the whole JSON blob, so the top hit was a record quoting *Bill Gates saying
   "I never said that"*. And "appears nowhere in Jefferson's writings" IS the editorial content of a
   disputed-quote corpus; flagging it flags the job description.
2. **Narrowed to world-claims only** — still **516/1158**. Same conceptual error, better regex.
3. **Name vs `schema.creator.sameAs` mismatch** — the shape of the Jourdan bug, and it fired on 46
   records of which the first six were all correct: `Marcus Tullius Cicero → /Cicero`,
   `Napoleon Bonaparte → /Napoleon`, `Lao Tzu → /Laozi`. Wikipedia titles on COMMON names and our
   records carry FULL names, so holding more name than the slug is normal and desirable. A correct
   expansion is not mechanically distinguishable from a fabricated middle name.

**The lesson:** claim correctness is not detectable by matching a record against itself. The signals
that work need no judgement — *a human said this page is wrong*, or *nobody has looked at it in a
year*. Everything else is audit.js's job. Measure any new heuristic's false-positive rate on a sample
before shipping it; a flag that is mostly wrong just teaches everyone to ignore flags.

## One wave, end to end
```bash
# 0. Pick the model of wave. TRACK A (misattributions):
Workflow harvest-candidates.js  args={authors:[<magnet authors NOT yet harvested>], perAuthor:12}
#    reconstruct candidates[] from the harvest journal (per-agent {author,candidates} results),
#    write to /tmp/harvest-rN.json, then:
node tools/harvest.js sync /tmp/harvest-rN.json     # append + dedup vs corpus+backlog
#    (TRACK B instead: Workflow harvest-verified-by-theme.js; candidates are {theme,quotes} per agent.)
#    (TRACK C instead: Workflow harvest-film-misquotes.js; screen lines the public gets wrong.)
#    (TRACK D — the Quotle game's hidden quotes: already synced from the game, no harvest needed.
#     The game plays ONLY quotes verified here, so each of these is a puzzle that stays dark until
#     it has a page. They're genuine-famous, which CAT_RANK sorts LAST, so they never surface in a
#     default `select` — draw them explicitly with --source. They carry gameIndex → batch `index`
#     → the record's dayNumber, so the page maps straight back to the puzzle it unblocks:
#         node tools/harvest.js select 40 --wave rN --source quotle-game-unverified.json
#     After the wave ships, flip those quotes to verified:true in gameshelf/quotle/index.html.
#     r20 was the first: 40 in → 18 verified, 9 attributed, 13 disputed. Expect ~45% to survive.)

# 1. SELECT + BATCH the next ~40
#    RANK FIRST. `select` sorts by demandScore, and any candidate that has none sorts LAST — so a
#    fresh harvest is effectively UNDRAWABLE until it is ranked. select warns about this, and the
#    warning is easy to walk straight past because select still succeeds. r29 hit it: "107 of 513
#    candidates have no demandScore" was the whole most-recent harvest, and ranking first changed
#    the wave substantially — the Carlin and Burke misattributions replaced a draw that was
#    otherwise mostly genuine-famous. Cheap and cached; --refresh re-fetches every author.
node tools/rank-backlog.js                          # → demandViews/demandScore/demandRank on each queued candidate
node tools/harvest.js select 40 --wave rN           # review the list; `harvest.js skip <slug>` (see the skip bar below)
node tools/harvest.js batch  --wave rN              # writes data/.harvest-batch-rN.json = [{text,author,index}]
                                                    # index = gameIndex (track D) or null (tracks A/B/C)

# 2. GENERATE (Opus, QI-deference). Pass TODAY'S date.
Workflow generate.js  args={items:<contents of data/.harvest-batch-rN.json>, verifiedDate:"D Mon YYYY", dateModified:"YYYY-MM-DD"}

# 3. PREP — reconstruct + escaping-scan + STUB-detect + (track A) creditedTo. Use the Transcript dir from step 2.
node workflows/prep-wave.js --journal <genTranscriptDir>/journal.jsonl --batch data/.harvest-batch-rN.json \
     --out workflows/.scratch/records-rN.json --verified-date "D Mon YYYY" --date-modified "YYYY-MM-DD" [--credited]
#    If it reports STUBS excluded (an agent returned placeholder junk): re-run generate.js on JUST those
#    quotes (from workflows/.scratch/stubs-rN.json), prep that mini-run, and _ingest it too.

# 4. INGEST + BUILD
node tools/_ingest.js workflows/.scratch/records-rN.json
node tools/build.js

# 5. AUDIT → FIX
#    !! IF YOU ARE IN A GIT WORKTREE (you are, if this session was started from a task chip), you
#    MUST pass the OBJECT form with `repo`, or every audit agent silently Reads the MAIN checkout's
#    pages instead of the ones you just built — a clean-looking PASS against the wrong site. The
#    array form below is the legacy shape and is ONLY safe in the primary checkout.
#        Workflow audit.js args={ pages:[...contents of .scratch/audit-args-rN.json], repo:"$(pwd)" }
#        Workflow fix.js   args={ slugs:[...FAIL slugs], repo:"$(pwd)" }
#        Workflow tag-themes.js args={ chunks, total, manifest:"$(pwd)/…", repo:"$(pwd)" }
#    parse-audit.js --out ALSO defaults to the main checkout — always pass it explicitly:
Workflow audit.js  args=<contents of workflows/.scratch/audit-args-rN.json>   # + repo: in a worktree
node workflows/parse-audit.js --journal <auditTranscriptDir>/journal.jsonl \
     --out "$(pwd)/workflows/.scratch/current-fixes.json"
Workflow fix.js  args=<the FAIL slug list printed above>                      # + repo: in a worktree
#    !! SCOPE GATE — fix.js agents may edit ONLY their own data/quotes/{slug}.json. Before you build,
#    check that they did. They run in PARALLEL on a generator that renders every page, so an edit
#    there is both a race and a blast radius nobody chose. r19's agents correctly refused and
#    escalated; r20's agents edited tools/template.js instead, and +94/-14 of generator change
#    shipped inside a CONTENT wave, unplanned. Same prompt, opposite behaviour — so verify, don't
#    trust. This must print nothing:
git status --porcelain -- tools workflows | grep . && echo "^^ fix agents escaped their lane — review before building"
#    Their generator findings arrive in the fix report's `remaining` (they're told to report, not
#    edit). Read those: apply each ONCE, centrally, on its OWN BRANCH — not smuggled into a wave.
#    They are often right and often important (the ClaimReview claimant bug, 59 pages emitting a
#    false machine-readable claim, was found exactly this way).
#    !! OWN BRANCH, not merely its own COMMIT. `merge-gate.js` judges FILES, not commits: a `wave-`
#    branch may touch nothing under tools/ workflows/ .github/ worker/ (GENERATOR), so one tidy
#    generator commit sitting on the wave branch makes the WHOLE wave a scope escape and the pass
#    refuses it — "SKIP … scope escape". r29 read "own commit" literally, put two prep-wave.js
#    fixes on wave-r29, and had to split them out to a separate PR before the content could land.
#    Splitting is better anyway: the fix gets reviewed on its merits instead of inside 300 files.
node tools/build.js
#    Spot-check any reassigned heroes (disputed pages must show the TRUE author, not the magnet).

# 6. THEME-TAG the new records (needed so they appear on /themes). Tag only the UNTAGGED ones.
#    NOTE: this stage was briefly folded into generate.js to save ~4 agents a wave. That REVERTED —
#    adding `themes` to DOSSIER_SCHEMA pushed it past the platform's output-schema size ceiling and
#    killed generation outright (r24: 20/20 agents rejected in 19ms, 0 tokens). The tag stage is
#    cheap next to a generator that cannot run. Do not re-fold it without freeing schema space
#    first — tools/verify-corpus.js now enforces the budget.
#    tag-themes.js takes a `manifest` arg for exactly this — build a mini-manifest of the untagged
#    records and point it there. No hand-editing:
node -e "const fs=require('fs');const out=fs.readdirSync('data/quotes').filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync('data/quotes/'+f))).filter(r=>!Array.isArray(r.themes)||!r.themes.length).map(r=>({quoteSlug:r.quoteSlug,quote:r.displayQuote,author:(r.answer&&r.answer.authorName)||'',confidence:r.confidence}));fs.mkdirSync('workflows/.scratch',{recursive:true});fs.writeFileSync('workflows/.scratch/untagged-rN.json',JSON.stringify(out,null,2));console.log(out.length+' untagged → workflows/.scratch/untagged-rN.json')"
Workflow tag-themes.js  args={ chunks: 4, total: <the count printed above>, manifest: "$(pwd)/workflows/.scratch/untagged-rN.json", repo: "$(pwd)" }
#    --manifest is MANDATORY and is the completeness gate: apply-tags.js exits non-zero and NAMES any
#    record the tagger dropped, then writes <manifest>-missing.json for a chunks:1 re-run. The journal
#    cannot detect this on its own — what an agent never returned leaves no trace in it. r32 and r33
#    each lost one record here and printed success; that is what this argument exists to stop.
node workflows/apply-tags.js --journal <tagTranscriptDir>/journal.jsonl \
     --manifest "$(pwd)/workflows/.scratch/untagged-rN.json"
node tools/build.js

# 7. SHIP
echo '[]' > /tmp/empty.json && node tools/harvest.js sync /tmp/empty.json   # sweep this wave's selected → ingested
node tools/build.js                                 # REQUIRED again after the sweep — under-review/ and the
#    other roll-ups (index, search.json, corpus-state) render the QUEUE, and the sync above just
#    changed it, so the step-6 build is stale the moment the sweep runs. Late audit fixes stale it
#    the same way. d20260809 (#404) and d20260810 (#424) both shipped the step-6 build and failed
#    CI's stale-output gate on the same six files, each needing a manual rebuild + commit after.
node tools/scan.js                                  # REQUIRED — CI fails the PR without it (see below)
#    !! This recipe omitted scan.js until r27 and CI failed the wave on it. The "Committed output
#    matches the generators" job runs build.js AND scan.js and rejects any diff, so a wave that
#    skips it lands a stale data/scan-state.json and a red PR. DAILY-WAVE.md always had the step;
#    this recipe did not, so anyone following the r-series runbook hit it. It is incremental and
#    cheap (r27: 240 checks, 7014 skipped as settled, 0 flagged).
git checkout -b wave-rN && git add -A && git commit
#    BEFORE PUSHING, run CI's staleness check locally — rebuild and require a clean tree. This is
#    byte-for-byte the "Committed output matches the generators" job in .github/workflows/verify.yml;
#    the build is deterministic, so any output means the commit is stale, never noise:
node tools/build.js && node tools/scan.js && git status --porcelain   # must print NOTHING
#    if it prints anything: git add -A && git commit --amend --no-edit, then re-run until empty.
git push
gh pr create ...
#    !! REBASE-REBUILD BEFORE MERGING — built HTML is COMMITTED, so a wave branched before a
#    generator fix but merged after it SILENTLY REVERTS that fix on every page the wave rebuilt.
#    (git is right to keep the wave's side: the wave did change those files.) r19 reverted #59's
#    og:image fix on its 40 pages this way. The build is idempotent, so this is cheap and a no-op
#    when nothing moved:
#    !! IT CUTS BOTH WAYS, AND THE OTHER DIRECTION HAS NO WAVE TO CATCH IT. A GENERATOR FIX branched
#    before a wave lands, and merged after it, does not revert anything — it simply never applies to
#    that wave's pages, because its own build predates those records. Nothing flags this: the fix's
#    diff is clean, its CI is green, main stays self-consistent, and the new pages just quietly lack
#    the fix. #371 (the FAQ verdict-lead fix) hit exactly this — it corrected 60 pages, then r33
#    merged under it, and `it-takes-courage-to-love-but-pain-through-love-is-the` shipped the old
#    lead until a second PR rebuilt it. So run the same rebase-rebuild on a GENERATOR branch before
#    merging it, not just on wave branches, and re-measure afterwards rather than trusting the count
#    you took before the wave landed.
git pull origin main && node tools/build.js && git add -A && git commit --amend --no-edit && git push -f
gh pr merge <#> --squash
#    after Pages deploys: node tools/indexnow.js   (feeds Bing/Yandex — the fastest agent-discovery path)
#    THEN VERIFY THE LIVE PAGE, not the merge — curl a page and check the thing you changed is
#    actually there. The og revert was invisible in a green merge + green deploy.
```

## Songs — the `/who-recorded/` pipeline (added 2026-07-23)

The song vertical answers **"who originally recorded this?"** — a song a later act covered, where that
covering act is mistaken for the ORIGINAL RECORDING artist. It has its own backlog, its own generator
and its own gate, mirroring the quote pipeline stage for stage.

> **How the first 27 got built, and why this exists.** They didn't use a pipeline. Commits
> `c8dd10df2` (Tainted Love, the hand-built prototype), `4b2516a2e` (wave 1, 18) and `bc8ec8265`
> (wave 2, 8 + 1 dropped) each spawned one Opus agent per song, and each agent wrote its record
> **straight into `data/songs/`**. Queue statuses were then updated by hand. There was no `select`,
> no `batch`, no ingest step, and — until `validate-songs.js` landed retroactively — no gate of any
> kind. That worked for 27 records and does not work for 63. Do not go back to it.

| Quotes | Songs |
|---|---|
| `data/harvest-queue.json` | `data/song-queue.json` (+ generated `data/song-queue.md`) |
| `tools/harvest.js` | `tools/songs.js` |
| `workflows/harvest-candidates.js` | `workflows/harvest-songs.js` |
| `workflows/generate.js` | `workflows/generate-songs.js` |
| `workflows/prep-wave.js` | `workflows/prep-songs.js` |
| `tools/_ingest.js` | `tools/_ingest-songs.js` |
| `tools/validate-records.js` | `tools/validate-songs.js` |

Lifecycle: `queued → selected → ingested` (or `dropped`). **Note the vocabulary difference from quotes: songs
use `dropped` + a MANDATORY `dropReason`, not `skipped`.** A song is dropped for failing the
*confusion bar*, which is a research finding worth keeping — without the reason on the record the
next harvest re-proposes the same song. (Higher Ground is the standing example.)

### The confusion bar — the thing that makes this vertical worth publishing
Only harvest where there is **genuine, documentable public belief** that the cover act originated it.
If the honest answer is "everyone knows it's a cover", it is not a candidate. **Higher Ground**
(RHCP ← Stevie Wonder) was dropped on exactly this: Wonder's original was a #4 pop / #1 R&B hit
universally credited to him. `low` confusion is rejected at the queue gate, mechanically.

The axis is **who RECORDED it first**. "The performer didn't write it" is *not* a candidate —
performers routinely don't write. The songwriter is context.

### NO LYRICS — the site's core legal position
The unit of a song page is the **TITLE**. Titles are not copyrightable; lyrics are. No page quotes,
excerpts or paraphrases a lyric line — not to illustrate a point, not a two-word hook. This is
enforced in three places: the generator prompt, a LYRIC REVIEW scan in `prep-songs.js` (cheap to fix —
re-generate), and `validate-songs.js` at build time (which **always** prints, even under `--quiet`,
because "is this a lyric" is not mechanically decidable — these records legitimately quote speech).

### One song wave, end to end
```bash
# 0. HARVEST (only when the queue is running dry — `songs.js report` tells you)
node -e "const q=require('./data/song-queue.json');const fs=require('fs');console.log(JSON.stringify([...new Set([...q.songs.map(s=>s.songSlug),...fs.readdirSync('data/songs').map(f=>f.replace(/\.json$/,''))])]))" > /tmp/exclude.json
Workflow {scriptPath:"workflows/harvest-songs.js", args:{perVein:12, exclude:<contents of /tmp/exclude.json>}}
#    write the workflow's return to /tmp/song-harvest.json, then:
node tools/songs.js sync /tmp/song-harvest.json     # dedups vs BUILT records + queue; rejects confusion:low

# 1. SELECT + BATCH
node tools/songs.js select 10 --wave sN --confusion high   # [--vein blues] to draw one lane
node tools/songs.js batch  --wave sN                       # → data/.song-batch-sN.json

# 2. GENERATE (Opus, one agent per song). Pass TODAY'S date.
Workflow {scriptPath:"workflows/generate-songs.js", args:{items:<contents of data/.song-batch-sN.json>, verifiedDate:"D Mon YYYY", dateModified:"YYYY-MM-DD"}}

# 3. PREP — from the JOURNAL, never the truncated <result>. Use the Transcript dir from step 2.
node workflows/prep-songs.js --journal <genTranscriptDir>/journal.jsonl --batch data/.song-batch-sN.json \
     --out workflows/.scratch/songs-sN.json --verified-date "D Mon YYYY" --date-modified "YYYY-MM-DD"
#    Read the LYRIC REVIEW warnings. Anything in songs-redo-sN.json needs re-generating.

# 4. INGEST + BUILD
node tools/_ingest-songs.js workflows/.scratch/songs-sN.json   # refuses to overwrite; --force is explicit
node tools/build.js                                            # validate-songs.js gates it

# 5. AUDIT → FIX  (do NOT skip — see "what the audit caught" below)
#    !! IN A WORKTREE you MUST pass `repo`, or every agent audits the MAIN checkout's pages
#    instead of the ones you just built — a clean-looking PASS against the wrong site.
Workflow {scriptPath:"workflows/audit-songs.js", args:{ pages:[{slug,confidence},...], repo:"$(pwd)" }}
node workflows/parse-audit.js --journal <auditTranscriptDir>/journal.jsonl \
     --out "$(pwd)/workflows/.scratch/current-fixes.json"     # parse-audit.js is shared with quotes
Workflow {scriptPath:"workflows/fix.js", args:{ slugs:[...FAIL slugs], repo:"$(pwd)", kind:"song" }}
#    !! `kind:"song"` is REQUIRED — without it fix.js edits data/quotes/ and the agents find nothing.
#    !! SCOPE GATE — fix agents may edit ONLY their own data/songs/{slug}.json. This must print nothing:
git status --porcelain -- tools workflows | grep . && echo "^^ fix agents escaped their lane"
#       (COMMIT your own pipeline edits BEFORE this step, or your changes make the gate unreadable.)
#    Their generator findings arrive in the fix report's `remaining` — they are told to REPORT, not
#    edit, because tools/build-songs.js renders every page and parallel agents would race on it.
#    Apply each ONCE, centrally, as its own commit. They are often the most valuable output of the
#    whole wave (see below).
node tools/build.js

# 6. SWEEP + SHIP
node tools/songs.js sync /tmp/empty.json    # echo '[]' > /tmp/empty.json — sweeps selected → ingested
git checkout -b songs-sN && git add -A && git commit && git push && gh pr create ...
```

### What the audit caught on its first run (wave s1) — why step 5 is not optional
All ten pages passed the three headline claims (`firstRecordingHolds`, `confusionBarHolds`,
`noLyrics`). Every real defect was *below* the headline, which is exactly where a human read stops:

- **A false machine-readable claim.** `beyond-the-sea`'s prose correctly explains that Roland Gerbeau
  recorded the French "La Mer" in 1945 and that the English "Beyond the Sea" was first recorded by
  Harry James in 1947 — while the JSON-LD asserted *"Beyond the Sea was first recorded by Roland
  Gerbeau"*. The FAQ answer was **hardcoded from the page title**, so no record edit could reach it.
  Prose and structured data contradicted each other, and only the structured data is what an
  assistant reads. `schema.faqAnswer` now overrides it.
- **`original.released` and `original.charted` were never rendered.** Researched, validated and stored
  on every song record since the first 27 — and dropped by the renderer. Dead data on 37 pages, found
  only because a fix agent went looking for the caveat it had written. Now rendered (37/37).
- Two pages contradicted their own cited sources (`bring-it-on-home` on the Dixon credit,
  `delta-dawn` on how many releases preceded Reddy).

Result: 6 PASS / 4 FAIL, 31 issues, 22 fixed in-record, the rest applied centrally to the generator.

> **CORRECTION (2026-07-23).** This section originally cited a fifth finding: that `everybodys-talkin`'s
> listen link pointed at a 1969 reissue master rather than the 1966 original, and used it as proof
> that "the generator's self-reported verification is not evidence". **That finding was REFUTED by its
> own skeptic and should never have been written up as confirmed.** MusicBrainz has partially-unmerged
> duplicate recording entities across that release group — its 1967 LP entry is a Wikipedia-derived
> stub with timings short across the *whole* album (the Raga is out by 45 seconds) — so the two MBIDs
> are a database artifact, not two masters. "Fixing" it would have swapped in the *less* well-sourced
> identifier. It was reported as confirmed because `parse-audit.js` read the auditor's raw issues and
> never saw the skeptic verdicts; that bug is fixed (see the gotcha below). The real lesson is the
> opposite one: **an adversarial pass told to find problems WILL manufacture some. The skeptic is what
> makes the audit trustworthy — and its verdicts have to actually be applied.**

### "Hear the original" — the `listen` link has a fixed procedure
The most persuasive artifact on a song page is the recording almost nobody has heard. It is also the
easiest thing to get wrong, because **an artist's own official channel very often hosts a LATER
RE-RECORDING under the original title** — legitimate uploader, legitimate ℗ line, wrong record by
decades. The research pass behind #118 caught three of exactly that: a 2003 re-cut of "Brændt",
Lori Lieberman's 1995/2009/2022 re-recordings of "Killing Me Softly", and The Arrows' 2002 re-do of
"I Love Rock 'n' Roll". The procedure, encoded in the `generate-songs.js` prompt:

1. Link the **ORIGINAL only** — never the famous cover; the cover is one search away.
2. **Fetch the watch page**; read the uploader and the ℗ line. Accept only an official artist/label
   channel, a VEVO channel, or a "Provided to YouTube by \<distributor\>" auto-upload.
3. **Cross-check the duration against the MusicBrainz recording.** This is the step that separates
   the original from a re-recording, and nothing else does. No match, or no established duration → omit.
4. Never an embed URL — the page renders a link, not a player (weight + third-party cookies).

**An absent link beats a dubious one** — 4 of the first 27 correctly have none. `prep-songs.js` prints
every proposed link with its claimed provenance *and* names the omissions, so both are a noticed
decision rather than a default. `validate-songs.js` gates the SHAPE only (https, no embed, `source`
present); whether the link is the right *recording* is a human call.

`sameAs` is the durable half: prefer a MusicBrainz **recording** MBID for the original, confirmed
against the release it first appeared on; fall back to a **work** MBID; always include the Wikidata
QID. Streaming URLs are rejected on purpose — they rot, and a dead identifier in structured data is
worse than none.

**An identifier of the COMPOSITION is not an identifier of the RECORDING**, and getting that wrong
asserts, machine-readably, that the song *is* one particular record. `build-songs.js` routes
`musicbrainz.org/work/` URLs to the `MusicComposition` node and everything else to `MusicRecording` —
which is right for MBIDs and wrong for Wikidata, where `Q3645800` ("original song written and
composed by…") and the recording item are indistinguishable as strings. **A record declares the
difference with `schema.workSameAs`**, an array merged into `recordingOf.sameAs`. Seven wave-s3 fix
agents filed this independently and two of them deleted good identifiers as the only workaround
available to them.

`prep-songs.js` now **fetches every Wikidata QID's entity description and classifies it**, so this is
caught at prep instead of at audit — and prints an explicit ✓ when everything checked out, because
the block used to be silent and silence read as a pass. Applied corpus-wide it moved **67**
identifiers across 90 records; the audit had spotted 8. The wave that motivated it had 22 of 26
records affected.

### What a normal wave looks like — so a high FAIL count does not read as a broken wave
Wave s2 (27 songs) came out **10 PASS / 17 FAIL, 122 issues** (3 blocker · 30 high · 37 medium ·
52 minor), and that is a HEALTHY result, not a bad one. The audit is adversarial by design and most
findings are medium/minor. **Judge a wave by its three headline booleans**
(`firstRecordingHolds` / `confusionBarHolds` / `noLyrics`), by how many blockers survive the skeptic,
and by whether the fix agents stayed in their lane — not by the PASS/FAIL split.

Wave s3 (26 songs, the backlog tail) came out **12 PASS / 14 FAIL, 84 issues** (5 blocker · 17 high ·
25 medium · 37 minor) with **3 of 25 skeptic-checked findings refuted**. All 26 held
`confusionBarHolds` and `noLyrics` — including the 16 medium-confusion candidates, so a weak-looking
queue tail is not automatically a drop. But **7 of 26 failed `firstRecordingHolds`**, well above the
1–2 the line below predicts: on a mature backlog the harvest lead is wrong or incomplete often enough
that **the audit, not the generator, is what establishes who was first.** In 4 of those 7 the JSON-LD
FAQ answer asserted a flat priority claim the visible prose had already hedged — check that pairing
explicitly, it is the failure mode this vertical keeps reproducing.

Expect, per wave: **1–2 blockers** (a genuinely wrong first recorder — s2 found two), a handful of
`sameAs` entries pointing at the COVER, several real links that do not carry the claim pinned to
them, and a long tail of structured-data nits. Expect roughly **15–20% of skeptic-checked findings to
be REFUTED** — that is the skeptic working, not a wasted stage.

### Song-specific gotchas
- **THE SKEPTIC VERDICTS ARE APPLIED BY `parse-audit.js`, NOT BY THE JOURNAL.** The audit workflow
  drops refuted findings in its own `.then()`, but the journal records each agent's RAW return — so
  for several waves `parse-audit.js` handed `fix.js` findings the skeptics had already thrown out
  (wave s2 sent 5; a wave-s1 finding was reported as "skeptic-confirmed" when it had been refuted).
  Fixed: verdicts now echo `{slug, location}` and `parse-audit.js` pairs and drops them, printing
  each drop. **A journal from before that change cannot be paired** — the parser says so loudly
  rather than silently passing them through; review those by hand.
- **Wave size is a parameter, not 10.** `songs.js select <N>` takes any N; the recipe uses 10 for
  readability. For scale: **wave s2 ran 27 songs for ~7.5M subagent tokens and ~44 minutes** of
  workflow time across generate + audit + fix. Budget accordingly; the audit stage is the expensive
  half, because every page gets an agent and every high/blocker gets a second one.
- **`verifiedDate` format is `"D Mon YYYY"`** — e.g. `"22 Jul 2026"`, matching `answer.lastVerified`
  in the records. `dateModified` is ISO `"YYYY-MM-DD"`. Pass TODAY's date, per wave.
- **A dead agent is hard to identify from the journal.** `started` lines carry an opaque agent id and
  no label, so "which page did I lose?" cannot be answered from the journal directly. Diff the slugs
  present in the `result` lines against the batch you submitted — that is the only reliable method,
  and it is what the documented `--allow-partial` decision actually depends on.
- **`prep-songs.js` LYRIC REVIEW is silent when it finds nothing.** Unlike `validate-songs.js` (which
  always prints), no output means zero hits — not that the scan was skipped.
- **The batch carries the WHOLE lead**, not a bare title — the harvest already established who
  recorded it first and a human reviewed the queue on that. The generator's job is to CONFIRM and
  deepen, and to **report a contradiction rather than quietly publishing a different answer**.
- **`generate-songs.js` and `prep-songs.js` each hold a copy of `toRecord`** (sandbox, no `require`),
  exactly as `generate.js`/`prep-wave.js` do. Change one, change the other.
- **The schema ceiling applies here too.** `SONG_DOSSIER_SCHEMA` is 3,304 bytes against the 4,072
  budget. `verify-corpus.js` now checks **every** agent-facing schema, not just the quote one — a
  song dossier is richer than a quote's, so it is the one most likely to drift over. Fields the batch
  already knows (artist, year, label, writer) and everything fixed or derivable (kickers, headings,
  slugs, initials) are applied in `toRecord`, NOT asked of the agent — that is what buys the room.
- **Reassigning `original.artist` orphans an author hub.** When a fix agent corrects the first
  recorder, the old artist's `authors/{slug}/` directory survives and fails the "rendered author pages
  match author hubs" invariant. It used to report only "expected 786, got 788" — no names, and
  `git status --untracked=all` hides the stale ones because they are tracked. **`verify-corpus.js`
  now names them and prints the `git rm -r` line to run.** Do that, then rebuild. (s3 hit this twice.)
- **Record prose carries HTML entities; JSON-LD does not decode them.** A record-authored
  `schema.faqAnswer` shipped `Milli Vanilli&rsquo;s version is a cover` to the one consumer that reads
  it aloud. `build-songs.js` now runs the whole JSON-LD graph through the quote template's `plain()`
  (URLs excepted) — the decoder that had existed since day one and that the song builder had simply
  never applied. If you add a new plain-text sink, route it through `plain()`.
- **Deleting a record does not delete its rendered pages.** The build writes pages but never removes
  orphan directories, so a removed song leaves `who-recorded/{slug}/` and its author hubs behind and
  the "rendered pages match hubs" invariant fails the build. That is the invariant working — `rm -rf`
  the orphan dirs (`git status --porcelain --untracked=all`) and rebuild.

## Songs — the `/who-wrote/` axis (added 2026-07-23)

The music object has a SECOND axis: **"who WROTE this song?"** — where the performer is correctly
credited, but a *different, recognisable artist* wrote it. Spec: `workflows/SCOPE-who-wrote-it.md`.
Three shapes, each with its own verdict vocabulary:

| shape | meaning | ClaimReview? | confidence |
|---|---|---|---|
| `credit` | the writer isn't the definitive performer (a revelation) | no | attributed |
| `misbelief` | the public thinks the PERFORMER wrote it (a fact-check) | yes (rates it false) | disputed |
| `contested` | authorship is litigated / genuinely disputed | no (a court ruling isn't a provenance trace) | disputed |

A record declares `axes`: `["writing"]` (writing-only → renders `/who-wrote/{slug}/`) or
`["recording","writing"]` (**dual** → renders ONE page at `/who-recorded/{slug}/` with a "who wrote
it" section; recording owns the canonical URL — no second page). `validate-songs.js` gates it; the
shape⇄confidence/misattribution consistency checks apply to **writing-only** records only (on a dual
record both belong to the recording axis).

### The harvest is deterministic — the candidates are already in `data/songs`
The best "who wrote it" candidates are cover-eclipse records: a recognisable artist wrote the song and
a *different* act's recording is the one the public knows. Every recording record already names its
writer (`original.writer`), so the harvest is a **scan, not an agent hunt**:

```bash
node workflows/harvest-who-wrote.js            # → data/who-wrote-queue.json (+ .md digest)
node workflows/harvest-who-wrote.js --report   # counts only
```

It stages every recording-only record with a nameable writer, preserving human decisions
(`status` / `suggestedShape` / `dropReason`) across rescans by slug. **Review each candidate**:
(1) is the writer a recognisable *recording artist* (inclusion test 1 — drop Diane Warren / Leiber &
Stoller: nobody expects them to have recorded it, so there's no gap); (2) is the shape right
(`misbelief` when the famous performer is assumed to be the author; `credit` when it's just
little-known; drop when `writer == performer` — no story).

### Ingest — dual-axis enrichment (the cheap, high-value path)
The writer is already verified in the record, so ingesting is adding three things to
`data/songs/{slug}.json` and rebuilding:

```json
"axes": ["recording", "writing"],
"shape": "misbelief",
"writing": {
  "kicker": "Who wrote it", "recordHeading": "Who wrote it",
  "label": "Written by <writer> — not <performer>",
  "writer": "<writer>", "writerSlug": "<kebab>",
  "trailTitle": "How we traced the writing",
  "trail": [ "…credited to <writer>, who wrote it…", "…<performer>'s version is so identified…", "…the same page's other story is the recording (above)…" ]
}
```

Then `node tools/build.js` (validate-songs gates it; 39 invariants must reconcile) → branch + PR.
Result: the `/who-recorded/` page gains a "Who wrote it" section, the writer's author hub picks up the
song (under "written by" if they have a distinct `writer` role; under "recorded first" if they also
recorded it — both true), and `/verify?q=<title>` answers "who wrote X" at the canonical URL.

### Ingest — a NEW writing-only record (needs research)
For a song with **no** recording record (the writer never released a competing version — e.g.
"You've Got a Friend", "Bitter Sweet Symphony"), author a full writing-only record modelled on
`data/songs/youve-got-a-friend.json` (the `writing` block plus `meta`, `context`, `authors`,
`schema`). `misbelief` needs a `misattribution` block + emits a ClaimReview; `credit`/`contested`
must NOT carry one. NO LYRICS — the unit is the title.

> **Not yet built — the agent path.** There is no `generate-who-wrote.js`. Dual-axis enrichment is
> mechanical enough to do by hand from the queue; new writing-only records are researched by hand.
> If a future wave wants agent-driven generation, write a SEPARATE `generate-who-wrote.js` with its
> own dossier schema — do NOT extend `SONG_DOSSIER_SCHEMA`, which has only ~768 bytes of headroom
> under the 4072-byte `SCHEMA_BUDGET` that `verify-corpus.js` enforces (an oversized schema kills
> every agent at the platform, 0 tokens, no readable error).

### Worker
`/verify` answers writing queries via a `t:"w"` branch in `worker/src/index.js` (deployed
2026-07-23). The Worker fetches `verify-index.json` live (60s TTL), so new writing waves need **no
redeploy** — only a brand-new discriminator type would.

## The numbers are not yours to compute (added 2026-07-22)
**`tools/corpus.js` is the ONE source of truth for every figure the site states about itself.**
No generator may count anything itself — it imports `CORPUS` and reads a field. This exists because
every generator used to rediscover its own counts and they disagreed *in production*: the home page
advertised **"526 Authors"** on a tile linking to an index headed **"593 authors"**, and `/authors/`
said **"1041 quotes"** against **1058** everywhere else. Nothing caught either, because nothing ever
compared one generator's arithmetic to another's.

- **`tools/corpus.js`** — reads the records once, derives every figure + the shared aggregates
  (`records`, `songs`, `authors`, era buckets). Import it; do not `readdirSync` the data dirs.
- **`data/corpus-state.json`** — the committed, diffable snapshot, rewritten every build by
  `tools/build-state.js`. A content wave shows up in its PR as `"total": 1058 → 1076`. **Commit it.**
- **`tools/verify-corpus.js`** — 27 invariants, run last in `build.js`, **exits 1** on any mismatch.
  It asserts the parts sum to the wholes, the rendered pages match the records, `search.json` and
  `sitemap.xml` match the corpus, the committed snapshot is not stale, **and the figures printed
  into the HTML equal the corpus** (that last group is what catches a hardcoded literal — verified
  by reintroducing the 526 bug, which now fails the build).
- **Source gates run inside `build.js`** and cannot be skipped: `validate-records.js --quiet`
  (which was orphaned for months — wired into nothing, so it never ran) and the new
  `validate-songs.js` (song records had **no** gate at all; all 27 were written straight into
  `data/songs/` by agents). Both abort the build on failure.
- **`validate-songs.js` LYRIC REVIEW warnings always print, even under `--quiet`.** Whether a quoted
  phrase is a lyric is not mechanically decidable — these records legitimately quote speech and
  belief statements — so it surfaces candidates for a human instead of blocking, by design.

If you add a content type, it needs: a record dir, a `validate-*.js` gate wired into
`runSourceGates()`, figures in `corpus.js`, and invariants in `verify-corpus.js`. Skipping that is
how songs got in unchecked.

## Gotchas (all learned the hard way — do not skip)
- **Reconstruct from the JOURNAL, never the task-notification `<result>`** — it's truncated for big waves.
  (The double-escaping you may SEE in the notification is a transport artifact; the journal data is clean.)
- **`prep-wave.js` does the escaping scan + STUB detection** — trust it. Stubs = an agent returning
  schema-valid placeholder junk ("t"/"test"); they're excluded and listed for re-generation.
- **Fuzzy-match min length** — prep only fuzzy-matches ogTitles ≥12 chars, so a degenerate stub ogTitle
  ("o") can't misroute onto a real batch item (the r16 bug).
- **`git add -A` after any `harvest.js sync`** — sync regenerates author pages, `/flagged`, `/under-review`.
- **Stamp dates per wave** (generate object-form args) so pages don't all claim one stale "last verified".
- **Track A → `--credited`; Track B → omit it** and theme-tag the new records.
- **New records emit `schema.isPartOf`; ~1,192 old ones still carry `isBasedOn`. Both render — the
  backfill is still pending.** `isPartOf` is the work a sentence is CONTAINED IN; `isBasedOn` is the
  specific translation the English wording came from. `tools/template.js:278-279` has documented that
  distinction all along, but `DOSSIER_SCHEMA` only ever offered `isBasedOn*`, so every wave filed
  containment under derivation and no agent could do otherwise — which is also why the Schema.org
  RULE (isPartOf required) was unmeetable by construction. Renamed 2026-07-30 in `generate.js` AND
  its `prep-wave.js` twin. **Do not "fix" a new record back to `isBasedOn` because the neighbours use
  it.** The outstanding work is a one-time backfill of the ~1,029 records that hold a containing work
  with no translation signal; the 16 genuinely-translated ones keep `isBasedOn`. #281 had to land
  first, because the `isPartOf` branch could not carry `citation`/`pagination` and the rename would
  have silently stripped them from the 28 best-sourced records.
- **"DOSSIER_SCHEMA can't emit X, so add X to it" is usually the wrong fix — check whether X is
  DERIVED first.** The schema sits at 4,069 of a proven-good 4,072 bytes, so every such ask is a
  budget fight, and the pipeline's answer to a field an agent shouldn't be trusted with is to compute
  it in `toRecord`/prep rather than ask for it. `misattribution.items[].kind` was filed by both the r32
  and r33 audits as "unmeetable by construction, 466 records hand-patched"; it is in fact produced by
  `tools/mis-kind.js` → `prep-wave.js` at ingest, with `backfill-mis-kind.js` for the existing corpus
  and two `detectors.js` detectors watching the residual — measured at **0 of 482 owed rows missing**,
  and r33 stamped 17 with no hand-patching. Adding it to the schema would have cost +22…+61 bytes
  against zero headroom to buy nothing. Full reasoning in the "ASKED FOR AND DECLINED" comment in
  `generate.js`; `audit.js`'s SETTLED list now tells agents not to re-file it.
  **The genuinely unmeetable one is different in kind**: `creatorDescription` (CLAUDE.md) has no
  deriving rule and no source to derive from — that is why the RULE was narrowed instead.
- **`--credited`'s guard mis-fires on name-form expansions, so do not lean on it.** `prep-wave.js`
  only stamps when `leadName(record author) !== leadName(batch author)` — comparing LAST WORDS. r27
  produced two records that trip that on the same person: `"Confucius (Kong Qiu)"` (lead `Qiu)`) and
  `"Socrates, as written by Plato"` (lead `Plato`). With `--credited` both would have been stamped
  `creditedTo` = the magnet — a machine-readable "falsely credited to Confucius" on a record whose
  author IS Confucius. `creditedTo` means *falsely* credited (`tools/credits.js`), so a wrong stamp
  asserts the opposite of the truth. On a mostly-Track-B wave omit the flag and hand-check instead:
  list records whose true author differs from the magnet, and stamp only genuine reassignments.
- **Hero framing on reassigned disputed pages**: answer.authorName + author.* + schema.creator must be the
  TRUE author; the magnet lives only in the misattribution section (Jobs→Brand / Lincoln→Anonymous).
- **A RESUMED run makes the started-vs-result gate read WRONG, and re-auditing is not idempotent.**
  Both learned in r39, when a platform outage (`529 Overloaded`, zero tokens — the requests never
  reached a model) forced three attempts at one audit.
  - **The gate can fire on an ARTIFACT.** `resumeFromRunId` appends to the SAME journal, so every
    failed attempt leaves orphaned `started` lines behind. r39's audit journal read *69 started vs 31
    results* while the final run was 27/27 clean. `--allow-partial` was correct there — but the thing
    that justified it was checking COVERAGE PER SLUG (all 20 pages had a result), not the counter. A
    genuinely truncated run looks identical at the counter level; only the per-slug check separates
    them. Do that before overriding, every time.
  - **Re-auditing the same page can return a DIFFERENT VERDICT.** Four pages got audited twice and
    `living-is-like-tearing-through-a-museum` came back **FAIL then PASS on identical input**. Both
    audits found the SAME defect; one graded it `high`, the other `medium`, and the verdict follows
    the grade. So the FINDINGS are stable and the VERDICT is not — never treat a PASS on a re-run as
    clearing an earlier FAIL. `parse-audit.js` keeps one audit's issues per slug, so the other's are
    silently dropped: union them by hand when a slug was audited more than once. r39 recovered 8
    findings that way, including a second `high` the surviving audit did not carry.
- **NEVER read a journal before the workflow finishes.** `journal.jsonl` is appended LIVE and holds
  `started` lines as well as `result` lines, so a line count is not a result count — and a partial
  read looks exactly like a smaller successful run. r23 hit this twice: `prep-wave.js` reported
  "dossiers: 2" for a 10-quote batch, and `parse-audit.js` saw 8 of 10 page audits. Both looked
  clean; either would have silently shipped a fraction of the wave. **Wait for the workflow's own
  completion notification.** `prep-wave.js` and `parse-audit.js` now ABORT on a started-without-
  result imbalance (and prep-wave also aborts if dossiers < batch size) — `--allow-partial`
  overrides only when an agent genuinely died and you accept the shortfall. To check by hand use
  `grep -c '"type":"result"'`, never `wc -l`. Note `audit.js` emits skeptic re-checks into the same
  journal, so results legitimately EXCEED the page count (19 results for 10 pages in r23).
- **`REPO` default paths** in audit.js/fix.js/harvest-dedup.js/apply-tags.js fall back to
  `/Users/davidstewart/Developer/quotle-info` — but they all accept an object-form `repo` arg, which
  is MANDATORY in a worktree (see step 5). The fallback only applies in the primary checkout.
- **A WORKTREE DOES NOT ISOLATE THE AGENTS, only the wave.** `repo` is a Read prefix, not a working
  directory (audit.js:14-15), and no workflow sets an agent cwd — so every research agent's cwd is
  the SESSION's cwd, i.e. the primary checkout, even when the wave runs from `/private/tmp/qi-wave-rN`.
  Nothing asks agents to write files, but source research reaches for it anyway: a Cloudflare
  interstitial or an API quota error comes back through WebFetch as unusable text and the natural
  workaround is `curl -o page.html`. On 2026-08-17 wave r36's generate run left `gb.json` (a Google
  Books 429) and `ht.html` (a Cloudflare challenge) in the checkout root, from three agents that each
  invented their own filename.
  **Why that is not cosmetic:** five documented steps run `git add -A` (this file, DAILY-WAVE.md,
  DAILY-MERGE.md:182, DAILY-REPORTS.md:307), so agent debris is committed to `main` by whichever
  routine runs next, authored by a routine with no idea where it came from. CI does not catch it —
  the "committed output matches the generators" gate fails on an UNCOMMITTED dirty tree, and once
  `git add -A` has run the tree is clean and the junk is tracked.
  The four agent-running workflows now carry a `SCRATCH_RULE` telling agents to write only to
  absolute paths under `/tmp` (the convention promote-detectors.js:54 already used). That is a
  prompt, so it is persuasion rather than a gate: **check `git status` in the PRIMARY checkout after
  a wave**, not just in the worktree. Ignoring the two observed filenames would fix nothing — the
  next agent picks different ones, which is why the rule is about the location.
- **A slow fix/audit agent is not a hung one** — a fix agent hunting a live source can run ~8 min; its Edits
  land on disk incrementally, so its work is safe even before it returns. Check `agent-*.jsonl` mtime.
- **Auto-merge** may be disabled on the repo — use `gh pr merge <#> --squash` (not `--auto`).

## Discovery reality (2026-07-14)
We are NOT indexed yet (only a stale homepage; 0 deep pages) — that's why cold agents don't find us. On-site
setup is correct (robots/sitemap/JSON-LD/internal links all good). The march to 2000 IS the SEO engine
(each page is a shot at ranking for a misattribution query). Fastest lever = IndexNow→Bing (run after every
deploy). Auth-gated user actions that help most: GSC "Request Indexing" + Bing Webmaster Tools sitemap submit.
