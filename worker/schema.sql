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
-- Reader reports about a specific quote page. Originally evidence-only ("here is a source URL"),
-- which meant the most common reader signal — "this is wrong and I'm fairly sure, but I don't have
-- a link" — had nowhere to go: the endpoint rejected it and the only other route was a nomination
-- form built for missing quotes. `reason` is what makes a sourceless report submittable.
--
-- `url` stays NOT NULL to avoid a table rebuild; a report with no source stores '' (empty), so
-- "has evidence" is `url <> ''`, not `url IS NOT NULL`. Every row must carry a reason OR a url —
-- enforced in the worker, not the schema, because SQLite CHECK constraints can't be added later.
CREATE TABLE IF NOT EXISTS source_submissions (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  slug    TEXT,                              -- the who-said/{slug} the report is about
  url     TEXT NOT NULL,                     -- source URL, or '' when the reader has none
  stance  TEXT NOT NULL DEFAULT 'supports',  -- supports | refutes (only meaningful when url <> '')
  reason  TEXT,                              -- wrong-person | wrong-wording | rights | dead-link | other
  note    TEXT,                              -- optional: what it shows / what is wrong
  status  TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | rejected
  created TEXT,
  iphash  TEXT
);

-- Migration for an EXISTING database (D1 supports ADD COLUMN; run once, it errors if already there):
--   npx wrangler d1 execute <DB> --remote --command "ALTER TABLE source_submissions ADD COLUMN reason TEXT;"

CREATE INDEX IF NOT EXISTS idx_src_status ON source_submissions(status, created);
CREATE INDEX IF NOT EXISTS idx_src_slug   ON source_submissions(slug, created);
CREATE INDEX IF NOT EXISTS idx_src_ip     ON source_submissions(iphash, created);
