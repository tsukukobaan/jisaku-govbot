// 実行：npm test（Node 22.6 以上。型は実行時に外すだけ）
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkQuotes, norm } from "../src/checks.ts";
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

test("ipBucket：IPv4 はそのまま、IPv6 は /64 にまとめる", () => {
  assert.equal(ipBucket("203.0.113.9"), "203.0.113.9");
  assert.equal(ipBucket("2001:db8:12:3400:aaaa:bbbb:cccc:dddd"), "2001:db8:12:3400::/64");
  assert.equal(ipBucket("2001:0db8:0012:3400::1"), "2001:db8:12:3400::/64");
  assert.equal(ipBucket("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(ipBucket("::1"), "0:0:0:0::/64");
});
