# 自作Govbot（非公式）

総務省が公開している「Govbot FAQ データ」（4,412件）を検索し、FAQ の原文を引用して答えるチャットボットです。個人が作った**非公式**のもので、総務省・デジタル庁とは関係ありません。

- 公開先：https://jisaku-govbot.yutaka-govbot.workers.dev/
- 答えは FAQ の引用と、その要約1文だけ。FAQ にないことには答えません
- 手続きは必ず公式の窓口で確かめてください。内容の正しさは保証しません

## 仕組み

Cloudflare の無料プラン（Workers・Workers AI・Vectorize・D1）だけで動きます。

1. 質問を bge-m3 で埋め込み、Vectorize で近い FAQ を5件とる
2. gemma-4 が「答えられるか・どの FAQ か・引用文・要約1文」を JSON で返す
3. コードで確かめる：引用が FAQ の原文に一字一句あるか、要約の数字が引用にあるか、要約に URL がないか
4. 別のモデル（llama-4-scout）が、要約と FAQ の食い違いを確かめる
5. 2〜4 のどこかで落ちたら、要約を出さずに FAQ の原文をそのまま見せる。リンクはモデルに書かせず、FAQ のデータから出す

使いすぎを防ぐため、1 IP 20問／時・1日 3,000問・1日 60,000 neurons の上限があります（`worker/wrangler.jsonc` の vars。vars が無いときは 700問・8,500 neurons）（超えたら検索だけ、または停止）。質問は D1 に記録します（IP はハッシュにして保存）。

| 場所 | 中身 |
|---|---|
| `worker/src/` | API（`pipeline.ts` 流れ・`checks.ts` 照合・`prompts.ts` 指示・`limits.ts` 制限と記録・`config.ts` 上限とモデル） |
| `worker/public/` | 画面（HTML・CSS・JS。ビルドなし） |
| `scripts/` | データの整形・埋め込み・評価（Python） |
| `raw/`・`out/` | 元データ、整形済みデータ、テスト300問、評価結果 |
| `docs/design.md` | 公開の設計と計測結果　／　`docs/notes.md` 作業メモ |

## 評価（2026-11-26・300問＝答えられる200／FAQにない60／意地悪40）

| 指標 | 結果 | 合格ライン |
|---|---|---|
| 誤答（引用元にない内容） | 5件 | 0件 |
| 正答率 | 90.5% | 85%以上 |
| 正しく答えなかった率（FAQにない＋意地悪） | 99.0% | 95%以上 |
| 検索の上位5件ヒット率 | 96.5% | 95%以上 |

誤答は合格ラインに届いていません。5件のうち4件は指示の修正で直りましたが、300問の測り直しはまだです。採点は別のモデルによる照合で、人の確認は終わっていません。詳しくは `docs/design.md`。

正答率を上げるためにやることは [docs/design.md](docs/design.md#正答率を上げるためにやること2026-11-26-時点の300問の結果から) に順番つきで書いています。

## 動かし方

Node.js 22.6 以上、Python 3.11 以上、Cloudflare のアカウント（Workers Free）が要ります。

```sh
# テスト（Cloudflare には何も送らない）
cd worker && npm install && npm test && npm run typecheck

# 評価：手元で Worker を立てて流す（Workers AI・Vectorize・D1 は本物を使い、無料枠を消費する）
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # macOS/Linux は .venv/bin/
cd worker && npm run dev                                                # 別の端末で。localhost だけ計測用の口が開く
.venv/Scripts/python scripts/eval_retrieval.py                          # 検索のヒット率（先に embed.py）
.venv/Scripts/python scripts/eval_answer.py @cf/google/gemma-4-26b-a4b-it 名前 --set all --budget 9000
.venv/Scripts/python scripts/score.py 名前 --packet                     # 採点用の束を作る → 採点 → score.py 名前
```

### デプロイ（自分のアカウントに置く場合）

```sh
cd worker
npx wrangler d1 create faq-db                 # 出た database_id を wrangler.jsonc に書く
npx wrangler vectorize create faq-bge-m3 --dimensions=1024 --metric=cosine
npx wrangler d1 migrations apply faq-db --remote
npm run dev                                   # 別の端末で
../.venv/Scripts/python ../scripts/embed.py && ../.venv/Scripts/python ../scripts/export_index.py
npx wrangler d1 execute faq-db --remote --file=../out/emb_faq_seed.sql
npx wrangler vectorize insert faq-bge-m3 --file=../out/emb_vectors.ndjson
npx wrangler secret put IP_SALT               # 任意：IP のハッシュに混ぜる塩
npx wrangler deploy
```

「超えたら止まるだけで請求は来ない」のは Workers Free のアカウントだけです。

## データの出典と利用条件

- 出典：総務省「Govbot FAQ データ」（令和8年11月19日時点）https://www.soumu.go.jp/main_content/001102261.xlsx
- `raw/faq.xlsx` は取得したままのファイル。`out/faq_clean.jsonl` などは**加工したもの**です（空行の除去、同じ問い・回答の統合、回答文中のリンクの分解）。`out/testset_*.jsonl` の質問文と `out/answers_*`・`out/grades_*` は、このリポジトリで作ったものです
- 総務省ウェブサイトの利用規約（公共データ利用規約 第1.0版）に従って使っています。再利用するときは、出典と加工したことを書き、総務省が作ったものと誤解される見せ方をしないでください
- 名前とキャラクターは独自のものです。公式のロゴ・キャラクター・画面は使っていません

## ライセンス

- コード：[MIT](LICENSE)
- FAQ データ（`raw/`・`out/`）：上の利用条件（総務省の公共データ利用規約）に従います
- キャラクターと画像（`assets/`・`worker/public/` の画像）：コードと同じく [MIT](LICENSE)
