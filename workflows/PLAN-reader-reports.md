# PLAN — reader reports end to end (draft for review, 2026-07-28)

Status: **proposal, not built.** Reviewed against `tools/review.js` + `tools/scan.js`, which another
session built on 2026-07-27 and which already own most of this.

## What a reader can actually send us

`/report/` collects exactly two intents. Everything below follows from that, and nothing else
should be invented:

| intent | form | endpoint | has a slug? |
|---|---|---|---|
| **ADD** — "you're missing this quote/song" | `#nomForm` | `POST /nominate` | no — it does not exist here yet |
| **DISPUTE** — "what you say about this is wrong" | `#fixForm`, and the per-quote form on every `/who-said/` page | `POST /submit-source` | yes (or a pasted link we parse) |

## ADD — reuse the harvest gate, add no criteria

The acceptance criteria already exist in `tools/harvest.js`. `harvest.js sync` dedupes against the
**corpus and the backlog** and rejects candidates that fail the bar. So the whole path is:

    nomination → shape as a harvest candidate → node tools/harvest.js sync

- already in the corpus → close the report, "we have it"
- already queued        → close the report, "already queued"
- accepted              → it is in the backlog; a future wave builds it
- rejected by the gate  → close the report with the gate's reason

**No agent. No new criteria.** Writing a second acceptance test here would be the "rebuilt what we
already had" mistake for the fourth time.

## DISPUTE — the evidence decides, and mostly deterministically

    fetch the submitted URL
      ├─ no URL, or unreachable/404        → close: rejected (nothing to check)
      ├─ reachable                          → does it contradict the record?
      │     ├─ the record contradicts ITSELF or its own cited source
      │     │        → AUTO-CORRECT (see the narrowing below)
      │     └─ otherwise                    → FLAG the record and stop
      └─ flagged records are picked up by `review.js due`, which already weights a flag at
         FLAG_WEIGHT = 1000 — above every other signal — and hands the slug to workflows/audit.js.

**That is the whole design.** The dispute path does not audit, does not research, and does not judge
whether a stranger's source beats ours. `workflows/audit.js` already re-fetches every source link,
tests whether it supports the claim attached to it, and runs a skeptic over blockers. Pointing a
second judge at the same question is how you get two answers.

### The narrowing on auto-correct — deliberate

Auto-correct fires **only when the record disagrees with itself**, e.g. `schema.creator.sameAs`
links the right person while `creator.name` says someone else (the Jourdan case review.js was
written for). That is machine-settleable and carries no opinion.

It does **not** fire on "this reader's source beats ours." That path is anonymous input reaching a
published attribution on a site whose entire product is provenance discipline, and it is trivially
abusable: submit a plausible link often enough and the record moves. Flagging costs one audit cycle
and removes the attack surface. If this proves too conservative, loosen it *after* seeing real
reports — not before.

## What has to be built (everything else already exists)

1. **Worker** — `POST /triage` (ADMIN_TOKEN-gated): `{id, kind, verdict, note}` → writes
   `triage` + `triaged_at`. Plus `reason` added to the `/sources` SELECT, which the new form sends
   but the endpoint does not return. Schema: two `ALTER TABLE ... ADD COLUMN`.
2. **`data/review-flags.json`** — committed, diffable, SEPARATE from `data/scan-state.json`.
   Scan-state is machine-derived from detectors; a reader report is a human assertion. Mixing them
   would make a flag's provenance unreadable, and scan.js clears rows on content-hash change — which
   would silently drop reader flags.
3. **`review.js`** — `reports` currently only prints. Add `reports --triage` to run the flow above,
   and teach `riskFlags()`/scoring to read `review-flags.json`.
4. **One agent, one question**, only for disputes whose evidence is reachable and not
   self-contradiction: *does this source actually contradict the record?* Nothing else.
5. **Daily schedule** that exits in milliseconds when the queue is empty — the common case.

## Explicitly NOT building

- A second auditor (`audit.js` exists, and review.js says so in capitals)
- New harvest acceptance criteria (`harvest.js sync` has them)
- Prose/claim-shape matching (review.js measured this: 61% then 45% hit rate — noise, not signal)
- An agent on every report (most resolve by fetching a URL)
- Auto-PR from an anonymous attribution claim

## Open questions for the reviewer

- Does flagging via a separate file actually reach `review.js due` scoring cleanly, or does the
  spine assume flags come only from detectors?
- Is `harvest.js sync` genuinely safe to feed anonymous input, or does it trust its caller?
- Is there an abuse path we have not closed (rate limits are per-IP per-day on submission only)?
- Does closing a report need to be idempotent — what happens if the daily job runs twice?

---

# REVISED after independent review (2026-07-28)

The original plan above was judged **wrong-shape**. Kept verbatim for the record. What follows
replaces it. The corrected design is SMALLER: roughly half of what the plan wanted to build already
exists, and the one real gap was not in the plan at all.

## What the review overturned

1. **ADD must keep its human gate.** `worker/src/index.js` states nominations land in a moderation
   queue and are NEVER auto-published; a human promotes them. Once a candidate is `queued` it IS
   published — rendered into `/under-review/`, embedded in `/flagged/`, indexed into `search.json`.
   Feeding `harvest.js sync` from anonymous input would put a fabricated quote, attributed to a
   named living person, on a public page of a provenance site. **No job may call `harvest.js sync`
   on nomination output.**
2. **`GET /lookup` already answers the ADD question** — corpus → backlog → pending nomination →
   Wikiquote, returning a stage, live and synchronous, already consumed by `/check`. It also
   auto-queues a moderation nomination when Wikiquote confirms literally. Wiring `#nomForm` through
   it answers the reader AT SUBMIT TIME, which is the only honest answer available: neither table
   has a contact field.
3. **`data/review-flags.json` is not needed.** `dueSet` already reads `/sources` and scores reader
   reports at 2000/4000 — above `FLAG_WEIGHT = 1000`. A separate file would be a second source for
   one number, the exact thing `corpus.js` exists to prevent.
4. **No new agent.** `audit.js` already re-fetches every source link and tests it against the claim
   attached to it, with a skeptic. Asking an agent the same question first produces two answers.
5. **No auto-correct.** The `creator.name` vs `sameAs` detector was built, measured at 46 hits with
   the first six all false positives, and deleted as not mechanically decidable without fetching the
   authority page — which is audit.js's job. Re-adding it re-derives a rejected result.
6. **Do not fetch the submitted URL.** Reachability is not evidence quality, and auto-rejecting on a
   transient 502 or a UA block discards a valid correction permanently.

## The steps, in order

1. **Fix the harvest-queue injection surface** (independent of this feature; live today).
   `build-index.js` interpolates `${c.category}` unescaped into a class attribute;
   `build-flagged.js` puts `documentedAt` into an href via an escaper that does not handle `"` and
   does no scheme check, so `javascript:` passes. `html-safety.js` gates `data/quotes` and
   `data/songs` — `harvest-queue.json` has no gate at any stage.
2. **Fix `stance` on `/report/`** — `build-index.js` hardcodes `'refutes'`, making the 4000/2000
   priority split inert for every report from that page. Derive it from `reason` as `template.js`
   does.
3. **Wire `#nomForm` through `/lookup`** before `/nominate`. Deletes the ADD daily job entirely and
   gives the reader a synchronous outcome.
4. **Close the loop on disputes** — the one real gap:
   - `/triage` must write `source_submissions.status`, conditional on `status='pending'` so a second
     run is a no-op. Writing only `triage`/`triaged_at` leaves `/sources?status=pending` undrained
     and the job non-idempotent.
   - Validate slug at the worker with `/^[a-z0-9-]{3,80}$/` (as `/vote` does), permitting `''` as
     the explicit "no page" case; route empty/unknown slugs to a named bucket rather than dropping
     them.
   - Add `reason` to the `/sources` SELECT and print it — on a sourceless report it is the only
     content.
   - Cover songs: `review.js` reads `data/quotes` only, so reports from 90 song pages and ~14
     writing records vanish. Extend it or say loudly that they have no destination.
   - **An automated caller for `audit.js`.** Today `due` prints a table and `args` writes JSON for a
     human to paste. There is no automated destination for a flagged record. This is the actual work.
5. **Invariants** — the spine has none, and CI never runs `scan.js`:
   (a) every `f` entry in scan-state is a live detector id; (b) scan-state covers exactly the live
   record slugs; (c) `FLAG_WEIGHT > DEFAULT_CYCLE_DAYS + max(demand)` — documented in prose,
   asserted nowhere; (d) reader-report priority strictly exceeds flag priority. Plus tests for
   step 4's idempotency and slug contract, or they are wishes.

Note on shape: the daily job "exits in milliseconds when empty" only for the empty case. Any ADD
acceptance mutates the queue → `/under-review/` → `search.json` → `corpus-state.json`, and
`verify.yml` fails on drift, so it means rebuild + commit + PR.

---

# VALIDATED by a second, independent cite-check (2026-07-28)

13 of 15 of the first review's claims verified against the code. Corrections and additions that
change what gets built:

- **Step 2 is DELETED.** `/report/`'s `#fixForm` offers no `supports` option, so `stance:'refutes'`
  is CORRECT, not inert. Deriving it would yield 'refutes' for all five reasons. The first review
  called a real code difference a bug; it is not one.
- **The slug regex must be `/^(song:)?[a-z0-9-]{3,80}$/`.** Song pages submit `slug:"song:<slug>"`
  (build-songs.js). A bare `[a-z0-9-]` regex 400s every report from 97 live song pages. Decide this
  WITH song coverage, not before it.
- **`scan.js` must not go into CI as-is.** It writes `state.updated` on every run, so the
  `git status --porcelain` gate fails every day after the last commit. Run `--report --json` and
  assert on stdout, or only write `updated` when records/catalogue actually changed. Do NOT exempt
  scan-state from the dirty check — that is weakening a gate to pass a build.
- **The loop is still open without a RETURN LEG.** `parse-audit.js` -> `fix.js` already exist
  downstream of audit.js. `review.js stamp` writes a local file and closes nothing, so a record can
  be audited, fixed, stamped, rebuilt and shipped while its report is still `pending` and scoring
  4000 forever. `stamp` (or the job wrapping it) MUST call `/triage`.
- **NO schema change.** `source_submissions.status` already exists (`pending|accepted|rejected`) and
  is indexed. The original plan's "two ALTER TABLEs" above is WRONG — do not run them.
- **Unresolvable reports need a DRAIN.** A report whose slug is renamed, deleted or empty joins to
  no record and stays pending forever. The named bucket needs a triage verdict, or it is a second
  silent queue.
- **DISPUTE outcomes are one-way** unless a public read-back is added. Neither table has a contact
  column. State it or fix it; do not leave it implied.
- **Concurrency**: `harvest.js save()` rewrites a ~1MB JSON plus two derived files, so two branches
  touching it conflict rather than race. Only a risk if an ADD path is ever automated — which is
  why step 3 deletes it. Recorded so nobody reintroduces it.

## Invariants (revised)

- (a) every `f` id in scan-state is a live detector id — KEEP
- (b) scan-state slugs == live record slugs — KEEP, but only after the timestamp problem above
- (c+d) ONE rank test over the real scoring expression, asserting the documented order:
  reader-refuted > reader-reported > overdue+risky > overdue > never-reviewed. Two arithmetic
  assertions would NOT have caught the measured bug where an uncapped sentinel scored 9,884 vs 750
  and flagging a record DEMOTED it.
- (e) every distinct slug in /sources resolves to a destination (quote, song, or named bucket)
- (f) run the EXISTING html-safety gate over harvest-queue.json candidates
- (g) render a poisoned fixture and assert no attribute breakout and no non-http(s) href
- (h) /triage idempotency: `UPDATE ... WHERE id=? AND status='pending'`, second call changes 0 rows

---

# CONSOLIDATION + EMAIL (decided 2026-07-28, not yet built)

## One form, not three

"Should be both" meant ONE form serving both jobs. What shipped was two forms stacked on /report/
(#fixForm + #nomForm), which is the same sprawl with a shared URL. Rebuild as a single <form> with
intent as the first question and fields that adapt:

    What are you reporting?
      ( ) Something on a page here is wrong
      ( ) You're missing a quote

      wrong   -> Which quote? paste the link or the line     (required)
      missing -> Who is it credited to?                      (required)
      missing -> The quote, if you have it                   (optional)

      What's wrong?          radios, shown only for "wrong"
      A link that shows it   (optional)
      Anything else          (optional)
      Your email             (optional)

One submit handler branches: wrong -> /submit-source, missing -> /lookup then /nominate. The email
field then becomes ONE edit rather than three.

The per-quote form on quote pages (#srcForm) STAYS. It is contextual, already knows which quote, and
is strictly the better path when the reader is on a page — removing it reintroduces the retyping
problem this whole day started from. So: one report form, plus the in-context one.

## Email field — copy matters more than the policy page

The reassurance goes NEXT TO THE FIELD, where someone decides whether to type it. Not only on
/privacy/, which nobody reads before submitting.

    Your email (optional)
    Only used to tell you what we found. We never sell or share it.

Rules for this copy:
  · state the SINGLE purpose — more reassuring than a list of things we will not do
  · no marketing hedge. Never "we may occasionally contact you about…" — that is the phrasing that
    stops people typing it. If we only ever send one reply, say exactly that.
  · say nothing about timing. The reply comes when a human has looked; implying speed we cannot
    deliver is worse than silence.

/privacy/ must be updated IN THE SAME CHANGE — it currently discloses only the IP hash and
nomination content, so adding a contact field without amending it makes that page inaccurate.

## Abuse: email amplification

An optional address plus an automated reply lets someone submit reports carrying a victim's address
so our system mails them. Mitigations that hold:
  · ONE reply per report, ever. No resends, no follow-ups.
  · never echo submitter-controlled text into the body — their quote/note goes in escaped and
    truncated, or not at all
  · the per-IP daily cap already limits volume
  · draft-not-send until a promotion bar is met (below)

## Trust ladder — earn the automation, with a number

"If we believe the gate holds" is a feeling unless it has a threshold. Record `mode` in
data/report-queue.json and promote deliberately:

  observe -> runs the gate, records what it WOULD have done, changes nothing
  pr      -> opens the PR, stops
  merge   -> merges on green CI

Bar: 5 consecutive runs where the gate's call matched the operator's — no PR they would have
rejected, no queued item they would have wanted as a PR. Miss one, the counter resets. Five is
arbitrary, but a stated threshold beats an unstated one.

Email runs its OWN ladder (draft -> send) on its own counter: mailing strangers is a distinct trust
question from opening a PR against your own repo.

Note: there are ZERO real reports today, so observe mode collects nothing until genuine traffic
arrives — which depends on the indexing work, not on this pipeline.

## Email sending — decided 2026-07-28

**Send via Mast's existing Resend account, from `runmast.email`.** No new account, no DNS.

Why not a dedicated quotle.info sending domain: the shared Resend account is on the FREE plan, which
allows exactly ONE domain, and `runmast.email` already occupies it (verified, us-east-1). Adding
quotle.info returns "Your plan includes 1 domain. Upgrade to add more." Options were: a separate free
Resend account (isolated, needs signup), upgrade to Pro at $20/mo for 50K emails, or send as
runmast.email. Chose the last for now.

Make the sender legible despite the domain mismatch:

    From:     "Quotle.info" <quotle@runmast.email>
    Reply-To: help@quotle.info

The recipient sees "Quotle.info" and replies reach the address the site already advertises on
/contact/ and in llms.txt. The runmast.email domain only shows on header inspection.

KNOWN RISK, accepted: a message about quotle.info sent from runmast.email, whose body links to a
third domain, is a mild phishing signal to spam filters. At single-digit volume this is unlikely to
bite. If replies start disappearing, that is the cause — fix by upgrading Resend and verifying
quotle.info properly, not by tuning the copy.

Key: RESEND_API_KEY in GCP project `runmast-outreach` (Mast's platform key). Mast resolves it via
getSecret() and treats that as the single source of truth — do not copy the value into a second
store. Mast's send path (functions/email-queue-processor.js) also queues sends and writes an audit
row per send; quotle's worker cannot require those modules (Cloudflare, not GCP Functions), so reuse
the SHAPE, not the code.

If two Google identities collide at a login page: stewartd@runmast.com is a Google Workspace identity
(runmast.com MX = smtp.google.com), so it and stewartdavidp@gmail.com both route to the same Google
chooser. Separate them with distinct Chrome profiles, or sign up with email+password instead of SSO.
