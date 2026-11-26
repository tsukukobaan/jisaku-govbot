// 同じ質問の答えを使い回す。バズると画像や例の質問がそのまま何度も入るので、2回目からは AI を呼ばない。
// FAQ の中身が変わらない限り答えも同じなので、CACHE_DAYS 日まで使う。

import { CACHE_DAYS } from "./config.ts";
import type { AskResult } from "./pipeline.ts";

/** 全角・半角、空白、末尾の記号、大文字小文字の違いを同じ質問とみなす。 */
export function cacheKey(q: string): string {
  return q
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[?!。.、,…~〜ー]+$/u, "");
}

const CACHEABLE = new Set(["answer", "faq_only", "refuse"]);

export async function getCached(db: D1Database, q: string): Promise<AskResult | null> {
  const row = await db
    .prepare(`SELECT result FROM answer_cache WHERE key = ? AND at >= datetime('now', '-${CACHE_DAYS} days')`)
    .bind(cacheKey(q))
    .first<{ result: string }>();
  if (!row) return null;
  const out = JSON.parse(row.result) as AskResult;
  return { ...out, question: q, neurons: 0, reason: `cache:${out.reason ?? ""}` };
}

export function putCached(db: D1Database, q: string, out: AskResult) {
  if (!CACHEABLE.has(out.mode)) return Promise.resolve();
  return db
    .prepare("INSERT OR REPLACE INTO answer_cache (key, result, at) VALUES (?, ?, datetime('now'))")
    .bind(cacheKey(q), JSON.stringify(out))
    .run();
}
