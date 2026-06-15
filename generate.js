// 毎日「旅行・ホテルのお役立ち情報5選」の記事を自動生成するスクリプト
// 1. used_topics.json で被り防止
// 2. Claude API (web_search) で記事を生成
// 3. OpenAI API (gpt-image-1) でヒーロー画像を生成
// 4. posts/YYYY-MM-DD.html を出力
// 5. index.html に記事リンクを追記
// 6. used_topics.json を更新
// 7. SEO: robots.txt / sitemap.xml を生成（記事HTMLには meta description・OGP・JSON-LD を付与）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- パス定義 ----
const USED_TOPICS_PATH = path.join(__dirname, "used_topics.json");
const INDEX_PATH = path.join(__dirname, "index.html");
const POSTS_DIR = path.join(__dirname, "posts");
const IMAGES_DIR = path.join(__dirname, "assets", "images");
const ROBOTS_PATH = path.join(__dirname, "robots.txt");
const SITEMAP_PATH = path.join(__dirname, "sitemap.xml");

// 公開サイトの絶対URL（OGP・canonical・sitemap で使用。末尾スラッシュなし）
// 独自ドメインやリポジトリ名に合わせてここを書き換える。
const SITE_URL = "https://jadbac2310-eng.github.io/travel-hotel-tips-blog";
const SITE_NAME = "旅とホテルのお役立ちガイド";

// 自社アプリのプロモ（記事内 1番目と2番目の間に挿入） ※ゲームブログと共通バナー
const PROMO_BANNER = {
  image: "../assets/banner-bokuneko.jpg",
  title: "ぼくとネコ",
  alt: "ヤバかわ！がちんこRPG「ぼくとネコ」",
  genre: "ヤバかわ！がちんこRPG",
  platform: "iOS / Android",
  price: "基本プレイ無料（一部アイテム課金あり）",
  description:
    "移動時間やホテルでのスキマ時間にぴったり！かわいいネコたちと冒険する「オフェンス型タワーディフェンス」RPG。世界中で配信中の人気作です。",
  points: [
    "直感操作でサクサク遊べる、お手軽わくわくバトル",
    "キャラの組み合わせは自由自在！自分だけの編成でキャラメイク",
    "全国のプレイヤーとリアルタイム対戦も楽しめる",
  ],
  androidUrl:
    "https://play.google.com/store/apps/details?id=com.ignm.bokuneko.jp",
  iosUrl: "https://apps.apple.com/jp/app/id1262986572",
};

// ---- ユーティリティ ----
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toMetaDescription(str = "", max = 120) {
  const flat = String(str).replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

// 日本時間（JST）の YYYY-MM-DD を返す
function todayJST() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

// ---- 1. 被り防止：過去に扱ったテーマ一覧を読み込む ----
function loadUsedTopics() {
  if (!fs.existsSync(USED_TOPICS_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(USED_TOPICS_PATH, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// 記事データの構造化スキーマ（構造化フォールバックで使用）
const ARTICLE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    date: { type: "string" },
    thumbnail_prompt: { type: "string" },
    category: { type: "string" },
    lead: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          body: { type: "string" },
        },
        required: ["heading", "body"],
      },
    },
    summary: { type: "string" },
  },
  required: ["title", "thumbnail_prompt", "lead", "sections", "summary"],
};

// ---- 2. Claude API で記事を生成 ----
async function generateArticle(usedTopics, date) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = `あなたは日本語の旅行・ホテル情報ブログのライターです。
Web検索で最新情報を調べ、旅行やホテル滞在に役立つ「読み物」としてのブログ記事を作成してください。

必ず以下のJSON形式**のみ**で出力してください（前後に説明文やコードブロックの記号を付けないこと）:
{
  "title": "記事タイトル",
  "date": "${date}",
  "thumbnail_prompt": "ヒーロー画像用の英語画像生成プロンプト（旅行・ホテルの雰囲気。文字やロゴは入れない）",
  "category": "国内旅行 / 海外旅行 / ホテル活用 / 旅行準備 / 節約・お得 などの分類",
  "lead": "記事の導入文（150〜200文字。読者を引き込むリード文）",
  "sections": [
    {
      "heading": "小見出し",
      "body": "本文（2〜4文、200〜300文字程度。改行で段落を分けてもよい）"
    }
  ],
  "summary": "締めくくりの文（100文字程度）"
}

- sections は3〜5個程度。ランキングや番号付けではなく、自然な流れの読み物にすること。
- タイトルには「5選」「ランキング」「○選」など、番号・順位・リストを想起させる表現を使わないこと。読み物らしい自然なタイトルにすること。
- 旅行者・ホテル利用者が「明日から使える」具体的で実用的な内容にすること。
- 季節やトレンドも踏まえ、読者にとって新鮮な内容にすること。`;

  const usedList =
    usedTopics.length > 0
      ? usedTopics.map((t) => `- ${t}`).join("\n")
      : "（まだありません）";

  const userPrompt = `Web検索を使って、旅行・ホテルに関する最新のお役立ち情報を調べ、本日（${date}）付けの「お役立ち情報5選」記事を作成してください。

【重要】以下のテーマ（記事タイトル）は過去に扱い済みなので、内容が大きく被らないようにしてください:
${usedList}

国内・海外・ホテル活用・旅行準備・節約術など、幅広い切り口から、今おすすめできる実用的な情報を5つ選んでください。
最後はJSONのみで回答してください。`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 5,
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  // まずローカルで JSON 抽出を試み、失敗したら構造化フォールバックで確実に取得する
  let article;
  try {
    article = extractJson(text);
  } catch (err) {
    console.warn(
      `[2/7] JSON抽出に失敗（${err.message}）。構造化フォールバックを実行します...`
    );
    article = await structureArticle(anthropic, text);
  }
  article.date = article.date || date;
  return article;
}

// テキストから JSON 部分を抽出してパースする（崩れていれば軽微な補修を試みる）
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Claude の応答から JSON を抽出できませんでした:\n" + text);
  }
  const jsonStr = candidate.slice(start, end + 1);
  try {
    return JSON.parse(jsonStr);
  } catch {
    return JSON.parse(repairJson(jsonStr));
  }
}

// よくある JSON の崩れを補修する（文字列内の生の制御文字をエスケープ、末尾カンマ除去）
function repairJson(s) {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (inStr) {
      if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else out += ch;
      continue;
    }
    out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

// 構造化フォールバック：ツール出力を強制し、必ず妥当な JSON オブジェクトを得る
async function structureArticle(anthropic, draft) {
  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    tools: [
      {
        name: "emit_article",
        description: "記事データを指定スキーマで構造化して出力する",
        input_schema: ARTICLE_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "emit_article" },
    messages: [
      {
        role: "user",
        content: `次の記事ドラフトを、ツール emit_article の入力として正確に構造化してください。内容は変えず、3〜5個の sections を含めてください。\n\n---\n${draft}`,
      },
    ],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block) {
    throw new Error("構造化フォールバックでツール出力が得られませんでした。");
  }
  return block.input;
}

// ---- 3. OpenAI API でヒーロー画像を生成 ----
async function generateThumbnail(prompt, date) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const result = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1536x1024",
    n: 1,
  });

  const b64 = result.data[0].b64_json;
  ensureDir(IMAGES_DIR);
  const imagePath = path.join(IMAGES_DIR, `${date}.png`);
  fs.writeFileSync(imagePath, Buffer.from(b64, "base64"));

  return `../assets/images/${date}.png`;
}

// 構造化データ(JSON-LD)：ブログ記事の Article
function buildJsonLd(article, date, pageUrl, imageUrl, description) {
  const graph = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: article.title,
    description,
    image: imageUrl,
    datePublished: date,
    dateModified: date,
    inLanguage: "ja",
    articleSection: article.category || "旅行・ホテル",
    mainEntityOfPage: { "@type": "WebPage", "@id": pageUrl },
    publisher: { "@type": "Organization", name: SITE_NAME },
  };
  return JSON.stringify(graph, null, 2).replace(/</g, "\\u003c");
}

// 自社アプリのシンプルなバナー（画像＋ストアバッジのみ。記事の邪魔をしない）
function buildPromoCard() {
  return `
      <aside class="promo-simple" aria-label="広告：${escapeHtml(PROMO_BANNER.title)}">
        <span class="promo-tag">PR</span>
        <img class="promo-image" src="${PROMO_BANNER.image}" alt="${escapeHtml(
    PROMO_BANNER.alt
  )}" loading="lazy" />
        <div class="store-buttons">
          <a class="store-btn" href="${PROMO_BANNER.iosUrl}" target="_blank" rel="noopener sponsored">
            <img class="store-badge" src="../assets/badge-app-store.svg" alt="App Store からダウンロード" />
          </a>
          <a class="store-btn" href="${PROMO_BANNER.androidUrl}" target="_blank" rel="noopener sponsored">
            <img class="store-badge" src="../assets/badge-google-play.svg" alt="Google Play で手に入れよう" />
          </a>
        </div>
      </aside>`;
}

// ---- 4. 記事HTMLの生成 ----
function buildArticleHtml(article, imageRelPath, date) {
  // 本文を改行で段落に分割
  const paragraphs = (body) =>
    String(body || "")
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `        <p>${escapeHtml(p)}</p>`)
      .join("\n");

  const blocks = (article.sections || []).map(
    (s) => `
      <section class="post-section">
        <h2 class="section-heading">${escapeHtml(s.heading)}</h2>
${paragraphs(s.body)}
      </section>`
  );

  // 最初のセクションの直後に自社アプリのプロモカードを挿入
  if (blocks.length >= 1) {
    blocks.splice(1, 0, buildPromoCard());
  }
  const sectionsHtml = blocks.join("\n");

  const lead = article.lead
    ? `      <p class="post-lead">${escapeHtml(article.lead)}</p>\n`
    : "";

  const description = toMetaDescription(
    article.lead ||
      article.summary ||
      (article.sections || []).map((s) => s.heading).join("、")
  );
  const pageUrl = `${SITE_URL}/posts/${date}.html`;
  const imageUrl = `${SITE_URL}/assets/images/${date}.png`;
  const jsonLd = buildJsonLd(article, date, pageUrl, imageUrl, description);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(article.title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(pageUrl)}" />

  <!-- Open Graph -->
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />
  <meta property="og:title" content="${escapeHtml(article.title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(pageUrl)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="article:published_time" content="${escapeHtml(date)}" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(article.title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../style.css" />

  <script type="application/ld+json">
${jsonLd}
  </script>
</head>
<body>
  <header class="hero">
    <img class="hero-image" src="${escapeHtml(imageRelPath)}" alt="${escapeHtml(article.title)}" />
    <div class="hero-overlay">
      <h1 class="hero-title">${escapeHtml(article.title)}</h1>
      <p class="hero-date">${escapeHtml(date)}${article.category ? "　|　" + escapeHtml(article.category) : ""}</p>
    </div>
  </header>

  <main class="container">
    <a class="back-link" href="../index.html">&larr; 記事一覧へ戻る</a>

    <article class="post">
${lead}${sectionsHtml}
    </article>

    <section class="summary">
      <p>${escapeHtml(article.summary)}</p>
    </section>

    <a class="back-link" href="../index.html">&larr; 記事一覧へ戻る</a>
  </main>

  <footer class="site-footer">
    <p>&copy; ${new Date().getFullYear()} ${escapeHtml(SITE_NAME)}</p>
  </footer>
</body>
</html>
`;
}

function saveArticleHtml(html, date) {
  ensureDir(POSTS_DIR);
  const filePath = path.join(POSTS_DIR, `${date}.html`);
  fs.writeFileSync(filePath, html, "utf-8");
  return filePath;
}

// ---- 5. index.html の更新 ----
function indexLabel(article, date) {
  const [, m, d] = date.split("-");
  const md = `${Number(m)}/${Number(d)}`;
  return `${md} ${article.title}`;
}

function updateIndex(article, date) {
  const label = indexLabel(article, date);
  const link = `<li><a href="posts/${date}.html">${escapeHtml(label)}</a></li>`;

  let html = fs.readFileSync(INDEX_PATH, "utf-8");
  if (html.includes(`posts/${date}.html`)) {
    return;
  }
  const marker = '<ul class="post-list">';
  if (html.includes(marker)) {
    html = html.replace(marker, `${marker}\n      ${link}`);
  } else {
    html = html.replace(
      "</main>",
      `  <ul class="post-list">\n      ${link}\n    </ul>\n  </main>`
    );
  }
  fs.writeFileSync(INDEX_PATH, html, "utf-8");
}

// ---- 6. used_topics.json の更新 ----
function updateUsedTopics(usedTopics, article) {
  const merged = [...usedTopics, article.title];
  fs.writeFileSync(
    USED_TOPICS_PATH,
    JSON.stringify(merged, null, 2) + "\n",
    "utf-8"
  );
}

// ---- 7. SEO: robots.txt / sitemap.xml の生成 ----
function writeRobots() {
  const body = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;
  fs.writeFileSync(ROBOTS_PATH, body, "utf-8");
}

function writeSitemap(today) {
  const urls = [{ loc: `${SITE_URL}/`, lastmod: today }];

  if (fs.existsSync(POSTS_DIR)) {
    const posts = fs
      .readdirSync(POSTS_DIR)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
      .sort()
      .reverse();
    for (const f of posts) {
      const d = f.replace(/\.html$/, "");
      urls.push({ loc: `${SITE_URL}/posts/${f}`, lastmod: d });
    }
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n  </url>`
  )
  .join("\n")}
</urlset>
`;
  fs.writeFileSync(SITEMAP_PATH, body, "utf-8");
}

// ---- メイン処理 ----
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("環境変数 ANTHROPIC_API_KEY が設定されていません。");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("環境変数 OPENAI_API_KEY が設定されていません。");
  }

  // 日付は通常 JST の本日。引数 or 環境変数で上書き可能（例: node generate.js 2026-06-12）
  const dateOverride = process.argv[2] || process.env.POST_DATE;
  if (dateOverride && !/^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) {
    throw new Error(`日付の形式が不正です（YYYY-MM-DD）: ${dateOverride}`);
  }
  const date = dateOverride || todayJST();
  console.log(`[1/7] 日付: ${date}${dateOverride ? "（指定）" : ""}`);

  const usedTopics = loadUsedTopics();
  console.log(`[1/7] 公開済み記事: ${usedTopics.length} 件`);

  console.log("[2/7] Claude API で記事を生成中...");
  const article = await generateArticle(usedTopics, date);
  console.log(`[2/7] 生成完了: ${article.title}`);

  console.log("[3/7] OpenAI API でヒーロー画像を生成中...");
  const imageRelPath = await generateThumbnail(article.thumbnail_prompt, date);
  console.log(`[3/7] 画像保存: assets/images/${date}.png`);

  console.log("[4/7] 記事HTMLを生成中...");
  const html = buildArticleHtml(article, imageRelPath, date);
  const articlePath = saveArticleHtml(html, date);
  console.log(`[4/7] 保存: ${path.relative(__dirname, articlePath)}`);

  console.log("[5/7] index.html を更新中...");
  updateIndex(article, date);

  console.log("[6/7] used_topics.json を更新中...");
  updateUsedTopics(usedTopics, article);

  console.log("[7/7] robots.txt / sitemap.xml を更新中...");
  writeRobots();
  writeSitemap(date);

  console.log("✅ 完了しました。");
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((err) => {
    console.error("❌ エラーが発生しました:", err);
    process.exit(1);
  });
}

export { buildArticleHtml, buildJsonLd, buildPromoCard, writeSitemap, writeRobots, toMetaDescription };
