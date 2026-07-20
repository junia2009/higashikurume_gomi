/* 東久留米ごみナビ 描画層。ロジックは GomiLogic（純関数）に委譲する。 */
(function () {
  "use strict";
  const L = window.GomiLogic;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const AREA_KEY = "gomi.area";
  const state = { items: [], schedule: null, special: null, area: null, calMonth: null };

  function catInfo(cat) { return L.CATEGORIES[cat] || L.CATEGORIES.unknown; }

  function appendLink(parent, text, href) {
    const a = el("a", null, text);
    a.href = href; a.target = "_blank"; a.rel = "noopener"; a.style.marginLeft = "6px";
    parent.appendChild(a);
  }

  // 週次の固定収集日を持つ区分（早見リスト・凡例で使用）
  const SCHEDULED = ["burnable", "non_burnable", "plastic", "pet", "bin", "can", "paper_cloth", "hazardous"];

  function chip(cat, small) {
    const info = catInfo(cat);
    const c = el("span", "chip" + (small ? " small" : ""));
    c.style.setProperty("--c", info.color);
    const dot = el("span", "dot");
    c.appendChild(dot);
    c.appendChild(document.createTextNode(small ? info.short : info.label));
    return c;
  }

  // ---- データ読み込み ----
  async function load() {
    const [items, supplement, schedule, special] = await Promise.all([
      fetch("data/items.json").then((r) => r.json()),
      fetch("data/items_supplement.json").then((r) => r.json()).catch(() => ({ items: [] })),
      fetch("data/schedule.json").then((r) => r.json()),
      fetch("data/special_days.json").then((r) => r.json()).catch(() => ({}))
    ]);
    const base = items.items || [];
    // 補完データは公式CSVに無い定番品目のみ。既存と同名（正規化一致）のものは足さない。
    const have = new Set(base.map((b) => L.normalize(b.name)));
    const extra = (supplement.items || []).filter((e) => !have.has(L.normalize(e.name)));
    state.items = base.concat(extra);
    state.itemsMeta = items;
    state.schedule = schedule;
    state.special = special || {};
  }

  // ---- 地区 ----
  function getSavedArea() {
    const a = localStorage.getItem(AREA_KEY);
    return a && state.schedule.areas[a] ? a : null;
  }
  function setArea(a) {
    state.area = a;
    localStorage.setItem(AREA_KEY, a);
    renderAll();
    updateAreaSwitch();
  }
  function updateAreaSwitch() {
    const label = state.schedule.areas[state.area].label;
    $("#areaSwitch").innerHTML = "<b>" + label + "</b>";
  }

  function showAreaModal(canDismiss) {
    const back = el("div", "modal-back");
    const m = el("div", "modal");
    m.appendChild(el("h2", null, "お住まいの地区を選択"));
    m.appendChild(el("p", null, "東久留米市は東地区・西地区で収集曜日が異なります。地区は端末に保存され、ヘッダーからいつでも変更できます。"));
    for (const key of Object.keys(state.schedule.areas)) {
      const area = state.schedule.areas[key];
      const b = el("button", "area-opt");
      const body = el("div", "opt-body");
      body.appendChild(el("b", null, area.label));
      body.appendChild(el("span", null, area.towns.join("・")));
      b.appendChild(body);
      b.addEventListener("click", () => { document.body.removeChild(back); setArea(key); });
      m.appendChild(b);
    }
    if (canDismiss) {
      back.addEventListener("click", (e) => { if (e.target === back) document.body.removeChild(back); });
    }
    back.appendChild(m);
    document.body.appendChild(back);
  }

  // ---- トップ画面 ----
  function renderToday() {
    const host = $("#viewToday");
    host.innerHTML = "";
    const now = new Date();
    const today = L.dateOnly(now);
    const afterCutoff = L.isAfterCutoff(now);

    [0, 1].forEach((offset) => {
      const date = L.addDays(today, offset);
      const info = L.categoriesOn(date, state.area, state.schedule, state.special);
      const card = el("div", "hero " + (offset === 0 ? "hero-today" : "hero-tomorrow"));
      const head = el("div", "hero-head");
      head.appendChild(el("span", "hero-rel", offset === 0 ? "今日" : "明日"));
      head.appendChild(el("span", "hero-date", L.formatDateJa(date)));
      card.appendChild(head);

      if (info.noCollection) {
        card.appendChild(el("div", "none", "🎍 収集はお休みです（年末年始など）"));
      } else if (info.categories.length === 0) {
        card.appendChild(el("div", "none", "この日の収集はありません"));
      } else {
        const chips = el("div", "chips");
        info.categories.forEach((c) => chips.appendChild(chip(c)));
        card.appendChild(chips);
      }
      if (offset === 0 && afterCutoff && info.categories.length > 0) {
        card.appendChild(el("div", "badge done", "朝8:30を過ぎています（収集済みかも）"));
      }
      if (info.holiday) {
        card.appendChild(el("div", "badge warn", "祝日: 収集の有無は広報ひがしくるめで要確認"));
      }
      if (info.note) {
        card.appendChild(el("div", "badge warn", info.note.text));
      }
      host.appendChild(card);
    });

    // 各区分の次回収集日 早見
    const card = el("div", "card");
    card.appendChild(el("h2", "card-title", "区分ごとの次回収集日"));
    const list = el("div", "next-list");
    SCHEDULED.forEach((cat) => {
      const r = L.nextCollectionDate(cat, state.area, now, state.schedule, state.special,
        { includeFromDate: !afterCutoff });
      const row = el("div", "next-row");
      row.appendChild(chip(cat, true));
      const right = el("span", "next-when");
      if (r) {
        const soon = r.daysFromNow <= 1 ? " soon" : "";
        right.innerHTML = '<b class="next-date">' + L.formatDateJa(r.date) + "</b>"
          + '<span class="next-rel' + soon + '">' + L.relativeLabel(r.daysFromNow) + "</span>"
          + (r.holiday ? '<span class="next-holiday">祝日要確認</span>' : "");
      } else {
        right.textContent = "—";
      }
      row.appendChild(right);
      list.appendChild(row);
    });
    card.appendChild(list);
    host.appendChild(card);
  }

  // ---- 検索 ----
  function renderResults(query) {
    const host = $("#searchResults");
    host.innerHTML = "";
    const q = query.trim();
    const hint = $("#searchHint");
    if (hint) hint.classList.toggle("hidden", !!q);
    if (!q) return;
    const now = new Date();
    const afterCutoff = L.isAfterCutoff(now);
    const results = L.searchItems(state.items, q, 50);

    if (results.length === 0) {
      const help = el("div", "empty-help");
      help.appendChild(el("p", null, "「" + q + "」は見つかりませんでした。"));
      const a1 = el("a", "link-btn", "ごみサク（公式）で探す");
      a1.href = "https://www.gomisaku.jp/0069/"; a1.target = "_blank"; a1.rel = "noopener";
      const a2 = el("a", "link-btn", "粗大ごみ受付（市公式）");
      a2.href = "https://www.city.higashikurume.lg.jp/kurashi/kankyo/shigen/gomishigen/index.html";
      a2.target = "_blank"; a2.rel = "noopener";
      help.appendChild(a1); help.appendChild(a2);
      host.appendChild(help);
      return;
    }

    results.forEach((item) => {
      const r = el("div", "result");
      r.style.setProperty("--c", catInfo(item.category).color);
      r.appendChild(el("div", "r-name", item.name));
      const rc = el("div", "r-cat");
      rc.appendChild(chip(item.category, true));
      r.appendChild(rc);
      if (item.note) r.appendChild(el("div", "r-note", item.note));

      const info = catInfo(item.category);
      const next = el("div", "r-next");
      if (info.kind === "guide") {
        // 固定収集日を持たない区分は案内へ誘導
        if (item.category === "oversized") {
          next.textContent = "粗大ごみは事前申込制です。";
          appendLink(next, "受付・料金を確認",
            "https://www.city.higashikurume.lg.jp/kurashi/kankyo/shigen/gomishigen/index.html");
        } else if (item.category === "pruned_branch") {
          next.textContent = "剪定枝は事前申込制です（専用電話 042-473-2118）。";
        } else if (item.category === "small_appliance") {
          next.textContent = "市の小型家電回収ボックスへお持ちください。";
          appendLink(next, "回収ボックスの場所",
            "https://www.city.higashikurume.lg.jp/kurashi/kankyo/shigen/gomishigen/index.html");
        } else {
          next.textContent = "市の収集では出せません。";
          appendLink(next, "出し方を確認", "https://www.gomisaku.jp/0069/");
        }
      } else {
        const nc = L.nextCollectionDate(item.category, state.area, now, state.schedule, state.special,
          { includeFromDate: !afterCutoff });
        if (nc) {
          next.innerHTML = "次回収集日: <b>" + L.formatDateJa(nc.date) + "</b>（"
            + L.relativeLabel(nc.daysFromNow) + "・" + info.label + "）" + (nc.holiday ? " ⚠祝日要確認" : "");
        } else {
          next.textContent = "次回収集日は算出できませんでした。";
        }
      }
      r.appendChild(next);
      host.appendChild(r);
    });
  }

  // ---- カレンダー ----
  function renderCalendar() {
    const host = $("#viewCalendar");
    host.innerHTML = "";
    const now = new Date();
    if (!state.calMonth) state.calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const first = state.calMonth;
    const y = first.getFullYear(), m = first.getMonth();

    const head = el("div", "cal-head");
    const prev = el("button", null, "‹"); prev.setAttribute("aria-label", "前の月");
    const next = el("button", null, "›"); next.setAttribute("aria-label", "次の月");
    prev.addEventListener("click", () => { state.calMonth = new Date(y, m - 1, 1); renderCalendar(); });
    next.addEventListener("click", () => { state.calMonth = new Date(y, m + 1, 1); renderCalendar(); });
    head.appendChild(prev);
    head.appendChild(el("div", "cal-title", y + "年" + (m + 1) + "月"));
    head.appendChild(next);
    host.appendChild(head);

    const grid = el("div", "cal-grid");
    const dows = ["日", "月", "火", "水", "木", "金", "土"];
    dows.forEach((d, i) => {
      const c = el("div", "dow" + (i === 0 ? " sun" : i === 6 ? " sat" : ""), d);
      grid.appendChild(c);
    });

    const startDow = new Date(y, m, 1).getDay();
    for (let i = 0; i < startDow; i++) grid.appendChild(el("div", "cal-cell empty"));

    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayIso = L.toISODate(L.dateOnly(now));
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(y, m, day);
      const info = L.categoriesOn(date, state.area, state.schedule, state.special);
      const cell = el("div", "cal-cell");
      if (L.toISODate(date) === todayIso) cell.classList.add("today");
      const dn = el("div", "d", String(day));
      if (info.holiday) dn.appendChild(el("span", "hol-mark", " 祝"));
      cell.appendChild(dn);

      const cats = el("div", "cats");
      if (info.noCollection) {
        cats.appendChild(el("div", "nc", "収集なし"));
      } else {
        info.categories.forEach((cat) => {
          const line = el("div", "cat-line", catInfo(cat).short);
          line.style.background = catInfo(cat).color;
          cats.appendChild(line);
        });
      }
      cell.appendChild(cats);
      grid.appendChild(cell);
    }
    host.appendChild(grid);

    // 凡例
    const legend = el("div", "cal-legend");
    SCHEDULED.forEach((cat) => legend.appendChild(chip(cat, true)));
    host.appendChild(legend);
  }

  // ---- ルール・情報 ----
  function renderInfo() {
    const meta = state.itemsMeta || {};
    $("#itemsVersion").textContent = (meta.seed ? "暫定シード" : meta.version || "-")
      + "（" + (state.items.length) + "品目）";
  }

  function renderAll() {
    renderToday();
    renderCalendar();
    renderInfo();
  }

  // ---- タブ ----
  function switchTab(name) {
    document.querySelectorAll(".tabbar button").forEach((b) => {
      const on = b.dataset.tab === name;
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll("section.view").forEach((s) => {
      s.classList.toggle("active", s.dataset.view === name);
    });
    window.scrollTo(0, 0);
    if (name === "search") setTimeout(() => $("#searchInput").focus(), 0);
  }

  // ---- 起動 ----
  async function init() {
    try {
      await load();
    } catch (e) {
      document.querySelector(".wrap").innerHTML =
        '<div class="card"><h2>読み込みエラー</h2><p>データを読み込めませんでした。' +
        'このページはローカルファイルを直接開くと動作しません（fetch がブロックされます）。' +
        'GitHub Pages 上、または <code>npx serve</code> 等のローカルサーバー経由で開いてください。</p></div>';
      return;
    }
    state.area = getSavedArea();

    document.querySelectorAll(".tabbar button").forEach((b) =>
      b.addEventListener("click", () => switchTab(b.dataset.tab)));
    $("#areaSwitch").addEventListener("click", () => showAreaModal(true));

    let timer = null;
    $("#searchInput").addEventListener("input", (e) => {
      clearTimeout(timer);
      const v = e.target.value;
      timer = setTimeout(() => renderResults(v), 120);
    });

    if (!state.area) {
      showAreaModal(false);
    } else {
      renderAll();
      updateAreaSwitch();
    }

    // Service Worker（オフライン対応）。
    // - updateViaCache:"none" で sw.js を常にサーバーの最新と照合（HTTPキャッシュを使わない）
    // - 読み込み時とタブ復帰時に update() で更新チェックを強制
    // - 新版が制御を取ったら一度だけ自動リロードしてバージョンを揃える
    if ("serviceWorker" in navigator) {
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
        .then((reg) => {
          reg.update();
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") reg.update();
          });
        })
        .catch(() => {});
    }
  }

  window.addEventListener("DOMContentLoaded", init);
})();
