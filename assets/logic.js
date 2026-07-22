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
  // 区分は東久留米市 公式ごみサク（東京都オープンデータ）の分別区分に準拠。
  // scheduled: 週次の固定収集日がある区分。guide: 収集日ではなく案内へ誘導する区分。
  const CATEGORIES = {
    burnable:        { label: "燃やせるごみ",         short: "燃やせる",   color: "#e0533d", kind: "scheduled" },
    non_burnable:    { label: "燃やせないごみ",       short: "燃やせない", color: "#3f6fd6", kind: "scheduled" },
    plastic:         { label: "容器包装プラスチック", short: "プラ",       color: "#d44f9a", kind: "scheduled" },
    pet:             { label: "ペットボトル",         short: "PET",        color: "#0ea3a0", kind: "scheduled" },
    bin:             { label: "びん",                 short: "びん",       color: "#8257d6", kind: "scheduled" },
    can:             { label: "缶",                   short: "缶",         color: "#c58a2a", kind: "scheduled" },
    paper_cloth:     { label: "紙類・布類",           short: "紙布",       color: "#2f9e5e", kind: "scheduled" },
    hazardous:       { label: "有害ごみ",             short: "有害",       color: "#9c8b12", kind: "scheduled" },
    small_appliance: { label: "小型家電回収ボックス", short: "小型家電",   color: "#5f7d99", kind: "guide" },
    pruned_branch:   { label: "剪定枝",               short: "剪定枝",     color: "#7d9440", kind: "guide" },
    oversized:       { label: "粗大ごみ",             short: "粗大",       color: "#6b7280", kind: "guide" },
    not_collected:   { label: "市では収集しません",   short: "収集不可",   color: "#97a2af", kind: "guide" },
    unknown:         { label: "分類不明",             short: "不明",       color: "#9aa0a6", kind: "guide" }
  };

  // 区分ごとの「主なもの」「出し方」（区分詳細ページで表示）。
  // 既存のごみ出しルール（8:30・有料指定袋・5袋制限・収集曜日など）から作成。
  const CATEGORY_INFO = {
    burnable: {
      main: "生ごみ、紙くず、革・ゴム製品、汚れの落ちないプラスチック、少量の木の枝など",
      howto: ["有料指定収集袋（燃やせるごみ用）に入れて出す", "収集日の朝8時30分までに戸別収集（自宅前）へ", "1世帯につき各曜日5袋まで"]
    },
    non_burnable: {
      main: "陶器・ガラス・金属類、小型家電（指定袋に入る大きさ）、刃物など",
      howto: ["有料指定収集袋（燃やせないごみ用）に入れて出す", "割れ物・刃物は紙に包み「キケン」と表示", "1世帯につき各曜日5袋まで"]
    },
    plastic: {
      main: "プラマークのある容器・包装（レジ袋、食品トレイ、ボトル・チューブ類、緩衝材など）",
      howto: ["中を軽くすすいで汚れを落とす", "汚れが落ちないものは燃やせるごみへ", "有料指定収集袋（プラ用）に入れて出す"]
    },
    pet: {
      main: "飲料・しょうゆ・酒などのPETボトル（PETマークのあるもの）",
      howto: ["キャップとラベルを外して容器包装プラスチックへ", "中をすすいで、つぶして出す"]
    },
    bin: {
      main: "飲食用のびん（ジュース・酒・調味料・ジャムなど）",
      howto: ["キャップを外して中をすすぐ", "燃やせるごみと同じ曜日に出す"]
    },
    can: {
      main: "飲食用の缶（アルミ缶・スチール缶）",
      howto: ["中を軽くすすいで出す", "紙類・布類と同じ曜日に出す"]
    },
    paper_cloth: {
      main: "新聞・雑誌・段ボール・紙パック・雑がみ、古着・タオルなどの布類",
      howto: ["種類ごとにひもで縛って出す", "紙類は雨天でも回収／布類は雨の日は出さない", "排出量の制限なし"]
    },
    hazardous: {
      main: "乾電池・ボタン電池、蛍光管、水銀体温計、ライター、スプレー缶など",
      howto: ["ほかのごみと混ぜず、透明な袋などで出す", "スプレー缶・ライターは使い切ってから", "燃やせないごみと同じ曜日に出す"]
    },
    small_appliance: {
      main: "携帯電話、デジタルカメラ、電卓、充電式電池など（指定の小型家電）",
      howto: ["市の小型家電回収ボックスへお持ちください", "個人情報はあらかじめ消去する"],
      link: { text: "回収ボックスの場所（市公式）", href: "https://www.city.higashikurume.lg.jp/kurashi/kankyo/shigen/gomishigen/index.html" }
    },
    pruned_branch: {
      main: "庭木の剪定で出た枝",
      howto: ["事前申込制（専用電話 042-473-2118）", "市の案内に従って出す"]
    },
    oversized: {
      main: "一辺が30cmを超える家具・家庭（電化）製品など",
      howto: ["電話またはインターネットで環境課ごみ減量推進係へ申し込む", "有料の粗大ごみ処理券を購入して貼る", "指定日の朝8時30分までに申込時の場所へ"],
      link: { text: "粗大ごみの申込（市公式）", href: "https://www.city.higashikurume.lg.jp/kurashi/kankyo/shigen/gomishigen/index.html" }
    },
    not_collected: {
      main: "家電リサイクル法対象品（テレビ・冷蔵庫・洗濯機・エアコン）、パソコン、消火器、タイヤ、バイクなど",
      howto: ["市では収集できません", "販売店・メーカー・専門業者へご相談ください"],
      link: { text: "出し方を調べる（ごみサク）", href: "https://www.gomisaku.jp/0069/" }
    },
    unknown: { main: "", howto: [] }
  };

  // 五十音の行（あ/か/さ/た/な/は/ま/や/ら/わ/#）を読みから判定
  const GOJUON_ROWS = [
    ["あ", "あいうえおぁぃぅぇぉゔ"],
    ["か", "かきくけこがぎぐげご"],
    ["さ", "さしすせそざじずぜぞ"],
    ["た", "たちつてとだぢづでどっ"],
    ["な", "なにぬねの"],
    ["は", "はひふへほばびぶべぼぱぴぷぺぽ"],
    ["ま", "まみむめも"],
    ["や", "やゆよゃゅょ"],
    ["ら", "らりるれろ"],
    ["わ", "わをんゎ"]
  ];
  const GOJUON_ORDER = GOJUON_ROWS.map((r) => r[0]).concat(["#"]);

  function gojuonRow(yomi) {
    const c = (yomi || "").charAt(0);
    for (const [row, chars] of GOJUON_ROWS) if (chars.indexOf(c) !== -1) return row;
    return "#"; // 数字・アルファベット・記号など
  }

  /**
   * 品目を五十音の行ごとにグループ化して返す。
   * @returns {{row: string, items: object[]}[]}  GOJUON_ORDER 順、空の行は除く
   */
  function groupByGojuon(items) {
    const map = {};
    for (const it of items) {
      const row = gojuonRow(it.yomi || it.name);
      (map[row] || (map[row] = [])).push(it);
    }
    return GOJUON_ORDER
      .filter((row) => map[row])
      .map((row) => ({
        row,
        items: map[row].sort((a, b) => (a.yomi || a.name).localeCompare(b.yomi || b.name, "ja"))
      }));
  }

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
    CATEGORY_INFO,
    GOJUON_ORDER,
    gojuonRow,
    groupByGojuon,
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
