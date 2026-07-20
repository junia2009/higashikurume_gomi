#!/usr/bin/env node
/*
 * csv2json.js — 東京都オープンデータカタログの東久留米市ごみ分別CSVを
 * data/items.json 形式へ変換する（手動実行）。
 *
 * 使い方:
 *   1) CSVを取得（プロキシ環境では手元で落として渡す）:
 *        curl -L -o tmp/garbage.csv \
 *          https://www.opendata.metro.tokyo.lg.jp/higashikurume/132225_higashikurumeshi_garbage_separate.csv
 *   2) 変換:
 *        node tools/csv2json.js tmp/garbage.csv > data/items.json
 *
 * 想定カラム（2023-06公開版で確認済み・11列）:
 *   全国地方公共団体コード, ID, 地方公共団体名, 地区名, ゴミの品目,
 *   ゴミの品目_カナ, ゴミの品目_英字, 分別区分, 注意点, 備考, 粗大ごみ回収料金
 *   ※注意点は全件空・粗大料金も全件空のため、説明文は「備考」を採用する。
 *
 * 文字コード: UTF-8（BOM可）を想定。Shift_JIS の場合は事前に iconv 等で変換する。
 */
"use strict";

const fs = require("fs");

// --- CSVパーサ（引用符・改行・エスケープ対応の最小実装） ---
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM 除去
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

// 分別区分（列の値）→ category enum。実CSVで確認した全11種を網羅。
const CATEGORY_EXACT = {
  "燃やせるごみ": "burnable",
  "燃やせないごみ": "non_burnable",
  "容器包装プラスチック": "plastic",
  "ペットボトル": "pet",
  "びん・缶": "bin_can",
  "紙類・布類": "paper_cloth",
  "有害ごみ": "hazardous",
  "小型家電回収ボックス": "small_appliance",
  "剪定枝": "pruned_branch",
  "粗大ごみ": "oversized",
  "収集しません": "not_collected"
};

// 表記揺れ用のフォールバック（将来の版で区分名が変わった場合の保険）
const CATEGORY_FUZZY = [
  [/容器包装|プラスチック製容器|プラ容器|容リ/, "plastic"],
  [/ペット|pet/i, "pet"],
  [/燃やせない|燃えない|不燃/, "non_burnable"],
  [/燃やせる|燃える|可燃/, "burnable"],
  [/有害/, "hazardous"],
  [/びん|ビン|瓶|缶|かん|カン/, "bin_can"],
  [/紙|布/, "paper_cloth"],
  [/小型家電/, "small_appliance"],
  [/剪定|枝/, "pruned_branch"],
  [/粗大|そだい/, "oversized"],
  [/収集しません|収集できない|収集不可|処理できない|適正処理困難|家電リサイクル/, "not_collected"]
];

function toCategory(raw) {
  const s = (raw || "").trim();
  if (CATEGORY_EXACT[s]) return CATEGORY_EXACT[s];
  for (const [re, cat] of CATEGORY_FUZZY) if (re.test(s)) return cat;
  return "unknown";
}

function katakanaToHiragana(s) {
  return s.normalize("NFKC").replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// カナ表記のゆらぎを吸収（半角ハイフンで書かれた電話番号などはそのまま）
function cleanNote(s) {
  return (s || "").trim().replace(/ー{2,}/g, "ー");
}

function col(header, name) {
  const idx = header.indexOf(name);
  return idx;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write("usage: node tools/csv2json.js <input.csv> > data/items.json\n");
    process.exit(1);
  }
  const rows = parseCSV(fs.readFileSync(file, "utf8"));
  if (rows.length < 2) { process.stderr.write("CSVに行がありません\n"); process.exit(1); }

  const header = rows[0];
  const cName = col(header, "ゴミの品目");
  const cYomi = col(header, "ゴミの品目_カナ");
  const cCat = col(header, "分別区分");
  const cBiko = col(header, "備考");
  const cChui = col(header, "注意点");
  if (cName === -1 || cCat === -1) {
    process.stderr.write("必須列（ゴミの品目 / 分別区分）が見つかりません。ヘッダー: " + JSON.stringify(header) + "\n");
    process.exit(1);
  }

  const items = [];
  const unknown = [];
  const seen = new Set();
  for (const r of rows.slice(1)) {
    const name = (r[cName] || "").trim();
    if (!name) continue;
    const category = toCategory(r[cCat]);
    if (category === "unknown") unknown.push(name + " (" + (r[cCat] || "").trim() + ")");
    // 注意点・備考の順で結合（実データでは備考のみ入る）
    const note = [cChui !== -1 ? r[cChui] : "", cBiko !== -1 ? r[cBiko] : ""]
      .map(cleanNote).filter(Boolean).join(" ");
    const yomi = cYomi !== -1 ? katakanaToHiragana((r[cYomi] || "").trim()) : "";
    const key = name + "|" + category;
    if (seen.has(key)) continue; // 完全重複は除去
    seen.add(key);
    items.push({ name, yomi, category, note });
  }

  if (unknown.length) {
    process.stderr.write("区分未判定 " + unknown.length + "件（unknown で出力）:\n  " + unknown.join("\n  ") + "\n");
  }

  const out = {
    version: new Date().toISOString().slice(0, 10),
    source: "東京都オープンデータカタログ「【東久留米市】ごみの分別方法一覧」",
    count: items.length,
    items
  };
  process.stdout.write(JSON.stringify(out, null, 1) + "\n");
  process.stderr.write("出力: " + items.length + "品目\n");
}

main();
