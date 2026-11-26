"""raw/faq.xlsx を整形して out/faq_clean.jsonl・out/stats.json・out/testset_answerable_seed.jsonl を作る。

使い方：.venv/Scripts/python scripts/build.py raw/faq.xlsx out
要るもの：openpyxl（requirements.txt）
"""
import sys, json, re, random, collections, hashlib
import openpyxl
src, out = sys.argv[1], sys.argv[2]
ws = openpyxl.load_workbook(src, read_only=True, data_only=True)["FAQ一覧"]
rows = []
for i, r in enumerate(ws.iter_rows(values_only=True)):
    if i == 0: continue
    r = [("" if v is None else str(v)).strip() for v in r[:4]]
    if not r[2] or r[0] == "EOF" or r[1] == "0": continue
    rows.append(r)
LINK = re.compile(r"<([^<>,]*),\s*(https?://[^<>\s]+)>")
URL = re.compile(r"https?://[^\s<>）)」]+")
recs, seen = [], {}
for fid, area, q, a in rows:
    key = (q, a)
    if key in seen:
        seen[key]["alias_ids"].append(fid); continue
    links = [{"label": m.group(1), "url": m.group(2)} for m in LINK.finditer(a)]
    urls = sorted(set(URL.findall(a)))
    plain = LINK.sub(lambda m: m.group(1) or m.group(2), a)
    rec = {"id": fid, "alias_ids": [], "area": area, "question": q, "answer": a, "answer_plain": plain,
           "links": links, "urls": urls, "as_of": "2026-11-19",
           "embed_text": f"分野: {area}\n問い: {q}\n回答: {plain}",
           "sha": hashlib.sha256((q + "\n" + a).encode()).hexdigest()[:12]}
    seen[key] = rec; recs.append(rec)
with open(f"{out}/faq_clean.jsonl", "w", encoding="utf-8") as f:
    for r in recs: f.write(json.dumps(r, ensure_ascii=False) + "\n")
area = collections.Counter(r["area"] for r in recs)
qdup = collections.Counter(r["question"] for r in recs)
stats = {"raw_real": len(rows), "unique": len(recs), "areas": area.most_common(),
         "same_q_diff_a": [q for q, c in qdup.items() if c > 1],
         "with_links": sum(1 for r in recs if r["urls"]),
         "embed_chars": sum(len(r["embed_text"]) for r in recs),
         "max_embed": max(len(r["embed_text"]) for r in recs),
         "over_1500": sum(1 for r in recs if len(r["embed_text"]) > 1500)}
json.dump(stats, open(f"{out}/stats.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps(stats, ensure_ascii=False)[:1800])
# stratified sample of 200 answerable (proportional, min 1 per area), seed fixed
random.seed(20261126)
N = 200; by = collections.defaultdict(list)
for r in recs: by[r["area"]].append(r)
alloc = {a: max(1, round(N * len(v) / len(recs))) for a, v in by.items()}
while sum(alloc.values()) > N:
    k = max(alloc, key=alloc.get); alloc[k] -= 1
while sum(alloc.values()) < N:
    k = max(alloc, key=lambda a: len(by[a]) / alloc[a]); alloc[k] += 1
sample = []
for a, v in by.items(): sample += random.sample(v, min(alloc[a], len(v)))
with open(f"{out}/testset_answerable_seed.jsonl", "w", encoding="utf-8") as f:
    for i, r in enumerate(sample):
        f.write(json.dumps({"qid": f"A{i+1:03d}", "type": "answerable", "gold_ids": [r["id"]] + r["alias_ids"], "area": r["area"],
                            "faq_question": r["question"], "user_question": None}, ensure_ascii=False) + "\n")
print("alloc", json.dumps(alloc, ensure_ascii=False))
pilot = random.sample(sample, 30)
for r in pilot: print(r["id"], "|", r["area"], "|", r["question"][:80])
