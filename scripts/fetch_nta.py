"""国税庁タックスアンサーの全ページを取ってくる（raw/nta/ に HTML を保存。取り直しは消してから）。

利用条件：公共データ利用規約（第1.0版）準拠（https://www.nta.go.jp/chuijiko/copy.htm・docs/sources.md）。
相手のサーバーに負担をかけないよう、1秒に1ページずつ取る。取ってあるページは飛ばす。
使い方：.venv/Scripts/python scripts/fetch_nta.py
"""
import re, sys, time, urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "raw" / "nta"
BASE = "https://www.nta.go.jp"
INDEX = BASE + "/taxes/shiraberu/taxanswer/code/index.htm"
UA = "jisaku-govbot-fetch/1.0 (+https://github.com/tsukukobaan/jisaku-govbot)"


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"user-agent": UA})
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:
            print("retry", i, url, e, file=sys.stderr)
            time.sleep(5 * (i + 1))
    raise RuntimeError(url)


DEST.mkdir(parents=True, exist_ok=True)
idx = get(INDEX).decode("utf-8", "ignore")
(DEST / "_index.htm").write_text(idx, encoding="utf-8")
paths = sorted(set(re.findall(r'href="(/taxes/shiraberu/taxanswer/[a-z_]+/\d+\.htm)"', idx)))
print("pages", len(paths))
for n, p in enumerate(paths, 1):
    f = DEST / p.split("/taxanswer/")[1].replace("/", "_")
    if f.exists():
        continue
    f.write_bytes(get(BASE + p))
    if n % 50 == 0:
        print(n, p, flush=True)
    time.sleep(1)
print("done")
