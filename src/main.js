import "./styles.css";
import { GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { LineChart } from "echarts/charts";
import { graphic, init, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { parseCsv, serializeCsv } from "./csv.mjs";

use([GridComponent, TooltipComponent, MarkLineComponent, LineChart, SVGRenderer]);

const BOARD_LABELS = { main: "主板", kcb: "科创板", cyb: "创业板", bse: "北交所" };
const BOARD_SHORT = { main: "主板", kcb: "科创板", cyb: "创业板", bse: "北交所" };
const BOARD_FILTERS = [
  ["all", "全部"],
  ["main", "主板"],
  ["kcb", "科创板"],
  ["cyb", "创业板"],
  ["bse", "北交所"]
];
const DB_PAGE_SIZE = 12;
const dbState = {
  board: "all",
  query: "",
  sortKey: "apply_date",
  sortDir: "desc",
  page: 1,
  expandedCode: ""
};

let appModel;

async function main() {
  const [masterText, eventsText, state] = await Promise.all([
    fetchText("/data/ipo_master.csv"),
    fetchText("/data/ipo_events.csv"),
    fetchJson("/data/run-state.json")
  ]);
  appModel = buildHomeModel(parseCsv(masterText).rows, parseCsv(eventsText).rows, state);
  window.addEventListener("hashchange", () => renderApp());
  renderApp();
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.json();
}

function buildHomeModel(master, events, state) {
  const today = state?.market_time || new Date().toISOString().slice(0, 10);
  const bse = master.filter((row) => row.board === "bse");
  const shsz = master.filter((row) => row.board !== "bse");
  const bseCompleted = bse
    .filter((row) => num(row.bse__VA_AMT) != null && num(row.bse__APPLY_AMT_100) != null)
    .sort((a, b) => b.apply_date.localeCompare(a.apply_date));
  const bseFocus = bse.sort((a, b) => b.apply_date.localeCompare(a.apply_date))[0];
  const bseSeries = [...bseCompleted].sort((a, b) => a.apply_date.localeCompare(b.apply_date));
  const shszApplyEvents = events
    .filter((event) => event.event_date >= today && event.event_type === "apply" && event.board !== "bse")
    .sort((a, b) => a.event_date.localeCompare(b.event_date))
    .slice(0, 3);
  const shszTimelineRows = shsz
    .filter((row) => row.apply_date >= today)
    .sort((a, b) => a.apply_date.localeCompare(b.apply_date))
    .slice(0, 3);
  const shszListed = shsz
    .filter((row) => row.listing_date && num(row.ipo__LD_CLOSE_CHANGE) != null)
    .sort((a, b) => b.listing_date.localeCompare(a.listing_date))
    .slice(0, 5);

  return {
    today,
    state,
    master,
    events,
    bseFocus,
    bseSeries,
    bseRecentListings: bseCompleted.filter((row) => row.listing_date).slice(0, 3),
    bseWeeks: issueWeeks(bse, today, 6),
    shszApplyEvents,
    shszTimelineRows,
    shszListed
  };
}

function renderApp() {
  const view = currentView();
  document.querySelector("#app").innerHTML = `
    <div class="page-shell">
      ${renderHeader(appModel, view)}
      ${view === "database" ? renderDatabasePage(appModel) : renderHomePage(appModel)}
    </div>
  `;
  if (view === "database") {
    bindDatabasePage(appModel);
  } else {
    bindHomeCompanyLinks();
    initBseFundingChart(appModel.bseSeries);
    scrollToHashTarget();
  }
}

function currentView() {
  return normalizeHash() === "database" ? "database" : "home";
}

function normalizeHash() {
  return window.location.hash.replace(/^#\/?/, "") || "home";
}

function renderHeader({ today }, view) {
  const hash = normalizeHash();
  return `
    <header class="app-header">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span></div>
        <div><h1>IPO 打新看板</h1><p>机会雷达 · 日历 · 资金热度</p></div>
      </div>
      <nav class="top-nav" aria-label="主导航">
        <a class="${view === "home" && hash === "home" ? "active" : ""}" href="#home">首页</a>
        <a class="${view === "home" && hash === "bse" ? "active" : ""}" href="#bse">北交所现金申购</a>
        <a class="${view === "home" && hash === "shsz" ? "active" : ""}" href="#shsz">沪深市值申购</a>
        <a class="${view === "database" ? "active" : ""}" href="#database">新股数据库</a>
      </nav>
      <label class="search-box"><span aria-hidden="true"></span><input type="search" placeholder="搜索公司 / 代码 / 关键词" /></label>
      <div class="update-chip"><i></i> 更新于 ${formatMonthDay(today)} 08:00</div>
      <button class="avatar" type="button">Z</button>
    </header>
  `;
}

function renderHomePage(model) {
  return `
    <main class="home-grid">
      ${renderBsePanel(model)}
      ${renderShszPanel(model)}
    </main>
  `;
}

function scrollToHashTarget() {
  const id = normalizeHash();
  if (!["bse", "shsz"].includes(id)) return;
  requestAnimationFrame(() => document.querySelector(`#${id}`)?.scrollIntoView({ block: "start" }));
}

function bindHomeCompanyLinks() {
  document.querySelectorAll("[data-open-company]").forEach((element) => {
    element.addEventListener("click", () => {
      openCompanyInDatabase(element.dataset.openCompany);
    });
  });
}

function openCompanyInDatabase(code) {
  const row = appModel.master.find((item) => item.code === code || item.secucode === code || item.apply_code === code);
  if (!row) return;
  dbState.board = "all";
  dbState.query = row.code;
  dbState.sortKey = "apply_date";
  dbState.sortDir = "desc";
  dbState.page = 1;
  dbState.expandedCode = row.code;
  window.location.hash = "database";
  renderApp();
  requestAnimationFrame(() => document.querySelector(".data-main-row.expanded")?.scrollIntoView({ block: "center" }));
}

function renderBsePanel(model) {
  const row = model.bseFocus;
  const ratio = strategyRatio(row);
  const label = strategyLabel(ratio);
  const topFund = num(row?.bse__APPLY_AMT_UPPER);
  const hundredFund = num(row?.bse__APPLY_AMT_100);
  return `
    <section class="brief-panel bse-panel" id="bse">
      <header class="panel-title">
        <h2>北交所现金申购今日摘要</h2>
        <p>聚焦资金水位与中签难度，识别手速局与高热机会</p>
      </header>

      <article class="card focus-card company-link-card" data-open-company="${escapeHtml(row?.code || "")}">
        <div class="focus-head">
          <div>
            <h3>${escapeHtml(row?.name || "--")} <small>${escapeHtml(row?.code || "")}</small> <em>${BOARD_LABELS.bse}</em></h3>
            <span class="date-pill">申购日 ${formatMonthDay(row?.apply_date)}</span>
          </div>
          <strong class="warning-pill">${label}</strong>
        </div>
        <div class="metric-strip four">
          <div><span>发行价</span><b>${formatMoney(row?.issue_price)}</b><small>元</small></div>
          <div><span>网上发行</span><b>${formatWanShare(row?.bse__ONLINE_ISSUE_NUM || row?.ipo__ONLINE_ISSUE_NUM)}</b><small>万股</small></div>
          <div><span>顶格申购资金</span><b>${formatWan(topFund)}</b><small>万</small></div>
          <div><span>稳获百股所需资金</span><b>${formatWan(hundredFund)}</b><small>万</small></div>
        </div>
        <div class="alert-line">顶格资金 ${compareText(topFund, hundredFund)} 稳获百股资金，${strategySentence(ratio)}</div>
      </article>

      <div class="panel-two">
        ${renderBseFundingCard(model)}
        ${renderBseProfitCard(model)}
      </div>
      ${renderBseRhythm(model)}
    </section>
  `;
}

function renderBseFundingCard({ bseSeries }) {
  return `
    <article class="card mini-card">
      <div class="card-title"><h3>参与申购资金变化</h3><span>单位：亿元</span></div>
      <div id="bseFundingChart" class="funding-chart" role="img" aria-label="参与申购资金变化"></div>
      <p class="muted-note">存在超低顶格补缴案例，可能拉低统计口径，仅供参考</p>
    </article>
  `;
}

function renderBseProfitCard({ bseRecentListings }) {
  const rows = bseRecentListings.slice(0, 3);
  return `
    <article class="card mini-card">
      <div class="card-title"><h3>最近上市赚钱效应</h3><span>近 5 只北交所新股</span></div>
      <table class="compact-table">
        <thead><tr><th>公司</th><th>首日涨幅</th><th>每百股获利</th><th>最新表现</th></tr></thead>
        <tbody>
          ${rows.map((row) => {
            const firstDayChange = row.bse__LD_CLOSE_CHANGE || row.ipo__LD_CLOSE_CHANGE;
            const latestChange = dbValue(row, "latest_change");
            return `<tr class="company-link-row" data-open-company="${escapeHtml(row.code)}"><td>${escapeHtml(row.name)}</td><td class="${marketToneClass(firstDayChange)}">${formatPct(firstDayChange)}</td><td>${formatMoney(row.bse__PER_SHARES_INCOME)}</td><td class="${marketToneClass(latestChange)}">${formatPct(latestChange)}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
      <p class="muted-note">统计区间：近 5 只北交所新股</p>
    </article>
  `;
}

function renderBseRhythm({ bseWeeks }) {
  return `
    <article class="card rhythm-card">
      <div class="card-title"><h3>近 6 周发行节奏 <span>北交所</span></h3></div>
      <div class="week-grid">
        ${bseWeeks.map((week, index) => `<div class="week-box ${index === bseWeeks.length - 1 ? "current" : ""}"><span>第 ${index + 1} 周</span><small>${formatMonthDay(week.start)} - ${formatMonthDay(week.end)}</small><b>${week.count}</b><em>只新股</em></div>`).join("")}
      </div>
      <p class="info-note">近 6 周北交所平均每周 ${formatNumber(avg(bseWeeks.map((week) => week.count)), 1)} 只新股，节奏平稳</p>
    </article>
  `;
}

function renderShszPanel(model) {
  return `
    <section class="brief-panel shsz-panel" id="shsz">
      <header class="panel-title">
        <h2>沪深市值申购今日摘要</h2>
        <p>聚焦额度利用与缴款节奏，尽打尽缴不踩点</p>
      </header>
      <div class="panel-two">
        ${renderShszTodo(model)}
        ${renderShszTimeline(model)}
      </div>
      ${renderShszListed(model)}
      <article class="logic-card">
        <div class="target-icon"></div>
        <div><b>逻辑：有额度即应打尽打，重点别错过申购和缴款。</b><p>额度不用等于浪费，时间错过无法补救。</p></div>
      </article>
    </section>
  `;
}

function renderShszTodo({ shszApplyEvents }) {
  return `
    <article class="card todo-card">
      <div class="card-title"><h3>本周应打尽打</h3></div>
      <div class="todo-list">
        ${shszApplyEvents.map((event) => `<div class="todo-row company-link-row" data-open-company="${escapeHtml(event.code)}"><div><b>${escapeHtml(event.name)}</b><span>${escapeHtml(event.secucode || event.code)} <em>${boardLabel(event.board)}</em></span></div><time>${formatMonthDay(event.event_date)}</time><strong>申购</strong></div>`).join("") || `<p class="muted-note">本周暂无沪深申购节点</p>`}
      </div>
      <p class="muted-note">数据来源：东方财富，仅供参考</p>
    </article>
  `;
}

function renderShszTimeline({ shszTimelineRows }) {
  return `
    <article class="card key-timeline-card">
      <div class="card-title"><h3>关键节点时间线</h3></div>
      <div class="three-steps"><span>1<br><em>申购</em></span><i></i><span>2<br><em>中签缴款</em></span><i></i><span>3<br><em>上市</em></span></div>
      <table class="compact-table node-table">
        <tbody>
          ${shszTimelineRows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${formatMonthDay(row.apply_date)}</td><td>${formatMonthDay(row.pay_date || row.ballot_date)}</td><td>${formatMonthDay(row.listing_date)}</td></tr>`).join("")}
        </tbody>
      </table>
      <p class="muted-note">节点时间为预估时间，仅供参考</p>
    </article>
  `;
}

function renderShszListed({ shszListed }) {
  const maxChange = maxAbs(shszListed.map((row) => row.ipo__LD_CLOSE_CHANGE));
  return `
    <article class="card listed-card">
      <div class="card-title"><h3>已上市表现 <span>近 5 只</span></h3></div>
      <table>
        <thead><tr><th>公司</th><th>板块</th><th>发行价(元)</th><th>发行PE</th><th>首日涨幅</th></tr></thead>
        <tbody>
          ${shszListed.map((row) => `<tr class="company-link-row" data-open-company="${escapeHtml(row.code)}"><td><b>${escapeHtml(row.name)}</b></td><td><em class="board ${row.board}">${boardLabel(row.board)}</em></td><td>${formatMoney(row.issue_price)}</td><td>${formatNumber(row.issue_pe, 2)}</td><td class="${marketToneClass(row.ipo__LD_CLOSE_CHANGE)}"><span class="bar ${marketToneClass(row.ipo__LD_CLOSE_CHANGE)}"><i style="width:${barWidth(row.ipo__LD_CLOSE_CHANGE, maxChange)}%"></i></span> ${formatPct(row.ipo__LD_CLOSE_CHANGE)}</td></tr>`).join("")}
        </tbody>
      </table>
    </article>
  `;
}

function renderDatabasePage(model) {
  const view = buildDatabaseView(model.master);
  return `
    <main class="database-page">
      <section class="database-hero">
        <div>
          <h2>新股数据库</h2>
          <p>按申购、发行、上市表现查数；默认展示高频字段，底层 CSV 仍保留全字段。</p>
        </div>
        <div class="database-stats">
          <span><b>${model.master.length}</b>家公司</span>
          <span><b>${model.events.length}</b>个事件</span>
          <span>更新于 ${formatMonthDay(model.today)} 08:00</span>
        </div>
      </section>

      <section class="card database-card">
        <div class="database-toolbar">
          <div class="filter-tabs" role="tablist" aria-label="板块筛选">
            ${BOARD_FILTERS.map(([value, label]) => `<button class="${dbState.board === value ? "active" : ""}" type="button" data-db-board="${value}">${label}</button>`).join("")}
          </div>
          <label class="db-search"><span aria-hidden="true"></span><input id="dbSearch" type="search" value="${escapeHtml(dbState.query)}" placeholder="搜索公司 / 代码 / 主营业务" />${dbState.query ? `<button type="button" data-db-clear aria-label="清空搜索">×</button>` : ""}</label>
          <button class="export-button" type="button" data-db-export>导出 CSV</button>
        </div>

        <div class="database-meta">
          <span>当前 ${view.filtered.length} 条</span>
          <span>第 ${view.page} / ${view.totalPages} 页</span>
          <span>点击表头可排序</span>
        </div>

        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                ${DB_COLUMNS.map((column) => `<th class="${column.align === "right" ? "right" : ""}"><button type="button" data-db-sort="${column.key}">${column.label}<span>${sortMark(column.key)}</span></button></th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${view.pageRows.map((row) => renderDatabaseRow(row, view.maxFirstDayChange)).join("") || `<tr><td class="empty-row" colspan="${DB_COLUMNS.length}">没有符合条件的新股</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="database-footer">
          <span>每页 ${DB_PAGE_SIZE} 条</span>
          <div class="pager">
            <button type="button" data-db-page="${Math.max(1, view.page - 1)}" ${view.page <= 1 ? "disabled" : ""}>上一页</button>
            <strong>${view.page}</strong>
            <button type="button" data-db-page="${Math.min(view.totalPages, view.page + 1)}" ${view.page >= view.totalPages ? "disabled" : ""}>下一页</button>
          </div>
        </div>
      </section>
    </main>
  `;
}

const DB_COLUMNS = [
  { key: "code", label: "代码" },
  { key: "name", label: "简称" },
  { key: "board", label: "板块" },
  { key: "apply_date", label: "申购日" },
  { key: "listing_date", label: "上市日" },
  { key: "issue_price", label: "发行价", align: "right" },
  { key: "issue_pe", label: "发行PE", align: "right" },
  { key: "industry_pe", label: "行业PE", align: "right" },
  { key: "online_issue", label: "网上发行(万股)", align: "right" },
  { key: "top_apply", label: "顶格资金/市值(万)", align: "right" },
  { key: "ballot_rate", label: "中签率", align: "right" },
  { key: "apply_fund", label: "参与资金(亿)", align: "right" },
  { key: "first_day_change", label: "首日涨幅", align: "right" },
  { key: "latest_price", label: "最新价", align: "right" },
  { key: "latest_change", label: "最新涨幅", align: "right" }
];

function buildDatabaseView(rows) {
  const filtered = rows.filter(matchesDatabaseFilters).sort(compareDatabaseRows);
  const totalPages = Math.max(1, Math.ceil(filtered.length / DB_PAGE_SIZE));
  dbState.page = Math.min(dbState.page, totalPages);
  const start = (dbState.page - 1) * DB_PAGE_SIZE;
  const pageRows = filtered.slice(start, start + DB_PAGE_SIZE);
  return {
    filtered,
    page: dbState.page,
    totalPages,
    pageRows,
    maxFirstDayChange: maxAbs(pageRows.map((row) => dbValue(row, "first_day_change")))
  };
}

function matchesDatabaseFilters(row) {
  if (dbState.board !== "all" && row.board !== dbState.board) return false;
  const query = dbState.query.trim().toLowerCase();
  if (!query) return true;
  return [row.code, row.secucode, row.apply_code, row.name, row.name_full, row.main_business]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function compareDatabaseRows(a, b) {
  const left = dbSortValue(a, dbState.sortKey);
  const right = dbSortValue(b, dbState.sortKey);
  const direction = dbState.sortDir === "asc" ? 1 : -1;
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
  return String(left).localeCompare(String(right), "zh-Hans-CN") * direction;
}

function dbSortValue(row, key) {
  const value = dbValue(row, key);
  if (["code", "name", "board", "apply_date", "listing_date"].includes(key)) return value || null;
  if (key === "top_apply") return row.board === "bse" ? num(value) / 10000 : num(value);
  if (key === "apply_fund") return num(value) / 100000000;
  return num(value);
}

function renderDatabaseRow(row, maxFirstDayChange) {
  const firstDayChange = dbValue(row, "first_day_change");
  const isExpanded = dbState.expandedCode === row.code;
  return `
    <tr class="data-main-row ${isExpanded ? "expanded" : ""}" data-db-expand="${escapeHtml(row.code)}">
      <td><b>${escapeHtml(row.code)}</b></td>
      <td>${escapeHtml(row.name)}</td>
      <td><em class="board ${row.board}">${boardLabel(row.board)}</em></td>
      <td>${formatMonthDay(dbValue(row, "apply_date"))}</td>
      <td>${formatMonthDay(dbValue(row, "listing_date"))}</td>
      <td class="right">${formatMoney(dbValue(row, "issue_price"))}</td>
      <td class="right">${formatNumber(dbValue(row, "issue_pe"), 2)}</td>
      <td class="right">${formatNumber(dbValue(row, "industry_pe"), 2)}</td>
      <td class="right">${formatWanShare(dbValue(row, "online_issue"))}</td>
      <td class="right">${formatDbTopApply(row)}</td>
      <td class="right">${formatDbRate(dbValue(row, "ballot_rate"))}</td>
      <td class="right">${formatDbApplyFund(row)}</td>
      <td class="right ${marketToneClass(firstDayChange)}"><span class="bar ${marketToneClass(firstDayChange)}"><i style="width:${barWidth(firstDayChange, maxFirstDayChange)}%"></i></span>${formatPct(firstDayChange)}</td>
      <td class="right">${formatMoney(dbValue(row, "latest_price"))}</td>
      <td class="right ${marketToneClass(dbValue(row, "latest_change"))}">${formatPct(dbValue(row, "latest_change"))}</td>
    </tr>
    ${isExpanded ? renderDatabaseDetailRow(row) : ""}
  `;
}

function renderDatabaseDetailRow(row) {
  return `
    <tr class="data-detail-row">
      <td colspan="${DB_COLUMNS.length}">
        <div class="detail-panel">
          <div class="company-detail">
            <span>公司</span>
            <b>${escapeHtml(row.name)}</b>
            <small>${escapeHtml(row.code)} · ${boardLabel(row.board)}</small>
          </div>
          <div>
            <span>行业名称</span>
            <b>${escapeHtml(formatDbText(dbValue(row, "industry_name")))}</b>
          </div>
          <div>
            <span>行业 PE</span>
            <b>${formatNumber(dbValue(row, "industry_pe"), 2)}</b>
          </div>
          <div class="business-detail">
            <span>主营业务</span>
            <p>${escapeHtml(formatDbText(dbValue(row, "main_business")))}</p>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function bindDatabasePage(model) {
  document.querySelectorAll("[data-db-board]").forEach((button) => {
    button.addEventListener("click", () => {
      dbState.board = button.dataset.dbBoard;
      dbState.page = 1;
      dbState.expandedCode = "";
      renderApp();
    });
  });

  const search = document.querySelector("#dbSearch");
  search?.addEventListener("input", () => {
    dbState.query = search.value;
    dbState.page = 1;
    dbState.expandedCode = "";
    renderApp();
    const nextSearch = document.querySelector("#dbSearch");
    nextSearch?.focus();
    nextSearch?.setSelectionRange(dbState.query.length, dbState.query.length);
  });
  document.querySelector("[data-db-clear]")?.addEventListener("click", () => {
    dbState.query = "";
    dbState.page = 1;
    dbState.expandedCode = "";
    renderApp();
  });

  document.querySelectorAll("[data-db-sort]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const key = button.dataset.dbSort;
      if (dbState.sortKey === key) {
        dbState.sortDir = dbState.sortDir === "asc" ? "desc" : "asc";
      } else {
        dbState.sortKey = key;
        dbState.sortDir = ["code", "name", "board"].includes(key) ? "asc" : "desc";
      }
      dbState.page = 1;
      dbState.expandedCode = "";
      renderApp();
    });
  });

  document.querySelectorAll("[data-db-page]").forEach((button) => {
    button.addEventListener("click", () => {
      dbState.page = Number(button.dataset.dbPage);
      dbState.expandedCode = "";
      renderApp();
    });
  });

  document.querySelectorAll("[data-db-expand]").forEach((row) => {
    row.addEventListener("click", () => {
      dbState.expandedCode = dbState.expandedCode === row.dataset.dbExpand ? "" : row.dataset.dbExpand;
      renderApp();
    });
  });

  document.querySelector("[data-db-export]")?.addEventListener("click", () => {
    exportDatabaseCsv(model.master);
  });
}

function exportDatabaseCsv(rows) {
  const view = buildDatabaseView(rows);
  const csvRows = view.filtered.map((row) => Object.fromEntries(DB_COLUMNS.map((column) => [column.label, dbDisplayValue(row, column.key)])));
  const filename = `ipo-database-${new Date().toISOString().slice(0, 10)}.csv`;
  const blob = new Blob([serializeCsv(csvRows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function dbDisplayValue(row, key) {
  if (key === "board") return boardLabel(row.board);
  if (key === "apply_date" || key === "listing_date") return dbValue(row, key) || "";
  if (key === "online_issue") return formatWanShare(dbValue(row, key));
  if (key === "top_apply") return formatDbTopApply(row);
  if (key === "ballot_rate") return formatDbRate(dbValue(row, key));
  if (key === "apply_fund") return formatDbApplyFund(row);
  if (key === "first_day_change" || key === "latest_change") return formatPct(dbValue(row, key));
  if (["issue_price", "issue_pe", "industry_pe", "latest_price"].includes(key)) return formatNumber(dbValue(row, key), 2);
  return dbValue(row, key) || "";
}

function dbValue(row, key) {
  switch (key) {
    case "code":
    case "name":
    case "board":
    case "apply_date":
    case "listing_date":
      return row[key];
    case "issue_price":
      return coalesce(row.issue_price, row.bse__ISSUE_PRICE, row.ipo__ISSUE_PRICE);
    case "issue_pe":
      return coalesce(row.issue_pe, row.bse__ISSUE_PE_RATIO, row.ipo__AFTER_ISSUE_PE);
    case "industry_pe":
      return coalesce(row.industry_pe, row.bse__INDUSTRY_PE_RATIO, row.ipo__INDUSTRY_PE_NEW, row.ipo__INDUSTRY_PE_RATIO);
    case "industry_name":
      return row.ipo__INDUSTRY_NAME;
    case "main_business":
      return coalesce(row.main_business, row.bse__MAIN_BUSINESS, row.ipo__MAIN_BUSINESS);
    case "online_issue":
      return coalesce(row.bse__ONLINE_ISSUE_NUM, row.ipo__ONLINE_ISSUE_NUM);
    case "top_apply":
      return row.board === "bse" ? row.bse__APPLY_AMT_UPPER : coalesce(row.ipo__TOP_APPLY_MARKETCAP, row.ipo__APPLY_AMT_UPPER);
    case "ballot_rate":
      return row.ipo__ONLINE_ISSUE_RATIO;
    case "apply_fund":
      return row.bse__VA_AMT;
    case "first_day_change":
      return coalesce(row.bse__LD_CLOSE_CHANGE, row.ipo__LD_CLOSE_CHANGE);
    case "latest_price":
      if (!row.listing_date) return "";
      return coalesce(row.bse__NEWEST_PRICE, row.ipo__TNEW_PRICE, row.ipo__LATELY_PRICE, row.ipo__NEWEST_PRICE);
    case "latest_change":
      if (!row.listing_date) return "";
      return coalesce(row.ipo__TCHANGE_RATE);
    default:
      return row[key];
  }
}

function formatDbTopApply(row) {
  const value = dbValue(row, "top_apply");
  if (num(value) == null) return "-";
  return row.board === "bse" ? formatWan(value) : formatNumber(value, 2);
}

function formatDbApplyFund(row) {
  const value = dbValue(row, "apply_fund");
  const n = num(value);
  return n == null ? "-" : (n / 100000000).toFixed(2);
}

function formatDbRate(value) {
  const n = num(value);
  return n == null ? "-" : `${n.toFixed(4)}%`;
}

function formatDbText(value) {
  return value == null || value === "" ? "-" : value;
}

function sortMark(key) {
  if (dbState.sortKey !== key) return "";
  return dbState.sortDir === "asc" ? "↑" : "↓";
}

function issueWeeks(rows, today, count) {
  const end = weekEnd(today);
  const weeks = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const start = addDays(end, -6 - index * 7);
    const stop = addDays(start, 6);
    weeks.push({ start, end: stop, count: rows.filter((row) => row.apply_date >= start && row.apply_date <= stop).length });
  }
  return weeks;
}

function initBseFundingChart(rows) {
  const container = document.querySelector("#bseFundingChart");
  if (!container) return;
  const chart = init(container, null, { renderer: "svg" });
  const source = rows
    .filter((row) => num(row.bse__VA_AMT) != null)
    .slice(-12);
  const values = source.map((row) => +(num(row.bse__VA_AMT) / 100000000).toFixed(1));
  const avg5 = avg(values.slice(-5));

  chart.setOption({
    animation: false,
    grid: { top: 18, right: 10, bottom: 22, left: 34 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => `${formatNumber(value, 1)} 亿元`,
      axisPointer: { type: "line", lineStyle: { color: "#98a2b3", width: 1 } },
      borderWidth: 0,
      backgroundColor: "rgba(17, 27, 42, 0.86)",
      textStyle: { color: "#fff", fontSize: 11 }
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: source.map((row) => formatMonthDay(row.apply_date)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "rgba(17, 27, 42, 0.12)" } },
      axisLabel: { color: "#697386", fontSize: 10, hideOverlap: true, margin: 8 }
    },
    yAxis: {
      type: "value",
      scale: true,
      splitNumber: 3,
      axisLabel: { color: "#697386", fontSize: 10, formatter: (value) => `${Math.round(value)}` },
      splitLine: { lineStyle: { color: "rgba(17, 27, 42, 0.08)" } }
    },
    series: [
      {
        name: "参与资金",
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 5,
        data: values,
        lineStyle: { color: "#ef4444", width: 2 },
        itemStyle: { color: "#ef4444" },
        areaStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(239, 68, 68, 0.24)" },
            { offset: 1, color: "rgba(239, 68, 68, 0.02)" }
          ])
        },
        markLine: avg5
          ? {
              symbol: "none",
              label: { show: false },
              lineStyle: { color: "#ef6b1b", type: "dashed", width: 1 },
              data: [{ yAxis: +avg5.toFixed(1) }]
            }
          : undefined
      }
    ]
  });

  window.addEventListener("resize", () => chart.resize(), { passive: true });
}

function weekEnd(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + (7 - day));
  return d.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function strategyRatio(row) {
  const top = num(row?.bse__APPLY_AMT_UPPER);
  const hundred = num(row?.bse__APPLY_AMT_100);
  return top != null && hundred ? top / hundred : null;
}

function strategyLabel(ratio) {
  if (ratio == null) return "待观察";
  if (ratio < 1) return "手速局";
  if (ratio < 3) return "低确定性";
  return "资金局";
}

function strategySentence(ratio) {
  if (ratio == null) return "等待完整申购资金数据。";
  if (ratio < 1) return "顶格也难稳获 100 股。";
  if (ratio < 3) return "低确定性，主要看碎股排序。";
  return `理论约 ${ratio.toFixed(1)} 手，资金权重更高。`;
}

function compareText(left, right) {
  if (left == null || right == null) return "与";
  return left < right ? "<" : ">";
}

function avg(values) {
  const valid = values.filter((value) => value != null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function maxAbs(values) {
  return values.reduce((max, value) => Math.max(max, Math.abs(num(value) || 0)), 0);
}

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function coalesce(...values) {
  return values.find((value) => value != null && value !== "") ?? "";
}

function barWidth(value, maxValue) {
  const n = Math.abs(num(value) || 0);
  if (!n || !maxValue) return 0;
  return Math.max(8, Math.min(100, (n / maxValue) * 100));
}

function marketToneClass(value) {
  const n = num(value);
  if (n == null || n === 0) return "neutral";
  return n > 0 ? "red" : "green";
}

function boardLabel(board) {
  return BOARD_SHORT[board] || board || "--";
}

function formatMonthDay(value) {
  if (!value) return "待定";
  const [, month, day] = String(value).slice(0, 10).split("-");
  return `${month}/${day}`;
}

function formatNumber(value, digits = 0) {
  const n = num(value);
  return n == null ? "-" : n.toFixed(digits);
}

function formatMoney(value) {
  const n = num(value);
  return n == null ? "-" : n.toFixed(2);
}

function formatWan(value) {
  const n = num(value);
  return n == null ? "-" : (n / 10000).toFixed(2);
}

function formatWanShare(value) {
  const n = num(value);
  return n == null ? "-" : (n / 10000).toFixed(0);
}

function formatPct(value) {
  const n = num(value);
  return n == null ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

main().catch((error) => {
  document.querySelector("#app").innerHTML = `<main class="error-state"><h1>数据加载失败</h1><pre>${escapeHtml(error.stack || error.message)}</pre></main>`;
});
