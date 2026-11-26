"""Vectorize と D1 に入れるファイルを作る（scripts/embed.py のあと）。

  out/emb_vectors.ndjson  … 1行 {"id", "values"}（bge-m3・1,024次元）
  out/emb_faq_seed.sql    … D1 の faq 表への INSERT
使い方：.venv/Scripts/python scripts/export_index.py [出力先（既定 out）]
入れ方は README.md の「デプロイ」。
"""
import json, sys
from pathlib import Path
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

OUT = Path(__file__).resolve().parent.parent / "out"
DEST = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT
ids = json.loads((OUT / "emb_faq_ids.json").read_text(encoding="utf-8"))  # 索引に載せる FAQ（Z-zz-999 は embed.py で除いてある）
vecs = np.load(OUT / "emb_faq.npy")
faq = {r["id"]: r for r in map(json.loads, (OUT / "faq_clean.jsonl").read_text(encoding="utf-8").splitlines())}
sq = lambda s: "'" + s.replace("'", "''") + "'"

with (DEST / "emb_vectors.ndjson").open("w", encoding="utf-8", newline="\n") as f:
    for i, v in zip(ids, vecs):
        f.write(json.dumps({"id": i, "values": [round(float(x), 6) for x in v]}) + "\n")
with (DEST / "emb_faq_seed.sql").open("w", encoding="utf-8", newline="\n") as f:
    for i in ids:
        r = faq[i]
        cols = [r["id"], r["area"], r["question"], r["answer_plain"], json.dumps(r["links"], ensure_ascii=False), r["as_of"]]
        f.write(f"INSERT INTO faq VALUES({','.join(map(sq, cols))});\n")
print(len(ids), "件 →", DEST)
