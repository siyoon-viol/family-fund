-- 우리집 공금통장 D1 스키마
CREATE TABLE IF NOT EXISTS tx (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,              -- YYYY-MM-DD
  type       TEXT NOT NULL CHECK (type IN ('in', 'out')),
  category   TEXT NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  member_id  TEXT,
  month      TEXT,                       -- 회비 해당 월 YYYY-MM
  memo       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tx_date ON tx (date);

CREATE TABLE IF NOT EXISTS members (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  sort  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
