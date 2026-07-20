/*
 * 東久留米ごみナビ ロジック層（純関数のみ・DOM非依存）
 * ブラウザでは window.GomiLogic、Node では module.exports で公開。
 * テスト: node --test tools/logic.test.js
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.GomiLogic = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

  // 区分の表示名と色（カレンダー・チップで使用）
  const CATEGORIES = {
    burnable:      { label: "燃やせるごみ",          short: "燃やせる",   color: "#e05a3d" },
    non_burnable:  { label: "燃やせないごみ",        short: "燃やせない", color: "#3f72d9" },
    plastic:       { label: "容器包装プラスチック",  short: "プラ",       color: "#d6529e" },
    pet:           { label: "PETボトル",             short: "PET",        color: "#0ea5a5" },
    bin:           { label: "びん",                  short: "びん",       color: "#8257d6" },
    can:           { label: "缶",                    short: "缶",         color: "#c17d21" },
    paper:         { label: "紙類",                  short: "紙",         color: "#2fa060" },
    cloth:         { label: "布類",                  short: "布",         color: "#a06a52" },
    hazardous:     { label: "有害ごみ",              short: "有害",       color: "#caa400" },
    oversized:     { label: "粗大ごみ",              short: "粗大",       color: "#64748b" },
    not_collected: { label: "市で収集できないもの",  short: "収集不可",   color: "#94a3b8" },
    unknown:       { label: "分類不明",              short: "不明",       color: "#9aa0a6" }
  };

  /** ローカルタイムで YYYY-MM-DD */
  function toISODate(d) {
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  /** YYYY-MM-DD → ローカルタイムの Date（時刻 00:00） */
  function fromISODate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  /** 時刻を落とした Date を返す */
  function dateOnly(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  /**
   * 指定日の収集情報。
   * @returns {{categories: string[], noCollection: boolean, holiday: boolean, note: ?{date:string,text:string}}}
   */
  function categoriesOn(date, areaKey, schedule, special) {
    const area = schedule.areas[areaKey];
    if (!area) throw new Error("unknown area: " + areaKey);
    const iso = toISODate(date);
    const sp = special || {};
    const noCollection = (sp.no_collection || []).includes(iso);
    const holiday = (sp.holidays || []).includes(iso);
    const note = (sp.notes || []).find((n) => n.date === iso) || null;
    const weekly = area.weekly[WEEKDAY_KEYS[date.getDay()]] || [];
    return {
      categories: noCollection ? [] : weekly.slice(),
      noCollection,
      holiday,
      note
    };
  }

  /**
   * 次回収集日を算出（中核関数）。
   * @param {string} category  category enum
   * @param {string} areaKey   "east" | "west"
   * @param {Date}   fromDate  起点日
   * @param {object} schedule  schedule.json
   * @param {object} special   special_days.json
   * @param {object} [opts]    includeFromDate: 起点日当日を候補に含めるか（既定 true。8:30 以降は false を渡す）
   * @returns {?{date: Date, iso: string, daysFromNow: number, holiday: boolean, note: ?object}}
   */
  function nextCollectionDate(category, areaKey, fromDate, schedule, special, opts) {
    const o = opts || {};
    const base = dateOnly(fromDate);
    let d = o.includeFromDate === false ? addDays(base, 1) : base;
    // 週次スケジュール + 年末年始スキップなので 60 日先まで見れば必ず見つかる
    for (let i = 0; i < 60; i++) {
      const info = categoriesOn(d, areaKey, schedule, special);
      if (info.categories.indexOf(category) !== -1) {
        return {
          date: d,
          iso: toISODate(d),
          daysFromNow: Math.round((d - base) / 86400000),
          holiday: info.holiday,
          note: info.note
        };
      }
      d = addDays(d, 1);
    }
    return null;
  }

  /**
   * 検索用正規化: NFKC → 小文字 → カタカナをひらがなへ → 長音・中点・空白を除去
   */
  function normalize(s) {
    return String(s)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
      .replace(/[ー・･\s]/g, "");
  }

  /**
   * インクリメンタル検索。品目名と読みの部分一致。
   * 前方一致 → 出現位置 → 名前の短さ の順で並べる。
   */
  function searchItems(items, query, limit) {
    const q = normalize(query);
    if (!q) return [];
    const hits = [];
    for (const item of items) {
      const name = normalize(item.name);
      const yomi = normalize(item.yomi || "");
      const pos = Math.min(
        ...[name.indexOf(q), yomi.indexOf(q)].filter((p) => p !== -1).concat([Infinity])
      );
      if (pos === Infinity) continue;
      hits.push({ item, pos, len: name.length });
    }
    hits.sort((a, b) => a.pos - b.pos || a.len - b.len || a.item.name.localeCompare(b.item.name, "ja"));
    const max = limit || 50;
    return hits.slice(0, max).map((h) => h.item);
  }

  /** 日付の日本語表記: 7月21日(火) */
  function formatDateJa(d) {
    return (d.getMonth() + 1) + "月" + d.getDate() + "日(" + WEEKDAY_JA[d.getDay()] + ")";
  }

  /** 相対日ラベル: 今日 / 明日 / N日後 */
  function relativeLabel(daysFromNow) {
    if (daysFromNow === 0) return "今日";
    if (daysFromNow === 1) return "明日";
    return daysFromNow + "日後";
  }

  /** 8:30 の収集締切を過ぎているか */
  function isAfterCutoff(now) {
    return now.getHours() > 8 || (now.getHours() === 8 && now.getMinutes() >= 30);
  }

  /** 町名から地区キーを引く。見つからなければ null */
  function areaForTown(town, schedule) {
    for (const key of Object.keys(schedule.areas)) {
      if (schedule.areas[key].towns.indexOf(town) !== -1) return key;
    }
    return null;
  }

  return {
    WEEKDAY_KEYS,
    WEEKDAY_JA,
    CATEGORIES,
    toISODate,
    fromISODate,
    dateOnly,
    addDays,
    categoriesOn,
    nextCollectionDate,
    normalize,
    searchItems,
    formatDateJa,
    relativeLabel,
    isAfterCutoff,
    areaForTown
  };
});
