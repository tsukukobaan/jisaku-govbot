// モデルの出力をコードで確かめる部分。モデルも外部も呼ばない（test/checks.test.ts で確かめる）。

// 照合用の正規化：空白・改行を除き、全角英数を半角に
export function norm(s: string): string {
  return s
    .replace(/[\s　]/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// 数字（桁区切り・小数つき）と、単位が続く漢数字
const NUM = /[0-9０-９]+(?:[.,][0-9０-９]+)*|[一二三四五六七八九十百千万億]+(?=[円日年月歳か回人件割%％])/g;
const URL_LIKE = /https?:|www\.|\.go\.jp|\.com/i;

/**
 * 引用と要約を FAQ の原文と照らす。問題がなければ null、あれば理由を返す。
 * - 引用は1つ以上あり、どれも原文に一字一句ある
 * - 要約に URL がない（URL は FAQ の links からコードで出す）
 * - 要約の数字は、すべて引用の中にある
 */
export function checkQuotes(answerPlain: string, quotes: string[], summary: string): string | null {
  if (!quotes.length) return "引用がない";
  const body = norm(answerPlain);
  for (const q of quotes) if (!q.trim() || !body.includes(norm(q))) return `原文にない引用：${q.slice(0, 40)}`;
  if (URL_LIKE.test(summary)) return "要約に URL";
  const qs = norm(quotes.join(""));
  for (const n of norm(summary).match(NUM) ?? []) if (!qs.includes(n)) return `引用にない数字：${n}`;
  return null;
}
