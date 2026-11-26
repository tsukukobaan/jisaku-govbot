"""FAQ とテスト質問を bge-m3 で埋め込み、out/emb_*.npy に保存する。

前提：worker/ で `cp .dev.vars.example .dev.vars` のあと `npm run dev` が動いている（/embed が Workers AI を呼ぶ）。
使い方：.venv/Scripts/python scripts/embed.py
"""
import json, sys, time, urllib.request
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
URL = "http://localhost:8787/embed"
BATCH = 50
EXCLUDE = {"Z-zz-999"}  # 選択肢の「この中にはない」。FAQ ではない


def embed(texts):
    req = urllib.request.Request(URL, data=json.dumps({"text": texts}).encode(), headers={"content-type": "application/json"})
    for i in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)["data"]
        except Exception as e:  # 一時的な失敗は少し待って再試行
            print("retry", i, e, file=sys.stderr); time.sleep(3 * (i + 1))
    raise RuntimeError("embed failed")


def run(name, items):
    path = OUT / f"emb_{name}.npy"
    if path.exists():
        print("skip", path.name); return
    vecs = []
    for i in range(0, len(items), BATCH):
        vecs += embed([t for _, t in items[i:i + BATCH]])
        print(name, min(i + BATCH, len(items)), "/", len(items), flush=True)
    np.save(path, np.asarray(vecs, dtype=np.float32))
    (OUT / f"emb_{name}_ids.json").write_text(json.dumps([k for k, _ in items], ensure_ascii=False), encoding="utf-8")
    print(name, "chars", sum(len(t) for _, t in items))


def load(p):
    return [json.loads(l) for l in (OUT / p).read_text(encoding="utf-8").splitlines() if l.strip()]


faq = [(r["id"], r["embed_text"]) for r in load("faq_clean.jsonl") if r["id"] not in EXCLUDE]
tests = [(r["qid"], r["user_question"]) for p in ("testset_answerable.jsonl", "testset_unanswerable.jsonl", "testset_adversarial.jsonl") for r in load(p)]
run("test", tests)
run("faq", faq)
