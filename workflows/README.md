# quotle.info content pipeline — the march to 2000

Everything needed to keep growing the corpus toward **2,000 quotes** (to match Quote Investigator),
**durably across context compaction**. All scripts here are committed; a fresh session can run a full
wave by following this file. Per-wave intermediates go in gitignored `workflows/.scratch/`.

## Current state (update this line each wave)
- **Corpus: 718** quotes. **Target: 2000.**
- **Next wave number: r21.** (Waves r6–r20 shipped. Numbering is just a label for batch/scratch files.)
- Harvest backlog: `data/harvest-queue.json` (committed) — ~500 queued. `node tools/harvest.js report`.
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
Workflow audit.js  args=<contents of workflows/.scratch/audit-args-rN.json>
node workflows/parse-audit.js --journal <auditTranscriptDir>/journal.jsonl   # writes .scratch/current-fixes.json + prints FAIL slugs
Workflow fix.js  args=<the FAIL slug list printed above>
node tools/build.js
#    Spot-check any reassigned heroes (disputed pages must show the TRUE author, not the magnet).

# 6. THEME-TAG the new records (needed so they appear on /themes). Tag only the untagged ones:
#    extract untagged {slug,quote} from data/quotes, run the tag workflow (see tag-themes.js / the
#    persisted tag-themes-r14 script), then:
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
- **`REPO` absolute paths** in audit.js/fix.js/harvest-dedup.js/apply-tags.js = `/Users/davidstewart/
  Developer/quotle-info`. Update if the repo moves.
- **A slow fix/audit agent is not a hung one** — a fix agent hunting a live source can run ~8 min; its Edits
  land on disk incrementally, so its work is safe even before it returns. Check `agent-*.jsonl` mtime.
- **Auto-merge** may be disabled on the repo — use `gh pr merge <#> --squash` (not `--auto`).

## Discovery reality (2026-07-14)
We are NOT indexed yet (only a stale homepage; 0 deep pages) — that's why cold agents don't find us. On-site
setup is correct (robots/sitemap/JSON-LD/internal links all good). The march to 2000 IS the SEO engine
(each page is a shot at ranking for a misattribution query). Fastest lever = IndexNow→Bing (run after every
deploy). Auth-gated user actions that help most: GSC "Request Indexing" + Bing Webmaster Tools sitemap submit.
