# quotle.info content pipeline (durable workflow scripts)

These are the multi-agent **Workflow** scripts that grow the corpus. They were previously
kept in a session scratch dir and kept getting lost on compaction — they now live here,
version-controlled. Each `*.js` is a Claude Code `Workflow` script (run via the `Workflow`
tool with `{scriptPath: "workflows/<file>.js", args: ...}`), **not** a plain Node CLI —
except `harvest-dedup.js`, which is a standalone `node` script.

All agents run on **Opus** at `effort: 'high'`. The discipline throughout: **defer to Quote
Investigator / Wikiquote**, never overclaim past them, and treat a wrong `public-domain`
rights badge as the costliest possible error.

## The scripts

| File | Kind | What it does |
|---|---|---|
| `harvest-candidates.js` | Workflow | One agent per magnet author pulls DOCUMENTED misattributions/disputed lines + a few genuine anchors from Wikiquote + QI. Returns `{byAuthor, candidates[]}`. |
| `harvest-dedup.js` | node CLI | Standalone dedup of a harvest output vs the live corpus (superseded in practice by `tools/harvest.js sync`, kept for reference / one-off use). |
| `generate.js` | Workflow | Researches each selected quote into a full provenance dossier → `records[]` ready for `tools/_ingest.js`. |
| `audit.js` | Workflow | Adversarially audits each newly-built page (re-fetches every source link, checks confidence/rights/JSON-LD), then a skeptic re-checks each high/blocker. Returns `{pageAudits[]}`. |
| `fix.js` | Workflow | Applies the confirmed audit fixes to each flagged record, re-verifying every factual replacement against source. Reads the fixes map from `workflows/.scratch/current-fixes.json`. |

## End-to-end wave (the proven loop)

```
# 1. HARVEST — replenish the backlog with fresh magnet authors
Workflow harvest-candidates.js  args={perAuthor:12, authors:[...]}
#    → reconstruct candidates[] from the journal, write to a file
node tools/harvest.js sync <harvest-out.json>     # append + dedup vs corpus+queue, sweep published→ingested

# 2. SELECT + BATCH — stage the next wave off the queue
node tools/harvest.js select 40 --wave rN
node tools/harvest.js batch --wave rN              # emits [{text, author, index:null}] for generate

# 3. GENERATE — research each into a dossier
Workflow generate.js  args={items:[...], verifiedDate:"D Mon YYYY", dateModified:"YYYY-MM-DD"}
#    → parse records[]; RUN THE ESCAPING SCAN (grep for &lt;a / &amp;mdash) and unescape one
#      level PER RECORD before ingest; stamp creditedTo; then:
node tools/_ingest.js <records.json>
node tools/build.js && node tools/build-index.js && node tools/build-authors.js \
  && node tools/build-search.js && node tools/build-verify.js

# 4. AUDIT — adversarial fact-check of the built pages
Workflow audit.js  args=[{slug, confidence, rights}, ...]
#    → collect the FAIL pages' issues into workflows/.scratch/current-fixes.json (keyed by slug)

# 5. FIX — apply confirmed fixes, then rebuild
Workflow fix.js  args=["<slug>", ...]              # reads workflows/.scratch/current-fixes.json
node tools/build.js && node tools/build-index.js && node tools/build-authors.js \
  && node tools/build-search.js && node tools/build-verify.js
#    → spot-check any reassigned heroes (disputed pages must NOT show the magnet under "Not X")

# 6. SHIP
node tools/harvest.js sync /tmp/empty.json         # sweep the wave's selected → ingested ([] input = sweep-only)
git add -A && git commit && gh pr create && gh pr merge --auto --squash
#    → after Pages deploys: node tools/indexnow.js
```

## Notes / footguns learned the hard way

- **Escaping scan BEFORE ingest.** Research agents occasionally double-escape HTML
  (`&lt;a`, `&amp;mdash`). Detect per-record and unescape one level *before* `_ingest.js`.
- **`git add -A` after any `harvest.js sync`** — sync regenerates author pages, `/flagged`,
  and `/under-review`; a partial stage ships an inconsistent site.
- **Stamp dates per wave.** `generate.js` defaults `verifiedDate`/`dateModified` but pass the
  object form so pages don't all claim the same stale "last verified" date.
- **Hero framing on disputed pages.** When a fix reassigns the true author, `answer.authorName`
  + the whole `author.*` block + `schema.creator` must become the TRUE author; the magnet
  belongs only in the misattribution section (Jobs→Brand / Lincoln→Anonymous pattern).
- **`REPO` is hard-coded** to `/Users/davidstewart/Developer/quotle-info` in `audit.js`,
  `fix.js`, and `harvest-dedup.js` (the agents' Read/WebFetch tools need absolute paths).
  Update that constant if the repo moves.
- **`.scratch/`** holds per-wave intermediates (`current-fixes.json`, records, audit-args) and
  is gitignored — only the scripts themselves are committed.
