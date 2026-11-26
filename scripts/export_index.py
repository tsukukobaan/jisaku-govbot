"""Vectorize と D1 に入れるファイルを作る（scripts/embed.py のあと）。

  out/emb_vectors.ndjson  … 1行 {"id", "values"}（bge-m3・1,024次元）
  out/emb_faq_seed.sql    … D1 の faq 表への INSERT
使い方：.venv/Scripts/python scripts/export_index.py [出力先（既定 out）] [出典（既定 faq。nta なら emb_nta_vectors.ndjson・emb_nta_seed.sql）]
入れ方は README.md の「デプロイ」。
"""
import json, sys
from pathlib import Path
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

OUT = Path(__file__).resolve().parent.parent / "out"
DEST = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT
SRC = sys.argv[2] if len(sys.argv) > 2 else "faq"
ids = json.loads((OUT / f"emb_{SRC}_ids.json").read_text(encoding="utf-8"))  # 索引に載せる FAQ（Z-zz-999 は embed.py で除いてある）
vecs = np.load(OUT / f"emb_{SRC}.npy")
faq = {r["id"]: r for r in map(json.loads, (OUT / ("faq_clean.jsonl" if SRC == "faq" else f"faq_{SRC}.jsonl")).read_text(encoding="utf-8").splitlines())}
PRE = "" if SRC == "faq" else f"{SRC}_"
sq = lambda s: "'" + s.replace("'", "''") + "'"

with (DEST / f"emb_{PRE}vectors.ndjson").open("w", encoding="utf-8", newline="\n") as f:
    for i, v in zip(ids, vecs):
        f.write(json.dumps({"id": i, "values": [round(float(x), 6) for x in v]}) + "\n")
with (DEST / f"emb_{PRE}faq_seed.sql").open("w", encoding="utf-8", newline="\n") as f:
    for i in ids:
        r = faq[i]
        cols = [r["id"], r["area"], r["question"], r["answer_plain"], json.dumps(r["links"], ensure_ascii=False), r["as_of"]]
        f.write(f"INSERT INTO faq VALUES({','.join(map(sq, cols))});\n")
print(len(ids), "件 →", DEST)
