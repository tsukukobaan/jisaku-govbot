// 荒らし・使いすぎ対策：本文の大きさ、IP ごとの回数、1日の上限、質問の記録（D1 の ask_log）。

import { MAX_BODY, RESERVE_NEURONS } from "./config.ts";
import type { AskResult } from "./pipeline.ts";

/** 本文を上限つきで読んで JSON にする。大きすぎれば "too_large"、JSON でなければ null。 */
export async function readJson(req: Request, max = MAX_BODY): Promise<unknown | "too_large" | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return "too_large";
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return null;
  }
}

/** IPv6 は /64（先頭4つの組）にまとめる。1回線が大量のアドレスを持てるので、1つずつ数えると制限にならない。 */
export function ipBucket(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/**
 * IP はそのまま残さない。日付と（あれば）秘密の塩 IP_SALT を混ぜて SHA-256 にし、先頭 12 バイトだけ使う。
 * IP_SALT が無いと IPv4 は総当たりで戻せるので、`wrangler secret put IP_SALT` を勧める。
 */
export async function ipHash(req: Request, salt = ""): Promise<string> {
  const ip = ipBucket(req.headers.get("cf-connecting-ip") ?? "local");
  const day = new Date().toISOString().slice(0, 10);
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${day}:${ip}`));
  return [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type Reservation = {
  id: number; // ask_log の行
  ipLastHour: number; // この IP の直近1時間の質問数（今回を含む）
  asksToday: number; // 今日（UTC）の質問数（今回を含む）
  neuronsToday: number; // 今日（UTC）に使った neurons（今回の見込みは含まない）
};

/**
 * 質問を先に ask_log に書いてから数える（1回のまとめ実行＝1トランザクション）。
 * 答えが出てから書くと、同時に来た質問が互いを数えられず、IP の制限も1日の上限も越えてしまう。
 */
export async function reserve(db: D1Database, question: string, model: string, ip: string): Promise<Reservation> {
  const [ins, perIp, today] = await db.batch<Record<string, number>>([
    db
      .prepare("INSERT INTO ask_log (question, top_ids, top_scores, mode, model, neurons, ip_hash) VALUES (?, '[]', '[]', 'pending', ?, ?, ?) RETURNING id")
      .bind(question, model, RESERVE_NEURONS, ip),
    db.prepare("SELECT count(*) n FROM ask_log WHERE ip_hash = ? AND at >= datetime('now','-1 hour')").bind(ip),
    db.prepare("SELECT coalesce(sum(neurons),0) s, count(*) n FROM ask_log WHERE at >= date('now')"),
  ]);
  return {
    id: ins.results[0].id,
    ipLastHour: perIp.results[0].n,
    asksToday: today.results[0].n,
    neuronsToday: today.results[0].s - RESERVE_NEURONS,
  };
}

/** 回数制限で断った質問は記録に残さない（残すと、断られた分でさらに締め出される）。 */
export function release(db: D1Database, id: number) {
  return db.prepare("DELETE FROM ask_log WHERE id = ?").bind(id).run();
}

/** 先に書いた行を、結果で書き換える。 */
export function record(db: D1Database, id: number, out: AskResult) {
  const detail = JSON.stringify({ reason: out.reason, quotes: out.quotes, summary: out.summary, faq: out.faq?.id });
  return db
    .prepare("UPDATE ask_log SET top_ids = ?, top_scores = ?, mode = ?, neurons = ?, detail = ? WHERE id = ?")
    .bind(JSON.stringify(out.top_ids), JSON.stringify(out.top_scores), out.mode, out.neurons, detail, id)
    .run();
}
