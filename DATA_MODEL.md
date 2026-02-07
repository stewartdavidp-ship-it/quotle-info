# Data Model - Quotle.info Database Schema

## Overview
This document defines the complete Firebase Realtime Database structure for the quote database. The model emphasizes relationships between quotes, authors, and ideas while maintaining query performance.

## Design Principles
1. **Denormalization for performance** - Store author name with quote for quick display
2. **Rich relationships** - Track connections, contradictions, responses between quotes
3. **Extensibility** - Reserved fields for future features (translations, user interactions)
4. **Verification-first** - Public domain status and source documentation built-in
5. **Search optimization** - cleanText field for normalized searching

---

## Core Collections

### Quotes Collection
Primary collection storing all quote data.

**Path:** `quotes/{quoteId}`

```javascript
{
  // ============================================
  // CORE CONTENT
  // ============================================
  text: "The only way to do great work is to love what you do.",
  cleanText: "the only way to do great work is to love what you do", // lowercase, no punctuation
  
  // ============================================
  // ATTRIBUTION
  // ============================================
  authorId: "author_steve_jobs",
  authorName: "Steve Jobs", // denormalized for display
  
  // ============================================
  // SOURCE INFORMATION
  // ============================================
  source: {
    type: "speech", // speech|book|letter|interview|essay|article|other
    title: "Stanford Commencement Address",
    year: 2005,
    month: 6,
    day: 12,
    publicationDetails: "Stanford University",
    url: "https://news.stanford.edu/2005/06/14/jobs-061505/",
    verified: true,
    verifiedBy: "admin",
    verificationDate: "2025-02-06",
    verificationNotes: "Official Stanford News transcript"
  },
  
  // ============================================
  // CONTEXT & INTERPRETATION
  // ============================================
  context: "Jobs was reflecting on his career path and encouraging graduates to pursue work aligned with their passions.",
  historicalContext: "Delivered one year after his pancreatic cancer diagnosis and shortly after selling Pixar to Disney for $7.4 billion.",
  interpretation: "This quote emphasizes intrinsic motivation and authentic engagement with one's work as prerequisites for excellence.",
  
  // ============================================
  // CATEGORIZATION
  // ============================================
  topics: ["work", "passion", "success", "career", "excellence"],
  themes: ["motivation", "life_philosophy", "self_actualization"],
  sentiment: "inspirational", // inspirational|philosophical|humorous|critical|reflective|sardonic
  
  // ============================================
  // RELATIONSHIPS
  // ============================================
  relatedQuotes: [
    "quote_confucius_love_job",
    "quote_twain_work_play"
  ],
  contradictingQuotes: [
    "quote_weber_protestant_ethic"
  ],
  responseQuotes: [], // quotes that directly respond to this one
  
  // ============================================
  // LITERARY ANALYSIS
  // ============================================
  literaryDevices: ["parallelism", "conditional_statement"],
  keyPhrases: ["great work", "love what you do"],
  wordCount: 12,
  readingLevel: 8, // Flesch-Kincaid grade level
  
  // ============================================
  // POPULARITY & ACCURACY
  // ============================================
  famousRating: 9, // 1-10 scale
  commonlyMisattributed: true,
  actualAuthor: "Steve Jobs", // if misattributed, who really said it
  misattributedTo: ["Mark Twain", "Confucius"], // common false attributions
  
  variations: [
    {
      text: "To do great work, you must love what you do",
      notes: "Common paraphrase, slightly altered word order"
    }
  ],
  
  // ============================================
  // MULTIMEDIA
  // ============================================
  imageUrl: null, // future: context images
  audioUrl: "https://www.youtube.com/watch?v=UF8uR6Z6KLc", // original speech
  
  // ============================================
  // PUBLIC DOMAIN STATUS
  // ============================================
  publicDomain: {
    status: true,
    jurisdiction: "US",
    reason: "speech_public_event",
    notes: "Public commencement address, no copyright claimed",
    verificationDate: "2025-02-06"
  },
  
  // ============================================
  // GAME INTEGRATION
  // ============================================
  gameData: {
    usedInQuotle: true,
    quotleDate: "2024-03-15",
    difficultyLevel: 7,
    averageGuesses: 2.3,
    solveRate: 0.87,
    hintsUsed: 0.4 // average hints per solve
  },
  
  // ============================================
  // METADATA
  // ============================================
  createdAt: 1707264000000, // timestamp
  updatedAt: 1707264000000,
  curatedBy: "admin",
  status: "published", // draft|review|published|archived
  flags: [], // for moderation
  
  // ============================================
  // RESERVED FOR FUTURE
  // ============================================
  userInteractions: {
    favorites: 0,
    shares: 0,
    views: 0
  },
  
  translations: {
    // future: other languages
  },
  
  aiInsights: {
    // future: AI-generated modern relevance, etc.
  }
}
```

---

### Authors Collection
Biographical and contextual information about quote authors.

**Path:** `authors/{authorId}`

```javascript
{
  // ============================================
  // BASIC INFORMATION
  // ============================================
  name: "Steve Jobs",
  fullName: "Steven Paul Jobs",
  aliases: ["Steven P. Jobs"],
  slug: "steve-jobs", // for URLs
  
  // ============================================
  // BIOGRAPHICAL
  // ============================================
  birthDate: "1955-02-24",
  deathDate: "2011-10-05",
  birthPlace: {
    city: "San Francisco",
    state: "California",
    country: "United States"
  },
  nationality: "American",
  
  // ============================================
  // PROFESSIONAL
  // ============================================
  occupations: ["entrepreneur", "inventor", "business_magnate"],
  knownFor: [
    "Co-founding Apple Inc.",
    "Pioneering personal computing",
    "Leading Pixar Animation Studios"
  ],
  industries: ["technology", "entertainment", "design"],
  
  // ============================================
  // CONTEXT
  // ============================================
  biography: "Steve Jobs was an American entrepreneur and inventor best known as the co-founder of Apple Inc. He played a key role in revolutionizing personal computing, animated films, music, phones, and digital publishing.",
  
  era: "modern", // ancient|classical|medieval|renaissance|enlightenment|modern|contemporary
  timePeriod: "1955-2011",
  centuriesActive: [20, 21],
  
  // ============================================
  // INTELLECTUAL CONTEXT
  // ============================================
  fields: ["business", "technology", "design", "innovation"],
  philosophies: ["minimalism", "user_experience", "innovation"],
  movements: ["digital_revolution", "personal_computing"],
  
  // ============================================
  // RELATIONSHIPS
  // ============================================
  influences: [
    "author_alan_turing",
    "author_buckminster_fuller"
  ],
  influenced: [
    "author_elon_musk",
    "author_jony_ive"
  ],
  contemporaries: [
    "author_bill_gates",
    "author_steve_wozniak"
  ],
  
  // ============================================
  // WORKS & SOURCES
  // ============================================
  majorWorks: [
    {
      title: "Stanford Commencement Address",
      year: 2005,
      type: "speech",
      significance: "Widely regarded as one of the most influential graduation speeches"
    },
    {
      title: "iPhone Introduction",
      year: 2007,
      type: "presentation",
      significance: "Revolutionized mobile computing"
    }
  ],
  
  // ============================================
  // STATISTICS
  // ============================================
  quoteCount: 47,
  popularityScore: 95, // 1-100
  
  // ============================================
  // MEDIA
  // ============================================
  portraitUrl: "/images/authors/steve-jobs-portrait.jpg",
  signatureUrl: null,
  
  // ============================================
  // PUBLIC DOMAIN
  // ============================================
  worksPublicDomain: false, // not yet, died 2011
  publicDomainYear: 2082, // 70 years after death (US)
  
  // ============================================
  // EXTERNAL LINKS
  // ============================================
  wikipediaUrl: "https://en.wikipedia.org/wiki/Steve_Jobs",
  wikidataId: "Q19837",
  externalLinks: {
    biography: "https://www.biography.com/business-figure/steve-jobs",
    archive: "https://archive.org/..."
  },
  
  // ============================================
  // METADATA
  // ============================================
  verified: true,
  createdAt: 1707264000000,
  updatedAt: 1707264000000,
  curatedBy: "admin"
}
```

---

### Topics Collection
Hierarchical taxonomy of themes and subjects.

**Path:** `topics/{topicId}`

```javascript
{
  // ============================================
  // BASIC INFO
  // ============================================
  id: "topic_success",
  name: "success",
  displayName: "Success",
  slug: "success",
  
  description: "Quotes about achievement, accomplishment, and reaching one's goals.",
  
  // ============================================
  // HIERARCHY
  // ============================================
  parentTopic: "topic_career", // null for top-level
  childTopics: [
    "topic_achievement",
    "topic_goals",
    "topic_ambition"
  ],
  relatedTopics: [
    "topic_motivation",
    "topic_perseverance",
    "topic_failure"
  ],
  
  // ============================================
  // CATEGORIZATION
  // ============================================
  category: "life", // life|philosophy|politics|science|art|humor|history
  
  // ============================================
  // STATISTICS
  // ============================================
  quoteCount: 234,
  popularityScore: 87, // based on searches, views
  
  // ============================================
  // DISPLAY
  // ============================================
  iconName: "trophy", // for UI
  colorCode: "#FFD700",
  
  // ============================================
  // CURATION
  // ============================================
  featured: true,
  featuredQuotes: [
    "quote_jobs_great_work",
    "quote_churchill_success_failure"
  ],
  
  // ============================================
  // METADATA
  // ============================================
  createdAt: 1707264000000,
  updatedAt: 1707264000000
}
```

---

### Quote Connections Collection
Explicit relationships between quotes.

**Path:** `connections/{connectionId}`

```javascript
{
  // ============================================
  // CONNECTION TYPE
  // ============================================
  type: "response", // response|contradiction|echo|expansion|context
  
  // ============================================
  // QUOTES
  // ============================================
  primaryQuoteId: "quote_jobs_great_work",
  secondaryQuoteId: "quote_confucius_love_job",
  
  // ============================================
  // RELATIONSHIP
  // ============================================
  relationshipDescription: "Jobs's modern take on work satisfaction echoes Confucius's ancient wisdom about choosing work you love, showing this principle transcends cultures and millennia.",
  
  // ============================================
  // CONTEXT
  // ============================================
  timeSeparation: 2500, // years between quotes
  culturalContext: "Eastern philosophy influencing Western business thought",
  
  // ============================================
  // DISPLAY
  // ============================================
  displayTitle: "Ancient Wisdom Meets Modern Business",
  narrative: "Twenty-five centuries apart, a Chinese philosopher and a Silicon Valley entrepreneur arrived at the same conclusion about the path to excellence.",
  
  // ============================================
  // METADATA
  // ============================================
  strength: 0.9, // 0-1, connection strength
  verified: true,
  curatedBy: "admin",
  createdAt: 1707264000000
}
```

---

### Collections (Curated Groupings)
Hand-picked quote collections for storytelling.

**Path:** `collections/{collectionId}`

```javascript
{
  // ============================================
  // BASIC INFO
  // ============================================
  id: "collection_innovators",
  title: "The Innovator's Mindset",
  slug: "innovators-mindset",
  
  description: "Quotes from history's greatest innovators about creativity, risk-taking, and changing the world.",
  
  // ============================================
  // CONTENT
  // ============================================
  quoteIds: [
    "quote_jobs_great_work",
    "quote_edison_genius",
    "quote_curie_nothing_fear",
    "quote_einstein_imagination"
  ],
  
  // Custom ordering (override chronological)
  quoteOrder: [3, 1, 4, 2],
  
  // ============================================
  // METADATA
  // ============================================
  curatorId: "admin",
  category: "business",
  tags: ["innovation", "creativity", "technology"],
  
  // ============================================
  // DISPLAY
  // ============================================
  coverImageUrl: "/images/collections/innovators.jpg",
  featured: true,
  
  // ============================================
  // STATISTICS
  // ============================================
  viewCount: 1234,
  shareCount: 89,
  
  // ============================================
  // METADATA
  // ============================================
  createdAt: 1707264000000,
  updatedAt: 1707264000000,
  status: "published"
}
```

---

## Indexes for Query Performance

```javascript
// Firebase Realtime Database indexes
{
  "quotes": {
    ".indexOn": ["authorId", "createdAt", "famousRating"]
  },
  "authors": {
    ".indexOn": ["name", "popularityScore", "era"]
  },
  "topics": {
    ".indexOn": ["category", "popularityScore"]
  }
}
```

## Query Examples

```javascript
// Find all quotes by an author
ref.child('quotes')
   .orderByChild('authorId')
   .equalTo('author_steve_jobs');

// Find top 10 famous quotes
ref.child('quotes')
   .orderByChild('famousRating')
   .limitToLast(10);

// Search by text (requires client-side filtering)
ref.child('quotes')
   .once('value')
   .then(snapshot => {
     // Filter by cleanText containing search term
   });
```

---

## Future Extensions

### User Accounts (Phase 2)
```javascript
users/{userId}
{
  displayName: "John Doe",
  favorites: ["quote_1", "quote_2"],
  collections: ["collection_1"],
  activity: {
    quotesViewed: 45,
    collectionsStarted: 3
  }
}
```

### Quote Facts (Sub-collection)
```javascript
quotes/{quoteId}/facts/{factId}
{
  type: "trivia|impact|translation|usage|misconception",
  title: "Most Misattributed Quote of 2010s",
  content: "This quote is often...",
  sources: ["url1"],
  interestingLevel: 8
}
```

---

**Last Updated:** 2025-02-06
