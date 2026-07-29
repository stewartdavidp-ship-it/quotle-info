# Open items — handoff from the 2026-07-29 session

Six things the first daily report surfaced that a person has to decide. Written for a **fresh
session with no context**: each item states what is wrong, what has already been established (so you
do not re-derive it), and what is genuinely still open.

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

## 5 · Egress allowlist — widen it, or write the gap down

Confirmed reachable: wikiquote · wikipedia · wikisource · quoteinvestigator · gutenberg · loc.gov
Confirmed blocked (CONNECT 403): monticello.org · archive.org · books.google.com · rarebookroom.org ·
babel.hathitrust.org · snopes.com · constitutioncenter.org
`founders.archives.gov` returns **202 with an empty body** to both curl and WebFetch.

Between them these are the primary route for most Franklin and Jefferson claims. **Four claims went
unestablished on 2026-07-29 as a direct result**, and the pages say so in their own prose.

**Open:** add the hosts to the cloud environment's allowlist (UI-only config, the operator must do
it), or record in the workflow docs that these are permanently unreachable so waves stop spending
stages rediscovering it. Doing neither means every future wave pays the same cost.

## 6 · `licensed` rights value is 0/1166 — emit it or retire it

`licensed` is a valid value in three places: `tools/build-discovery.js:30` (schema enum),
`tools/validate-records.js:44` (validator), `tools/build-check.js:209` (renders *"Cleared for reuse
under licence — keep the credit."*).

**No record has ever used it.** `daily-review` reported this and correctly did not act, because its
doc forbids touching `tools/`.

**Open:** is there a real class of quote that is neither public-domain nor in-copyright-and-unusable?
If yes the generator should be able to emit it; if no, retire the vocabulary entry and the renderer
branch. Low stakes either way — this is dead-code hygiene, not a live defect.

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
