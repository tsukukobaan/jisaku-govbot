"""最初の試行：話し言葉30問でのキーワード検索（文字 n-gram TF-IDF）の当たり具合と、「FAQにない」15問の確認。
out/testset_pilot.jsonl を書く。いまの計測は eval_retrieval.py（200問）。

使い方：.venv/Scripts/python scripts/pilot.py out
要るもの：scikit-learn・numpy（requirements.txt）
"""
import sys, json, re
from sklearn.feature_extraction.text import TfidfVectorizer
out = sys.argv[1]
recs = [json.loads(l) for l in open(f"{out}/faq_clean.jsonl", encoding="utf-8")]
P = [("C-h-85","保険証がなくなるって聞いたけど、70歳からもらう高齢受給者証もなくなるの？"),
("FS-B-c-2","NISAってどうやって始めればいいですか"),
("D-d-20","年金振込通知書っていうハガキが届いたんだけど、これ何？"),
("I-a-27","フリーランスでもキャリアアップ助成金の労働時間延長のコースは使えますか"),
("M-b-7","災害のとき外国語で防災や天気の情報を見られるサイトを知りたい"),
("C-g-3","出産育児一時金は産む前にもらうことはできる？"),
("D-d-08","自分の年金がいくらになるか確認したい"),
("NP-M-a-057","警察大学校って何をするところ？"),
("MJ-G-i-3","戸籍のフリガナの通知が来たけど、書いてある読み方と違う読み方で届けたい。何がいる？"),
("NP-B-a-031","会社で車を何台か使っている。安全運転管理者の届出はどんなとき必要？"),
("NP-A-a-085","免許証に旧姓を載せられますか"),
("A-b-29","子どもが海外に住んでいても児童手当はもらえる？"),
("I-a-66","キャリアアップ助成金を申請するときの必要書類を教えて"),
("NP-D-a-024","海外で犯罪に巻き込まれて亡くなった場合の弔慰金は、どんな被害が対象？"),
("D-b-22","支払基礎日数って何のこと？"),
("MC-D-0001","社会生活基本調査って昔からやってるの？"),
("NP-C-a-122","警備員の成績証明書をなくした。再交付はどこに申請する？"),
("D-h-04","年金の最新のお知らせはどこで見られますか"),
("D-d-34","夫が亡くなった。遺族年金は誰がもらえるの"),
("B-g-8","マイナ免許証にはどんな免許の情報が入るの？"),
("W-68","M&Aの支援機関の登録について聞きたい。窓口は？"),
("Q-9","アポスティーユを取りたい。どこに問い合わせればいい？"),
("NP-A-a-218","高齢の親の運転が心配。相談できるところはある？"),
("MC-D-0084","社会生活基本調査でなぜ持病のことまで聞かれるの？"),
("Z-a-3","行政相談月間って何ですか"),
("NP-D-a-127","電車で痴漢を見かけたらどうすればいい？"),
("MF-D-J-a-6","品種登録した人にはどんな権利があるの？"),
("B-c-37","マイナポータルで代理人ができることは何？"),
("B-b-45","マイナンバーカードの電子証明書の更新、家族が代わりに行ってもいい？"),
("MC-D-0042","社会生活基本調査で出した自分の回答を、見せてもらったり直してもらったりできる？")]
U = [("確定申告の締め切りはいつ？", r"確定申告.*(期限|いつまで|締め?切)"),
("パスポートの更新はどうやるの？", r"パスポート|旅券"),
("失業保険はいつからもらえる？", r"失業|雇用保険.*(受給|給付)|基本手当"),
("生活保護を申請したい", r"生活保護"),
("自動車税の支払い期限はいつ？", r"自動車税"),
("粗大ごみの出し方を教えて", r"粗大ごみ|粗大ゴミ"),
("インボイスの登録番号はどうやって取る？", r"インボイス|適格請求書"),
("奨学金の返済を減らしたい", r"奨学金"),
("相続税はいくらからかかる？", r"相続税"),
("ふるさと納税の上限額はいくら？", r"ふるさと納税.*(上限|限度)"),
("国民健康保険料は年収400万でいくら？", r"保険料.*(いくら|金額|計算)"),
("引っ越しの転出届はオンラインでできる？", r"転出届|引越し|引っ越し"),
("NHK受信料の免除を受けたい", r"受信料"),
("婚姻届に必要なものは？", r"婚姻届"),
("運転免許の更新を忘れた。どうすれば？", r"(免許|更新).*(失効|忘れ|過ぎ)")]
for q, pat in U:
    hits = [r for r in recs if re.search(pat, r["question"])]
    print("U", q, "| 問いヒット", len(hits), [h["id"] + ":" + h["question"][:28] for h in hits[:3]])
vec = TfidfVectorizer(analyzer="char", ngram_range=(1, 3), sublinear_tf=True)
X = vec.fit_transform([r["embed_text"] for r in recs])
Xq = TfidfVectorizer(analyzer="char", ngram_range=(1, 3), sublinear_tf=True, vocabulary=vec.vocabulary_)
ids = [[r["id"]] + r["alias_ids"] for r in recs]
import numpy as np
S = (vec.transform([q for _, q in P]) @ X.T).toarray()
res = {1: 0, 3: 0, 5: 0}; miss = []
for (gid, q), s in zip(P, S):
    top = np.argsort(-s)[:5]; rank = next((i for i, t in enumerate(top) if gid in ids[t]), None)
    for k in res:
        if rank is not None and rank < k: res[k] += 1
    if rank is None: miss.append((gid, q, recs[top[0]]["id"], recs[top[0]]["question"][:30]))
print("baseline hit@k (n=30):", res); print("miss:", miss)
with open(f"{out}/testset_pilot.jsonl", "w", encoding="utf-8") as f:
    for i, (gid, q) in enumerate(P): f.write(json.dumps({"qid": f"P{i+1:02d}", "type": "answerable", "gold_ids": [gid], "user_question": q}, ensure_ascii=False) + "\n")
