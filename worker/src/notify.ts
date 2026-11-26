// 1日の上限の 8 割・10 割に来たら、LINE（times5884）でオーナーに知らせる。種類ごとに1日1回だけ。
// Secret：LINE_CHANNEL_TOKEN（Messaging API のチャネルアクセストークン）、LINE_TO（受け取る人の LINE ユーザー ID）。無ければ何もしない。

const LEVELS = [0.8, 1] as const;

export type Usage = { neurons: number; asks: number };
export type Limits = { neurons: number; asks: number };

/** 今回の質問で新しく越えた段階（まだ知らせていないかは notifyOnce が見る）。 */
export function crossed(now: Usage, limit: Limits): { kind: string; text: string }[] {
  const out: { kind: string; text: string }[] = [];
  for (const level of LEVELS) {
    const pct = Math.round(level * 100);
    if (now.neurons >= limit.neurons * level)
      out.push({
        kind: `neurons-${pct}`,
        text: `【自作Govbot】今日の AI の利用量が上限の${pct}%（${Math.round(now.neurons).toLocaleString()} / ${limit.neurons.toLocaleString()} neurons、${now.asks}問）に${level < 1 ? "来ました" : "達しました。いまは検索だけの表示です"}。上限は wrangler.jsonc の DAILY_NEURONS。毎朝9時に戻ります。`,
      });
    if (now.asks >= limit.asks * level)
      out.push({
        kind: `asks-${pct}`,
        text: `【自作Govbot】今日の質問数が上限の${pct}%（${now.asks} / ${limit.asks}問）に${level < 1 ? "来ました" : "達しました。いまは新しい質問を受けていません（使い回しの答えだけ）"}。上限は wrangler.jsonc の DAILY_ASKS。毎朝9時に戻ります。`,
      });
  }
  return out;
}

/** その日まだ知らせていなければ記録して LINE に送る。 */
export async function notifyOnce(env: Env, kind: string, text: string): Promise<boolean> {
  if (!env.LINE_CHANNEL_TOKEN || !env.LINE_TO) return false;
  const day = new Date().toISOString().slice(0, 10);
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO notify_log (day, kind) VALUES (?, ?) RETURNING kind").bind(day, kind).all();
  if (!ins.results?.length) return false; // もう知らせた
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.LINE_CHANNEL_TOKEN}` },
    body: JSON.stringify({ to: env.LINE_TO, messages: [{ type: "text", text }] }),
  });
  if (!r.ok) {
    console.error("LINE push failed", r.status, (await r.text()).slice(0, 200));
    await env.DB.prepare("DELETE FROM notify_log WHERE day = ? AND kind = ?").bind(day, kind).run(); // 次の質問でもう一度試す
    return false;
  }
  return true;
}

export async function notifyLimits(env: Env, now: Usage, limit: Limits) {
  for (const c of crossed(now, limit)) await notifyOnce(env, c.kind, c.text);
}
