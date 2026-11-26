// /api/ask の入口と制限を、にせの AI・Vectorize と、メモリ上の SQLite（migrations をそのまま流す）で確かめる。
// Cloudflare には何も送らない。
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { DAILY_ASKS, DAILY_NEURONS, PER_IP_HOUR } from "../src/config.ts";
import worker from "../src/index.ts";

const MIGRATIONS = new URL("../migrations/", import.meta.url);
const FAQ_ANSWER = "申請は、出生の日の翌日から15日以内に行ってください。";
const GOOD = { answerable: true, faq_id: "A-1", quotes: [FAQ_ANSWER], summary: "生まれた日の翌日から15日以内に申請します。" };

// D1 のうち、Worker が使う部分だけ
class Stmt {
  db: DatabaseSync; sql: string; args: any[];
  constructor(db: DatabaseSync, sql: string, args: any[] = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args: any[]) { return new Stmt(this.db, this.sql, args); }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) as any[] }; }
  async run() { return this.all(); }
  async first(col?: string) { const r = this.db.prepare(this.sql).get(...this.args) as any; return r == null ? null : col ? r[col] : r; }
}
class FakeD1 {
  db = new DatabaseSync(":memory:");
  constructor() {
    for (const f of readdirSync(MIGRATIONS).sort()) this.db.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
    this.db.prepare("INSERT INTO faq VALUES (?,?,?,?,?,?)").run("A-1", "戸籍", "出生届はいつまで？", FAQ_ANSWER, JSON.stringify([{ label: "法務省", url: "https://www.moj.go.jp/" }]), "2026-11-19");
  }
  prepare(sql: string) { return new Stmt(this.db, sql); }
  async batch(stmts: Stmt[]) { const out = []; for (const s of stmts) out.push(await s.all()); return out; }
  rows(where = "1=1") { return this.db.prepare(`SELECT * FROM ask_log WHERE ${where}`).all() as any[]; }
}

function setup(opts: { gen?: unknown; ver?: unknown; aiError?: boolean; vars?: Record<string, string> } = {}) {
  const DB = new FakeD1();
  const calls: string[] = [];
  const AI = {
    async run(model: string) {
      calls.push(model);
      if (opts.aiError) throw new Error("secret-internal-detail");
      if (model.includes("bge-m3")) return { data: [[0.1, 0.2]] };
      const out = model.includes("llama-4-scout") ? (opts.ver ?? { ok: true, reason: "" }) : (opts.gen ?? GOOD);
      return { response: JSON.stringify(out), usage: { prompt_tokens: 1000, completion_tokens: 100 } };
    },
  };
  const VECTORIZE = { async query() { return { matches: [{ id: "A-1", score: 0.81 }] }; } };
  const waits: Promise<unknown>[] = [];
  const env = { DB, AI, VECTORIZE, ...opts.vars } as any;
  const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) } as any;
  const post = async (body: unknown, o: { headers?: Record<string, string>; url?: string; ip?: string } = {}) => {
    const r = await worker.fetch(
      new Request(o.url ?? "https://bot.example/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": o.ip ?? "203.0.113.9", ...o.headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      env,
      ctx,
    );
    await Promise.all(waits);
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  };
  return { DB, calls, post, env, ctx };
}

test("答えられる質問：公開の応答は画面が使うものだけ", async () => {
  const t = setup();
  const r = await t.post({ q: "出生届はいつまで？" });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["candidates", "faq", "mode", "quotes", "summary"]);
  assert.equal(r.body.mode, "answer");
  assert.equal(r.body.faq.links[0].url, "https://www.moj.go.jp/");
  const [row] = t.DB.rows();
  assert.equal(row.mode, "answer");
  assert.ok(row.neurons > 0 && row.neurons !== 25);
  assert.notEqual(row.ip_hash, "203.0.113.9");
});

test("照合や検証に落ちた要約は、公開の応答に出さない", async () => {
  for (const o of [{ gen: { ...GOOD, summary: "14日以内に申請します。" } }, { ver: { ok: false, reason: "条件を落とした" } }, { gen: { ...GOOD, quotes: "配列でない" } }]) {
    const t = setup(o);
    const r = await t.post({ q: "出生届はいつまで？" });
    assert.equal(r.body.mode, "faq_only");
    assert.deepEqual(Object.keys(r.body).sort(), ["candidates", "faq", "mode"]);
    assert.ok(JSON.parse(t.DB.rows()[0].detail).reason); // 理由は記録にだけ残る
  }
});

test("AI が落ちても、中身の文言を外に出さない", async () => {
  const t = setup({ aiError: true });
  const r = await t.post({ q: "出生届はいつまで？" });
  assert.equal(r.body.mode, "unavailable");
  assert.ok(!JSON.stringify(r.body).includes("secret-internal-detail"));
  assert.match(JSON.parse(t.DB.rows()[0].detail).reason, /secret-internal-detail/);
});

test("本文：JSON 以外・他サイトから・大きすぎ・形が違うものは、モデルを呼ばずに断る", async () => {
  const t = setup();
  assert.equal((await t.post({ q: "a" }, { headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await t.post({ q: "a" }, { headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await t.post({ q: "a" }, { headers: { origin: "https://bot.example" } })).status, 200);
  assert.equal((await t.post({ q: "あ".repeat(5000) })).status, 413);
  for (const bad of ["null", "[1]", "{", '{"q":123}', '{"q":"   "}']) assert.equal((await t.post(bad)).status, 400, bad);
  assert.equal(t.DB.rows().length, 1);
  const get = await worker.fetch(new Request("https://bot.example/api/ask"), t.env, t.ctx);
  assert.equal(get.status, 405);
});

test("質問は 300 字で切る", async () => {
  const t = setup();
  await t.post({ q: "あ".repeat(400) });
  assert.equal(t.DB.rows()[0].question.length, 300);
});

test("1つの IP は1時間に 20 問まで。同時に送っても越えない", async () => {
  const t = setup();
  const rs = await Promise.all(Array.from({ length: PER_IP_HOUR + 10 }, () => t.post({ q: "出生届はいつまで？" })));
  assert.equal(rs.filter((r) => r.status === 200).length, PER_IP_HOUR);
  assert.equal(rs.filter((r) => r.status === 429).length, 10);
  assert.equal(t.DB.rows().length, PER_IP_HOUR); // 断った分は残さない
  assert.equal((await t.post({ q: "別の IP" }, { ip: "198.51.100.7" })).status, 200);
  // IPv6 は同じ /64 なら同じ人として数える
  for (let i = 0; i < PER_IP_HOUR; i++) await t.post({ q: "v6" }, { ip: `2001:db8:1:2::${i + 1}` });
  assert.equal((await t.post({ q: "v6" }, { ip: "2001:db8:1:2:ffff::1" })).status, 429);
});

test("1日の neurons の上限を超えたら検索だけ（生成モデルを呼ばない）", async () => {
  const t = setup();
  t.DB.db.prepare("INSERT INTO ask_log (question, top_ids, top_scores, mode, neurons) VALUES ('x','[]','[]','answer',?)").run(DAILY_NEURONS);
  const r = await t.post({ q: "出生届はいつまで？" });
  assert.equal(r.body.mode, "search_only");
  assert.deepEqual(t.calls, ["@cf/baai/bge-m3"]);
});

test("1日の質問数の上限を超えたら、検索もせずに unavailable", async () => {
  const t = setup();
  const ins = t.DB.db.prepare("INSERT INTO ask_log (question, top_ids, top_scores, mode, neurons) VALUES ('x','[]','[]','refuse',0)");
  for (let i = 0; i < DAILY_ASKS; i++) ins.run();
  const r = await t.post({ q: "出生届はいつまで？" });
  assert.equal(r.body.mode, "unavailable");
  assert.deepEqual(t.calls, []);
});

test("手元の計測用の口は、ホスト名が localhost でも LOCAL_EVAL が無ければ開かない", async () => {
  const t = setup();
  const embed = await worker.fetch(new Request("http://localhost/embed", { method: "POST", body: '{"text":["a"]}' }), t.env, t.ctx);
  assert.equal(embed.status, 404);
  const r = await t.post({ q: "出生届はいつまで？", gen: "@cf/expensive/model" }, { url: "http://localhost/api/ask" });
  assert.ok(!("neurons" in r.body));
  assert.ok(!t.calls.includes("@cf/expensive/model"));

  // LOCAL_EVAL=1 でも、公開のホスト名では開かない
  const pub = setup({ vars: { LOCAL_EVAL: "1" } });
  const r2 = await pub.post({ q: "出生届はいつまで？", gen: "@cf/expensive/model" });
  assert.ok(!pub.calls.includes("@cf/expensive/model"));
  assert.ok(!("neurons" in r2.body));
});

test("手元の計測（localhost ＋ LOCAL_EVAL=1）：モデルを差し替えられ、計測用の項目が返る", async () => {
  const t = setup({ vars: { LOCAL_EVAL: "1" } });
  const r = await t.post({ q: "出生届はいつまで？", gen: "@cf/zai-org/glm-4.7-flash" }, { url: "http://localhost:8787/api/ask" });
  assert.ok(t.calls.includes("@cf/zai-org/glm-4.7-flash"));
  for (const k of ["top_ids", "top_scores", "neurons", "question"]) assert.ok(k in r.body, k);
  const embed = await worker.fetch(new Request("http://localhost:8787/embed", { method: "POST", body: '{"text":["a"]}' }), t.env, t.ctx);
  assert.deepEqual((await embed.json() as any).data, [[0.1, 0.2]]);
});

test("同じ質問の2回目は使い回す（AI を呼ばず、1日の上限にも数えない）", async () => {
  const t = setup();
  const a = await t.post({ q: "出生届はいつまで？" });
  const before = t.calls.length;
  const b = await t.post({ q: " 出生届は いつまで? " }); // 空白・全角半角・末尾の記号の違いは同じ質問
  assert.equal(b.body.mode, "answer");
  assert.deepEqual(b.body, a.body);
  assert.equal(t.calls.length, before);
  const rows = t.DB.rows();
  assert.equal(rows.at(-1).neurons, 0);
  // 上限を超えた日でも、使い回しは返せる
  const ins = t.DB.db.prepare("INSERT INTO ask_log (question, top_ids, top_scores, mode, neurons) VALUES ('x','[]','[]','refuse',0)");
  for (let i = 0; i < DAILY_ASKS; i++) ins.run();
  assert.equal((await t.post({ q: "出生届はいつまで？" }, { ip: "198.51.100.8" })).body.mode, "answer");
});

test("1日の上限は vars で上げられる", async () => {
  const t = setup({ vars: { DAILY_NEURONS: "60000" } });
  t.DB.db.prepare("INSERT INTO ask_log (question, top_ids, top_scores, mode, neurons) VALUES ('x','[]','[]','answer',?)").run(DAILY_NEURONS);
  assert.equal((await t.post({ q: "出生届はいつまで？" })).body.mode, "answer");
});

test("上限の8割・10割に来たら LINE に1日1回ずつ知らせる（Secret が無ければ何もしない）", async () => {
  const sent: any[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response("{}"); }) as any;
  try {
    const t = setup({ vars: { LINE_CHANNEL_TOKEN: "tok", LINE_TO: "U123" } });
    t.DB.db.prepare("INSERT INTO ask_log (question, top_ids, top_scores, mode, neurons) VALUES ('x','[]','[]','answer',?)").run(DAILY_NEURONS * 0.85);
    await t.post({ q: "出生届はいつまで？" });
    await t.post({ q: "出生届の期限" });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, "https://api.line.me/v2/bot/message/push");
    assert.equal(sent[0].body.to, "U123");
    assert.match(sent[0].body.messages[0].text, /80%/);
    t.DB.db.prepare("INSERT INTO ask_log (question, top_ids, top_scores, mode, neurons) VALUES ('x','[]','[]','answer',?)").run(DAILY_NEURONS * 0.2);
    await t.post({ q: "出生届は何日以内" });
    assert.equal(sent.length, 2);
    assert.match(sent[1].body.messages[0].text, /100%/);

    const u = setup(); // Secret なし
    u.DB.db.prepare("INSERT INTO ask_log (question, top_ids, top_scores, mode, neurons) VALUES ('x','[]','[]','answer',?)").run(DAILY_NEURONS);
    await u.post({ q: "出生届はいつまで？" });
    assert.equal(sent.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
