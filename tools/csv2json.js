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
 * CSVの実カラム構成は取得後に確認すること（§4.1）。本ツールはヘッダー名を
 * 緩く突き合わせて「品目名 / カナ / 分別区分 / 注意点」列を推定する。想定と
 * 違う場合は COLUMN_HINTS と区分マッピングを調整する。
 *
 * 文字コード: UTF-8 を想定。Shift_JIS の場合は事前に iconv 等で変換するか、
 *   iconv-lite を使う（本ツールは追加依存を持たない方針のため未対応）。
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
  // BOM 除去
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
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

// ヘッダー名 → 論理列 のヒント（部分一致・優先順）
const COLUMN_HINTS = {
  name:  ["品目", "名称", "item", "ごみの品目", "分別品目"],
  yomi:  ["カナ", "かな", "読み", "よみ", "kana", "ふりがな"],
  cat:   ["分別区分", "区分", "分別", "category", "出し方"],
  note:  ["注意", "備考", "ポイント", "note", "説明", "出し方のポイント"]
};

function findColumn(header, keys) {
  for (const key of keys) {
    const idx = header.findIndex((h) => h && h.replace(/\s/g, "").includes(key));
    if (idx !== -1) return idx;
  }
  return -1;
}

// 区分表記の揺れ → category enum。実CSVの表記を確認しつつ拡充する。
const CATEGORY_MAP = [
  [/(容器包装|プラスチック製容器|プラ容器|容リ)/, "plastic"],
  [/(ペット|pet)/i, "pet"],
  [/(燃やせないごみ|燃えないごみ|不燃)/, "non_burnable"],
  [/(燃やせるごみ|燃えるごみ|可燃)/, "burnable"],
  [/有害/, "hazardous"],
  [/(びん|ビン|瓶)/, "bin"],
  [/(缶|かん|カン)/, "can"],
  [/(紙類|古紙|紙)/, "paper"],
  [/(布類|古布|布)/, "cloth"],
  [/(粗大|そだい)/, "oversized"],
  [/(収集しません|収集できない|収集不可|市では収集|処理できない|適正処理困難|家電リサイクル)/, "not_collected"]
];

function toCategory(raw) {
  const s = (raw || "").trim();
  for (const [re, cat] of CATEGORY_MAP) {
    if (re.test(s)) return cat;
  }
  return "unknown";
}

function main() {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write("usage: node tools/csv2json.js <input.csv> > data/items.json\n");
    process.exit(1);
  }
  const text = fs.readFileSync(file, "utf8");
  const rows = parseCSV(text);
  if (rows.length < 2) { process.stderr.write("CSVに行がありません\n"); process.exit(1); }

  const header = rows[0];
  const col = {
    name: findColumn(header, COLUMN_HINTS.name),
    yomi: findColumn(header, COLUMN_HINTS.yomi),
    cat:  findColumn(header, COLUMN_HINTS.cat),
    note: findColumn(header, COLUMN_HINTS.note)
  };
  process.stderr.write("検出列: " + JSON.stringify(col) + " / ヘッダー: " + JSON.stringify(header) + "\n");
  if (col.name === -1 || col.cat === -1) {
    process.stderr.write("品目名または分別区分の列が見つかりません。COLUMN_HINTS を調整してください。\n");
    process.exit(1);
  }

  const items = [];
  const unknown = [];
  for (const r of rows.slice(1)) {
    const name = (r[col.name] || "").trim();
    if (!name) continue;
    const catRaw = col.cat !== -1 ? r[col.cat] : "";
    const category = toCategory(catRaw);
    if (category === "unknown") unknown.push(name + " (" + (catRaw || "").trim() + ")");
    items.push({
      name,
      yomi: col.yomi !== -1 ? katakanaToHiragana((r[col.yomi] || "").trim()) : "",
      category,
      note: col.note !== -1 ? (r[col.note] || "").trim() : ""
    });
  }

  if (unknown.length) {
    process.stderr.write("区分未判定 " + unknown.length + "件（unknown で出力）:\n  " + unknown.join("\n  ") + "\n");
  }

  const today = new Date().toISOString().slice(0, 10);
  const out = {
    version: today,
    source: "東京都オープンデータカタログ「【東久留米市】ごみの分別方法一覧」",
    items
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  process.stderr.write("出力: " + items.length + "品目\n");
}

function katakanaToHiragana(s) {
  return s.normalize("NFKC").replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

main();
