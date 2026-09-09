# Open items — handoff from the 2026-09-07/08 session (waves r47–r52)

Written for a **fresh session with no context**. Each item states what is wrong, **what has already
been measured** (so you do not re-derive it), and what is genuinely still open. Every figure below
was measured against the code or the corpus on the date given — where a number is a guess, it says so.

> **Update 2026-09-09 (later session).** Items **1** and **3** are CLOSED — see each. Item 3's
> exposure figure was wrong and is corrected there; half of its proposed fix was measured harmful and
> must not be re-proposed. One new item (**9**) came out of that measurement.

## State at handoff
- `main` clean, **2,157 quotes**, backlog **231 queued**, last shipped wave **r52**.
- Six waves shipped this session: r47 (40), r48 (40), r49 (20), r50 (18), r51 (19), r52 (10).
- Four generator PRs merged: **#801** (docs), **#802** (mis-kind patterns), **#811** (prep-wave
  scrubber), **#812** (template record overrides), **#813** (qualified `genuine` tag).
- No stray wave branches or worktrees.

---

## 1. The author-hub gate does not run at ingest — NEW, and it is a regression of a closed fix

**r52 drew three Seneca quotes and the generate agents returned three different name forms** —
`Seneca (Lucius Annaeus Seneca)`, `Seneca`, `Seneca the Younger` — which produce three different
`author.slug` values and therefore **three author hubs from one wave**.

**Established:** the corpus has exactly ONE Seneca hub, `seneca-the-younger` (14 records before r52,
17 after). `fix/split-author-hubs` — "seven people had two or three author hubs each; merge them and
gate it" — merged the *existing* splits. **The gate does not prevent new splits forming at ingest.**
r52 normalised all three by hand before ingesting; the orphan slugs `/authors/seneca/` and
`/authors/seneca-lucius-annaeus-seneca/` correctly 404 on the live site.

**CLOSED 2026-09-09.** `validate-records.js` now enforces it as a **hard failure**. Author names are
compared as TOKEN SETS with any parenthetical stripped, because the defect class is one name form
being an expansion of another; only true particles are dropped, since honorifics and regnal numbers
are what stop `Saint Ambrose` ⊂ `Ambrose Bierce`.

Calibrated on all 2,157 records, every pair read by hand: **12 hits, 4 of them real splits**, merged
in the same change — `the-buddha-siddhartha-gautama` → `gautama-buddha`, the two Oz screenwriter
credits, `josh-billings` → `josh-billings-henry-wheeler-shaw`, `artemus-ward` →
`artemus-ward-charles-farrar-browne`. Three of the four are the **pen-name-in-parentheses** shape,
which only the paren strip catches and which a substring test misses entirely. The other 8 are
different people sharing a name prefix and are listed in `DISTINCT_HUBS` with a note each.

Standing count is zero, so the gate is silent until it matters. It reports only on the hub that
should MOVE — flagging both sides turned one stray Seneca slug into 17 failures, 16 on correct
records.

**Still open:** nothing for this defect. Note the gate is a **build-time** check, not an ingest-time
one — a wave that never runs `validate-records.js` still ships a split, so keep it in the wave
procedure.

---

## 2. `tag-themes` silently drops records — MEASURED, and worse than it looks

| wave | requested | returned | dropped |
|---|---|---|---|
| r49 | 20 | 19 | **1** |
| r50 | 18 | 18 | 0 |
| r51 | 19 | 15 | **4 (21%)** |
| r52 | 10 | 10 | 0 |

**Established:** the workflow *knows* it dropped them — it returns `complete: false` with an accurate
`covered` count. **The journal cannot detect this**: what an agent never returns leaves no trace in
it. Only `apply-tags.js --manifest` sees it. An untagged record never appears on `/themes` and nothing
downstream flags it.

So `--manifest` is **not** a belt-and-braces guard against a rare r32/r33-style accident — it is
**load-bearing against a routine failure**, and the wave only survives because a caller runs it and
reads the exit code.

**Correction to the record:** an earlier message in this session claimed `apply-tags.js` exits 0 on
failure. **That was wrong** — it exits **1**, confirmed three times, including on r51's real failure.
Do not "fix" a bug that is not there.

**Open:** `tag-themes.js` could retry its own dropped slugs before returning, instead of reporting
`complete: false` and relying on a downstream caller to notice.

---

## 3. `verdictNote`'s claimant fallback ignores `kind: "context"` — MEASURED at 59 records

`tools/template.js`, the `verdictNote` IIFE inside `buildJsonLd` (disputed branch, ~line 822):

    const wrong = plain(magnet || misWho || '');

Every *other* consumer of the claimant has been taught that `misattribution.items[0].who` is not
necessarily a magnet — `claimant()` (~line 553) refuses it on wording-drift pages, and `mis-kind.js`
types a row `kind: "context"` precisely to say *this row is not a refutation*. **`verdictNote`'s
fallback consults neither.**

**Consequence:** a record that correctly drops `creditedTo` because no claimant is documented **still
ships `Commonly misattributed to {items[0].who}`** in the JSON-LD. The record fix appears to be
accepted while the defect survives — which is why this one matters more than its severity suggests.

**CLOSED 2026-09-09** — the `kind: "context"` half. The `wordingDrift` half was tried, measured
HARMFUL, and deliberately NOT shipped.

**The 59 does not reproduce, and its filter was the problem.** Today 148 disputed records have a
first row typed `kind: "context"` — but **122 of them carry a `creditedTo`**, so `magnet` wins and
the fallback line is never reached. The number that can actually ship a falsehood is **26**, and the
existing `looksLikePerson` / `isQuoteNotPerson` guards already reject all but **3** of those. The
old figure counted how often the TAG is used, not how often the defect can ship.

The three that shipped, each contradicting its own visible label:

| page | label says | row | shipped |
|---|---|---|---|
| `go-ahead-make-my-day` | "The words are right — the authorship is disputed" | Speaker, not author | Commonly misattributed to Clint Eastwood. |
| `not-all-of-us-can-do-…` | "Not her exact words — a paraphrase of Mother Teresa" | paraphrase | Commonly misattributed to Mother Teresa. |
| `the-first-human-who-…` | "Not Sigmund Freud's line — he was quoting someone else" | Popularizer, not author | Commonly misattributed to Sigmund Freud. |

**DO NOT re-propose the wordingDrift half.** It was implemented and reverted on measurement:
- `wordingDrift` compares `plain()` strings, so a trailing period or a Title-Cased claim counts as
  drift. It suppressed **"Actually by John D. Rockefeller"** and **"Actually by Dolly Parton"** — both
  true — on pages whose only "drift" was punctuation and letter case.
- Re-tested with hard normalisation it still cost three **genuine magnets**: Mark Twain, Oliver
  Wendell Holmes Jr., Sigmund Freud on `the-common-law-…`. A page can be BOTH a real misattribution
  and a wording drift. Drift is a fact about the WORDING and carries no evidence about whether
  `items[0].who` is a magnet.
- The gate is left as-is on `claimant`, where its only cost is degrading to the bare-quote form.

Drift looked convincing because it correlates with a different defect — now item 9.

---

## 4. `isPartOf` on "no source work known" records — an OPERATOR decision, not a bug fix

`tools/template.js:331-334` defines `isPartOf` as *"the work this sentence is CONTAINED IN"*, and
**~1,190 records carry one**. On an `attributed` record whose finding is "no source work known", the
value is instead the **earliest located printing** — a different relation — so the node
machine-readably asserts a source the page's whole argument denies.

**Established:** an r52 fix agent mitigated one record with a qualifying `description` on the node and
**explicitly refused to decide the class**: *"do not decide it one slug at a time."* Its reasoning is
sound — the CLAUDE.md Schema.org RULE names `isPartOf` as required, so the alternative (stop emitting
it where the work is only the earliest printing) needs the RULE narrowed the way the
`creator.description` requirement was narrowed on 2026-07-29.

**Open, for a person:** either narrow the RULE, or standardise the qualifying `description` across
every unpinned record. Two r51 records already dropped `dateCreated`/`isPartOf` outright rather than
assert a false creation date — same tension, decided ad hoc.

---

## 5. QI article HEADLINES are in the harvest queue as quotations — root cause is harvest-side

**Three found and skipped this session**, on the operator's ruling:
- r50: `The Vanishing Lady and the Vanishing Hotel Room`, `Shirley Temple Visits a Department Store Santa Claus`
- r51: `Update: Antedating Quotation About Plagiarism Versus Research`

Each has a `documentedAt` pointing at a QI article whose **title** was ingested as the quote. One
generate agent, correctly refusing to invent a quotation, produced a record naming **Garson O'Toole
(the QI researcher) as `answer.authorName`** and stamping `creditedTo: "Alexander Woollcott"`.

**The skip bar is hate/harm ONLY**, so this was escalated, not decided in-wave. The operator ruled:
skip. The bar's own precondition — *"if it is a real, documented misattribution it gets a page"* —
does not hold for a candidate that is not a quotation, which is why it did not fit the rule as written.

**Do NOT re-derive this:** a title-shape heuristic was tried and **failed**. It flagged 34 of 261
queued candidates, and reading them showed most are genuine quotes — *"There's a Sucker Born Every
Minute"*, *"The Buck Stops Here"*, *"The Squeaky Wheel Gets the Grease"*. That number is the regex,
not the corpus, and it was discarded. **How many remain is UNKNOWN.** All three surfaced only because
the generate agents were honest about them; nothing detected them.

**Open:** whether `tools/qi-harvest.js` can distinguish an article title from a quotation at harvest
time. It may not be mechanically decidable — treat a proposed detector with the suspicion this repo's
runbook already prescribes.

---

## 6. `mis-kind.js` candidates, accumulated r50–r52 — measured or explicitly declined

Landed already: **#802** (five patterns, 55 rows) and **#813** (the qualified `genuine` tag).

Still open, each reported by a fix agent that hand-stamped its own record so no page ships wrong:

| candidate | note |
|---|---|
| `/^unsourced$/i` | same shape as the landed `/^circular$/i`, `/^absent$/i` — the row's `who` is a SOURCE |
| `later flourish` | widen the landed `(later\|modern\|popular) (variant\|…)` alternation with `flourish\|addition\|embellishment\|accretion` |
| `/^[^,]{1,40}'s\s+version$/i` | "Creamer's version", "SABR's version" — read every hit; the failure mode is a possessive naming the credited magnet |
| `/^polished$/i` | bare adjective, same family as landed `/^smoothed$/i` |
| `name collision` | asserts a confusion vector |
| `different book/author/speaker` | **safer variant proposed:** gate on the row's `who` not being a person name, reusing the existing `NOT_A_PERSON` guard |

**Explicitly DECLINED after measurement — do not re-propose:**
- `/^overstated$/i` — 12 rows, mixed; "Overstated | Muhammad Ali" reads as a correction.
- `/\bpredates\b/i` — 16 rows, mixed; "Predates him by a century | who: Benjamin Franklin" denies the
  magnet's authorship and the ✕ is CORRECT.
- `/\bsingle\b|\bmemoir\b/` — near-certain to sweep up genuine refutations.
- bare `/\bvariant\b/` — the file's own header already records this; ~250 rows, contains real debunks.

**This is now five waves running where the tag vocabulary outruns the pattern list.** Worth asking
whether tag-matching is the right mechanism at all, rather than adding a sixth batch of patterns.

---

## 7. Smaller, still open

- **`verbatimNote` wants a string label.** #812 shipped `presentation.wordingUnpinned` (boolean →
  "As commonly quoted"). It cannot say *"as recorded in Parade, 1985"*. Proposed: optional
  `presentation.wordingLabel` string, defaulting to today's behaviour.
- **A borrow is needed.** Whether Ralph Keyes, *Nice Guys Finish Seventh* (HarperCollins, 1992),
  rules on the ATTRIBUTION of "you don't need to wear a necktie if you can hit" — not just its
  wording — is unknown. `archive.org` item `niceguysfinishse0000keye` is lending-restricted;
  `/fulltext/inside.php`, `ia-fts` and `api.archivelab.org` all return nothing. The page states the
  limitation rather than asserting either way.

---

## 9. `looksLikePerson` accepts works, characters and role-qualified names — NEW, measured

Found while measuring item 3. `misWho`'s guards (`tools/template.js` ~line 540) exist to stop a
non-person becoming the fallback claimant, and they catch vectors and anonymity notes. They do not
catch three shapes that are live right now.

**Measured 2026-09-09:** 22 pages have no `creditedTo` and still render
`Commonly misattributed to X`. **11 of the 22 name something that is not a falsely-credited person:**

| shape | live examples |
|---|---|
| a work | `Star Trek: The Original Series`, `Casablanca`, `Snow White and the Seven Dwarfs`, `Disney's Snow White and the Seven Dwarfs` |
| a character / the actor | `Gordon Gekko / Michael Douglas`, `Montgomery Scott ("Scotty"), played by James Doohan` |
| a name + role qualifier after a COMMA | `Charles Dickens, as usually quoted`, `Warren Buffett, as originator`, `Isaac Hewitt, testifying in 1879` |
| a short quote fragment | `"Frankly, Scarlett…"`, `"Methinks the lady…"` |

The other 11 are correct magnets (Groucho Marx, Tocqueville, Plato, Shakespeare, Sun Tzu, Mark Twain,
Confucius …), so **any widening must be checked against that half** — this is a field where
over-rejecting is cheap and over-accepting ships a falsehood, but half the population is legitimate.

Two notes for whoever takes it:
- `stripQual` already strips a trailing **parenthetical**; the comma form is the same idea and is not
  handled. `Charles Dickens, as usually quoted` also produces the self-contradicting
  "Commonly misattributed to Charles Dickens, as usually quoted. Actually by Charles Dickens."
- `isQuoteNotPerson` compares on a **24-character** prefix, which is why fragments shorter than that
  ("Frankly, Scarlett") slip through. That constant is the fix for the fourth shape, not a new regex.

---

## 8. A stale claim in the PREVIOUS handoff — corrected, do not re-inherit it

`workflows/OPEN-ITEMS-2026-07-29.md`, item 2's note, says the `--credited` guard "compares last
words" and cites `"Confucius (Kong Qiu)"` (lead `Qiu)`) and `"Socrates, as written by Plato"` (lead
`Plato`) as cases it would wrongly stamp.

**That is false, and was measured false on 2026-09-07** (see #801, which corrected `README.md`).
`leadName` splits on dash/paren/comma and keeps the **FIRST** segment, so both yield `confucius` /
`socrates`, match the magnet, and are NOT stamped. r47 confirmed it live.

**The gap that DOES exist is a middle name or honorific**, because that changes the first segment:

    Hillary Rodham Clinton   vs  Hillary Clinton   -> STAMPS (same person)
    Sir Richard Branson      vs  Richard Branson   -> STAMPS (same person)
    John D. Rockefeller Jr.  vs  John D. Rockefeller -> STAMPS (genuinely two people — TRUE positive)

r48 shipped into the first of these and it was removed by hand before ingest. r51 avoided the second
by omitting the flag on a Track B wave. **A substring test does not catch it** — the shorter name is
not a substring of the longer — so a hand-check written in the guard's own idiom inherits the guard's
blind spot. **Use a token-subset test.** Known false-positive mode: a shared forename (`Edmund Kean`
vs `Edmund Gwenn` flagged in r51; genuinely different people).
