-- 上限の通知を1日1回ずつにするための記録
CREATE TABLE notify_log (
  day TEXT NOT NULL,      -- UTC の日付
  kind TEXT NOT NULL,     -- 例：neurons-80, neurons-100, asks-80, asks-100
  at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (day, kind)
);
