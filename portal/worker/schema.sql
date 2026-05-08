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
