# Daily discovery audit — find defect classes nobody has a detector for

A claude.ai routine runs this daily at 07:30 UTC (03:30 ET) against `main`.

## This one is NOT free, and that is the point

The daily review pass (`DAILY-REVIEW.md`) is flag-driven and costs nothing on a day with no flags.
**This is the opposite.** It audits records that nothing flagged, precisely because nothing flagged
them — a detector can only re-find what someone already found once, so without this the catalogue
never grows and layer 1 stays frozen at whatever we thought of the day it was written.

Measured cost: **~205K tokens per record audited.** At 2 records a day that is ~410K/day, ~2.9M/week.
It is the price of discovery, and it is not avoidable by cleverness — if it were free it would not
be finding anything new.

**Audit 2 records per run.** Not more without a decision: this is the one routine whose cost scales
directly with how much it does.

## Pick the sample

Draw from records that are **not** flagged and **not** recently reviewed — flagged ones already have
a cheaper route (`DAILY-REVIEW.md`), and re-auditing fresh work finds nothing.

```bash
node tools/scan.js                    # so the flag state is current
node tools/review.js due --limit 20   # priority order: demand, age, reader reports
```

Take 2 from that list that are NOT in the flagged set. Prefer high-demand records — a wrong page
nobody reads matters less than a wrong page with traffic.

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
PR containing only those stamps.
