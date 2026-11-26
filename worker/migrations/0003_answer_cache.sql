-- 同じ質問の答えを使い回す（2回目からは AI を呼ばない）
CREATE TABLE answer_cache (
  key TEXT PRIMARY KEY,   -- 正規化した質問
  result TEXT NOT NULL,   -- AskResult の JSON
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
