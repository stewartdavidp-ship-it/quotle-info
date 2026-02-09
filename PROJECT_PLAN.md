# Quotle.info — Project Plan

## Mission

Be the trusted source for verified public domain quotes — answering voice queries instantly, providing rich context, and creating discovery pathways that drive users to the Game Shelf ecosystem.

## Completed Features

### v0.1.0 — Foundation (Feb 2025)
- [x] Data model design for quotes, authors, relationships
- [x] UX strategy: three-layer experience model
- [x] Voice search optimization strategy
- [x] Competitive differentiation analysis
- [x] Project documentation structure
- [x] Quote migration strategy (408 quotes from Quotle)
- [x] Extraction script ready

### v1.0.0 — Landing & Admin
- [x] Landing page with hero, search, featured quotes
- [x] Firebase integration — live quote search
- [x] Featured quotes grid (top 5 by famousRating)
- [x] Interactive demo phone mockup
- [x] Admin tool for database management
- [x] 408 quotes loaded into Firebase
- [x] Custom domain (quotle.info) configured
- [x] Repo renamed from quote-info to quotle-info

## In Progress

- [ ] Fix SSL certificate for quotle.info (re-provision in GitHub Pages settings)
- [ ] Individual quote page template (the core product)

## Planned Features

### Near Term — v1.1.0 (Individual Quote Pages)
- [ ] Quote page HTML template implementing Layer 1 + Layer 2
- [ ] Schema.org Quotation JSON-LD markup on every page
- [ ] URL structure: `/quotes/{author-slug}/{quote-slug}`
- [ ] "Why it matters" context section
- [ ] Source verification badge
- [ ] Mobile-first responsive layout (375px+)
- [ ] Open Graph / social sharing meta tags
- [ ] Navigation between quotes (next/prev, related)

### Medium Term — v1.2.0 (Enrichment & Discovery)
- [ ] Enrich top 100 quotes with full context
- [ ] Author profile pages (`/authors/{slug}`)
- [ ] Collections/themes pages (courage, leadership, love)
- [ ] "Connected Ideas" — link related quotes across authors/eras
- [ ] Misattribution flags ("Often attributed to X, actually said by Y")
- [ ] Timeline view — quotes in historical context
- [ ] Search improvements — fuzzy matching, filters

### Future — v2.0.0 (Voice & API)
- [ ] Schema.org markup tuned for featured snippets
- [ ] Alexa Skill: "Alexa, ask Quotle who said..."
- [ ] Google Action integration
- [ ] Quotle game cross-promotion (play today's puzzle CTA)
- [ ] Quote API for third-party use
- [ ] Wikidata contributions as cited source
- [ ] User-submitted quote verification requests

## Architecture Decisions

### Single repo, two apps
Landing page at root (`/`), admin tool at `/admin`. Both share the same Firebase database. This keeps deployment simple — one repo, one GitHub Pages site.

### Firebase Realtime Database (not Firestore)
Consistent with the Game Shelf ecosystem which already uses RTDB. Quote data is relatively flat and read-heavy, which suits RTDB well. No need for complex queries that would favor Firestore.

### Static HTML pages (not SPA)
Individual quote pages will be static HTML for maximum SEO and voice search performance. No client-side routing — each quote gets its own `index.html` that can be crawled, cached, and served as a featured snippet. The landing page and admin are dynamic (search, CRUD) but quote pages prioritize discoverability.

### Public domain only
Strict policy: only quotes verified as public domain are included. This avoids copyright issues entirely and is a genuine differentiator vs sites that don't verify. The `source.publicDomain` boolean is required for every quote.

### Quote page generation strategy
Quote pages will be generated/updated via a build script that reads from Firebase and outputs static HTML files. This gives us SEO benefits of static pages with the convenience of database-driven content management.

## Open Questions

1. **Quote page generation**: Build script that outputs static HTML vs. server-side rendering vs. client-side fetch? Leaning toward static generation for SEO.
2. **URL structure**: `/quotes/abraham-lincoln/government-of-the-people` vs. `/q/lincoln-gettysburg`? Need to balance SEO (descriptive URLs) with brevity.
3. **How to handle the 408 → enriched pipeline**: Batch enrich with AI? Manual curation? Hybrid?
4. **Game Shelf integration depth**: Just a CTA link, or deeper integration (shared auth, stats)?
5. **Sitemap generation**: Automated from Firebase data? How often to regenerate?
