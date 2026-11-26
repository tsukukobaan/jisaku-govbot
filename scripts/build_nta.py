"""raw/nta/ の国税庁タックスアンサーを、見出しごとの FAQ に分けて out/faq_nta.jsonl にする（形は out/faq_clean.jsonl と同じ）。

1ページは数千字あるので、そのまま候補に渡すと長すぎる。h2（概要・対象者・手続き など）ごとに分け、
長い h2 は h3 ごとに、それでも長いものは段落の切れ目で分ける。根拠法令・関連リンク・問い合わせ先は入れない。
ID は NTA-<コード>-<連番>。リンクの先頭はそのページ（出典の表示に使う）。
使い方：.venv/Scripts/python scripts/build_nta.py
"""
import hashlib, html, json, re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "raw" / "nta"
OUT = ROOT / "out" / "faq_nta.jsonl"
BASE = "https://www.nta.go.jp"
AREA = "税（国税庁タックスアンサー）"
SKIP = {"根拠法令等", "関連リンク", "関連コード", "お問い合わせ先", "対象税目", "QAリンク",
        "税の情報・手続・用紙", "サイトマップ（コンテンツ一覧）", "お問い合せ先", "根拠リンク"}  # 古い形のページのナビ
SPLIT_H2 = 700  # これより長い h2 は h3 ごとに分ける
MAX_CHUNK = 1200  # これより長い塊は段落の切れ目で分ける
ERA = {"令和": 2018, "平成": 1988}


def text_of(frag: str) -> str:
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", frag, flags=re.S)
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"</(p|li|tr|div|dt|dd|caption)>", "\n", s)
    s = re.sub(r"<(td|th)[^>]*>", " ｜ ", s)
    s = re.sub(r"<li[^>]*>", "・", s)
    s = html.unescape(re.sub(r"<[^>]+>", "", s))
    lines = [re.sub(r"[ \t　\xa0]+", " ", l).strip(" ｜") for l in s.splitlines()]
    return "\n".join(l for l in lines if l)


def links_of(frag: str) -> list[dict]:
    out = []
    for href, label in re.findall(r'<a [^>]*href="([^"#][^"]*)"[^>]*>(.*?)</a>', frag, re.S):
        url = href if href.startswith("http") else BASE + href if href.startswith("/") else None
        label = text_of(label)
        if url and label and url not in [l["url"] for l in out]:
            out.append({"label": label, "url": url})
    return out


def as_of(t: str) -> str:
    m = re.search(r"\[(令和|平成)(\d+|元)年(\d+)月(\d+)日現在法令等\]", t)
    if not m:
        return ""
    y = ERA[m.group(1)] + (1 if m.group(2) == "元" else int(m.group(2)))
    return f"{y}-{int(m.group(3)):02d}-{int(m.group(4)):02d}"


def pieces(body: str) -> list[str]:
    """長い本文を段落の切れ目で MAX_CHUNK 字以内に分ける。"""
    if len(body) <= MAX_CHUNK:
        return [body]
    out, cur = [], ""
    for line in body.split("\n"):
        if cur and len(cur) + len(line) + 1 > MAX_CHUNK:
            out.append(cur); cur = ""
        cur = f"{cur}\n{line}" if cur else line
    return out + ([cur] if cur else [])


def sections(content: str):
    """h2 ごとに (見出し, [(h3 見出し or "", 断片)]) を返す。"""
    parts = re.split(r"(<h2[^>]*>.*?</h2>)", content, flags=re.S)
    for i in range(1, len(parts), 2):
        h2 = text_of(parts[i])
        subs = re.split(r"(<h3[^>]*>.*?</h3>)", parts[i + 1], flags=re.S)
        items = [("", subs[0])] + [(text_of(subs[j]), subs[j + 1]) for j in range(1, len(subs), 2)]
        yield h2, items


recs = []
for f in sorted(SRC.glob("*.htm")):
    if f.name.startswith("_"):
        continue
    b = f.read_bytes()
    cs = re.search(rb"charset=[\"']?([\w-]+)", b[:2000])
    t = b.decode("cp932" if cs and cs.group(1).lower() in (b"shift_jis", b"sjis", b"x-sjis") else "utf-8", "ignore")  # 古いページは Shift_JIS
    m = re.search(r"<h1>(.*?)</h1>", t, re.S)
    if not m:
        print("no h1", f.name); continue
    title = re.sub(r"\s+", " ", text_of(m.group(1)))
    code = re.match(r"No\.(\d+)", title).group(1) if re.match(r"No\.(\d+)", title) else f.stem.split("_")[-1]
    cat, num = f.stem.rsplit("_", 1)
    page = f"{BASE}/taxes/shiraberu/taxanswer/{cat}/{num}.htm"
    start, end = t.find("</h1>"), t.find("contents-feedback")
    content = t[start:end if end > 0 else None]
    date = as_of(content) or "2026-04-01"
    zeimoku = ""
    chunks = []  # (見出し, 本文, 断片)
    for h2, items in sections(content):
        if h2 == "対象税目":
            zeimoku = text_of(items[0][1]).replace("\n", "・")
        if h2 in SKIP:
            continue
        whole = "\n".join((f"■{h3}\n" if h3 else "") + text_of(fr) for h3, fr in items).strip()
        frag_all = "".join(fr for _, fr in items)
        if len(whole) > SPLIT_H2 and len(items) > 1:
            lead = text_of(items[0][1])
            if len(lead) >= 200:  # 前置きが長ければ、それだけで1つにする（落とさない）
                chunks.append((h2, lead, items[0][1]))
            for h3, fr in items[1:]:
                body = ((lead + "\n") if lead and len(lead) < 200 else "") + text_of(fr)
                chunks.append((f"{h2}：{h3}", body, fr))
        elif whole:
            chunks.append((h2, whole, frag_all))
    n = 0
    for head, body, frag in chunks:
        for k, piece in enumerate(pieces(body)):
            if not piece.strip():
                continue
            n += 1
            q = f"{title}（{head}{'・続き' if k else ''}）"
            links = [{"label": f"国税庁 タックスアンサー {title}", "url": page}] + [l for l in links_of(frag) if l["url"] != page][:3]
            area = f"{AREA}・{zeimoku}" if zeimoku else AREA
            recs.append({
                "id": f"NTA-{code}-{n}", "alias_ids": [], "area": area, "question": q, "answer": piece, "answer_plain": piece,
                "links": links, "urls": [l["url"] for l in links], "as_of": date, "source": "nta", "page": page,
                "embed_text": f"分野: {area}\n問い: {q}\n回答: {piece}",
                "sha": hashlib.sha256((q + "\n" + piece).encode()).hexdigest()[:12],
            })

with OUT.open("w", encoding="utf-8", newline="\n") as w:
    for r in recs:
        w.write(json.dumps(r, ensure_ascii=False) + "\n")
L = sorted(len(r["answer_plain"]) for r in recs)
print("pages", len({r["page"] for r in recs}), "chunks", len(recs), "median", L[len(L) // 2], "p90", L[int(len(L) * 0.9)], "max", L[-1])
