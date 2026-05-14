-- Phase 6: author-published character settings and chapter summaries

CREATE TABLE IF NOT EXISTS characters (
  id            TEXT PRIMARY KEY,
  work_id       TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  data          TEXT NOT NULL DEFAULT '{}',    -- JSON: CharacterExtended fields
  locked_fields TEXT NOT NULL DEFAULT '[]',   -- JSON: LockedField[]
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(work_id, slug)
);

CREATE TABLE IF NOT EXISTS chapter_summaries (
  id             TEXT PRIMARY KEY,
  work_id        TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  summary        TEXT NOT NULL DEFAULT '',
  locked         INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE(work_id, chapter_number)
);

CREATE INDEX IF NOT EXISTS idx_characters_work ON characters(work_id);
CREATE INDEX IF NOT EXISTS idx_summaries_work  ON chapter_summaries(work_id);
