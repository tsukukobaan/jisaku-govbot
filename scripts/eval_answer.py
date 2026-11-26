"""回答パイプラインを手元の wrangler dev（/api/ask）に流して、モデルごとの結果を数える。

前提：worker/ で `cp .dev.vars.example .dev.vars` のあと `npm run dev` が動いている。
使い方：.venv/Scripts/python scripts/eval_answer.py <生成モデル> <出力名> [--set pilot|all|sample] [--budget 4000]
  pilot  = 回答可の試行30問（A のうち source=pilot）
  sample = pilot30 ＋ FAQにない10 ＋ 意地悪10
  all    = 300問
  nta    = 国税庁タックスアンサーで答えられる問（out/testset_nta.jsonl）
  all+nta = 両方
neurons が --budget を超えたら止める（無料枠 1日 10,000 を守る）。結果は out/answers_<出力名>.jsonl
"""
import argparse, json, sys, time, urllib.request
from collections import Counter
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
OUT = Path(__file__).resolve().parent.parent / "out"
load = lambda p: [json.loads(l) for l in (OUT / p).read_text(encoding="utf-8").splitlines() if l.strip()]

ap = argparse.ArgumentParser()
ap.add_argument("gen"); ap.add_argument("name")
ap.add_argument("--ver", default=None)
ap.add_argument("--set", default="sample", choices=["pilot", "sample", "all", "nta", "all+nta"])
ap.add_argument("--budget", type=float, default=4000)
ap.add_argument("--qids", default="", help="カンマ区切りの qid だけ流す")
a = ap.parse_args()

A = load("testset_answerable.jsonl"); U = load("testset_unanswerable.jsonl"); X = load("testset_adversarial.jsonl")
pilot = [r for r in A if r["source"] == "pilot"]
T = load("testset_nta.jsonl") if (OUT / "testset_nta.jsonl").exists() else []  # 国税庁タックスアンサーで答えられる問（#3）
tests = {"pilot": pilot, "sample": pilot + U[::6] + X[::4], "all": A + U + X, "nta": T, "all+nta": A + U + X + T}[a.set]
if a.qids:
    want = a.qids.split(","); allt = {t["qid"]: t for t in A + U + X + T}; tests = [allt[q] for q in want]
alias = {}
for r in [x for f in ("faq_clean.jsonl", "faq_nta.jsonl") if (OUT / f).exists() for x in load(f)]:
    for i in [r["id"]] + r["alias_ids"]:
        alias[i] = r["id"]

path = OUT / f"answers_{a.name}.jsonl"
done = {json.loads(l)["qid"] for l in path.read_text(encoding="utf-8").splitlines()} if path.exists() else set()
spent = 0.0
with path.open("a", encoding="utf-8", newline="\n") as f:
    for t in tests:
        if t["qid"] in done:
            continue
        if spent > a.budget:
            print("budget reached", round(spent)); break
        body = {"q": t["user_question"], "gen": a.gen}
        if a.ver: body["ver"] = a.ver
        req = urllib.request.Request("http://localhost:8787/api/ask", data=json.dumps(body).encode(), headers={"content-type": "application/json"})
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                res = json.load(r)
        except Exception as e:
            res = {"mode": "error", "reason": str(e)}
        res["sec"] = round(time.time() - t0, 1)
        spent += res.get("neurons", 0)
        f.write(json.dumps({"qid": t["qid"], "type": t["type"], "gold_ids": t.get("gold_ids", []), "res": res}, ensure_ascii=False) + "\n")
        f.flush()
        print(t["qid"], res["mode"], (res.get("faq") or {}).get("id", ""), res.get("reason", "")[:40], flush=True)

rows = load(path.name)
c = Counter(); n = Counter()
for r in rows:
    m = r["res"]["mode"]; n[r["type"]] += 1
    if r["type"] == "answerable":
        gold = {alias.get(g, g) for g in r["gold_ids"]}
        fid = (r["res"].get("faq") or {}).get("id")
        c["answer_gold" if m == "answer" and fid in gold else "answer_other" if m == "answer" else m] += 1
    else:
        c[f"{r['type']}:{'answered' if m == 'answer' else 'held'}"] += 1
neu = [r["res"].get("neurons", 0) for r in rows]
sec = sorted(r["res"].get("sec", 0) for r in rows)
print(f"\n{a.name}  n={dict(n)}  {dict(c)}")
print(f"neurons 合計 {sum(neu):.0f}  1問平均 {sum(neu)/len(neu):.1f}   秒 中央 {sec[len(sec)//2]}")
