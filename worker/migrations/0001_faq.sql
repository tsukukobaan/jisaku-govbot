CREATE TABLE faq (
  id TEXT PRIMARY KEY,
  area TEXT NOT NULL,
  question TEXT NOT NULL,
  answer_plain TEXT NOT NULL,
  links TEXT NOT NULL,      -- JSON [{label,url}]
  as_of TEXT NOT NULL
);
CREATE TABLE ask_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  question TEXT NOT NULL,
  top_ids TEXT NOT NULL,    -- JSON
  top_scores TEXT NOT NULL, -- JSON
  mode TEXT NOT NULL,       -- pending | answer | faq_only | refuse | search_only | unavailable
  model TEXT,
  neurons REAL,
  detail TEXT               -- JSON（判定・引用・検証の結果）
);
