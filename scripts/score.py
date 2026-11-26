"""300問の結果を合格ラインで数える。

使い方：
  .venv/Scripts/python scripts/score.py <名前> --packet   … 採点用の束 out/grade_input_<名前>.jsonl を作る（回答した問だけ）
  .venv/Scripts/python scripts/score.py <名前>            … out/grades_<名前>.jsonl（採点結果）を読んで数える
採点結果の1行：{"qid":…, "supported": true|false, "answers_question": true|false, "note": "…"}
  supported        = 要約と引用の主張がすべて FAQ 原文にある（false が1件でもあれば「誤答」）
  answers_question = その FAQ がユーザーの質問に答えている（期待と別の FAQ でもよい）
"""
import json, sys
from collections import Counter
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
OUT = Path(__file__).resolve().parent.parent / "out"
load = lambda p: [json.loads(l) for l in (OUT / p).read_text(encoding="utf-8").splitlines() if l.strip()]
name = sys.argv[1]
rows = load(f"answers_{name}.jsonl")
tests = {r["qid"]: r for p in ("testset_answerable.jsonl", "testset_unanswerable.jsonl", "testset_adversarial.jsonl", "testset_nta.jsonl") if (OUT / p).exists() for r in load(p)}
faq = {r["id"]: r for f in ("faq_clean.jsonl", "faq_nta.jsonl") if (OUT / f).exists() for r in load(f)}  # 足した出典も引く
alias = {i: r["id"] for r in faq.values() for i in [r["id"]] + r["alias_ids"]}

if "--packet" in sys.argv:
    with (OUT / f"grade_input_{name}.jsonl").open("w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            s = r["res"]
            if s["mode"] != "answer":
                continue
            t = tests[r["qid"]]; fq = faq[s["faq"]["id"]]
            f.write(json.dumps({
                "qid": r["qid"], "type": r["type"], "user_question": t["user_question"],
                "expected": t.get("expected"), "test_note": t.get("note") or t.get("why_not"),
                "faq_id": fq["id"], "faq_question": fq["question"], "faq_answer": fq["answer_plain"],
                "quotes": s.get("quotes"), "summary": s.get("summary"),
            }, ensure_ascii=False) + "\n")
    print("packet", sum(1 for _ in open(OUT / f"grade_input_{name}.jsonl", encoding="utf-8")))
    sys.exit()

g = {r["qid"]: r for r in load(f"grades_{name}.jsonl")} if (OUT / f"grades_{name}.jsonl").exists() else {}
c = Counter(); wrong = []
for r in rows:
    s = r["res"]; m = s["mode"]; t = tests[r["qid"]]; gr = g.get(r["qid"])
    if m == "answer" and gr and not gr["supported"]:
        c["誤答"] += 1; wrong.append(r["qid"])
    if r["type"] == "answerable":
        gold = {alias.get(x, x) for x in r["gold_ids"]}
        c["hit5"] += bool(gold & {alias.get(x, x) for x in s.get("top_ids", [])})
        ok = m == "answer" and (s["faq"]["id"] in gold or (gr and gr["answers_question"])) and (not gr or gr["supported"])
        c["正答"] += bool(ok)
        c[f"A:{m}"] += 1
    else:
        # 答えてよい意地悪（前提の訂正・FAQの数字だけ）は、採点で支持・質問に答えていれば正しい
        okans = t.get("expected") in ("correct_premise", "answer_only_from_faq") and m == "answer" and gr and gr["supported"] and gr["answers_question"]
        c["正しく答えなかった"] += (m != "answer") or bool(okans)
        c[f"{'U' if r['type'] == 'unanswerable' else 'X'}:{m}"] += 1
nA = sum(r["type"] == "answerable" for r in rows); nN = len(rows) - nA
neu = sum(r["res"].get("neurons", 0) for r in rows)
print(f"{name}  回答可 {nA}  FAQにない＋意地悪 {nN}  採点済み {len(g)}")
print(f"  誤答                {c['誤答']} 件（合格 0）  {wrong}")
print(f"  正答率              {c['正答']/nA:.1%}（合格 85%以上）")
print(f"  正しく答えなかった率 {c['正しく答えなかった']/nN:.1%}（合格 95%以上）")
print(f"  上位5件ヒット率     {c['hit5']/nA:.1%}（合格 95%以上）")
print(f"  neurons 合計 {neu:.0f}  1問 {neu/len(rows):.1f}")
print("  内訳", {k: v for k, v in c.items() if ":" in k})
