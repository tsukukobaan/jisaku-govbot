// モデル・しきい値・上限。数字の根拠は docs/design.md。

export const EMBED = "@cf/baai/bge-m3";
export const DEFAULT_GEN = "@cf/google/gemma-4-26b-a4b-it";
export const DEFAULT_VER = "@cf/meta/llama-4-scout-17b-16e-instruct"; // 生成と別のモデルで検証する
export const TOP_K = 5;
export const MIN_SCORE = 0.5; // これ未満は FAQ にないとみなし、モデルを呼ばない
export const RELATED_SCORE = 0.62; // 「見つからない」ときに近い FAQ を出すのは、1位の類似度がこれ以上のときだけ（遠いものを並べない）

// 1日の上限は wrangler.jsonc の vars（DAILY_NEURONS・DAILY_ASKS）で変える。下は vars が無いときの値（無料枠を守る）
export const DAILY_NEURONS = 8500; // 1日（UTC）の生成の上限。超えたら検索だけ（無料枠 10,000 を守る）
export const DAILY_ASKS = 700; // 1日（UTC）に受ける質問数。Vectorize の月の無料枠（約2.4万問）を守る
export const CACHE_DAYS = 7; // 同じ質問の答えを使い回す日数

/** vars があればそちらを使う（Workers Paid にしたら vars だけ上げて出し直す）。 */
export function dailyLimits(env: { DAILY_NEURONS?: string; DAILY_ASKS?: string }) {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return { neurons: num(env.DAILY_NEURONS, DAILY_NEURONS), asks: num(env.DAILY_ASKS, DAILY_ASKS) };
}
export const PER_IP_HOUR = 20; // 1つの IP から1時間に受ける質問数
export const RESERVE_NEURONS = 25; // 1問の見込み。答えが出る前に先に数えておく（同時に来た質問で上限を越えないように）
export const MAX_QUESTION = 300; // 質問の文字数
export const MAX_BODY = 4096; // /api/ask の本文のバイト数

// neurons / 100万トークン（入力, 出力）。Workers AI の料金ページ（2026-11-26）より。
// 既定の3つ以外は、手元でモデルを差し替えて比べるときの分。
const RATES: Record<string, [number, number]> = {
  "@cf/baai/bge-m3": [1075, 0],
  "@cf/google/gemma-4-26b-a4b-it": [9091, 27273],
  "@cf/meta/llama-4-scout-17b-16e-instruct": [24545, 77273],
  "@cf/zai-org/glm-4.7-flash": [5500, 36400],
  "@cf/openai/gpt-oss-20b": [18182, 27273],
  "@cf/mistralai/mistral-small-3.1-24b-instruct": [31876, 50488],
};

export type Usage = { prompt_tokens?: number; completion_tokens?: number };

export function neurons(model: string, u?: Usage): number {
  const r = RATES[model];
  if (!r || !u) return 0;
  return ((u.prompt_tokens ?? 0) * r[0] + (u.completion_tokens ?? 0) * r[1]) / 1e6;
}
