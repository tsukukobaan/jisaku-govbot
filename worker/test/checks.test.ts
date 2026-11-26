// 実行：npm test（Node 22.6 以上。型は実行時に外すだけ）
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkQuotes, droppedLimit, linkOnly, norm, overlap } from "../src/checks.ts";
import { ipBucket } from "../src/limits.ts";

const FAQ = "申請は、出生の日の翌日から15日以内に行ってください。\n手数料は１，０００円です（市区町村の窓口に限ります）。";

test("norm：空白・改行を除き、全角英数を半角にする", () => {
  assert.equal(norm(" Ａｂ１２　３\n４ "), "Ab1234");
  assert.equal(norm("１，０００円"), "1，000円"); // 全角の読点はそのまま
});

test("引用が原文に一字一句あれば通る（空白・改行・全角半角の違いは許す）", () => {
  assert.equal(checkQuotes(FAQ, ["申請は、出生の日の翌日から 15日以内に行ってください。"], "生まれた日の翌日から15日以内に申請します。"), null);
  assert.equal(checkQuotes(FAQ, ["15日以内に行ってください。 手数料は"], "15日以内です。"), null);
});

test("引用がない・空・原文にない引用は落とす", () => {
  assert.equal(checkQuotes(FAQ, [], "要約"), "引用がない");
  assert.match(checkQuotes(FAQ, ["  "], "要約")!, /原文にない引用/);
  assert.match(checkQuotes(FAQ, ["申請は14日以内に行ってください。"], "要約")!, /原文にない引用/);
  assert.match(checkQuotes(FAQ, ["申請は、15日以内に行ってください。"], "要約")!, /原文にない引用/); // つなぎ合わせ
});

test("要約の数字は引用の中になければ落とす", () => {
  const q = ["申請は、出生の日の翌日から15日以内に行ってください。"];
  assert.equal(checkQuotes(FAQ, q, "１５日以内に申請します。"), null); // 全角でも同じ数字
  assert.equal(checkQuotes(FAQ, q, "14日以内に申請します。"), "引用にない数字：14");
  // 原文にはあるが、引用に入れていない数字も落とす
  assert.match(checkQuotes(FAQ, q, "15日以内に申請し、手数料は1,000円です。")!, /引用にない数字/);
  // 単位が続く漢数字は数字として扱う。続かないもの（「一部」など）は扱わない
  assert.equal(checkQuotes(FAQ, q, "三日以内に申請します。"), "引用にない数字：三");
  assert.equal(checkQuotes(FAQ, q, "一部の人は15日以内に申請します。"), null);
});

test("要約に URL らしいものがあれば落とす", () => {
  const q = ["手数料は１，０００円です"];
  for (const s of ["詳しくは https://example.go.jp を見てください。", "www.example.jp を見てください。", "soumu.go.jp にあります。"])
    assert.equal(checkQuotes(FAQ, q, s), "要約に URL");
});

test("引用にそのままある URL・メールは要約に書いてよい", () => {
  const faq = "ドメイン（@myna.go.jp）が迷惑メールに指定されている可能性があります。";
  assert.equal(checkQuotes(faq, [faq], "@myna.go.jp が迷惑メールに指定されているかもしれません。"), null);
  assert.equal(checkQuotes(faq, [faq], "example.go.jp が迷惑メールに指定されているかもしれません。"), "要約に URL");
});

test("droppedLimit：引用の限定の語が要約から消えたら落とす", () => {
  const q = ["マイナ免許証のみを保有する方が対象です。"];
  assert.equal(droppedLimit(q, "住所変更の手続がワンストップでできます。"), "のみ");
  assert.equal(droppedLimit(q, "マイナ免許証のみを持つ方は、ワンストップでできます。"), null);
  assert.equal(droppedLimit(["土日を除き、受け付けます。"], "土日を除いて受け付けます。"), null); // 同じ組の別の形は通す
  assert.equal(droppedLimit(["窓口に限ります。"], "窓口でできます。"), "限り");
  assert.equal(droppedLimit(["申請できる場合があります。"], "申請できます。"), null); // 「場合」は見ない
});

test("overlap：引用をそのまま写した要約は 1、無関係なら 0 に近い", () => {
  assert.equal(overlap("登録料の納付は郵送でもかまいません。", ["登録料の納付は郵送でもかまいません。"]), 1);
  assert.ok(overlap("電子証明書の更新は可能です。", ["可能です。"]) < 0.5);
  assert.equal(overlap("", ["何か"]), 0);
});

test("ipBucket：IPv4 はそのまま、IPv6 は /64 にまとめる", () => {
  assert.equal(ipBucket("203.0.113.9"), "203.0.113.9");
  assert.equal(ipBucket("2001:db8:12:3400:aaaa:bbbb:cccc:dddd"), "2001:db8:12:3400::/64");
  assert.equal(ipBucket("2001:0db8:0012:3400::1"), "2001:db8:12:3400::/64");
  assert.equal(ipBucket("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(ipBucket("::1"), "0:0:0:0::/64");
});

test("linkOnly：短くてリンクの案内だけの本文", () => {
  const L = [{ label: "x", url: "https://example.go.jp/" }];
  assert.equal(linkOnly("下記をご参照ください。\nパスポートの申請事前準備をする", L), true);
  assert.equal(linkOnly("下記をご参照ください。", []), false); // リンクが無ければ違う
  assert.equal(linkOnly("申請は、出生の日の翌日から15日以内に行ってください。詳しくは下記をご覧ください。手数料は無料です。窓口でも受け付けます。", L), false);
});
