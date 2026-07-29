# Weekly discovery audit — find defect classes nobody has a detector for

A claude.ai routine runs this every Monday at 06:00 UTC (02:00 ET in summer) against `main`.

**It runs at 02:00 to clear the 03:00 daily wave, not for any reason of its own.** It was at 03:30,
half an hour behind a wave that budgets 1.5–2M tokens for 5 records and can easily still be running —
so once a week the two overlapped. Moving it an hour ahead of the wave gives it a clear window
instead of a trailing one.

Overlap is no longer corrupting — since 2026-07-29 no routine merges its own PR, and the 07:00 pass
(`DAILY-MERGE.md`) serializes every merge, so the worst case became "one branch is BEHIND and merges
a day later" rather than two branches fighting over ~1,163 rebuilt files. This spacing is what keeps
that worst case from happening weekly.

Note the cron is fixed UTC, so this drifts to 01:00 ET when the US leaves daylight saving. That still
clears the wave, which drifts by the same hour.

## This one is NOT free, and that is the point

The daily review pass (`DAILY-REVIEW.md`) is flag-driven and costs nothing on a day with no flags.
**This is the opposite.** It audits records that nothing flagged, precisely because nothing flagged
them — a detector can only re-find what someone already found once, so without this the catalogue
never grows and layer 1 stays frozen at whatever we thought of the day it was written.

Cost scales directly with how many records you take, and it is the only routine of which that is
true. **Audit 20 records per run**, which is the number that makes weekly runs compound: a class
present in 3% of the corpus has a 46% chance of being touched in any one week and 91% within a
month, because `P = 1 - (1-f)^n`.

⚠ **THE COST ESTIMATE IS UNVERIFIED.** A full tier-2 audit measured ~205K tokens a record, but that
included re-fetching every source link and a skeptic pass. This is a lighter read — record plus
built page, looking for self-contradiction — and every class found so far has been an INTERNAL
contradiction needing no source fetch. It should be far cheaper. Nobody has measured it. Record
what the run actually did so the estimate can be replaced with a number.

## Pick the sample — the queue already ranks it

```bash
node tools/scan.js                    # so the flag state is current
node tools/review.js due --limit 20   # take these 20
```

`due` ranks by reader reports, flags, staleness, demand and STRUCTURAL ODDITY — how many fields a
record is missing that ~all its peers have (schema, context, copyAttribution, misattribution). That
last signal is what makes this sample better than a random one: it cannot flag a class nobody has a
detector for, but it can flag a record that is *unusual*, and unusual records are where unmet
classes hide. It is a prioritisation signal only — 52 records legitimately have no misattribution
block, so oddity asserts nothing is wrong.

**STAMPING IS WHAT MAKES THE SWEEP ADVANCE — do not skip it.** Auditing a record does not change its
oddity: conclude the missing fields are fine and it is still an outlier next week, and the week
after, forever. Rotation comes from having LOOKED. `review.js stamp` records that, and the priority
weights are set so a stamped record can never outrank an unstamped one (oddity caps at 200, below
the 250 never-reviewed bonus). Miss the stamp and next week draws the same 20.

## Audit them

For each record: read `data/quotes/<slug>.json` **and** the built page at
`who-said/<slug>/index.html`, then re-fetch every source link and test whether it literally supports
the specific claim attached to it. Check that the visible prose and the JSON-LD agree — that pairing
is where this corpus fails most often. Check `confidence` and `source.rights` are honest.

**Default to finding nothing.** An adversarial pass told to find problems will manufacture some.
Report an issue only if you can point at the specific text and the specific source that contradicts
it.

## What to do with what you find

**A one-off factual error** — fix it in `data/quotes/<slug>.json`, verifying against the source
first. Then `node tools/review.js stamp <slug>`.

**After stamping ANYTHING — including a clean PASS — re-run `node tools/scan.js` before you commit.**
This pass stamps every record it audits, that being the whole rotation mechanism, so it always
mutates records. `stamp` writes a `review` block, which changes the record's **content hash**, so the
`scan.js` at the top of this file now holds stale hashes. `verify.yml` runs `scan.js` itself (added
2026-07-29) and fails the build on the difference — so a run that stamps and does not rescan goes red
every time, no matter how good its findings were.

**A CLASS of defect** — something mechanically detectable in any record, without fetching — is the
valuable find. Do not just fix it. Write a candidate detector to `/tmp/cand.js`:

```js
module.exports = {
  id: 'kebab-case-id', severity: 'medium',
  field: 'the.record.field[].yourFixSets',   // lets the gate DERIVE record vs backfill vs generator
  title: 'one line',
  test(r) { return /* null, or a string saying why this record is flagged */; },
};
```

Then measure it before believing it:

```bash
node tools/propose-detector.js /tmp/cand.js
```

The gate prints a hit rate and a verdict. **Respect it.** Rules that looked obviously right have
measured 130 hits (11.2%) and 703 (61%) on this corpus, because they matched the editorial content
of a misattribution site rather than errors in it. If it says REJECT, report the candidate in the PR
body and add nothing.

If it passes, include the candidate file's contents in the PR body so a human can run
`propose-detector.js --accept` — do **not** append to `tools/detectors.js` yourself. That file is
shared and admission is deliberately serial.

## Record what this run did

```bash
node tools/routine-log.js --routine weekly-discovery --outcome <no-op|pr> \
  --sampled 20 --findings <N> --proposals <N> [--pr <url>]
```

Commit it. This is the routine whose cost estimate is explicitly marked unverified above, so its
log line is the one that matters most.

## Scope

Edit only `data/quotes/*.json` (plus the one appended line in `data/routine-log.jsonl`). Never `tools/` or `workflows/`:

```bash
git status --porcelain -- tools workflows   # must print nothing
```

**Branch name — load-bearing, not cosmetic.** Name the branch `discovery/<YYYY-MM-DD>`. `tools/merge-gate.js` (the
07:00 merge pass) decides what may auto-merge from an ALLOWLIST OF BRANCH PREFIXES, because the
GitHub author is the same account for routine and human PRs and cannot distinguish them. It fails
closed: a branch it does not recognise is classed `HUMAN` and left alone forever. Use the wrong
prefix and this PR simply never merges — silently, and looking exactly like a quiet night.

Finish with `node tools/build.js`, then branch, commit, push and open a PR. If you found nothing —
which is a good and common outcome — say so in one line, stamp the records you audited, and open a
PR containing only those stamps. **A PASS is a finding**: it is the record of "we looked and this is
fine", and without it the same 20 records are re-derived every week at full cost.

**Open the PR READY, never as a draft** (`gh pr create` without `--draft`). A draft cannot be
merged, so every draft leaves an unmergeable PR sitting until a human clicks "Ready for review" —
which happened on the first two routine runs before anyone noticed. Draft/ready is now load-bearing in a second way: the
07:00 merge pass (`workflows/DAILY-MERGE.md`) SKIPS drafts, so a draft is never merged and never
chased — it simply sits until someone notices.

