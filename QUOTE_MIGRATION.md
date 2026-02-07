# Quote Migration Guide - Quotle to Quotle.info

## Overview
We have 408 quotes in Quotle (v1.2.9) that can serve as our starting dataset for Quotle.info. However, Quotle has a simplified schema focused on gameplay, while Quotle.info needs richer context and verification.

---

## Quotle Schema (Current)

```javascript
{
  index: 1,
  text: "Few things help an individual more than to place responsibility upon them.",
  author: "Booker T. Washington",
  gender: "Male",
  category: "Speech",
  period: "1800s",
  difficulty: 8,
  hint: "He founded the Tuskegee Institute with just 30 students.",
  location: "Tuskegee, Alabama, USA",
  year: "1900s"
}
```

## Quotle.info Schema (Target)

Much richer - see DATA_MODEL.md for full schema. Key additions needed:
- Source verification (title, URL, publication details)
- Public domain status and reason
- Historical context
- Related quotes (connections)
- Topics/themes (searchable taxonomy)
- Clean text for searching
- Literary analysis
- Misattribution flags

---

## Migration Strategy

### Phase 1: Import Base Data (Week 1)
**Goal:** Get all 408 quotes into Firebase with basic enrichment

**Process:**
1. Extract quotes from Quotle index.html
2. Convert to JSON
3. For each quote:
   - Generate unique ID (slug from author + text snippet)
   - Add cleanText field (lowercase, no punctuation)
   - Create basic author record if doesn't exist
   - Flag for manual review/enrichment

**Script:** `scripts/extract-quotle-quotes.js`

### Phase 2: Enrich Top 100 (Week 2-3)
**Goal:** Fully enrich the most important quotes for launch

**Selection criteria:**
- Famous quotes (difficulty < 7 in Quotle = easier to recognize)
- Diverse authors (not all Franklin, Disney, Kennedy)
- Different time periods
- Good for voice search (short, clear attribution)

**Enrichment needed:**
- Source verification (find original speech, book, letter)
- Public domain verification
- Historical context (2-3 sentences)
- Related quotes (manual curation initially)
- Topics/themes tagging
- Misattribution check

**Tool:** Manual enrichment spreadsheet or Firebase admin panel

### Phase 3: Automated Enhancement (Week 4+)
**Goal:** Use AI to suggest enrichments for remaining quotes

**Process:**
- Use Claude API to generate:
  - Historical context
  - Suggested topics/themes
  - Related quote suggestions (from our database)
  - Public domain analysis
- Human review and approval
- Batch update Firebase

---

## Data Mapping

### Direct Mappings (No Change Needed)
```javascript
Quotle → Quotle.info
text → text
author → authorName (denormalized)
year → source.year
location → source.publicationDetails (if relevant)
difficulty → gameData.difficultyLevel
hint → (can inform context writing)
```

### Derived Mappings
```javascript
Quotle → Quotle.info
author → authorId (generate slug: "booker-t-washington")
text → cleanText (normalize for search)
period → author.era (normalize: "1800s" → "modern")
category → source.type (normalize: "Speech" → "speech")
```

### New Fields to Add
```javascript
Required for launch:
- source.title (needs research)
- source.url (find primary source)
- publicDomain.status (verify)
- publicDomain.reason (document)
- context (2-3 sentences why it matters)
- topics[] (3-5 relevant topics)
- themes[] (1-3 broad themes)

Optional for V1:
- relatedQuotes[]
- contradictingQuotes[]
- historicalContext
- interpretation
```

---

## Sample Conversion

### Quotle Format:
```javascript
{
  index: 1,
  text: "Few things help an individual more than to place responsibility upon them.",
  author: "Booker T. Washington",
  gender: "Male",
  category: "Speech",
  period: "1800s",
  difficulty: 8,
  hint: "He founded the Tuskegee Institute with just 30 students.",
  location: "Tuskegee, Alabama, USA",
  year: "1900s"
}
```

### Quotle.info Format (Enriched):
```javascript
{
  // Core content
  text: "Few things help an individual more than to place responsibility upon them.",
  cleanText: "few things help an individual more than to place responsibility upon them",
  
  // Attribution
  authorId: "booker-t-washington",
  authorName: "Booker T. Washington",
  
  // Source (NEEDS RESEARCH)
  source: {
    type: "speech",
    title: "Atlanta Exposition Address",
    year: 1895,
    publicationDetails: "Atlanta, Georgia",
    url: "https://historymatters.gmu.edu/d/39/",
    verified: true,
    verifiedBy: "admin",
    verificationDate: "2025-02-06",
    verificationNotes: "Verified from Historical Matters primary source collection"
  },
  
  // Context (NEEDS WRITING)
  context: "Washington emphasized self-reliance and personal responsibility as paths to African American advancement during the post-Reconstruction era.",
  historicalContext: "Delivered at the Cotton States Exposition, this speech became known as the 'Atlanta Compromise' for its conciliatory tone toward segregation.",
  
  // Categorization (NEEDS TAGGING)
  topics: ["responsibility", "self-reliance", "leadership", "education"],
  themes: ["personal_growth", "empowerment"],
  sentiment: "inspirational",
  
  // Public domain (NEEDS VERIFICATION)
  publicDomain: {
    status: true,
    jurisdiction: "US",
    reason: "published_pre_1928",
    verificationDate: "2025-02-06"
  },
  
  // Game data (FROM QUOTLE)
  gameData: {
    usedInQuotle: true,
    quotleIndex: 1,
    difficultyLevel: 8,
    quotleHint: "He founded the Tuskegee Institute with just 30 students."
  },
  
  // Metadata
  createdAt: Date.now(),
  updatedAt: Date.now(),
  status: "published"
}
```

---

## Enrichment Checklist

For each quote being enriched:

**Source Verification:**
- [ ] Find original source (speech, book, letter, etc.)
- [ ] Verify exact wording
- [ ] Get publication date
- [ ] Find authoritative URL
- [ ] Document verification process

**Public Domain:**
- [ ] Check publication date (pre-1928 = public domain)
- [ ] Check author death date (70+ years = public domain)
- [ ] Verify no copyright claim
- [ ] Document reason for PD status

**Context Writing:**
- [ ] Write 2-3 sentence "why it matters"
- [ ] Add historical context if relevant
- [ ] Note any common misunderstandings

**Categorization:**
- [ ] Add 3-5 relevant topics
- [ ] Add 1-3 broad themes
- [ ] Classify sentiment (inspirational/philosophical/etc.)

**Connections (Optional for V1):**
- [ ] Identify 1-2 related quotes
- [ ] Note any contradicting perspectives
- [ ] Flag if commonly misattributed

---

## Priority Quotes for Enrichment

Based on Quotle data, prioritize:

1. **Low difficulty (famous quotes):** difficulty ≤ 6
2. **Diverse authors:** Not over-indexing on same person
3. **Good voice search candidates:** Clear, short quotes
4. **Different eras:** Mix of ancient, modern, contemporary

**Example priority list (from Quotle):**
- JFK: "Ask not what your country can do for you..." (index 4, difficulty 5)
- Benjamin Franklin: "An investment in knowledge..." (index 2, difficulty 6)
- Walt Disney: "It's kind of fun to do the impossible" (index 3, difficulty 6)

Then work through remaining quotes by era/theme.

---

## Tools Needed

### Extraction Script
```javascript
// scripts/extract-quotle-quotes.js
// Parses index.html and outputs JSON
```

### Migration Script
```javascript
// scripts/migrate-to-firebase.js
// Uploads quotes to Firebase with basic transformation
```

### Enrichment Interface
Options:
1. Firebase Admin console (manual editing)
2. Google Sheets → Firebase (bulk import)
3. Custom admin panel (overkill for V1)

Recommendation: Use Google Sheets for enrichment, then import to Firebase.

---

## Integration Back to Quotle

Once Quotle.info is live, update Quotle game to link to it:

**Post-game screen:**
```javascript
// After revealing answer
"Learn more about this quote →"
// Links to: quotle.info/quotes/{slug}

// Instead of Wikipedia link
```

**Quote of the day link:**
```javascript
// In game header or menu
"Explore all quotes →"
// Links to: quotle.info/collections/quotle-quotes
```

**Hint system:**
```javascript
// If user requests hint, could show preview
"Want deeper context? Visit quotle.info"
```

---

## Next Steps

1. **This week:** Extract all 408 quotes to JSON
2. **Next week:** Select top 100 for enrichment
3. **Week 3-4:** Enrich top 100 with sources and context
4. **Week 5:** Build quote page templates and test with enriched data
5. **Week 6+:** Gradually enrich remaining quotes

---

**Last Updated:** 2025-02-06
