# Closing reader reports — the noon pass

A local routine runs this every day at 12:00 ET.

**This is the only routine that emails a reader.** It is small, it is authenticated, and it runs on
the operator's machine because that is where the credential is.

## Why it is separate, and why noon is fine

The 04:00 pass audits and fixes; it never closes anything. Splitting them did two things:

**It moved the expensive half off the laptop.** Auditing a record costs real tokens and needs no
secret. Only reading the queue and closing a report ever did — and the read is public now. So the
04:00 pass runs in cloud whether or not the laptop is awake, and only this three-minute pass depends
on it.

**It stopped us telling readers about fixes that had not shipped.** `stamp --close-reports` used to
fire in step 6 of the audit pass, *before the PR merged*. A reader was told "we fixed it" while the
fix sat in a PR that might still fail CI, be rebuilt, or be rejected. This pass reads the record on
`main`, so "shipped" means merged.

Noon is fine because the reply is a **courtesy, not a critical event**. Nothing downstream waits on
it. A reply that arrives six hours after the fix is a reply; one that arrives before the fix exists
is a lie.

## Step 0 — preflight

```bash
node tools/preflight.js --routine reports-close
export ADMIN_TOKEN=$(/opt/homebrew/bin/gcloud secrets versions access latest --secret=quotle-admin-token --project=word-boxing 2>/dev/null)
git checkout main && git fetch origin && git merge --ff-only origin/main
```

**`2>/dev/null`, never `2>&1`** — gcloud writes a deprecation warning to stderr, and folding it in
gives you a 461-character token instead of the real 43. `echo ${#ADMIN_TOKEN}` should print 43.

**Being current matters more here than anywhere else.** This pass decides whether a fix shipped by
reading the record on `main`. A stale checkout reads yesterday's `main` and concludes a merged fix
has not shipped, leaving the reporter unanswered — silently, and looking like a quiet day.

## Step 1 — see what it would do

```bash
node tools/review.js close-merged --dry-run
```

One line per pending report:

| verdict | means |
|---|---|
| `accepted` | the record on `main` carries `lastVerdict: FIXED` stamped **after** the report was filed. Closing it **emails the reporter**. |
| `rejected` | stamped `PASS` after the report — we looked, the page stands. Closes silently, no email. |
| `LEAVE` | no stamp, or a stamp predating the report. The fix has not shipped. Stays pending. |

**`LEAVE` is the common and correct outcome** on any day the 04:00 pass found nothing, or its PR has
not merged yet. It is not a failure and needs no action.

## Step 2 — close them

```bash
node tools/review.js close-merged
```

Then log it:

```bash
node tools/routine-log.js --routine reports-close --outcome <no-op|pr> --processed <N> \
  --note "N accepted (emailed), N rejected, N left pending"
```

If you committed a log shard, branch `reports/<YYYY-MM-DD>-close`, PR ready not draft, and let the
07:00 pass merge it. **Do not merge it yourself.**

## What this pass must never do

- **Never stamp a record.** It reads stamps; it does not write them. Writing one here would mean this
  pass deciding a fix shipped, which is the audit pass's judgement to make.
- **Never edit `data/quotes`, `data/songs`, `tools/` or `workflows/`.** Its only write is its own log
  shard.
- **Never close a report the tool marked `LEAVE`** to tidy the queue. A pending report is a reader
  still owed an answer; draining it unread is worse than leaving it, because a reply that never comes
  is at least honest about the state.
- **Never run without a token.** `review.js` falls back to the public endpoint, which carries no
  report ids — `close-merged` detects this and refuses rather than silently closing nothing. Do not
  work around that.
