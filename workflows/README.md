# quotle.info content pipeline — the march to 2000

Everything needed to keep growing the corpus toward **2,000 quotes** (to match Quote Investigator),
**durably across context compaction**. All scripts here are committed; a fresh session can run a full
wave by following this file. Per-wave intermediates go in gitignored `workflows/.scratch/`.

## Current state (update this line each wave)
- **Corpus: 1118** quotes + **37** songs. **Target: 2000** quotes.
- **Next wave number: r26.** (Waves r6–r25 shipped via this pipeline. Numbering is just a label for batch/scratch files.)
- Harvest backlog: `data/harvest-queue.json` (committed) — 391 queued.
- **Songs: next wave number s2.** (s1 shipped 2026-07-22: 10 records, the first wave driven by the songs pipeline end to end.) Song backlog `data/song-queue.json` — 53 queued, 36 ingested, 1 dropped. Digest: `data/song-queue.md`.

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
- Four tracks (see below). Track A ≈ 70 magnet authors harvested; Track B covered 24 themes;
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
| `apply-tags.js` | node CLI | Tag-workflow journal → write `record.themes`. |
| `harvest-dedup.js` | node CLI | Standalone dedup (reference; superseded by `tools/harvest.js sync`). |
| `audit-songs.js` | Workflow | **Songs:** adversarial audit of built /who-recorded/ pages + skeptic. args `{pages, repo}` |
| `harvest-songs.js` | Workflow | **Songs:** candidate sweep, one agent per vein. args `{veins:[...], perVein:12, exclude:[slugs]}` |
| `generate-songs.js` | Workflow | **Songs:** research each queued song → dossier. args `{items:[...], verifiedDate, dateModified}` |
| `prep-songs.js` | node CLI | **Songs:** journal → ingest-ready records (toRecord + escaping + stub + LYRIC + axis checks). |

Workflow scripts run via the `Workflow` tool (`{scriptPath, args}`); they can't `require()` repo modules
(sandbox), so `generate.js` has an INLINE `toRecord` that must stay in sync with `prep-wave.js`'s copy.
The Workflow launch result prints a **Transcript dir** — its `journal.jsonl` is the input to the node CLIs.

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
#    edit). Read those: apply each ONCE, centrally, as its OWN commit — not smuggled into a wave.
#    They are often right and often important (the ClaimReview claimant bug, 59 pages emitting a
#    false machine-readable claim, was found exactly this way).
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
node workflows/apply-tags.js --journal <tagTranscriptDir>/journal.jsonl
node tools/build.js

# 7. SHIP
echo '[]' > /tmp/empty.json && node tools/harvest.js sync /tmp/empty.json   # sweep this wave's selected → ingested
git checkout -b wave-rN && git add -A && git commit && git push
gh pr create ...
#    !! REBASE-REBUILD BEFORE MERGING — built HTML is COMMITTED, so a wave branched before a
#    generator fix but merged after it SILENTLY REVERTS that fix on every page the wave rebuilt.
#    (git is right to keep the wave's side: the wave did change those files.) r19 reverted #59's
#    og:image fix on its 40 pages this way. The build is idempotent, so this is cheap and a no-op
#    when nothing moved:
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
- **The listen-link duration check failed silently.** `everybodys-talkin`'s generator note claimed the
  runtime matched "the MusicBrainz recording on Capitol's release of that album". The auditor queried
  the MB web service: that recording is **first-release-date 1969**, from the retitled reissue, not
  the 1966 original. **The generator's self-reported verification is not evidence** — this is the one
  finding that proves the audit stage cannot be replaced by a better prompt.
- **`original.released` and `original.charted` were never rendered.** Researched, validated and stored
  on every song record since the first 27 — and dropped by the renderer. Dead data on 37 pages, found
  only because a fix agent went looking for the caveat it had written. Now rendered (37/37).
- Two pages contradicted their own cited sources (`bring-it-on-home` on the Dixon credit,
  `delta-dawn` on how many releases preceded Reddy).

Result: 6 PASS / 4 FAIL, 31 issues, 22 fixed in-record, the rest applied centrally to the generator.

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

### Song-specific gotchas
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
- **Deleting a record does not delete its rendered pages.** The build writes pages but never removes
  orphan directories, so a removed song leaves `who-recorded/{slug}/` and its author hubs behind and
  the "rendered pages match hubs" invariant fails the build. That is the invariant working — `rm -rf`
  the orphan dirs (`git status --porcelain --untracked=all`) and rebuild.

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
- **Hero framing on reassigned disputed pages**: answer.authorName + author.* + schema.creator must be the
  TRUE author; the magnet lives only in the misattribution section (Jobs→Brand / Lincoln→Anonymous).
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
- **A slow fix/audit agent is not a hung one** — a fix agent hunting a live source can run ~8 min; its Edits
  land on disk incrementally, so its work is safe even before it returns. Check `agent-*.jsonl` mtime.
- **Auto-merge** may be disabled on the repo — use `gh pr merge <#> --squash` (not `--auto`).

## Discovery reality (2026-07-14)
We are NOT indexed yet (only a stale homepage; 0 deep pages) — that's why cold agents don't find us. On-site
setup is correct (robots/sitemap/JSON-LD/internal links all good). The march to 2000 IS the SEO engine
(each page is a shot at ranking for a misattribution query). Fastest lever = IndexNow→Bing (run after every
deploy). Auth-gated user actions that help most: GSC "Request Indexing" + Bing Webmaster Tools sitemap submit.
