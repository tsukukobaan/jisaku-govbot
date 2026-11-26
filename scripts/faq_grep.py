"""FAQ keyword search helper for building test sets.

Usage:
  python scripts/faq_grep.py KW1 [KW2 ...]        # AND search (question+answer)
  python scripts/faq_grep.py -o KW1 KW2 ...       # OR search
  python scripts/faq_grep.py -q KW ...            # search question only
  python scripts/faq_grep.py -s ID [ID ...]       # show full FAQ
Options: -n N (max hits, default 15), -a (show answer snippet)
"""
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
FAQ = Path(__file__).resolve().parent.parent / "out" / "faq_clean.jsonl"


def load():
    with FAQ.open(encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def main(argv):
    mode_or = "-o" in argv
    q_only = "-q" in argv
    show = "-s" in argv
    snip = "-a" in argv
    n = 15
    if "-n" in argv:
        i = argv.index("-n")
        n = int(argv[i + 1])
        del argv[i : i + 2]
    kws = [a for a in argv if not a.startswith("-")]
    rows = load()
    if show:
        for r in rows:
            if r["id"] in kws or set(r.get("alias_ids", [])) & set(kws):
                print(f"=== {r['id']} [{r['area']}]\nQ: {r['question']}\nA: {r['answer_plain']}\n")
        return
    hits = []
    for r in rows:
        text = r["question"] if q_only else r["question"] + "\n" + r["answer_plain"]
        found = [k for k in kws if k in text]
        if (mode_or and found) or (not mode_or and len(found) == len(kws)):
            qhit = sum(k in r["question"] for k in kws)
            hits.append((len(found), qhit, r))
    hits.sort(key=lambda x: (-x[0], -x[1]))
    print(f"# {len(hits)} hits")
    for c, qh, r in hits[:n]:
        line = f"{r['id']} [{r['area']}] ({c}/{qh}) {r['question'][:80]}"
        if snip:
            line += "\n    A: " + r["answer_plain"][:160].replace("\n", " ")
        print(line)


if __name__ == "__main__":
    main(sys.argv[1:])
