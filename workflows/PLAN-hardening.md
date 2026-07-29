# PLAN — hardening the routine system (v2, 2026-07-29)

Status: **v1 was reviewed adversarially and largely dismantled.** This is the rewrite. The three
items the review ranked first are already DONE (#238). What follows is what remains, with the
review's cuts applied and its objections answered rather than absorbed.

## What v1 got wrong, kept here so it is not re-derived

1. **It proposed rebuilding two tools written the day before.** `preflight.js` already IS the
   "systematic fix for silent failure" v1's Tier 1.2 proposed; `verify-review-spine.js` already has
   the Worker-contract harness Tier 4.1 called non-existent. This repo's documented, repeated failure
   mode, reproduced by the plan meant to fix it.
2. **Its unifying theme was ~40% real.** Of 15 items grouped as "silent failure", six share a cause
   and a fix (`try/catch → default`). Four are *wrong models of an external system* — each needs a
   different test, not a discipline. One is cache invalidation. One (`git merge`) v1 listed as silent
   AND described as "highest-severity **loud** failure" two sections later. A table assembled to hit
   a count.
3. **Its central argument was refuted by its own code.** v1 claimed three same-day defects proved we
   need a mechanism, not more care. But `preflight.js`'s `sh()` throws and `daily-report.js`'s
   swallows — same author, same day, same helper. That is variance in care. The remedy it supports is
   a convention or a CI grep, not a tier.
4. **Its load-bearing premise was unverified.** "The cloud environment already authenticates GitHub
   REST — no secret required" cited a run log that records using `gh` (which carries its own
   credential), not raw REST. Measured on the operator's Mac: raw `fetch` to `api.github.com` returns
   `x-ratelimit-limit: 60` — anonymous, no write access.
5. **It declared a mitigation impossible without opening the file.** See 2.2 below.

## Done (#238)

- `review.js stamp`: `FIXED → accepted`, `PASS → rejected`. Stops mailing readers "we fixed it" about
  pages that did not change.
- Worker: `pageUrlForSlug` returns the index entry's own `u`. Stops mailing a 404 to whoever reported
  one of the 113 song pages.
- `verify-corpus.js` asserts its own check count (45), catching ~15 guards that could silently delete
  their checks.
- `git merge --ff-only` / `git merge origin/main` allowlisted — three routines stopped at step 0
  without it.

---

## A. Swallowed errors — six items, one fix, ~20 lines

The genuinely-one-class group, with the narrative removed.

| where | today | fix |
|---|---|---|
| `daily-report.js:30` | `sh()` returns `''` on any failure → a perfect quiet morning | return a sentinel; render `gh unavailable` |
| `review.js:426` | `args` drops `reportError`; audit gets a queue with reader reports absent, exit 0 | emit it into the JSON or exit non-zero |
| `validate-queue.js:46` | shape change → validates 0, exits 0, `--quiet` hides it | assert the shape, not just the count |
| `corpus.js:31` | one bad record → whole corpus reads 0 | narrow the `try` to `readdirSync` |
| `build-search.js:62` | read failure → `search.json` ships with zero theme entries | let it throw; add a `t` count invariant |
| `routine-log.js:59` | unreadable dir → "no runs recorded yet" | distinguish empty from unreadable |

**Plus a CI grep** for `catch {} return ''` / `catch (_) { return [] }` in `tools/`, so the convention
is enforced rather than remembered. That is the honest remedy for the same-day variance in (3).

## B. Wrong models of an external system — four items, four different checks

Grouping these with A was v1's error. Each needs its own probe against the real thing.

- **`gh pr list --json files` truncates at 100.** Verified: PR #205 reports 100 for 1164 changed
  files. **Review's correction, accepted:** ordering is alphabetical, `tools/` sorts first, `decide()`
  returns `HUMAN` before touching `files` for non-routine branches, and the largest routine PR ever is
  44 files. Latent, never fired, cannot fire under current behaviour. **Two-line pagination fix, not
  a tier.**
- **`public-domain-modern-source` reads `source.year`/`source.date`** — 0 of 1169 records have either;
  440 carry `public-domain`. Its "0 hits" is structural. **Do not naively repoint at
  `schema.dateCreated`**: that fires on 21 records, most legitimately PD (US federal works; plus a
  Yogi Berra record whose `rightsNote` correctly separates a 1913 public-domain phrase from the 1998
  book reprinting it). Route through `propose-detector.js` and accept it may be REJECTED.
- **`GET /mail` defaults to `status='drafted'`** and returns `[]` in send mode, while
  `DAILY-REPORTS.md:142` says it "shows what was sent". One-line default change, one doc line.
- **REST `/commits/{sha}/status` returns `pending` on zero statuses.** Only matters if B/2.1 proceeds;
  a naive shim would make the merge pass `WAIT` forever. This repo has zero commit statuses — use
  check-runs only.

## C. Detector version discipline

`detectors.js` promises "bump `version` when logic changes"; nothing enforces it, so an unbumped edit
produces `scan: ran 0 checks, skipped 6948 already settled` — fast, clean, wrong. Key `CATALOGUE` on
`version + sha1(String(d.test))`. One line, removes the last hand-maintained promise in the spine.

## D. Durability — BLOCKED pending one measurement

**D.1 `tools/gh-rest.js`.** ~150 lines; `decide()` untouched. Would move the 08:01 report to cloud and
make the 07:00 merge sustainable rather than rebuilt-by-hand nightly.

**This does not get sequenced until someone runs one probe from the cloud environment:**

```bash
node -e "fetch('https://api.github.com/repos/stewartdavidp-ship-it/quotle-info/pulls?state=open').then(r=>console.log(r.status, r.headers.get('x-ratelimit-limit')))"
```

`5000` → the proxy injects credentials, no secret needed, D.1 proceeds. `60` → it does not, D.1 needs
a PAT, and its whole advantage over D.2 collapses. Two seconds, and ~150 lines depend on it. The repo's
own rule is measure before believing; v1 did not.

**D.2 Scoped `ROUTINE_TOKEN` — only with the send-gate, per the review.**

v1 claimed "any credential that can close a report can cause a send… cannot be engineered away." That
is false and the review located the fix: `auth` is already in scope at `index.js:361`, and
`replyToReport` is called at `:383` and `:411`. Adding

```js
const mayReply = safeEq(auth, env.ADMIN_TOKEN);
```

and gating both call sites makes a routine token **structurally incapable of sending mail** — it
closes reports; any close that would have replied returns `reply: 'suppressed'` for an operator to
action. ~5 lines.

**Without that gate, D.2 is rationalisation** — it reduces read scope while leaving the irreversible
outbound capability at 100%, then calls the result low-value. With it, the claim is true.

**Ordering, which v1 missed and matters more than the coupling it did flag:** D.2's purpose is a
credential that can close reports; closing is what fires a reply. Until #238 landed, every close
mailed "you were right". **D.2 before that fix would have automated the worst bug in the system,
nightly.** #238 is in, so this is now safe to consider — but the dependency should be stated, not
rediscovered.

**D.3 `/sources`, `/nominations`, `/mail` → `Bearer` headers.** The admin token travels in the URL
and `wrangler.jsonc` has `observability: true`, so it is retained in plaintext in Workers Logs on
every nightly run. **Not "four lines":** three Worker handlers plus two in-repo callers
(`review.js:310`, `verify-review-spine.js:184`), a README and three comments. Change the Worker
without the callers and the nightly pass 401s — which `review.js` reports as "reader reports
unavailable" and carries on, manufacturing the exact defect class this plan exists to remove. While
touching all four handlers, make `/sources` and `/nominations` use `safeEq` like their siblings.

## E. Evidence that is collected and discarded

**E.1 Persist `sourcesVerified` and `confidenceReason`.** Both `required` in `generate.js`'s schema,
neither read by `prep-wave.js`, both 0/1169. **Review's caveat, accepted:** this only helps records
built from now on, so any invariant over it must be scoped to records built after the change — state
that, or the invariant fails on 1169 legacy records forever.

**E.2 The wave should stamp what it audits.** `record.review` exists and works — 23/1169 carry it,
**zero from the wave**. Adding `review.js stamp` to `DAILY-WAVE.md` step 7 closes "nothing
distinguishes an audited record from an unaudited one" with existing machinery. Safe now that #238
maps `PASS → rejected`.

## Cut from v1, deliberately

- **`--self-test` for every decision tool** → only `report-gate.js` has a `decide()`-shaped pure
  function. `preflight.js` is a list of probes; a self-test would exercise the harness, not the
  checks.
- **A Worker test suite** → three `check()` calls in `verify-review-spine.js`. One is already done
  (#238). "Idempotency under concurrency" is already asserted twice — source grep plus `--live` probe.
- **`answer.lastVerified`** → deferred. Real finding (15 distinct values, 298 sharing one), but it
  renders on 1169 pages and inside the copy-to-clipboard citation; the fix is unclear and the blast
  radius is the largest in the plan for the smallest defect.
- **The Gandhi record** → re-framed. The record carries a specific checkable citation (*Young India*,
  11 Aug 1920, CWMG vol. 18) and a `rightsNote` reasoning correctly from the 1931 cut-off. **The PR
  body is the stale artefact, not the record.** Demoting a well-sourced 1920 publication to match a
  wrong changelog would be weakening the record. And "no `review` stamp" describes 1146 of 1169
  records — not evidence about this one.
- **MCP server, GitHub Actions for the merge pass, option (e)** → unchanged from v1; reasons stand.

## Sequence

1. **A** — six swallow sites + the CI grep. Independent, small, no dependencies.
2. **C** — detector hash. One line.
3. **B** — the four external-model checks, individually.
4. **D.1** — *only after the cloud probe returns 5000.*
5. **D.3**, then **D.2 with the send-gate**.
6. **E.1, E.2.**

## Open questions for the second reviewer

- Is A still one group, or does the CI grep make five of the six redundant?
- Is D.2 worth doing at all once the send-gate exists, or does the gate make "keep 04:10 local"
  strictly better — no credential anywhere, same safety?
- E.1 persists evidence for future records only. Is a field that is empty on 1169 of 1172 records
  worth adding, or does it just look like provenance without being it?
- Has this plan, like v1, proposed anything that already exists?
