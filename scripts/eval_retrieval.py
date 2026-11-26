"""検索の上位k件ヒット率を測る（埋め込み・キーワード・併用）。

前提：scripts/embed.py で out/emb_*.npy を作ってある。
使い方：.venv/Scripts/python scripts/eval_retrieval.py
"""
import json, sys
from pathlib import Path
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

sys.stdout.reconfigure(encoding="utf-8")
OUT = Path(__file__).resolve().parent.parent / "out"
load = lambda p: [json.loads(l) for l in (OUT / p).read_text(encoding="utf-8").splitlines() if l.strip()]

faq = {r["id"]: r for f in ("faq_clean.jsonl", "faq_nta.jsonl") if (OUT / f).exists() for r in load(f)}  # 足した出典も引く
fid = json.loads((OUT / "emb_faq_ids.json").read_text(encoding="utf-8"))
F = np.load(OUT / "emb_faq.npy")
if (OUT / "emb_nta.npy").exists():  # 足した出典も同じ索引にあるものとして測る
    fid += json.loads((OUT / "emb_nta_ids.json").read_text(encoding="utf-8"))
    F = np.vstack([F, np.load(OUT / "emb_nta.npy")])
F /= np.linalg.norm(F, axis=1, keepdims=True)
tid = json.loads((OUT / "emb_test_ids.json").read_text(encoding="utf-8"))
T = np.load(OUT / "emb_test.npy"); T /= np.linalg.norm(T, axis=1, keepdims=True)
tix = {q: i for i, q in enumerate(tid)}
names = [{fid[i]} | set(faq[fid[i]]["alias_ids"]) for i in range(len(fid))]

tests = {r["qid"]: r for p in ("testset_answerable.jsonl", "testset_unanswerable.jsonl", "testset_adversarial.jsonl", "testset_nta.jsonl") if (OUT / p).exists() for r in load(p)}
ans = [r for r in tests.values() if r["type"] == "answerable"]

dense = T @ F.T  # cos 類似度
vec = TfidfVectorizer(analyzer="char", ngram_range=(1, 3), sublinear_tf=True)
X = vec.fit_transform([faq[i]["embed_text"] for i in fid])
kw = (vec.transform([tests[q]["user_question"] for q in tid]) @ X.T).toarray()


def rrf(*mats, k=60):  # 順位の逆数の和で併用する
    s = np.zeros_like(mats[0])
    for m in mats:
        r = np.argsort(np.argsort(-m, axis=1), axis=1)
        s += 1.0 / (k + r + 1)
    return s


methods = {"keyword": kw, "dense": dense, "hybrid": rrf(dense, kw)}
print(f"答えられる {len(ans)} 問の上位k件ヒット率")
miss = []
for name, S in methods.items():
    hit = {1: 0, 3: 0, 5: 0, 10: 0}
    for r in ans:
        top = np.argsort(-S[tix[r["qid"]]])[:10]
        rank = next((j for j, t in enumerate(top) if names[t] & set(r["gold_ids"])), None)
        for k in hit:
            hit[k] += rank is not None and rank < k
        if name == "dense" and (rank is None or rank >= 5):
            miss.append((r["qid"], r["user_question"][:40], fid[top[0]], faq[fid[top[0]]]["question"][:30].replace("\n", " ")))
    print(f"  {name:8s}", "  ".join(f"@{k} {v/len(ans):.1%}" for k, v in hit.items()))
print("\n埋め込みで上位5件に入らなかった問：")
for m in miss:
    print("  ", *m)

print("\n埋め込みの1位の類似度（回答可否ゲートの手がかり）")
for typ in ("answerable", "unanswerable", "adversarial"):
    v = np.array([dense[tix[q]].max() for q, r in tests.items() if r["type"] == typ])
    print(f"  {typ:13s} n={len(v):3d}  p10 {np.percentile(v,10):.3f}  中央 {np.median(v):.3f}  p90 {np.percentile(v,90):.3f}")
