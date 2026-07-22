# CLAUDE.md — Quotle Info

## Architecture — AS BUILT (authoritative, updated 2026-07-08)
> This section reflects what the site actually is today and OVERRIDES the older
> vision sections below wherever they conflict. The v1 sections (Firebase SPA,
> single HTML file, 404.html path routing) describe an approach that was **abandoned**;
> they are kept only for product context (personas, tone, no-ads, Schema.org — all still valid).

**quotle.info is a static-site GENERATOR, not an SPA and not a single HTML file.**
- **Source of truth:** `data/quotes/{slug}.json` records (one per quote). No Firebase, no runtime fetch.
- **Generators (`tools/`):**
  - `tokens.js` — the ONE `:root` design-token block (`ROOT_CSS`), injected into both generators
    below so the palette can never drift. Brand tokens (`--burgundy/--gold/--sage/--ink/--slate/--cream`)
    are byte-for-byte the **Quotle game's** dark theme, so the game + this site read as one product.
    `--amber/--caution/--purple` + the `--bg-*` depth surfaces are quotle.info extensions.
  - `a11y-widget.js` — shared display control: `HEAD_SCRIPT` (pre-paint theme+text-size),
    `THEME_CSS` (light-theme overrides + header-control styles), `CONTROL` (the header "Aa" button +
    dropdown, placed IN the topnav — **not** a floating button), `SCRIPT` (its wiring).
  - `template.js` — renders each `who-said/{slug}/index.html` detail page from a record.
  - `build-index.js` — renders the homepage `index.html` + `who-said/index.html` browse from the manifest.
  - `build.js` — records → pages + `data/manifest.json`; `require`s build-index at the end. **Run `node tools/build.js` to regenerate everything.**
- **Output = real prerendered files at real paths** (`who-said/{slug}/index.html`, root `index.html`).
  Deployed to GitHub Pages (repo `stewartdavidp-ship-it/quotle-info`, branch `main`, custom domain quotle.info).
- **URL contract (locked):** `https://quotle.info/who-said/{quoteSlug}/` — one canonical string drives
  canonical/og/Schema `@id`s/breadcrumb/cite/pager. quoteSlug is kebab-case of the quote text.
  **Trailing slash REQUIRED** (fixed 2026-07-22): GitHub Pages serves `who-said/{slug}/index.html` at
  the directory URL; the no-slash form 301-redirects to it. The contract originally omitted the slash,
  so every canonical pointed at a redirect — Google left the pages "unknown, no referring sitemaps."
- **Standards alignment (2026-07):** adopted the Game Shelf convention — settings live in a header
  control (theme Auto/Light/Dark + 4-step text size), NOT a floating button; tokens follow the Quotle
  game's semantic scheme via the shared `tokens.js`. localStorage keys `quotle-theme` / `quotle-text-size`
  (distinct origin from the game, so no collision). Theme = `[data-theme]` on `<html>` + pre-paint script.
- **NOT wired:** the full `gameshelf:` runtime IIFE (presence/complete events) — quotle.info is a content
  site with no puzzle to complete; it carries only the static `<meta name="gs-app-id">` + outbound links.
- **404 handling:** `404.html` is a plain static page (the old GitHub-Pages SPA-redirect trick was removed
  once pages became prerendered at real paths).

## What This App Is
Companion site for Quotle that provides author bios, quote historical context, thematic analysis, and daily deep-dives tied to the Quotle puzzle calendar

## Current Build Objective
**Quotle Info Pages — Core Platform**

Companion site for the Quotle daily quote guessing game. Provides individual quote pages with author bios, historical context, thematic analysis, source verification, and daily deep-dives tied to the Quotle puzzle calendar. Three-layer progressive UX: instant answer (0-5s), story/context (5-60s), rabbit hole exploration (1+ min). Voice-assistant optimized with Schema.org markup. Pulls from Quotle's 365 public domain quote database. Built as a single-page app with Firebase backend, hosted on GitHub Pages.

## RULEs — Do not violate these.

- Every quote page must include Schema.org Quotation structured data (JSON-LD) with: @type Quotation, text, creator (Person with name, birthDate, description), dateCreated, isPartOf (CreativeWork source), and inLanguage. This enables Google featured snippets for 'who said' queries and voice assistant integration. The JSON-LD is injected dynamically when the quote view renders. _(from: Quotle Info Pages — Core Platform)_
- v1 builds the page framework and routing with graceful degradation for missing enrichment data. If a quote has no context field, Layer 2 shows 'Context coming soon' rather than hiding the section. Content enrichment is a separate offline task run after the site is functional. This prevents the enrichment pipeline from blocking the build and allows progressive content improvement over time. _(from: Quotle Info Pages — Core Platform)_
- Content tone is 'smart friend at a dinner party' — engaging, conversational, concise, never academic or encyclopedic. Historical context should feel like an interesting anecdote you'd share over drinks, not a Wikipedia article. Target reading level: high school educated adult. Context paragraphs should be 2-3 sentences maximum. This serves the primary persona (Quotle player with 30 seconds of curiosity) and differentiates from dry quote aggregator sites. _(from: Quotle Info Pages — Core Platform)_
- No ads on quotle.info, ever. The site differentiates from BrainyQuote and AZQuotes specifically by being clean, fast, and content-first. Ads would destroy the premium literary club aesthetic and make the site indistinguishable from existing quote aggregators. The site monetizes indirectly by driving traffic to the Quotle game, not directly via ads. _(from: Quotle Info Pages — Core Platform)_
- Anti-patterns to avoid based on competitor analysis: (1) No ads or ad-adjacent clutter — the BrainyQuote problem; (2) No user-generated content or unverified quotes — the Goodreads problem; (3) No wall-of-text academic formatting — the Quote Investigator problem; (4) No pagination for browsing — 365 quotes doesn't need it; (5) No sign-up wall — all content is freely accessible; (6) No SEO keyword stuffing in content — the context should be genuinely useful, not optimized for crawlers. _(from: Quotle Info Pages — Core Platform)_

## CONSTRAINTs — External realities. Work within these.

- Quotle's quote database is fixed at 365 quotes — one per calendar day — all verified public domain. This bounds the content enrichment scope and means the total dataset is small enough to cache client-side. New quotes are only added if Quotle's calendar expands. _(from: Quotle Info Pages — Core Platform)_
- Single HTML file with inline CSS and JS, no build tools, no npm, no framework. Consistent with the Game Shelf ecosystem pattern where each app is a self-contained HTML file deployed via GitHub Pages. External dependencies limited to Google Fonts and Firebase SDK (loaded via CDN). This keeps deployment trivial and Claude Code builds simple. _(from: Quotle Info Pages — Core Platform)_
- Retention is entirely dependent on Quotle game traffic and organic search. quotle.info has no independent engagement loop in v1 — no notifications, no accounts, no streaks. This is acceptable because the site serves as a content companion, not a standalone product. The success metric is 'percentage of Quotle players who tap the info link' rather than independent DAU. _(from: Quotle Info Pages — Core Platform)_

## DECISIONs — Current direction for this phase.

- Use existing word-boxing Firebase project with data stored under quotle-info/ path in RTDB. Paths: quotle-info/quotes/{id}, quotle-info/authors/{id}. No separate Firebase project needed — the dataset is small, read-only for the public site, and the existing project already has the Quotle quote data. REST fallback is already implemented for CORS/file:// scenarios.
- Quote pages follow a three-layer progressive disclosure model: Layer 1 (The Answer, 0-5s) shows quote text, author name, source, year, and public domain badge with no scroll required, optimized for voice assistants and featured snippets. Layer 2 (The Story, 5-60s) shows historical context paragraph, why it mattered, who the audience was. Layer 3 (The Rabbit Hole, 1+ min) shows author bio, related quotes, thematic connections, and Quotle game link. Each layer is a distinct visual section on the same page.
- Content enrichment (historical context, author bios, thematic analysis) is a one-time batch process run offline, not runtime AI generation. With only 365 quotes, all enrichment can be pre-computed and stored in Firebase. This eliminates API costs per page view, ensures instant load times, allows human review of AI-generated content before publishing, and avoids hallucination risk at read time. A separate enrichment script runs against the Quotle quote database and writes enriched data back to Firebase.
- Daily quote page links bidirectionally with Quotle. After completing a Quotle puzzle, the results screen links to quotle.info for context. The quotle.info daily page shows a 'Play Today's Quotle' CTA that links back. The daily quote is determined by Quotle's calendar mapping (day-of-year to quote ID). This creates a natural content loop: play the game, then learn the story.
- Retain the existing dark luxury design system: deep navy/purple backgrounds (#0f0f1e, #1a1a2e), burgundy accents (#d4627a), gold highlights (#ffd369), sage green for verification (#7eb38b). Typography: Playfair Display for headings, Source Serif 4 for body, DM Sans for UI elements. The aesthetic is 'literary club' — editorial, premium, and distinct from the chalkboard theme of Quotle itself. Design is already implemented in the uploaded index.html.
- Enriched quote schema extends existing Quotle data. Required fields from Quotle: id, text, authorName, authorId, source (title, year). Enrichment adds: context (2-3 sentence historical context), significance (why it mattered), themes (array of topic tags like 'freedom', 'courage'), relatedQuoteIds (array of connected quote IDs), misattribution (if commonly misattributed, note the real origin). Author schema: id, name, birthYear, deathYear, nationality, bio (2-3 paragraphs), notableWorks, quoteIds. All enrichment fields are optional to allow progressive rollout.
- The Quotle Player is the primary persona. The site optimizes for the post-game curiosity moment: player finishes Quotle, taps the info link, wants 30 seconds of interesting context, and may share a fun fact. The Quote Googler (search traffic) is the secondary persona who needs instant attribution. The Quote Enthusiast (browser) is tertiary. UX priority follows this order — quick context delivery beats deep exploration features.
- Positioning: quotle.info is the only quote site that tells you not just who said it, but why it mattered. Differentiation is in the context layer — no other quote site provides curated historical context, thematic connections, and source verification in a clean, premium UX. The competitive moat is the integration with Quotle (built-in traffic source) combined with verified-only public domain content (quality over quantity). The 365-quote corpus is intentionally small — depth over breadth.
- Go/No-Go: GREEN. Build effort is 4-6 hours total (1-2 hours Claude Code build, 1 hour enrichment script, 2-3 hours content QA). Hosting cost is $0 (GitHub Pages + Firebase Spark). Maintenance is under 1 hour/month. Content enrichment API cost is $2-5 one-time. The bounded scope (365 quotes, single HTML, no accounts) means this is one of the lowest-risk projects possible. The only significant time investment is human review of AI-generated context.
- Single-page app with path-based routing (/quote/{id}, /author/{id}, /today) using the GitHub Pages 404.html trick for clean URLs. A 404.html file redirects all routes to index.html, which parses window.location.pathname to determine the view. This gives SEO-friendly URLs that Google indexes properly while keeping the single-file deployment model. Hash routing was rejected because hash fragments are not reliably indexed by search engines, and the Quote Googler persona depends on search discoverability.
- Four path-based routes cover the complete URL structure: (1) / — home/landing page with search, featured quotes, and today's quote highlight; (2) /quote/{id} — individual quote page with full three-layer content; (3) /author/{id} — author page with bio and all their quotes; (4) /today — redirects to today's quote based on Quotle calendar mapping. Clean paths via 404.html redirect trick on GitHub Pages. Search remains on the home page with instant client-side filtering.
- Invalid routes (/quote/nonexistent or any unmatched path) show a friendly 404 state within the SPA: a message like 'This quote isn't in our collection yet', the search bar, and a link to the home page. The 404 state is a view within the app, not a browser error page. This handles both bad quote IDs and mistyped URLs gracefully.
- If Firebase is unreachable (both SDK and REST fail), show a graceful offline state: a static message indicating temporary unavailability with a retry button, plus a link to play Quotle. No embedded static fallback data — the content is entirely Firebase-dependent and the site is useless without data. The existing SDK + REST fallback pattern from the uploaded code is sufficient for resilience. Full offline caching is out of scope for v1.
- Each quote page includes a share button that copies formatted share text to clipboard: the quote text, attribution, and quotle.info/quote/{id} URL. Uses Web Share API on mobile (native share sheet) with clipboard fallback on desktop. Share text format follows the Game Shelf standard sharing pattern. The shareable URL uses the clean path route (/quote/{id}) which resolves via the 404.html redirect trick.

## OPENs — Unresolved. Flag if you encounter these during build.

(No unresolved OPENs)
