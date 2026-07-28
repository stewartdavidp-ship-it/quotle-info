# Weekly discovery audit — find defect classes nobody has a detector for

A claude.ai routine runs this every Monday at 07:30 UTC (03:30 ET) against `main`.

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

## Scope

Edit only `data/quotes/*.json`. Never `tools/` or `workflows/`:

```bash
git status --porcelain -- tools workflows   # must print nothing
```

Finish with `node tools/build.js`, then branch, commit, push and open a PR. If you found nothing —
which is a good and common outcome — say so in one line, stamp the records you audited, and open a
PR containing only those stamps. **A PASS is a finding**: it is the record of "we looked and this is
fine", and without it the same 20 records are re-derived every week at full cost.
