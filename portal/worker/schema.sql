-- Tensei Author Portal — D1 schema

CREATE TABLE IF NOT EXISTS authors (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  github_handle TEXT,
  display_name  TEXT,
  status      TEXT NOT NULL DEFAULT 'pending_email',
  -- status: pending_email | email_verified | pending_manual_review | approved | rejected
  note_url    TEXT,        -- URL author posted their verification code at
  verify_code TEXT,        -- TENSEI-VERIFY-{random}
  created_at  INTEGER NOT NULL,
  reviewed_at INTEGER,
  admin_note  TEXT
);

CREATE TABLE IF NOT EXISTS works (
  id           TEXT PRIMARY KEY,
  author_id    TEXT NOT NULL REFERENCES authors(id),
  title        TEXT NOT NULL,
  platform     TEXT NOT NULL,   -- syosetu | kakuyomu | other
  platform_url TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,  -- {handle}-{work-slug}
  status       TEXT NOT NULL DEFAULT 'pending_manual_review',
  -- status: pending_manual_review | approved | rejected
  admin_note   TEXT,
  created_at   INTEGER NOT NULL,
  reviewed_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_authors_email  ON authors(email);
CREATE INDEX IF NOT EXISTS idx_works_author   ON works(author_id);
CREATE INDEX IF NOT EXISTS idx_works_status   ON works(status);

-- Phase 6: author-published character settings and chapter summaries

CREATE TABLE IF NOT EXISTS characters (
  id            TEXT PRIMARY KEY,
  work_id       TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  data          TEXT NOT NULL DEFAULT '{}',
  locked_fields TEXT NOT NULL DEFAULT '[]',
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
