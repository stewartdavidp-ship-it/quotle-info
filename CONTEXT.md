# Quotle.info — CONTEXT.md

> **Read this first** at the start of every session.

## Current Version

**v1.0.0** — Landing page live, admin tool functional

## What Quotle.info Is

A companion website to the Quotle daily game that serves as the authoritative source for verified public domain quotes with rich context. Designed to win voice search queries ("Who said...?") while creating engaging exploration pathways that drive users to the Game Shelf ecosystem. Positioning: **"The Quote Context Engine"** — shows not just WHAT was said, but WHY it mattered, HOW it connects, and the STORY behind it.

## Architecture

- **Multi-page static site**: Landing page + Admin tool (separate HTML files)
- **Framework**: Vanilla JS (landing), React via CDN (admin)
- **Data**: Firebase Realtime Database (`word-boxing-default-rtdb` — shared with Game Shelf ecosystem)
- **PWA**: No
- **Deploy target**: GitHub Pages with custom domain `quotle.info`
- **Repo**: `stewartdavidp-ship-it/quotle-info` (standalone, not consolidated)

## Key Technical Details

### Meta Tags (Required)
```html
<meta name="version" content="X.X.X">
<meta name="gs-app-id" content="quotle-info">
```

Admin uses:
```html
<meta name="gs-app-id" content="quotle-info-admin">
```

### Firebase Data Paths
```
quotle-info/
├── quotes/{quoteId}/          ← Quote records
│   ├── text                   ← Quote text
│   ├── authorName             ← Display name
│   ├── authorId               ← Kebab-case key
│   ├── source/                ← Source details
│   │   ├── title, year, type
│   │   └── publicDomain (boolean)
│   ├── context                ← "Why it matters" text
│   ├── historicalContext       ← Extended context
│   ├── famousRating           ← 1-10 fame score
│   ├── gameData/              ← Quotle game metadata
│   │   ├── quotleDay, quotlePeriod
│   │   └── gameMode (easy/hard)
│   └── enrichment/            ← AI-enriched fields
│       ├── status (pending/complete)
│       ├── themes[], connections[]
│       └── misattribution (if applicable)
├── authors/{authorId}/        ← Author profiles
│   ├── name, born, died
│   ├── nationality, era
│   └── quoteCount
└── meta/
    ├── totalQuotes
    └── lastUpdated
```

### App Components

**Landing Page (index.html)**
- Hero section with search
- Featured quotes grid (pulls top 5 from Firebase by famousRating)
- Demo phone mockup (interactive — updates when quote clicked)
- Feature highlights (Voice-First, Verified Sources, Connected Ideas)
- CTA to Quotle game

**Admin Tool (admin/index.html)**
- Quote database management (CRUD)
- Enrichment queue and status tracking
- Bulk operations
- Firebase direct read/write

### Key Functions (Landing Page)
| Function | Purpose |
|----------|---------|
| `loadQuotesFromFirebase()` | Fetches all quotes, populates search + featured |
| `showInDemo(id)` | Updates phone mockup with selected quote |
| `renderFeaturedQuotes(quotes)` | Builds top-5 grid sorted by famousRating |
| `performSearch(query)` | Filters quotes by text/author match |

## Deployment

- **Repo:** `stewartdavidp-ship-it/quotle-info`
- **SubPath:** `` (root for landing), `admin` (for admin tool)
- **Structure:** Single repo, two apps
- **Custom domain:** `quotle.info`
- **Detection patterns:** `quotle.info`, `Quote Context Engine`, `quotle-info/quotes`
- **Admin detection:** `Database Manager`, `quotle-info.*manager`, `Enrichment Queue`

## Conventions

- All quotes must be verified public domain before inclusion
- Firebase paths use kebab-case for IDs (`abraham-lincoln`, not `Abraham Lincoln`)
- Quote text stored without surrounding quotation marks
- famousRating scale: 1 (obscure) to 10 (universally known)
- Schema.org Quotation markup required on every individual quote page (future)
- Mobile-first design — all layouts must work on 375px width

## Three-Layer UX Model

Every quote page follows progressive disclosure:
1. **Layer 1 (0-5s):** Quick answer — who said it, source, verification badge
2. **Layer 2 (5-60s):** Context — "Why it matters", connected ideas
3. **Layer 3 (1+ min):** Exploration — collections, timelines, related quotes

## Recent Changes

### v1.0.0
- Landing page with Firebase-powered search and featured quotes
- Interactive demo phone mockup
- Admin tool for quote database management
- 408 quotes migrated from Quotle game
- Custom domain configured (quotle.info)
