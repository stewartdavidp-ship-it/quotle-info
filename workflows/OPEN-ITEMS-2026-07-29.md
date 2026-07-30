# Open items — handoff from the 2026-07-29 session

Six things the first daily report surfaced that a person has to decide, plus a seventh added by the
session that closed the first two. Written for a **fresh session with no context**: each item states
what is wrong, what has already been established (so you do not re-derive it), and what is genuinely
still open.

**Items 1, 2, 3 and 5 are RESOLVED** (#258, #260, #261; item 5 on 2026-07-30 — see the notes under
each). **Items 4 and 6 are open.** Item 7 records what 1–2 left behind; its schema half is closed for
the same reason item 3's is — **`DOSSIER_SCHEMA` has zero headroom, not the "~87 bytes" its own
comment implies.**

> **Item 2's resolution is narrower than it reads.** It says the `--credited` mis-fire was fixed by
> comparing the LEADING name of `rec.answer.authorName` with the batch author. That guard still
> mis-fires on a name-form expansion, because it compares last words: wave r27 produced
> `"Confucius (Kong Qiu)"` (lead word `Qiu)`) and `"Socrates, as written by Plato"` (lead word
> `Plato`) — both the same person as the magnet, and both would have been stamped `creditedTo`, which
> means *falsely* credited. The residual is written up in `workflows/README.md`'s gotchas: on a
> mostly-Track-B wave omit the flag and hand-check instead. Wave r28 shows the same signal can be a
> TRUE positive (`John D. Rockefeller` → `John D. Rockefeller Jr.`, genuinely father and son), so it
> is a review trigger, not a rule.

**Read this before researching any of them.** Every claim below was checked against the code on
2026-07-29; the file/line pointers are real. What is NOT settled is what to *do*, which is the point
of the new session.

---

## First, what is already closed — do not re-raise

The report `data/daily-report/2026-07-29.md` carries 11 numbered items. **Four are done**, and its
own header block says so. Specifically:

- **Its item 1 is NOT a defect.** `strength-does-not-come-from-physical-capacity-…` was re-audited
  against the primary (mkgandhi.org's "The Doctrine of the Sword": two-sentence form verbatim, the
  "average Zulu" continuation, dateline *Young India*, Ahmedabad, 11 August 1920). Stamped `PASS` in
  #252. The wave's PR body was stale, not the record.
- **Items 3 and 4 are fixed** in #251 (`tools/proxy-boot.js`; `daily-report.js` now reads the legacy
  log and alarms on `error`).
- **Item 8 is confirmed** — `quotle-reports-close` is scheduled and enabled.
- **Item 2** (were the other four #193 records adequately re-audited?) was handed to a dedicated
  source-verification agent on 2026-07-29. Check for its result before touching those four:
  `dont-give-up-dont-ever-give-up`, `if-god-did-not-exist-…`, `let-us-cultivate-our-garden`,
  `one-dies-twice-…`.

---

## 1 · `claimQuoteText` cannot be set on a magnet-author record — SHIPS WRONG PAGES

> **RESOLVED 2026-07-29.** The diagnosis below is right about the guard and wrong about the lever.
> `claimQuoteText` was never what should have decided the banner: `renderPresentationKit` had its own
> copy of the right-person-wrong-words test keyed on that field, while the JSON-LD block 760 lines
> above already used the correct ATTRIBUTION test. One predicate now, `rightPersonWrongWords()` at the
> foot of `tools/template.js`, shared by both. **17 pages stopped shipping the contradiction; 1
> started shipping the banner it needed** (`houston-we-have-a-problem` carries `claimQuoteText`, so
> the old test suppressed the warning on the one page whose credit is flatly wrong). Two records
> (`he-who-lives-in-harmony-…`, `i-have-nothing-to-declare-…`) were false positives because they
> omitted `answer.realAuthorName: "Unknown"` — the convention `template.js` documents — and were
> corrected. The `!item.author` guard was dropped from both copies too, since which track harvested a
> quote says nothing about whether its wording drifted. Two invariants in `verify-corpus.js` (§4d-bis)
> now assert the contract in both directions against rendered HTML.

**Verified in code.** Two copies, same condition:

- `workflows/prep-wave.js:98` — `if (!item.author && out.quotationText && displayQuote !== out.quotationText)`
- `workflows/generate.js:150` — identical line

`item.author` is set for magnet-author (Track A) batches. So on exactly those records the field is
never written, and `tools/template.js:207` keys `wordingDrift` off `claimQuoteText` being present.

**The visible damage:** a right-person-wrong-words page rendered a banner — *"⚠ The slide-ready
mistake: crediting this to Franklin"* — three sections below its own sentence *"Nobody is falsely
credited here — Franklin really did publish it."* The wave fixed that one record by hand. **The
pipeline still cannot produce a correct one.**

**Open:** whether the guard should be dropped entirely or replaced with a different signal.
`template.js:214–221` documents a previous attempt at this exemption that was both too narrow (12
genuine pages carried no `claimQuoteText`) and too broad — read that comment first, it is the record
of the last person who tried.

## 2 · `prep-wave --credited` stamps `creditedTo` where the credit is correct

> **RESOLVED 2026-07-29.** The guard now compares the leading name of `rec.answer.authorName` with
> the batch author and declines to stamp a self-credit. **Blast radius measured before the fix: 41
> records carried a `creditedTo` naming their own author** (14 verified, 24 attributed, 3 name-form
> variants) plus the 24 disputed right-person-wrong-words ones; 4 non-disputed records carry a
> genuinely false credit and had to survive, which they do.
> The reader was fixed as well as the writer: `tools/credits.js` grew `falseCredits(r)` — the rule
> `build-authors.js` had been applying inline for months — and `build-verify.js` now uses it, so
> `/verify` stopped shipping `credited` (returned as `misattributedTo`) naming the true author. That
> count went **68 → 0**, including the legacy `misattribution.items[0].who` fallback, which re-imported
> the same false claim once `falseCredits` correctly returned nothing.

**Verified:** `workflows/prep-wave.js:149` — `if (STAMP_CREDITED && b.author) rec.creditedTo = b.author;`

Unconditional on the batch author. On a right-person-wrong-words record the credited person is
**right** — only the wording is wrong — so this writes a false "misattributed to X" claim. It is the
input that feeds the banner in item 1.

Line 146 already carries a comment reasoning about not writing a junk `creditedTo`, so the author of
that line was thinking about a *neighbouring* case and did not catch this one.

**Reported 2026-07-28 and again 2026-07-29 — two consecutive days.** It is one guard.

**Relevant memory:** `creditedTo` is multi-valued, and the rule is *verify the claimant, not the
vector* — before writing a false credit, check the person is actually claimed as the author. That is
exactly the check missing here.

## 3 · `creator.description` — a CLAUDE.md RULE no wave can satisfy

> **RESOLVED 2026-07-29 — the RULE was amended, not the schema.** The fork below is real but its
> first branch is closed: **there are no bytes to free.** The wave's "~87 bytes under a hard platform
> ceiling" measures against **4,159, the size that was REJECTED**. The enforced budget
> (`SCHEMA_BUDGET`, `tools/verify-corpus.js:451`) is the proven-good **4,072**, and `DOSSIER_SCHEMA`
> is at **exactly** 4,072 — headroom **zero**. `creatorDescription` costs 39 bytes and would land at
> 4,111, inside the untested `(4072, 4159]` band, where the failure mode is the platform rejecting
> every agent before it runs (0 tokens, no content error).
>
> Nothing is droppable either: the schema carries **no** `description` prose at all, and what remains
> is 485 bytes of `required`, 375 of `additionalProperties: false`, 91 of enums — all constraint work.
> Freeing 35–39 bytes means deleting two `additionalProperties: false`, i.e. weakening a gate so a
> field fits, which the house rules forbid.
>
> So the RULE now asks for **name + birthDate**. `creator.jobTitle` is what actually ships (1,010 of
> the 1,030 records carrying a creator) and `template.js` still passes a hand-written `description`
> through for the 48 records that have one — the capability is intact, only the false universal claim
> is gone. **Do not re-open this as "free the bytes" without new measurement**: see item 7(a), which
> also wanted that headroom and cannot have it either.

CLAUDE.md carries a standing RULE that every quote page's Schema.org `Quotation` includes `creator`
as a Person with **name, birthDate, description**.

`DOSSIER_SCHEMA` in `workflows/generate.js` has **no `creatorDescription` field**. Records fall back
to `creatorJobTitle` (`generate.js:135`). The wave reported the schema is *"~87 bytes under a hard
platform ceiling, so this needs space freed first."*

**Open, and it is a real fork:** free the bytes (what can be dropped from the schema?), or amend the
RULE in CLAUDE.md to match what the pipeline can actually do. Right now the repo asserts a rule it
structurally cannot keep, which is worse than either branch.

## 4 · `hardcoded-pd-cutoff-year` detector — accept or decline

Proposed by the discovery pass, gate verdict **BACKFILL**, 69 hits (5.9%). 62 records say *"the 1931
cutoff"*, 9 say *"the 1930 cutoff"*. **Neither is wrong today.** Both silently become wrong on
2027-01-01. Two records already use a safe self-dating form.

Admission is deliberately serial — route through `node tools/propose-detector.js <cand.js> --accept`,
never by hand-editing the catalogue.

**Open:** accept it (then a sweep to the house "as of 2026" form), or decline on the grounds that a
detector firing on 69 correct records is noise until closer to the date.

## 5 · Egress allowlist — RESOLVED 2026-07-30 (allowlist widened)

> **The "permanently unreachable" half of this item was FALSE, and acting on it would have been the
> expensive mistake.** Re-probed from a local checkout on 2026-07-30: **7 of the 8 hosts below answer
> normally.** They were never unreachable — they were blocked *in the cloud container only*, which is
> a per-environment egress policy, not a property of the sites. Writing them into the docs as
> permanently unreachable would have stopped every future wave from even trying a route that works.
>
> | host | from cloud (2026-07-29) | from local (2026-07-30) |
> |---|---|---|
> | archive.org | CONNECT 403 | **200** — and it is the 3rd most-cited host here, 577 citations |
> | books.google.com | CONNECT 403 | **200** |
> | constitutioncenter.org | CONNECT 403 | **200** |
> | monticello.org | CONNECT 403 | **301** |
> | snopes.com | CONNECT 403 | **301** |
> | founders.archives.gov | 202, empty body | **202** — same everywhere; an origin quirk, not egress |
> | babel.hathitrust.org | CONNECT 403 | **403** — HathiTrust's own bot policy, same class as the |
> | | | Wikimedia UA case already handled in `preflight.js` |
> | rarebookroom.org | CONNECT 403 | **connection failed** — appears genuinely dead; do not chase |
>
> **The operator widened the cloud allowlist on 2026-07-30**, covering these plus the two
> infrastructure hosts below. Verified only from local — the real test is the next scheduled CLOUD
> run, because that is the environment the policy applies to.

Confirmed reachable: wikiquote · wikipedia · wikisource · quoteinvestigator · gutenberg · loc.gov

Between them these are the primary route for most Franklin and Jefferson claims. **Four claims went
unestablished on 2026-07-29 as a direct result**, and the pages say so in their own prose.

### The infrastructure hosts, which cost a whole routine run on 2026-07-30

`quotle-community.stewartd.workers.dev` (`QUOTLE_API`) and `quotle.info` were blocked the same way,
and that is what killed the reader-report pass (#267) at step 1. **`preflight.js` could not see it**:
it probed the four citation hosts, passed 13/13, and reported "safe to proceed" immediately before
the failure. Four citation hosts being reachable says nothing about the one host a routine cannot
start without.

Fixed: `NEEDS` now carries `api: true` for `reports` and `reports-close`, probed separately from
`egress`. `reports-close` previously had `egress: false` and therefore **no network check at all** —
the worst place for the gap, since it is the only routine that emails a real person about a page they
reported. The probe reads `QUOTLE_API` from the environment exactly as the tools do, so an overridden
value is what gets checked, and a 404 counts as a pass (root path has no route; the question is
whether the origin was reached, which `head()` decides by `x-deny-reason`, never by status).

**Lesson worth keeping:** "blocked" from one environment is not "unreachable". Probe from a second
environment before writing a host off — the two answers here differed for 7 of 8 hosts.

## 6 · `licensed` rights value is 0/1166 — emit it or retire it

`licensed` is a valid value in three places: `tools/build-discovery.js:30` (schema enum),
`tools/validate-records.js:44` (validator), `tools/build-check.js:209` (renders *"Cleared for reuse
under licence — keep the credit."*).

**No record has ever used it.** `daily-review` reported this and correctly did not act, because its
doc forbids touching `tools/`.

**Open:** is there a real class of quote that is neither public-domain nor in-copyright-and-unusable?
If yes the generator should be able to emit it; if no, retire the vocabulary entry and the renderer
branch. Low stakes either way — this is dead-code hygiene, not a live defect.

## 7 · What items 1–2 left behind — two exposures, one of them shared with item 3

Added 2026-07-29 after #258 shipped. Neither is a live defect; both are the kind of thing that gets
re-derived from scratch in six weeks if it only lives in a merged PR body.

**(a) `realAuthorName` is hand-maintained, and item 3 is competing for the bytes that would fix it.**
`rightPersonWrongWords()` (`tools/template.js`, foot of file) decides whether a page warns readers
off its own credit. It depends on `answer.realAuthorName` being set whenever the true author differs
from `answer.authorName`. That field is **not in `DOSSIER_SCHEMA`** — no wave emits it, it is added
by hand, and only **71 of 704** disputed records carry one. Two records silently violated it and
suppressed a warning they needed.

Half of this is now gated: `verify-corpus.js` §4d-ter fails the build if a record claims
right-person-wrong-words while its `schema.creator` does not name that same author (22/22 pass;
both historical violations fail it). **That closes the exposure** — drift is a build failure now, and
a human fills the field in.

The other half — letting the generator emit the field — is **closed as unaffordable, not open.**
Corrected 2026-07-29: `generate.js:179` says the schema is "~87 bytes under" the ceiling, but that
measures against **4,159, the size that was REJECTED**. The enforced budget is the proven-good
**4,072** and `DOSSIER_SCHEMA` is at **exactly** 4,072 — **headroom zero**. `answer.realAuthorName`
costs 35 bytes → 4,107, inside the untested `(4072, 4159]` band. Item 3 wanted the same space for
`creatorDescription` (39 bytes) and was resolved by amending the RULE instead; **this one is resolved
by the gate.** Neither field is landing without new measurement.

**If someone does want to spend it, the minimum proof is ONE agent, not a wave** — an oversized
schema is rejected *before* execution (20/20 agents, 19ms, 0 tokens, "output schema too large to
classify safely"), so a single agent carrying a 4,107-byte schema settles the band at zero cost.
Record the datapoint beside the others in `generate.js:173-179` and only then raise `SCHEMA_BUDGET`.
Raising it on faith turns a number that means *proven* into one that means *probably*.

**(b) 38 non-disputed records still carry a `creditedTo` naming their own author.**
`prep-wave.js` no longer writes them and every reader now goes through `falseCredits()`
(`tools/credits.js`), so the data is inert: `/verify` reports 0 rows where `credited == real`, and
the author hubs and theme cards excluded this shape already. The residual exposure is a **future
reader** added without `falseCredits`.

`validate-records.js:160` only checks `real == credited` inside `if (confidence === 'disputed')`, so
these 38 are not warned about, let alone gated. Promoting that to a hard failure is the right end
state and was **deliberately not done**: it fails CI until the 38 records are cleaned, and cleaning
them was considered and declined in favour of fixing the readers. Re-open it as a data decision, not
by tightening the gate underneath it — tightening a gate you then have to weaken to get green is the
exact move this repo forbids.

---

## Traps this session paid for — inherit them, do not re-learn them

- **Check the instrument before the system.** A failed fetch is not evidence about the subject.
  `mkgandhi.org` returns **406** to curl's default user-agent; it looked like a dead source and was
  bot protection. A 403/406/202-empty-body is usually the tool, not the truth.
- **A tool that reads half its input reports the other half as absence.** `daily-report.js` showed a
  hard-failed wave run as a clean one for exactly this reason (fixed in #251). When a result looks
  quiet, check what the tool actually read.
- **Assigning `process.env.NODE_USE_ENV_PROXY` inside a script is a no-op that looks like a fix** —
  Node reads it once at startup. See `tools/proxy-boot.js` for why it re-execs.
- **`review.js stamp` changes the record hash, so `scan-state.json` goes stale.** Run `node
  tools/scan.js` after stamping and commit it, or CI fails. This has now bitten twice (#210, #252).
- **Read `workflows/PLAN-hardening.md` before proposing anything here.** Its v1 proposed rebuilding
  two tools written the day before. The report's item 1 was re-derived because nothing read that
  file. This repo's documented failure mode is rebuilding what exists.
- **Apply a rule's intent, not its letter** — `workflows/README.md`, "Applying a rule". Name what the
  rule protects against and check that risk is present before you build machinery to honour it.
