// 非公式の FAQ 回答 API。設計は docs/design.md。
//   config.ts   モデル・しきい値・上限
//   prompts.ts  生成と検証の指示
//   checks.ts   引用・数字・URL の照合（コードだけ）
//   pipeline.ts 検索 → 生成 → 照合 → 検証
//   limits.ts   本文の大きさ・IP ごとの回数・1日の上限・記録
// Env は wrangler types が worker-configuration.d.ts に生成する（LOCAL_EVAL・IP_SALT は env.d.ts）。

import { getCached, putCached } from "./cache.ts";
import { DEFAULT_GEN, DEFAULT_VER, EMBED, MAX_QUESTION, PER_IP_HOUR, RELATED_SCORE, dailyLimits } from "./config.ts";
import { ipHash, readJson, record, release, reserve } from "./limits.ts";
import { notifyLimits } from "./notify.ts";
import { ask, type AskResult } from "./pipeline.ts";

const API_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: API_HEADERS });
const fail = (status: number, error: string) => json({ error }, status);

/**
 * 手元の計測（wrangler dev）かどうか。/embed とモデルの差し替えはこのときだけ。
 * ホスト名だけに頼らず、.dev.vars の LOCAL_EVAL=1 も要る（公開側は vars で "0"）。
 */
function isLocalEval(url: URL, env: Env): boolean {
  return env.LOCAL_EVAL === "1" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

/** 公開の応答。画面が使うものだけ返す：内部の理由・類似度・neurons・検証に落ちた要約は出さない。 */
function publicView(out: AskResult) {
  const { mode, faq } = out;
  // 「見つからない」で遠い FAQ を並べると、関係のない話（ラーメン→食品廃棄物など）が出るので出さない
  const candidates = mode === "refuse" && !((out.top_scores[0] ?? 0) >= RELATED_SCORE) ? [] : out.candidates;
  return mode === "answer" ? { mode, candidates, faq, quotes: out.quotes, summary: out.summary } : { mode, candidates, faq };
}

const unavailable = (q: string, reason: string): AskResult => ({ question: q, top_ids: [], top_scores: [], candidates: [], mode: "unavailable", reason, neurons: 0 });

async function handleAsk(req: Request, env: Env, ctx: ExecutionContext, url: URL, local: boolean): Promise<Response> {
  // 別のサイトのページから、見ている人のブラウザ経由で質問を送らせない（その人の回数と1日の上限を使われる）。
  // JSON 以外を断ると、ブラウザは他サイトからの送信の前に確認（preflight）を挟み、そこで止まる。
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) return fail(415, "JSON で送ってください");
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) return fail(403, "このサイトの画面から送ってください");

  const body = await readJson(req);
  if (body === "too_large") return fail(413, "質問が長すぎます");
  const b = (body && typeof body === "object" ? body : {}) as { q?: unknown; gen?: unknown; ver?: unknown };
  const q = (typeof b.q === "string" ? b.q : "").trim().slice(0, MAX_QUESTION);
  if (!q) return fail(400, "質問が空です");
  const gen = local && typeof b.gen === "string" && b.gen ? b.gen : DEFAULT_GEN; // モデルの差し替えは手元の計測だけ
  const ver = local && typeof b.ver === "string" && b.ver ? b.ver : DEFAULT_VER;

  const slot = await reserve(env.DB, q, gen, await ipHash(req, env.IP_SALT));
  if (!local && slot.ipLastHour > PER_IP_HOUR) {
    await release(env.DB, slot.id);
    return fail(429, "質問が多すぎます。1時間ほどおいてからお試しください。");
  }

  const limit = dailyLimits(env);
  // 上限の 8 割・10 割に来たら LINE で知らせる（種類ごとに1日1回）
  if (!local) ctx.waitUntil(notifyLimits(env, { neurons: slot.neuronsToday, asks: slot.asksToday }, limit).catch((e) => console.error(e)));
  const useCache = gen === DEFAULT_GEN && ver === DEFAULT_VER; // 手元でモデルを差し替えた計測は使い回さない
  let out: AskResult | null = useCache ? await getCached(env.DB, q) : null;
  if (out) {
    // 使い回し：AI も検索も呼ばないので、1日の上限には数えない
  } else if (!local && slot.asksToday > limit.asks) {
    out = unavailable(q, "今日の質問数の上限に達した");
  } else {
    try {
      out = await ask(env, q, gen, ver, slot.neuronsToday >= limit.neurons);
      if (useCache) ctx.waitUntil(putCached(env.DB, q, out));
    } catch (e) {
      // 無料枠を使い切ったときなど。Workers Free なら請求は来ず、ここで止まる
      out = unavailable(q, String(e).slice(0, 200));
    }
  }
  ctx.waitUntil(record(env.DB, slot.id, out));
  return json(local ? out : publicView(out));
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const local = isLocalEval(url, env);
    try {
      if (local && url.pathname === "/embed" && req.method === "POST") {
        const { text } = (await req.json()) as { text: string[] };
        const r: any = await env.AI.run(EMBED, { text });
        return json({ shape: r.shape, data: r.data });
      }
      if (url.pathname === "/api/ask") {
        if (req.method !== "POST") return fail(405, "POST で送ってください");
        return await handleAsk(req, env, ctx, url, local);
      }
      return new Response("not found", { status: 404, headers: API_HEADERS });
    } catch (e) {
      console.error(e); // 中身は Workers のログにだけ残す
      return fail(500, "うまくいきませんでした。時間をおいてお試しください。");
    }
  },
} satisfies ExportedHandler<Env>;
