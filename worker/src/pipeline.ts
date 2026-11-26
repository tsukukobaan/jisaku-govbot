// 回答の流れ：埋め込み検索 → 生成（JSON）→ コードで照合 → 別モデルで検証。
// どこかで落ちたら、要約を出さずに FAQ の原文（faq_only）か「見つからない」（refuse）にする。

import { checkQuotes, droppedLimit, linkOnly, overlap } from "./checks.ts";
import { CONTACT_AREA, CONTACT_SCORE, DEFAULT_GEN, DEFAULT_VER, EMBED, MIN_SCORE, SEARCH_K, SKIP_VERIFY_OVERLAP, TOP_K, neurons, type Usage } from "./config.ts";
import { CONTACT_SCHEMA, CONTACT_SYSTEM, GEN_SCHEMA, GEN_SYSTEM, VER_SCHEMA, VER_SYSTEM } from "./prompts.ts";

type FaqRow = { id: string; area: string; question: string; answer_plain: string; links: string; as_of: string };
export type Link = { label: string; url: string };
export type PublicFaq = { id: string; area: string; question: string; answer: string; links: Link[]; as_of: string };
export type Mode = "answer" | "faq_only" | "refuse" | "search_only" | "unavailable";

export type AskResult = {
  question: string;
  top_ids: string[];
  top_scores: number[];
  candidates: PublicFaq[]; // 上位3件
  contact?: PublicFaq; // 「見つからない」ときに出す、いちばん近い窓口の案内
  contact_score?: number; // その類似度（記録と手元の計測用）
  mode: Mode;
  reason?: string; // answer 以外になった理由（記録と手元の計測用。公開の応答には出さない）
  faq?: PublicFaq;
  quotes?: string[];
  summary?: string;
  raw?: string; // 読めなかった生成の出力（手元の計測用）
  neurons: number;
};

const toPublic = (f: FaqRow): PublicFaq => ({
  id: f.id,
  area: f.area,
  question: f.question,
  answer: f.answer_plain,
  links: JSON.parse(f.links),
  as_of: f.as_of,
});

/** モデルに JSON を返させる。読めなければ data は null。 */
async function runJson(env: Env, model: string, system: string, user: string, schema: object) {
  const r: any = await env.AI.run(model as any, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: schema },
    max_tokens: 600,
    temperature: 0,
    ...(model.includes("gemma-4") ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  } as any);
  let raw = r?.response ?? r?.choices?.[0]?.message?.content ?? "";
  const usage: Usage | undefined = r?.usage;
  if (typeof raw !== "string") return { data: raw, usage, raw: JSON.stringify(raw) };
  raw = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const m = raw.match(/\{[\s\S]*\}/);
  try {
    return { data: m ? JSON.parse(m[0]) : null, usage, raw };
  } catch {
    return { data: null, usage, raw };
  }
}

export async function ask(env: Env, q: string, gen = DEFAULT_GEN, ver = DEFAULT_VER, searchOnly = false): Promise<AskResult> {
  // 検索
  const e: any = await env.AI.run(EMBED, { text: [q] });
  let spent = neurons(EMBED, { prompt_tokens: Math.ceil(q.length * 1.2) }); // 埋め込みは usage が無いので概算
  const res = await env.VECTORIZE.query(e.data[0], { topK: SEARCH_K });
  const all = res.matches.map((m) => m.id);
  const ids = all.slice(0, TOP_K);
  const scores = res.matches.slice(0, TOP_K).map((m) => Math.round(m.score * 1000) / 1000);

  const rows = all.length
    ? ((await env.DB.prepare(`SELECT * FROM faq WHERE id IN (${all.map(() => "?").join(",")})`).bind(...all).all<FaqRow>()).results ?? [])
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cands = ids.map((i) => byId.get(i)).filter((f): f is FaqRow => !!f);
  // 窓口の案内：上位 SEARCH_K 件のうち、いちばん近い「国等の相談窓口」（パスポート→外務省の案内など）
  // 名前が似ているだけの窓口（一般の受信料免除→飛行場周辺の受信料補助など）を出さないよう、類似度で絞ったあと生成モデルに選ばせる
  const contacts = res.matches.filter((m) => m.score >= CONTACT_SCORE && byId.get(m.id)?.area === CONTACT_AREA).slice(0, 3);
  const base = { question: q, top_ids: ids, top_scores: scores, candidates: cands.slice(0, 3).map(toPublic) };
  const done = (mode: Mode, rest: Partial<AskResult> = {}): AskResult => ({ ...base, mode, ...rest, neurons: spent });
  // 「答えられない」ときだけ、窓口の案内を選ぶ
  const refuse = async (reason: string): Promise<AskResult> => {
    if (!contacts.length) return done("refuse", { reason });
    const list = contacts.map((m) => byId.get(m.id)!).map((f) => `[ID] ${f.id}\n[窓口] ${f.question}\n[内容] ${f.answer_plain}`).join("\n\n");
    const c = await runJson(env, gen, CONTACT_SYSTEM, `質問：${q}\n\n窓口：\n${list}`, CONTACT_SCHEMA);
    spent += neurons(gen, c.usage);
    const m = contacts.find((x) => x.id === c.data?.contact_id);
    return done("refuse", { reason, ...(m ? { contact: toPublic(byId.get(m.id)!), contact_score: Math.round(m.score * 1000) / 1000 } : {}) });
  };

  if (!cands.length || scores[0] < MIN_SCORE) return done("refuse", { reason: "検索の類似度が低い" });
  if (searchOnly) return done("search_only", { reason: "今日の生成の上限に達した" });

  // 生成：答えられるか・どの FAQ・引用・要約1文
  const user = `質問：${q}\n\n候補：\n` + cands.map((f) => `[ID] ${f.id}\n[問い] ${f.question}\n[回答] ${f.answer_plain}`).join("\n\n");
  const g = await runJson(env, gen, GEN_SYSTEM, user, GEN_SCHEMA);
  spent += neurons(gen, g.usage);
  const d = g.data;
  if (!d || typeof d !== "object") return done("faq_only", { reason: "生成の JSON が読めない", raw: g.raw?.slice(0, 300) });
  if (!d.answerable) return refuse("生成モデルが答えられないと判定");
  const faq = byId.get(d.faq_id);
  if (!faq) return done("faq_only", { reason: `候補にない ID：${String(d.faq_id).slice(0, 40)}` });
  if (linkOnly(faq.answer_plain, JSON.parse(faq.links))) return done("faq_only", { faq: toPublic(faq), reason: "リンクだけの FAQ" });

  // コードで照合：引用は一字一句・数字は引用にある・URL なし
  const quotes: string[] = Array.isArray(d.quotes) ? d.quotes.filter((s: unknown) => typeof s === "string") : [];
  const summary: string = typeof d.summary === "string" ? d.summary : "";
  const picked = { faq: toPublic(faq), quotes, summary };
  const bad = checkQuotes(faq.answer_plain, quotes, summary);
  if (bad) return done("faq_only", { ...picked, reason: bad });
  const lost = droppedLimit(quotes, summary);
  if (lost) return done("faq_only", { ...picked, reason: `要約が条件を落とした：${lost}` });

  // 要約が引用をほぼそのまま写しているなら、検証モデルは呼ばない（検証が日本語を読み違えて落とす方が多い。docs/design.md）
  if (overlap(summary, quotes) >= SKIP_VERIFY_OVERLAP) return done("answer", picked);

  // 別モデルで検証：要約が FAQ と食い違わないか
  const v = await runJson(env, ver, VER_SYSTEM, `質問：${q}\n\nFAQ の問い：${faq.question}\nFAQ の回答：${faq.answer_plain}\n\n要約：${summary}`, VER_SCHEMA);
  spent += neurons(ver, v.usage);
  if (!v.data?.ok) return done("faq_only", { ...picked, reason: `検証で不合格：${v.data?.reason ?? "読めない"}` });

  return done("answer", picked);
}
