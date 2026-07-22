-- quotle-community D1 schema. Apply with:
--   wrangler d1 execute quotle-community --remote --file schema.sql
-- Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS votes (
  slug    TEXT PRIMARY KEY,
  count   INTEGER NOT NULL DEFAULT 0,
  updated TEXT
);

-- one row per (ip fingerprint, slug) — enforces one vote per browser/network per quote
CREATE TABLE IF NOT EXISTS vote_log (
  iphash  TEXT NOT NULL,
  slug    TEXT NOT NULL,
  created TEXT,
  PRIMARY KEY (iphash, slug)
);

-- moderation queue. Nothing here is public until a human promotes it into the harvest backlog.
CREATE TABLE IF NOT EXISTS nominations (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  quote   TEXT,
  author  TEXT,
  note    TEXT,
  status  TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  created TEXT,
  iphash  TEXT
);

CREATE INDEX IF NOT EXISTS idx_nom_status ON nominations(status, created);
CREATE INDEX IF NOT EXISTS idx_nom_ip     ON nominations(iphash, created);

-- source-evidence queue. A reader submits a URL that SUPPORTS or REFUTES a quote page's
-- provenance claim — evidence for us to validate, never an edit. Nothing here changes any page;
-- a human reviews each submission and, if it holds up, updates the record through the normal build.
CREATE TABLE IF NOT EXISTS source_submissions (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  slug    TEXT,                              -- the who-said/{slug} the evidence is about
  url     TEXT NOT NULL,                     -- the source URL the reader is offering
  stance  TEXT NOT NULL DEFAULT 'supports',  -- supports | refutes
  note    TEXT,                              -- optional: what it shows
  status  TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | rejected
  created TEXT,
  iphash  TEXT
);

CREATE INDEX IF NOT EXISTS idx_src_status ON source_submissions(status, created);
CREATE INDEX IF NOT EXISTS idx_src_slug   ON source_submissions(slug, created);
CREATE INDEX IF NOT EXISTS idx_src_ip     ON source_submissions(iphash, created);
