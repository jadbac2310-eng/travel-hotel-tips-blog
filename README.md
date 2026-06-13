# 旅とホテルのお役立ちガイド

Claude API（記事生成）と OpenAI API（画像生成）を使って、**毎日自動で「旅行・ホテルのお役立ち情報5選」記事を生成**する静的ブログです。GitHub Actions により日本時間の毎朝6時に記事が追加されます。

> 姉妹プロジェクト「[ゲームおすすめブログ](https://github.com/jadbac2310-eng/top5-game-recommend-blog)」と同じ仕組みで、**API キーも共通**で使えます。

## 仕組み

1. `used_topics.json` を読み込み、過去に扱った記事テーマと被らないようにする
2. **Claude API**（`claude-sonnet-4-6` + Web検索）で最新のお役立ち情報5選を生成
3. **OpenAI API**（`gpt-image-1`）でヒーロー画像を生成
4. `posts/YYYY-MM-DD.html` として記事を出力（meta description / OGP / JSON-LD 付き）
5. `index.html` の記事一覧に新しい記事を先頭追加
6. `used_topics.json` に今回の記事タイトルを追記
7. `robots.txt` / `sitemap.xml` を更新

各記事の「1番目と2番目の間」には、スマホゲーム「ぼくとネコ」のプロモカード（公式ストアバッジ付き）を掲載しています。

## ディレクトリ構成

```
.
├── generate.js                 # 記事生成スクリプト（Node.js / ESModules）
├── package.json
├── style.css                   # 明るい旅行系デザイン・レスポンシブ
├── index.html                  # 記事一覧ページ
├── used_topics.json            # 扱った記事テーマの一覧
├── posts/                      # 生成された記事HTML
├── assets/
│   ├── images/                 # 生成されたヒーロー画像
│   ├── banner-bokuneko.jpg     # 「ぼくとネコ」プロモバナー
│   ├── badge-app-store.svg     # App Store 公式バッジ
│   └── badge-google-play.svg   # Google Play 公式バッジ
└── .github/workflows/daily-post.yml
```

## ローカルでの実行

```bash
npm install

# API キーを .env に記入（ゲームブログと同じキーでOK / .env は .gitignore 済み）
cp .env.example .env
#  → .env を開いて ANTHROPIC_API_KEY と OPENAI_API_KEY を実際の値に置き換える

node --env-file=.env generate.js

# 日付を指定して生成することも可能
node --env-file=.env generate.js 2026-06-14
```

## GitHub Actions のセットアップ（重要）

GitHub Actions で自動実行するには、**このリポジトリにも** Secrets を登録する必要があります（姉妹プロジェクトと同じ値でOK）。

`リポジトリ > Settings > Secrets and variables > Actions > New repository secret` から、以下の2つを登録してください。

| Secret 名           | 内容                          |
| ------------------- | ----------------------------- |
| `ANTHROPIC_API_KEY` | Anthropic（Claude）の API キー |
| `OPENAI_API_KEY`    | OpenAI の API キー             |

また `Settings > Actions > General > Workflow permissions` を **Read and write permissions** にしてください（記事の自動コミットに必要）。

登録後、`.github/workflows/daily-post.yml` が毎日 **日本時間 6:00（UTC 21:00）** に実行され、生成した記事を自動コミット＆プッシュします。`Actions` タブから手動実行（`Run workflow`）も可能です。

## ライセンス

MIT
