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
