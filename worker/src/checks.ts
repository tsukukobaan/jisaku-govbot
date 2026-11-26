// モデルの出力をコードで確かめる部分。モデルも外部も呼ばない（test/checks.test.ts で確かめる）。

// 照合用の正規化：空白・改行を除き、全角英数を半角に
export function norm(s: string): string {
  return s
    .replace(/[\s　]/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// 数字（桁区切り・小数つき）と、単位が続く漢数字
const NUM = /[0-9０-９]+(?:[.,][0-9０-９]+)*|[一二三四五六七八九十百千万億]+(?=[円日年月歳か回人件割%％])/g;
// URL・メール・ドメインらしい塊（引用にそのままあるものは要約に書いてよい）
const URL_TOKEN = /[\w.@:/~%?=&+-]*(?:https?:|www\.|\.go\.jp|\.com)[\w.@:/~%?=&+-]*/gi;

/**
 * 引用と要約を FAQ の原文と照らす。問題がなければ null、あれば理由を返す。
 * - 引用は1つ以上あり、どれも原文に一字一句ある
 * - 要約に URL がない（URL は FAQ の links からコードで出す。引用にそのままある URL・メールは除く）
 * - 要約の数字は、すべて引用の中にある
 */
export function checkQuotes(answerPlain: string, quotes: string[], summary: string): string | null {
  if (!quotes.length) return "引用がない";
  const body = norm(answerPlain);
  for (const q of quotes) if (!q.trim() || !body.includes(norm(q))) return `原文にない引用：${q.slice(0, 40)}`;
  const qs = norm(quotes.join(""));
  for (const u of norm(summary).match(URL_TOKEN) ?? []) if (!qs.includes(u)) return "要約に URL";
  for (const n of norm(summary).match(NUM) ?? []) if (!qs.includes(n)) return `引用にない数字：${n}`;
  return null;
}

// 対象を絞る語。引用にあるのに要約に無ければ、条件を落として対象を広げたとみなす（A015 の型）。
// 「場合」は多すぎるので見ない（docs/design.md）。
const LIMITS: string[][] = [["のみ"], ["限る", "限り", "限ら", "限定"], ["除く", "除き", "除いて", "除外"], ["以外"], ["ただし", "但し"]];

/** 引用にある限定の語が要約から消えていれば、その語を返す。なければ null。 */
export function droppedLimit(quotes: string[], summary: string): string | null {
  const qs = norm(quotes.join("")), sm = norm(summary);
  for (const g of LIMITS) {
    const w = g.find((x) => qs.includes(x));
    if (w && !g.some((x) => sm.includes(x))) return w;
  }
  return null;
}

/** 要約の2文字の組のうち、引用にもあるものの割合（0〜1）。1 に近いほど引用をほぼそのまま写している。 */
export function overlap(summary: string, quotes: string[]): number {
  const pairs = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
  const a = pairs(norm(summary)), b = pairs(norm(quotes.join("")));
  if (!a.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / a.size;
}
