# Scope: the writing axis — who WROTE the song

Status: **spec. Code changes listed in §6 must land BEFORE any record is written.**
Written 2026-07-23 against `56d06aa11` (90 song records). Rev 2 — rev 1 was reviewed and would have
failed the source gate on record #1; every claim below has been checked against the code.

The music object has ONE axis today: *who recorded it first* (`/who-recorded/`, scope = "a cover
mistaken for the original recording"). This adds a SECOND: *who wrote it*.

---

## 1. The decision that shapes everything: one record, two axes

A song is not routed to one axis or the other. **A record may carry the recording axis, the writing
axis, or both**, declared in a new `axes` array:

```
"axes": ["recording"]              → /who-recorded/{slug}/   (every record today)
"axes": ["writing"]                → /who-wrote/{slug}/
"axes": ["recording", "writing"]   → primary axis owns the URL; both sections render
```

Rev 1 said "one song, one page" and routed dual-axis songs to `/who-recorded/`. That silently
deleted the writing story from the best candidates — "I Will Always Love You" is a cover-eclipse
AND the motivating writer example. It also handed harvest agents a routing coin-flip with no record
of the discarded axis. Both stories now render on one page.

**This stays inside `data/songs/`.** These are still song records; `CORPUS.songs.total` stays honest
and the home tile keeps working. What must change is that per-route directory counts can no longer
be compared against `CORPUS.songs.total` — see §6.

---

## 2. The three shapes

`shape` is REQUIRED on any record carrying the writing axis.

### `credit` — the writer is not the definitive performer
No false belief; the performer is correctly credited as performer. This is a **revelation**, not a
fact-check. Covers both "the writer never released their own version" (Robert Hazard demoed "Girls
Just Want to Have Fun") and "the writer recorded it but another version is definitive" (Carole King
recorded "You've Got a Friend" on *Tapestry*; Taylor's single went to No. 1, hers was never
released as one). Rev 1 split these into shapes A and B; they produced byte-identical records, so
they are one shape. Whether the writer released a version belongs in `original.trail`, as prose,
with a source.

- `confidence: "attributed"` (legal — `validate-songs.js:29`)
- **No `ClaimReview`.** There is no false claim to rate.

### `misbelief` — the public believes the PERFORMER wrote it
The only writing shape that adjudicates a false belief.

- `confidence: "disputed"`
- `ClaimReview` rating «performer» wrote this song as **false**.

### `contested` — authorship is litigated or genuinely disputed
"A Whiter Shade of Pale", "My Sweet Lord", "Blurred Lines". The only writing shape where `disputed`
is earned by the facts rather than by public error.

- `confidence: "disputed"`
- **No `ClaimReview` rating anything false.** A court outcome is not a provenance trace, and these
  pages describe named, often living parties. State the ruling, the court, the date and the
  outcome, and attribute every characterisation to a source. If the dispute is unresolved, say so.
- **Stricter sourcing bar:** court records or major-outlet reporting only. No fan wikis, no
  aggregators. If the only source is a forum or a listicle, DROP the candidate.

---

## 3. The intent rule — the most important rule in this file

**Never assert that a writer "chose not to sing it", "gave it away", "didn't want it", or "wrote it
for" someone unless a cited source says so in those terms.** Motive is almost never documentable and
is the easiest false sentence to write here.

The framing example that prompted this vertical is itself the trap: "Carole King wrote it but chose
not to sing it" is FALSE — she recorded it on *Tapestry* (Feb 1971). What is true and citable is
that Taylor's version was the hit single and hers was never released as one.

State what is documented: who wrote it, who recorded it, when, whose version charted. Where intent
IS documented, cite it.

---

## 4. Field delta

Base: `data/songs/tainted-love.json`.

| field | value |
| --- | --- |
| `axes` | **NEW, REQUIRED on every record** (backfill existing 90 as `["recording"]`) |
| `shape` | **NEW**, required when `axes` includes `writing`: `credit` \| `misbelief` \| `contested` |
| `writing.kicker` | `"Who wrote it"` |
| `writing.writer` / `writerSlug` / `writerDates` | the writing-axis headline |
| `writing.definitiveVersion` | whose version the public knows, and the sourced reason (chart position / sales) |
| `writing.trail[]` | provenance prose, same shape as `original.trail` |
| `confidence` | `credit` → `attributed`; `misbelief`/`contested` → `disputed` |
| `creditedTo` | **stays populated. Do NOT empty it** — see §5 |
| `misattribution` | **stays present** — required by `validate-songs.js:28` |
| `authors[]` | `role:"writer"` card becomes primary on a writing-axis page. `original`/`cover` roles unchanged |

---

## 5. `creditedTo` — rev 1 was wrong about this

Rev 1 ordered `creditedTo` emptied on non-fact-check records, justified by the claim that it feeds
the author-hub chip reading "N wrongly credited to them". **That was a misread.**
`tools/build-authors.js:38` destructures `records` (quotes) and `songs: songRecords` separately, and
the chip at `:395` iterates `records` — **a song's `creditedTo` never reaches it.**

Emptying it would also have been build-breaking (`validate-songs.js:86`: `creditedTo is empty —
nothing to correct`, a failure) and would have broken four consumers that assume it is populated:
`build-authors.js:265` (renders "now often credited to " with a dangling clause on the performer's
hub), `build-search.js:33`, `build-songs.js:469`, `build-verify.js:71`.

**The correct mechanism is a shape-aware renderer, not an empty field.** On a `credit` page the
renderer must never compose a "wrongly credited" sentence — because nobody is wrongly credited. The
field still records who the public associates the song with; the shape decides how that fact is
phrased.

> The separate magnet-count over-count on the QUOTE side (`build-authors.js:395` lacks the
> `credSlug === trueSlug` exclusion `misattrBy` applies at `:57`) is a real, still-open bug — but it
> is unrelated to this vertical and is NOT a blocker for it. Rev 1 wrongly gated this wave on it.

---

## 6. Code changes required BEFORE any record is written

Rev 1 named one of these. A harvest wave started today aborts the entire site build — including all
1,118 quote pages — at `runSourceGates()` (`build.js:80`) on record #1.

**Build-failing:**
1. `tools/validate-songs.js` — make `REQUIRED`, the `creditedTo` check (`:86`), the `cover`-role
   requirement (`:93`) and `answer.originalArtist` (`:85`) axis-aware. **Also add an assertion that
   `shape` agrees with the record's own data** — an unchecked enum is a lie surface, not a guardrail.
2. `tools/build-songs.js` — conditional `ClaimReview` (currently unconditional in the `@graph` at
   `:181`), a writing-axis section, a writer-first hero, correct canonical/breadcrumb per route.
3. `tools/verify-corpus.js:107` and `:113-116` — the quotes-before-songs invariant computes
   `lastQuote` by treating any non-`t:'s'` entry as a quote. A third discriminator breaks both
   assertions. Make the arithmetic explicit per type.
4. `tools/verify-corpus.js:83`, `:109`, `:151` — `countDirs('who-recorded')` is asserted against
   `CORPUS.songs.total`. With two routes over one record set, these need per-route counts.
5. `tools/corpus.js` — expose per-axis counts alongside `songs.total`.
6. **Schema budget.** `SONG_DOSSIER_SCHEMA` measures **3,304 bytes against `SCHEMA_BUDGET = 4072`
   — 768 bytes of headroom**, and `verify-corpus.js:278` already calls it the schema most likely to
   drift over. Do NOT extend it. Write a separate `workflows/generate-who-wrote.js` with its own
   dossier schema, add it to `AGENT_SCHEMAS` (`verify-corpus.js:262`), and it gets its own budget.
   Over-budget fails at the platform before any agent runs: 0 tokens, no readable error.

**Silently wrong (ships bad pages, fails nothing):**
7. `tools/verify-corpus.js:238` — the no-slash scan loops over a **hardcoded**
   `['who-said','authors','themes','who-recorded']`, NOT `SECTIONS`. Adding `who-wrote` to
   `urls.js` does not get it scanned. This is the exact invariant whose absence froze indexing at
   289 pages; make the loop read `SECTIONS`.
8. `tools/urls.js` — `whoWrotePath`/`whoWroteUrl` builders **and** `who-wrote` in `SECTIONS`.
9. `tools/build-verify.js:101` — the `/who-recorded/` URL is hardcoded; a writing-axis record would
   publish a 404 to the `/verify` API. Same at `build-authors.js:311` and `build-sitemap.js:49`.
10. `tools/build-search.js:31-34` + `tools/chrome.js:80` — `LABEL`/`ALL` have no `w` key; hits
    render with a blank category and a dead "see all" link.
11. `tools/chrome.js:20` — NAV entry, or the section is unreachable.
12. A `/who-wrote/` browse index. Note `build-songs.js:514` scopes the existing index to covers in
    prose — that aside must not appear on the writing index.

**Harmless (degrades gracefully):** `worker/src/index.js` — a `t`-aware Worker returns better field
names; the current one still answers.

---

## 7. Harvest inclusion tests

All must hold:

1. **The writer has a charting release under their own name.** Mechanical, checkable. Replaces rev
   1's "a recognisable recording artist in their own right", which had no boundary — it admitted
   Bruce Johnston (a Beach Boy, not a solo artist) while excluding Leiber & Stoller on the same
   logic. Career behind-the-scenes writers (Diane Warren, Max Martin) remain OUT: nobody expects
   them to have recorded it, so there is no gap to close.
2. **The definitive version belongs to someone else** — charted higher or is the version the public
   names. Document which, with a source.
3. **There is a real gap in public knowledge.** Skip "everyone knows Dolly wrote it" the way the
   cover pipeline skips "everyone knows it's a cover" (why `higher-ground` was dropped —
   `harvest-songs.js:88`).
4. **Every fact confirmable** — writer, performer, dates, chart positions. DROP if the core claim
   cannot be confirmed. Wikipedia song pages are reliable; SecondHandSongs 403s the fetcher.
5. **Dupe pre-flight** against `data/songs/` before queueing. If the song already has a record, the
   writing axis is ADDED to it — not published as a second page.

**No lyrics, ever.** The unit is the TITLE.

### Vetted examples

- **"Girls Just Want to Have Fun"** — Robert Hazard wrote and demoed it; Lauper's is definitive.
  `credit`. Likely dual-axis; check whether the recording axis also holds.
- **"You've Got a Friend"** — King wrote and recorded it; Taylor's single was the hit. `credit`.

### Rejected from rev 1 — do not reuse

- **"I Write the Songs" as the flagship `misbelief` case.** Bruce Johnston wrote it, but **David
  Cassidy released it first** (1975) and Captain & Tennille also cut it before Manilow's single.
  Manilow's is a cover — it is a dual-axis record, not a clean `misbelief` exemplar.
- **"Elvis wrote none of his 600+ songs."** False as a *credit* statement: he holds registered
  co-writing credits (publishing cut-ins arranged by management) on "Heartbreak Hotel", "Don't Be
  Cruel" and others. On a page about authorship credit that distinction is the entire subject. The
  honest form is: credited as co-writer on several songs as a publishing arrangement, with no
  documented authorship — and it needs a source.
- **Paul Anka / "My Way" as a "writer never released it" case** — Anka has released his own
  recordings of it. Under the merged `credit` shape this no longer matters, but do not repeat the
  claim.
- **Prince / "Nothing Compares 2 U"** — he released it in 1985 through The Family, his own side
  project. Fine under `credit`; the trail must say so rather than implying he never recorded it.

Backlog note: `data/song-queue.json` is drained to 0 (89 ingested, 1 dropped). Any wave here starts
with `harvest-songs.js` at step 0, or `select` returns nothing.
