// node --test tools/logic.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const L = require("../assets/logic.js");
const schedule = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/schedule.json"), "utf8"));
const items = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/items.json"), "utf8")).items;

const special = {
  no_collection: ["2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"],
  holidays: ["2026-07-20"],
  notes: [{ date: "2026-07-20", text: "祝日: 広報要確認" }]
};

test("normalize: カタカナ・長音・空白・全角を同一視", () => {
  assert.strictEqual(L.normalize("ペットボトル"), L.normalize("ぺっとぼとる"));
  assert.strictEqual(L.normalize("ダンボール"), L.normalize("だんぼーる"));
  assert.strictEqual(L.normalize("スプレー かん"), L.normalize("すぷれーかん"));
  assert.strictEqual(L.normalize("ＰＥＴボトル"), L.normalize("petぼとる"));
  // 長音・中点・空白は落ちる（漢字はそのまま残る）
  assert.strictEqual(L.normalize("コー・ヒー 豆"), "こひ豆");
});

test("searchItems: 読みでもカタカナでも見つかる", () => {
  // ペットボトル系（品目名は「飲料容器（ペットボトル）」等）は pet に分類される
  const r1 = L.searchItems(items, "ぺっとぼとる");
  assert.ok(r1.length > 0);
  assert.ok(r1.some((i) => i.category === "pet"));
  // カタカナ入力でも同じ結果
  assert.deepStrictEqual(
    L.searchItems(items, "ペットボトル").map((i) => i.name),
    r1.map((i) => i.name)
  );
  const r3 = L.searchItems(items, "テレビ");
  assert.strictEqual(r3[0].name, "テレビ");
  assert.strictEqual(r3[0].category, "not_collected");
});

test("searchItems: 前方一致が先頭に来る", () => {
  const r = L.searchItems(items, "かん");
  assert.ok(L.normalize(r[0].name).startsWith("かん") || L.normalize(r[0].yomi).startsWith("かん"));
});

test("searchItems: 空クエリは空配列", () => {
  assert.deepStrictEqual(L.searchItems(items, "  "), []);
});

test("categoriesOn: 東地区の月曜はプラ+PET、西地区は燃やせる+びん", () => {
  const mon = new Date(2026, 6, 27); // 2026-07-27 (月)
  assert.deepStrictEqual(L.categoriesOn(mon, "east", schedule, special).categories, ["plastic", "pet"]);
  assert.deepStrictEqual(L.categoriesOn(mon, "west", schedule, special).categories, ["burnable"]);
});

test("categoriesOn: 資源物(びん・缶/紙・布)は東=木・西=金にまとまる", () => {
  const thu = new Date(2026, 6, 23); // 2026-07-23 (木)
  const fri = new Date(2026, 6, 24); // 2026-07-24 (金)
  assert.deepStrictEqual(L.categoriesOn(thu, "east", schedule, special).categories, ["bin_can", "paper_cloth"]);
  assert.deepStrictEqual(L.categoriesOn(fri, "west", schedule, special).categories, ["bin_can", "paper_cloth"]);
});

test("categoriesOn: 土日は収集なし", () => {
  const sat = new Date(2026, 6, 25);
  assert.deepStrictEqual(L.categoriesOn(sat, "east", schedule, special).categories, []);
});

test("categoriesOn: no_collection 日は空、祝日はフラグが立つ", () => {
  const nye = new Date(2026, 11, 31); // 木曜だが年末で収集なし
  const info = L.categoriesOn(nye, "east", schedule, special);
  assert.deepStrictEqual(info.categories, []);
  assert.strictEqual(info.noCollection, true);

  const holiday = L.categoriesOn(new Date(2026, 6, 20), "east", schedule, special);
  assert.strictEqual(holiday.holiday, true);
  assert.strictEqual(holiday.note.text, "祝日: 広報要確認");
});

test("nextCollectionDate: 当日を含む（既定）", () => {
  // 2026-07-21 は火曜 → 東地区 burnable 当日
  const r = L.nextCollectionDate("burnable", "east", new Date(2026, 6, 21), schedule, special);
  assert.strictEqual(r.iso, "2026-07-21");
  assert.strictEqual(r.daysFromNow, 0);
});

test("nextCollectionDate: includeFromDate=false で翌回に飛ぶ", () => {
  const r = L.nextCollectionDate("burnable", "east", new Date(2026, 6, 21), schedule, special, { includeFromDate: false });
  assert.strictEqual(r.iso, "2026-07-24"); // 金曜
  assert.strictEqual(r.daysFromNow, 3);
});

test("nextCollectionDate: 土日をまたいで翌週へ", () => {
  // 土曜起点 → 東地区 plastic は月曜
  const r = L.nextCollectionDate("plastic", "east", new Date(2026, 6, 25), schedule, special);
  assert.strictEqual(r.iso, "2026-07-27");
});

test("nextCollectionDate: 年末年始の収集なし日をスキップ", () => {
  // 2026-12-31(木) は東地区 bin_can の日だが no_collection → 次の木曜 2027-01-07
  const r = L.nextCollectionDate("bin_can", "east", new Date(2026, 11, 30), schedule, special, { includeFromDate: false });
  assert.strictEqual(r.iso, "2027-01-07");
});

test("nextCollectionDate: 祝日に当たると holiday フラグ", () => {
  // 2026-07-20(月・海の日) 東地区 plastic
  const r = L.nextCollectionDate("plastic", "east", new Date(2026, 6, 19), schedule, special);
  assert.strictEqual(r.iso, "2026-07-20");
  assert.strictEqual(r.holiday, true);
});

test("isAfterCutoff: 8:30 境界", () => {
  assert.strictEqual(L.isAfterCutoff(new Date(2026, 6, 21, 8, 29)), false);
  assert.strictEqual(L.isAfterCutoff(new Date(2026, 6, 21, 8, 30)), true);
  assert.strictEqual(L.isAfterCutoff(new Date(2026, 6, 21, 12, 0)), true);
});

test("areaForTown: 南沢は東地区、前沢は西地区", () => {
  assert.strictEqual(L.areaForTown("南沢", schedule), "east");
  assert.strictEqual(L.areaForTown("前沢", schedule), "west");
  assert.strictEqual(L.areaForTown("存在しない町", schedule), null);
});

test("items.json: 全品目の category が enum に含まれる（unknown なし）", () => {
  for (const item of items) {
    assert.ok(L.CATEGORIES[item.category], item.name + ": " + item.category);
    assert.notStrictEqual(item.category, "unknown", item.name);
  }
});

test("items.json: 公式ごみサク全品目が取り込まれている", () => {
  assert.ok(items.length >= 1000, "品目数が少なすぎる: " + items.length);
  // 代表的な読みで検索して、期待する区分の品目が含まれる
  const hasCat = (q, cat) => {
    const r = L.searchItems(items, q);
    assert.ok(r.length > 0, q + " が0件");
    assert.ok(r.some((i) => i.category === cat), q + " に区分 " + cat + " が無い");
  };
  hasCat("ぺっとぼとる", "pet");
  hasCat("かんでんち", "hazardous");
  hasCat("そうじき", "oversized");
  // guide 区分（収集日を持たない）も存在する
  assert.ok(items.some((i) => i.category === "oversized"));
  assert.ok(items.some((i) => i.category === "not_collected"));
  assert.ok(items.some((i) => i.category === "small_appliance"));
});

test("schedule.json: 曜日キーと category が正しい", () => {
  for (const areaKey of Object.keys(schedule.areas)) {
    const weekly = schedule.areas[areaKey].weekly;
    for (const day of Object.keys(weekly)) {
      assert.ok(L.WEEKDAY_KEYS.includes(day), day);
      for (const cat of weekly[day]) assert.ok(L.CATEGORIES[cat], cat);
    }
  }
});
