"use strict";

const state = { domain: "shipping", data: null, expressData: null, spbData: null, motData: null, open: null };

// ============ 作者专属令牌（仅控制"写"操作的 UI 显隐与请求头）============
// 本机（localhost / 127.0.0.1 / ::1）访问时自动视为作者本人，无需解锁；
// 公网 / 非本机访问则需 URL ?owner=TOKEN 或点「解锁管理」输入令牌。
// 真正的鉴权在服务端：localhost 自动放行，其他来源须携带正确 X-Owner-Token。
const IS_LOCAL = ["127.0.0.1", "localhost", "::1"].includes(location.hostname);

let OWNER_TOKEN = (() => {
  if (IS_LOCAL) return "local-auto"; // 本机自动作者，后端 localhost 自动放行
  const p = new URLSearchParams(location.search).get("owner");
  if (p) {
    try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {}
    try { sessionStorage.setItem("ownerToken", p); } catch (e) {}
    return p;
  }
  try { return sessionStorage.getItem("ownerToken") || ""; } catch (e) { return ""; }
})();

// 是否为作者（本机自动 → true；否则需已解锁令牌）
function isOwner() {
  return IS_LOCAL || !!OWNER_TOKEN;
}

const $ = (s) => document.querySelector(s);
const fmt = (n, d = 2) =>
  n == null ? "—" : Number(n).toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n, d = 1) => (n == null ? "—" : `${n > 0 ? "+" : ""}${fmt(n, d)}%`);

function chgClass(v) {
  if (v == null || v === 0) return "flat";
  return v > 0 ? "up" : "down";
}

// 由月份推导季度标签（"2026-03" -> "2026Q1"）。极兔等季度披露企业用此替代月标签，
// 体现数据本身粒度，而非"缺数据"。
function quarterLabel(month) {
  if (!month) return month;
  const parts = month.split("-");
  if (parts.length < 2) return month;
  // 半年度基数记录（如 2025-H1）直接原样显示，不要解析成 QNaN
  if (parts[1] === "H1" || parts[1] === "H2") return month;
  const q = Math.ceil(parseInt(parts[1], 10) / 3);
  return `${parts[0]}Q${q}`;
}

// ============ 数据域标签页 ============
async function loadDomains() {
  const d = await (await fetch("data/domains.json")).json();
  const nav = $("#domainTabs");
  nav.innerHTML = "";
  d.domains.forEach((dom) => {
    const b = document.createElement("button");
    b.className = "tab" + (dom.id === state.domain ? " active" : "");
    b.textContent = dom.name;
    b.title = dom.sub;
    b.dataset.id = dom.id;
    b.addEventListener("click", () => switchDomain(dom.id));
    nav.appendChild(b);
  });
}

function switchDomain(id) {
  if (state.domain === id) return;
  state.domain = id;
  state.open = null;
  document.querySelectorAll(".domain-tabs .tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.id === id);
  });
  syncWriteUI();
  render();
}

// 按"作者令牌 + 当前域"同步 4 个管理 UI 的显隐（无令牌则全部隐藏）。
function syncWriteUI() {
  const id = state.domain;
  const can = isOwner();
  $("#refreshBtn").style.display = can && id === "shipping" ? "" : "none";
  $("#spbRefreshBtn").classList.toggle("hidden", !(can && id === "spb"));
  $("#importShipping").classList.toggle("hidden", !(can && id === "shipping"));
  $("#importExpress").classList.toggle("hidden", !(can && id === "express"));
}

// ============ 主渲染分发 ============
async function render() {
  const c = $("#content");
  c.innerHTML = `<div class="loading">加载中…</div>`;
  if (state.domain === "shipping") {
    await loadIndices();
  } else if (state.domain === "spb") {
    await loadSpb();
  } else if (state.domain === "rankings") {
    await loadRankings();
  } else {
    await loadExpress();
  }
}

// ============ 航运运价指数（原有逻辑） ============
async function loadIndices() {
  const r = await fetch("data/indices.json");
  state.data = await r.json();
  $("#lastUpdated").textContent = "最近更新：" + (state.data.last_updated || "—");
  const c = $("#content");
  c.innerHTML = "";
  state.data.categories.forEach((cat) => {
    const block = document.createElement("section");
    block.className = "cat-block";
    block.innerHTML = `<h2 class="cat-title">${cat}</h2>`;
    // 分航线指数为对应综合指数的细分，加一行归属说明
    const SUB_NOTE = {
      "CCFI分航线指数": "中国出口集装箱运价综合指数（CCFI）的分航线构成，由「一键刷新」抓 CCFI 时自动沉淀各航线当期值，累积历史走势。",
      "CICFI分航线指数": "中国进口集装箱运价指数（CICFI）的分航线构成，由「一键刷新」抓 CICFI 时自动沉淀各航线当期值，累积历史走势。",
    };
    if (SUB_NOTE[cat]) {
      const note = document.createElement("p");
      note.className = "cat-note";
      note.innerHTML = SUB_NOTE[cat];
      block.appendChild(note);
    }
    const grid = document.createElement("div");
    grid.className = "grid";
    state.data.data[cat].forEach((item) => grid.appendChild(card(item)));
    block.appendChild(grid);
    c.appendChild(block);
  });
}

function getMeta(code) {
  if (!state.data || !state.data.data) return null;
  for (const arr of Object.values(state.data.data)) {
    const it = arr.find((x) => x.code === code);
    if (it) return it;
  }
  return null;
}

function card(item) {
  const el = document.createElement("div");
  el.className = "card short";
  el.dataset.code = item.code;
  const has = item.latest && item.latest.comprehensive_value != null;
  const val = has ? fmt(item.latest.comprehensive_value) : "暂无数据";
  const chg = has ? `<span class="chg ${chgClass(item.latest.change_value)}">${chgText(item)}</span>` : "";
  const pub = has ? item.latest.pub_date : "未抓取";
  const routeTag = item.composite === false ? `<span class="route-tag">按航线</span>` : "";
  el.innerHTML = `
    <div class="short-name">${item.short}</div>
    <div class="full-name">${item.name}</div>
    <div class="value-row"><span class="value ${has ? chgClass(item.latest.change_value) : ""}">${val}</span>${chg}</div>
    <div class="meta"><span class="freq">${item.freq_label}</span><span>${pub}</span>${routeTag}</div>
    <div style="margin-top:6px"><a class="src-link" href="${item.source_url}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">航交所原文 ↗</a></div>
  `;
  el.addEventListener("click", (e) => {
    // 点击详情区域（对照期、表格、图表等）时不触发卡片折叠
    if (e.target.closest(".detail")) return;
    toggleDetail(el);
  });
  return el;
}

function chgText(item) {
  const v = item.latest ? item.latest.change_value : null;
  if (v == null) return "—";
  const isPct = item.latest.change_is_pct;
  const sign = v > 0 ? "+" : "";
  return isPct ? `${sign}${fmt(v, 1)}%` : `${sign}${fmt(v)} 点`;
}

async function toggleDetail(cardEl) {
  const grid = cardEl.closest(".grid");
  const isOpen = !!cardEl.querySelector(".detail");
  if (isOpen) {
    // 整行收起：同排卡片一并关闭
    const top = cardEl.offsetTop;
    Array.from(grid.querySelectorAll(":scope > .card"))
      .filter((c) => Math.abs(c.offsetTop - top) < 2)
      .forEach((c) => c.querySelector(".detail")?.remove());
    state.open = null;
    return;
  }
  // 先收起所有已展开的行，再在"折叠态"布局下计算同排卡片（offsetTop 才准确）
  document.querySelectorAll(".detail").forEach((d) => d.remove());
  const top = cardEl.offsetTop;
  const rowCards = Array.from(grid.querySelectorAll(":scope > .card"))
    .filter((c) => Math.abs(c.offsetTop - top) < 2);
  await Promise.all(rowCards.map((c) => loadCardDetail(c)));
  state.open = cardEl.dataset.code;
}

async function loadCardDetail(cardEl) {
  if (cardEl.querySelector(".detail")) return;
  const code = cardEl.dataset.code;
  const detail = document.createElement("div");
  detail.className = "detail";
  detail.innerHTML = `<div class="loading">加载历史…</div>`;
  cardEl.appendChild(detail);
  try {
    const [h, l] = await Promise.all([
      fetch(`data/history_${code}.json`).then((r) => r.json()),
      fetch(`data/lines_${code}.json`).then((r) => r.json()),
    ]);
    detail.innerHTML = "";
    detail.appendChild(historyView(code, h.history, l.lines));
  } catch (e) {
    detail.innerHTML = `<div class="empty">历史数据加载失败</div>`;
  }
}

function historyView(code, history, lines) {
  const wrap = document.createElement("div");
  if (!history.length) {
    wrap.innerHTML = `<div class="empty">暂无历史数据，点【一键刷新】抓取最新一期后开始沉淀。</div>`;
    return wrap;
  }
  const chrono = history.slice().reverse();
  const vals = chrono.map((h) => h.comprehensive_value);
  const meta = getMeta(code);
  const isRoute = meta && meta.composite === false;
  wrap.appendChild(lineChart(chrono.map((h) => h.pub_date), vals,
    (v) => fmt(v), vals[vals.length - 1] >= vals[0] ? "var(--up)" : "var(--down)",
    isRoute ? "首要航线走势（代表值）" : "综合指数走势", 440, 200, true));

  if (isRoute && lines && lines.length) {
    const note = document.createElement("div");
    note.className = "cat-note";
    note.textContent = `该指数按航线分项披露，无单一综合指数；以上走势与「代表航线值」列以首要航线（${lines[0].line_name}）为代表值，分项明细见下方表格。`;
    wrap.appendChild(note);
  }

  wrap.appendChild(compareBox(history));

  const h4 = document.createElement("h4");
  h4.textContent = `近期时序（共 ${history.length} 期，新→旧）`;
  wrap.appendChild(h4);
  const tbl = document.createElement("table");
  tbl.className = "tbl";
  tbl.innerHTML = `<thead><tr><th>发布日期</th><th>${isRoute ? "代表航线值" : "综合指数"}</th><th>上期</th><th>涨跌</th></tr></thead>`;
  const tb = document.createElement("tbody");
  history.slice(0, 60).forEach((h) => {
    const tr = document.createElement("tr");
    const cls = chgClass(h.change_value);
    const sign = h.change_value > 0 ? "+" : "";
    const chg = h.change_value == null ? "—"
      : (h.change_is_pct ? `${sign}${fmt(h.change_value, 1)}%` : `${sign}${fmt(h.change_value)} 点`);
    tr.innerHTML = `<td>${h.pub_date}</td><td>${fmt(h.comprehensive_value)}</td><td>${fmt(h.prev_value)}</td><td class="${cls}">${chg}</td>`;
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  wrap.appendChild(tbl);

  if (lines && lines.length) {
    const lh = document.createElement("h4");
    lh.textContent = `分航线明细（最新一期）`;
    wrap.appendChild(lh);
    const lt = document.createElement("table");
    lt.className = "tbl";
    lt.innerHTML = `<thead><tr><th>航线</th><th>单位</th><th>本期</th><th>上期</th><th>涨跌</th></tr></thead>`;
    const ltb = document.createElement("tbody");
    lines.forEach((ln) => {
      const tr = document.createElement("tr");
      const cls = chgClass(ln.change_value);
      const sign = ln.change_value != null && ln.change_value > 0 ? "+" : "";
      let chg;
      if (ln.change_value == null) chg = "—";
      else if (ln.change_is_pct) chg = `${sign}${fmt(ln.change_value, 1)}%`;
      else chg = `${sign}${fmt(ln.change_value)}`;
      tr.innerHTML = `<td>${ln.line_name}</td><td>${ln.unit || ""}</td><td>${fmt(ln.curr_value)}</td><td>${fmt(ln.prev_value)}</td><td class="${cls}">${chg}</td>`;
      ltb.appendChild(tr);
    });
    lt.appendChild(ltb);
    wrap.appendChild(lt);
  }
  return wrap;
}

function compareBox(history) {
  const box = document.createElement("div");
  box.className = "compare";
  const opts = history.map((h) => `<option value="${h.pub_date}">${h.pub_date}</option>`).join("");
  box.innerHTML = `
    <div><label style="font-size:11px;color:var(--muted)">对照期A</label><br><select id="cmpA">${opts}</select></div>
    <div><label style="font-size:11px;color:var(--muted)">对照期B</label><br><select id="cmpB">${opts}</select></div>
    <div class="result" id="cmpRes"></div>`;
  setTimeout(() => {
    const a = box.querySelector("#cmpA"), b = box.querySelector("#cmpB");
    if (history.length >= 2) { a.selectedIndex = 1; b.selectedIndex = 0; }
    const calc = () => {
      const va = history.find((h) => h.pub_date === a.value);
      const vb = history.find((h) => h.pub_date === b.value);
      if (!va || !vb) return;
      const diff = vb.comprehensive_value - va.comprehensive_value;
      const pp = va.comprehensive_value ? (diff / va.comprehensive_value) * 100 : 0;
      const cls = chgClass(diff);
      const sign = diff > 0 ? "+" : "";
      box.querySelector("#cmpRes").innerHTML =
        `<b>${a.value}</b> → <b>${b.value}</b>：<span class="${cls}">${sign}${fmt(diff)} 点（${sign}${fmt(pp, 1)}%）</span>`;
    };
    a.addEventListener("change", calc); b.addEventListener("change", calc); calc();
  }, 0);
  return box;
}

// ============ 快递企业运营（新域） ============
async function loadExpress() {
  const d = await (await fetch("data/express.json")).json();
  state.expressData = d;
  $("#lastUpdated").textContent = d.latest_month
    ? `数据截至：${d.latest_month}（用户整理）` : "最近更新：—";
  const c = $("#content");
  c.innerHTML = "";
  if (!d.companies.length) {
    c.innerHTML = `<div class="empty">尚无快递运营数据，点下方「导入快递企业运营数据」上传 Excel。</div>`;
    return;
  }
  const note = document.createElement("div");
  note.className = "domain-note";
  note.textContent = d.source_note || "";
  c.appendChild(note);

  const grid = document.createElement("div");
  grid.className = "grid express-grid";
  d.companies.forEach((comp) => grid.appendChild(expressCard(comp)));
  c.appendChild(grid);
}

function expressCard(comp) {
  const el = document.createElement("div");
  el.className = "card express-card";
  const L = comp.latest;
  // 半年度（-H1）记录仅用于 H1 同比基数，不进入季度/月度序列展示
  const qs = comp.series.filter((r) => !r.month.endsWith("-H1"));
  const momLabel = comp.quarterly ? "较上季" : "环比";
  const mom = (cur, prev) => (prev ? (cur - prev) / prev * 100 : null);
  const prev = qs.length > 1 ? qs[qs.length - 2] : null;
  const kpi = (label, val, unit, yoy, p) => {
    const yc = chgClass(yoy);
    const pc = chgClass(p);
    return `<div class="kpi"><span class="kpi-label">${label}</span>
      <span class="kpi-val">${fmt(val)}<i>${unit}</i></span>
      <span class="kpi-yoy ${yc}">同比 ${pct(yoy)}</span>
      <span class="kpi-mom ${pc}">${momLabel} ${pct(p)}</span></div>`;
  };
  const periodTag = comp.quarterly ? `<span class="exp-freq">${comp.freq_label}</span>` : "";
  const periodVal = comp.quarterly ? quarterLabel(comp.latest_month) : comp.latest_month;
  el.innerHTML = `
    <div class="exp-head"><span class="dot" style="background:${comp.color}"></span>
      <span class="exp-name">${comp.company}</span>${periodTag}<span class="exp-month">${periodVal}</span></div>
    ${kpi("业务收入", L.revenue, "亿", L.revenue_yoy, mom(L.revenue, prev && prev.revenue))}
    ${kpi("业务量", L.volume, "亿件", L.volume_yoy, mom(L.volume, prev && prev.volume))}
    ${kpi("单票收入", L.price, "元", L.price_yoy, mom(L.price, prev && prev.price))}
    ${L.profit != null ? kpi("净利润", L.profit, "亿", L.profit_yoy, mom(L.profit, prev && prev.profit)) : ""}
    <div class="exp-spark" id="spark-${comp.company}"></div>
  `;
  // 迷你走势（优先营收，无数据则退而取业务量/单票，最后留空）
  const pickSpark = () => {
    for (const k of ["revenue", "volume", "price"]) {
      if (qs.some((s) => s[k] != null)) return qs.map((s) => s[k]);
    }
    return qs.map(() => null);
  };
  el.querySelector(`#spark-${comp.company}`).appendChild(
    lineChart(qs.map((s) => s.month), pickSpark(), (v) => fmt(v), comp.color, "",
      260, 56, false, comp.quarterly ? quarterLabel : null));
  el.addEventListener("click", () => toggleExpressDetail(comp, el));
  return el;
}

async function toggleExpressDetail(comp, cardEl) {
  const grid = cardEl.parentElement;
  const existing = grid.querySelector(".detail");
  if (cardEl.classList.contains("expanded")) {
    cardEl.classList.remove("expanded");
    if (existing) existing.remove();
    state.open = null;
    return;
  }
  state.open = "exp:" + comp.company;
  document.querySelectorAll(".detail").forEach((d) => d.remove());
  document.querySelectorAll(".express-card.expanded").forEach((c) => c.classList.remove("expanded"));
  cardEl.classList.add("expanded");
  const detail = document.createElement("div");
  detail.className = "detail express-detail";
  detail.appendChild(expressDetail(comp));
  // 插在卡片紧后方（而非 grid 末尾），避免被其他卡隔开；并跨整行展示宽表格
  cardEl.after(detail);
}

function expressDetail(comp) {
  const wrap = document.createElement("div");
  // 阻断详情内点击冒泡到卡片，避免误触发"收起"
  wrap.addEventListener("click", (e) => e.stopPropagation());
  // 指标切换
  const metrics = [
    { key: "revenue", name: "业务收入", unit: "亿", d: 2 },
    { key: "volume", name: "业务量", unit: "亿件", d: 2 },
    { key: "price", name: "单票收入", unit: "元", d: 2 },
    { key: "profit", name: "净利润", unit: "亿", d: 2 },
  ];
  const bar = document.createElement("div");
  bar.className = "metric-bar";
  metrics.forEach((m, i) => {
    const b = document.createElement("button");
    b.className = "metric-btn" + (i === 0 ? " active" : "");
    b.textContent = m.name;
    b.addEventListener("click", () => {
      bar.querySelectorAll(".metric-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      chartBox.innerHTML = "";
      chartBox.appendChild(drawMetric(comp, m));
    });
    bar.appendChild(b);
  });
  wrap.appendChild(bar);

  const chartBox = document.createElement("div");
  wrap.appendChild(chartBox);
  chartBox.appendChild(drawMetric(comp, metrics[0]));

  // 营业成本细分（中通等季度披露公司）：按季度分别列出 Q1 / Q2
  if (comp.cost_breakdown_by_month && Object.keys(comp.cost_breakdown_by_month).length) {
    // 单票成本绝对变化（元）→ 文案：降X分 / 升X分 / 持平 / —
    const unitDeltaText = (d) =>
      d == null ? "—"
        : d < 0 ? `降${Math.round(-d * 100)}分`
        : d > 0 ? `升${Math.round(d * 100)}分`
        : "持平";
    // 按时间升序排列各季度（便于从上到下 Q1 → Q2 → …）
    const months = Object.keys(comp.cost_breakdown_by_month).sort();
    const h4c = document.createElement("h4");
    h4c.textContent = "营业成本细分（单票成本 = 成本 ÷ 业务量）";
    wrap.appendChild(h4c);
    months.forEach((m) => {
      const items = comp.cost_breakdown_by_month[m];
      const sub = document.createElement("div");
      sub.className = "cost-subtitle";
      sub.textContent = comp.quarterly ? `${quarterLabel(m)}（${m}）` : m;
      wrap.appendChild(sub);
      const ct = document.createElement("table");
      ct.className = "tbl exp-tbl cost-tbl";
      ct.innerHTML = `<thead><tr><th>成本项目</th><th>金额(亿)</th><th>占营收比</th><th>同比</th><th>单票成本(元)</th><th>单票成本变化</th></tr></thead>`;
      const ctb = document.createElement("tbody");
      items.forEach((item) => {
        const tr = document.createElement("tr");
        if (item.total) tr.classList.add("cost-total");
        tr.innerHTML =
          `<td>${item.name}</td>` +
          `<td class="tabular-nums">${fmt(item.amount)}</td>` +
          `<td class="tabular-nums">${item.pct_revenue != null ? item.pct_revenue + "%" : "—"}</td>` +
          `<td class="${chgClass(item.yoy)}">${pct(item.yoy)}</td>` +
          `<td class="tabular-nums">${fmt(item.unit_cost)}</td>` +
          `<td class="${chgClass(item.unit_delta)}">${unitDeltaText(item.unit_delta)}</td>`;
        ctb.appendChild(tr);
      });
      ct.appendChild(ctb);
      wrap.appendChild(ct);
    });
  }

  // 全指标时序表（含同比、环比）：过滤掉 -H1 半年度基数记录
  const qs = comp.series.filter((r) => !r.month.endsWith("-H1"));
  const h4 = document.createElement("h4");
  h4.textContent = `${comp.quarterly ? "季度时序" : "月度时序"}（共 ${qs.length} 期，新→旧）`;
  wrap.appendChild(h4);
  const tbl = document.createElement("table");
  tbl.className = "tbl exp-tbl";
  tbl.innerHTML = `<thead><tr>
    <th>${comp.quarterly ? "季度" : "月份"}</th>
    <th>营收(亿)</th><th>营收同比</th><th>营收${comp.quarterly ? "环比" : "环比"}</th>
    <th>业务量(亿件)</th><th>业务量同比</th><th>业务量环比</th>
    <th>单票(元)</th><th>单票同比</th><th>单票环比</th>
    <th>净利润(亿)</th><th>净利润同比</th><th>净利润环比</th>
  </tr></thead>`;
  const tb = document.createElement("tbody");
  const s = qs;
  for (let i = s.length - 1; i >= 0; i--) {
    const r = s[i];
    const prev = i > 0 ? s[i - 1] : null;
    const mom = (cur, pv) => (pv != null && pv !== 0 ? (cur - pv) / pv * 100 : null);
    const cell = (v, y, m) =>
      `<td>${fmt(v)}</td><td class="${chgClass(y)}">${pct(y)}</td><td class="${chgClass(m)}">${pct(m)}</td>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${comp.quarterly ? quarterLabel(r.month) : r.month}</td>`
      + cell(r.revenue, r.revenue_yoy, mom(r.revenue, prev && prev.revenue))
      + cell(r.volume, r.volume_yoy, mom(r.volume, prev && prev.volume))
      + cell(r.price, r.price_yoy, mom(r.price, prev && prev.price))
      + cell(r.profit, r.profit_yoy, mom(r.profit, prev && prev.profit));
    tb.appendChild(tr);
  }
  tbl.appendChild(tb);
  const sc = document.createElement("div");
  sc.className = "tbl-scroll";
  sc.appendChild(tbl);
  const hint = document.createElement("div");
  hint.className = "tbl-scroll-hint";
  hint.textContent = "← 左右滑动查看完整数据 →";
  sc.appendChild(hint);
  wrap.appendChild(sc);

  // 地区包裹量细分（极兔按地区披露，原文为百万件，统一换算为亿件展示）
  const segRows = [];
  comp.series.forEach((r) => {
    (r.segments || []).forEach((sg) => segRows.push({ month: r.month, region: sg.region, volume: sg.volume, volume_yoy: sg.volume_yoy }));
  });
  if (segRows.length) {
    const h4b = document.createElement("h4");
    h4b.textContent = `地区包裹量细分（亿件，${comp.quarterly ? "极兔季度公告" : ""}原文口径，百万件÷100）`;
    wrap.appendChild(h4b);
    const st = document.createElement("table");
    st.className = "tbl exp-tbl seg-tbl";
    st.innerHTML = `<thead><tr><th>${comp.quarterly ? "季度" : "月份"}</th><th>地区</th><th>包裹量(亿件)</th><th>同比</th></tr></thead>`;
    const stb = document.createElement("tbody");
    segRows.forEach((sg) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${comp.quarterly ? quarterLabel(sg.month) : sg.month}</td><td>${sg.region}</td>`
        + `<td>${fmt(sg.volume / 100)}</td>`
        + `<td class="${chgClass(sg.volume_yoy)}">${pct(sg.volume_yoy)}</td>`;
      stb.appendChild(tr);
    });
    st.appendChild(stb);
    const sc2 = document.createElement("div");
    sc2.className = "tbl-scroll";
    sc2.appendChild(st);
    wrap.appendChild(sc2);
  }

  // 半年度合计（H1）：季度披露企业按当年 Q1+Q2 求和，体现数据本身粒度（非缺数据）
  // 仅当有 ≥2 个季度（Q1+Q2 都存在）时才展示；只有单期（如中通仅 Q1）则跳过
  if (comp.quarterly) {
    const h1Series = comp.series.filter((r) => parseInt(r.month.slice(5, 7), 10) <= 6);
    if (h1Series.length >= 2) {
      const h1Vol = h1Series.reduce((a, r) => a + (r.volume || 0), 0);
      const h1Rev = h1Series.reduce((a, r) => a + (r.revenue || 0), 0);
      const h1Profit = h1Series.reduce((a, r) => a + (r.profit || 0), 0);
      // 上一年 H1 基数（形如 2025-H1 的半年度记录），用于计算 H1 同比
      const h1Prev = comp.series.find((r) => r.month === `${parseInt(h1Series[0].month.slice(0, 4), 10) - 1}-H1`);
      const h1yoy = (cur, prev) => (prev != null && prev !== 0 ? (cur - prev) / prev * 100 : null);
      const h1yoyCell = (cur, prev) => {
        const y = h1yoy(cur, prev);
        return `<td class="${chgClass(y)}">${pct(y)}</td>`;
      };
      const h1h = document.createElement("h4");
      h1h.textContent = "半年度合计（H1，当年 Q1+Q2 求和）";
      wrap.appendChild(h1h);
      const t1 = document.createElement("table");
      t1.className = "tbl exp-tbl";
      t1.innerHTML = `<thead><tr><th>指标</th><th>H1 合计</th><th>同比</th><th>口径</th></tr></thead>`;
      const tb1 = document.createElement("tbody");
      tb1.innerHTML = `<tr><td>业务量</td><td>${fmt(h1Vol)} 亿件</td>${h1yoyCell(h1Vol, h1Prev && h1Prev.volume)}<td>Q1+Q2 合计</td></tr>`
        + (h1Rev
            ? `<tr><td>业务收入</td><td>${fmt(h1Rev)} 亿</td>${h1yoyCell(h1Rev, h1Prev && h1Prev.revenue)}<td>Q1+Q2 合计</td></tr>`
            : `<tr><td>业务收入</td><td class="flat">极兔未披露</td><td>—</td><td>公告仅公布包裹量</td></tr>`)
        + (h1Profit
            ? `<tr><td>净利润</td><td>${fmt(h1Profit)} 亿</td>${h1yoyCell(h1Profit, h1Prev && h1Prev.profit)}<td>Q1+Q2 合计</td></tr>`
            : "");
      t1.appendChild(tb1);
      const sc3 = document.createElement("div");
      sc3.className = "tbl-scroll";
      sc3.appendChild(t1);
      wrap.appendChild(sc3);

      // 地区包裹量 H1 合计（原文百万件口径，按地区求和后÷100换算为亿件展示）
      const regSum = {};
      h1Series.forEach((r) => (r.segments || []).forEach((sg) => {
        regSum[sg.region] = (regSum[sg.region] || 0) + (sg.volume || 0);
      }));
      const regions = Object.keys(regSum);
      if (regions.length) {
        const h1b = document.createElement("h4");
        h1b.textContent = "半年度地区包裹量（亿件，Q1+Q2 合计，百万件÷100）";
        wrap.appendChild(h1b);
        const t2 = document.createElement("table");
        t2.className = "tbl exp-tbl seg-tbl";
        t2.innerHTML = `<thead><tr><th>地区</th><th>包裹量(亿件)</th></tr></thead>`;
        const tb2 = document.createElement("tbody");
        tb2.innerHTML = regions.map((r) => `<tr><td>${r}</td><td>${fmt(regSum[r] / 100)}</td></tr>`).join("")
          + `<tr><td>合计</td><td>${fmt(Object.values(regSum).reduce((a, b) => a + b, 0) / 100)}</td></tr>`;
        t2.appendChild(tb2);
        const sc4 = document.createElement("div");
        sc4.className = "tbl-scroll";
        sc4.appendChild(t2);
        wrap.appendChild(sc4);
      }
    }
  }
  return wrap;
}

// ============ 其他数据（国家邮政局·邮政行业月度） ============
const SPB_COLOR = "#e8590c";

// 月份显示标签：合并报告（如1-2月）标注为「Y年1-2月」，其余显示「YYYY-MM」。
function spbLabel(r) {
  if (r.combined) return `${r.year}年1-2月（合并）`;
  return r.month;
}

async function loadSpb() {
  const d = await (await fetch("data/spb.json")).json();
  state.spbData = d;
  const c = $("#content");
  c.innerHTML = "";
  // 邮政行业月度（国家邮政局） + 卡车销量榜 共用一个网格，保证展开互斥
  const grid = document.createElement("div");
  grid.className = "grid express-grid";
  if (d.series && d.series.length) {
    const note = document.createElement("div");
    note.className = "domain-note";
    note.textContent = `${d.source_note} ｜ 最新月份：${d.latest_month || "—"} ｜ 共 ${d.count} 期`;
    c.appendChild(note);
    grid.appendChild(spbCard(d));
  }
  // 交通运输部·交通运输经济运行情况（月度/季度/半年，散文数字半自动抽取）
  try {
    const md = await (await fetch("data/mot.json")).json();
    if (md && md.periods && md.periods.length) {
      state.motData = md;
      grid.appendChild(motCard(md));
    }
  } catch (e) {
    console.warn("交通运输经济运行情况加载失败", e);
  }
  // 卡车销量榜（卡车之家·每月20日左右公布）
  try {
    const td = await (await fetch("data/truck.json")).json();
    if (td && td.months && td.months.length) {
      grid.appendChild(truckSection(td));
    }
  } catch (e) {
    console.warn("卡车销量榜加载失败", e);
  }
  if (grid.children.length) c.appendChild(grid);
}

// ============ 卡车销量榜（卡车之家）============
const TRUCK_COLOR = "#7E9CA8"; // 莫兰迪蓝主色

function truckCats(td) {
  return (td.categories && td.categories.length)
    ? td.categories
    : [{ key: "all", label: "全部（总销量）", color: "#7E9CA8" },
       { key: "electric", label: "纯电动", color: "#A7C0CC" }];
}

// 收起态：双栏迷你榜单卡（每品类一张小卡：排名徽章+品牌+销量），视觉饱满
function truckSection(td) {
  const sec = document.createElement("section");
  sec.className = "card express-card truck-wrap";
  const months = td.months || [];
  const latest = td.latest_month || months[0] || "";
  const cats = truckCats(td);
  const data = td.by_month || {};
  const lat = data[latest] || {};
  const allTop = (lat.all || [])[0];
  const elecTop = (lat.electric || [])[0];
  // 取前3名做迷你预览（更饱满）
  const all3 = (lat.all || []).slice(0, 3);
  const elec3 = (lat.electric || []).slice(0, 3);
  const miniRow = (rows, color) => rows.map((r, i) => `
    <div class="tp-row${i === 0 ? " tp-top" : ""}">
      <span class="tp-rank">${r.rank}</span>
      <span class="tp-brand">${r.brand}</span>
      <span class="tp-sales">${Number(r.sales).toLocaleString()}</span>
    </div>`).join("");
  sec.innerHTML = `
    <div class="exp-head">
      <span class="dot" style="background:${TRUCK_COLOR}"></span>
      <span class="exp-name">卡车销量榜（卡车之家）</span>
      <span class="exp-month">${latest || "—"}</span>
      <span class="truck-chev">▾</span>
    </div>
    <div class="exp-card-fill">
    <div class="tp-grid">
      <div class="tp-card">
        <div class="tp-card-head" style="border-color:${cats[0] ? cats[0].color : "#7E9CA8"}">
          <span class="tp-dot" style="background:${cats[0] ? cats[0].color : "#7E9CA8"}"></span>
          ${cats[0] ? cats[0].label : "全部"} 榜首
        </div>
        <div class="tp-body">${miniRow(all3, cats[0] ? cats[0].color : "#7E9CA8")}</div>
      </div>
      <div class="tp-card">
        <div class="tp-card-head" style="border-color:${cats[1] ? cats[1].color : "#A7C0CC"}">
          <span class="tp-dot" style="background:${cats[1] ? cats[1].color : "#A7C0CC"}"></span>
          ${cats[1] ? cats[1].label : "纯电动"} 榜首
        </div>
        <div class="tp-body">${miniRow(elec3, cats[1] ? cats[1].color : "#A7C0CC")}</div>
      </div>
    </div>
    </div>`;
  sec.addEventListener("click", () => toggleTruckDetail(sec, td));
  return sec;
}

// 点整卡展开/收起（与全国快递行业卡片同范式：内部 .detail 为兄弟节点，点击不会收起）
function toggleTruckDetail(cardEl, td) {
  const grid = cardEl.parentElement;
  const existing = grid.querySelector(".truck-detail");
  if (cardEl.classList.contains("expanded")) {
    cardEl.classList.remove("expanded");
    if (existing) existing.remove();
    return;
  }
  document.querySelectorAll(".express-card.expanded").forEach((c) => c.classList.remove("expanded"));
  grid.querySelectorAll(".detail").forEach((x) => x.remove());
  cardEl.classList.add("expanded");
  // 插在卡片紧后方，避免被 grid 中后面的卡片隔开
  cardEl.after(truckDetail(td));
}

// 展开详情：月份选择 + 全部/纯电左右并排对比（按 categories 动态生成列）
function truckDetail(td) {
  const wrap = document.createElement("div");
  wrap.className = "detail truck-detail";
  const months = td.months || [];
  const latest = td.latest_month || months[0] || "";
  const cats = truckCats(td);
  const data = td.by_month || {};
  wrap.innerHTML = `
    <div class="truck-detail-head">
      <label>月份</label>
      <select class="truck-sel" id="truckMonthSel">
        ${months.map((m) => `<option value="${m}" ${m === latest ? "selected" : ""}>${m}</option>`).join("")}
      </select>
      <span class="truck-note">${td.source_note || ""}</span>
    </div>
    <div class="truck-cols">
      ${cats.map((c) => `
        <div class="truck-col">
          <div class="truck-col-head">
            <span class="truck-dot" style="background:${c.color}"></span>
            <span class="truck-col-name">${c.label}</span>
            <span class="truck-cat-badge" data-cat="${c.key}">${(data[latest] ? (data[latest][c.key] || []).length : 0)} 家</span>
          </div>
          <div class="truck-col-body" data-cat="${c.key}"></div>
        </div>`).join("")}
    </div>`;
  const sel = wrap.querySelector("#truckMonthSel");
  const render = () => {
    const m = sel.value;
    const md = data[m] || {};
    cats.forEach((c) => {
      const box = wrap.querySelector(`.truck-col-body[data-cat="${c.key}"]`);
      if (box) box.innerHTML = truckTable(md[c.key] || []);
      const badge = wrap.querySelector(`.truck-cat-badge[data-cat="${c.key}"]`);
      if (badge) badge.textContent = `${(md[c.key] || []).length} 家`;
    });
  };
  sel.addEventListener("change", render);
  render();
  return wrap;
}

function truckTable(rows) {
  if (!rows || !rows.length) return `<div class="empty sm">暂无数据</div>`;
  const body = rows.map((r) => {
    const chg = r.sales_change;
    const chgCls = chg == null ? "" : (chg >= 0 ? "up" : "down");
    const chgTxt = chg == null ? "—" : (chg >= 0 ? "+" : "") + Number(chg).toLocaleString();
    return `<tr>
      <td class="t-rank">${r.rank}</td>
      <td class="t-brand"><a href="${r.brand_url || "#"}" target="_blank" rel="noopener">${r.brand}</a></td>
      <td class="t-num">${Number(r.sales || 0).toLocaleString()}</td>
      <td class="t-num ${chgCls}">${chgTxt}</td>
    </tr>`;
  }).join("");
  return `<div class="tbl-scroll"><table class="tbl truck-tbl">
    <thead><tr>
      <th class="t-rank">排名</th>
      <th class="t-brand">品牌</th>
      <th class="t-num">销量(辆)</th>
      <th class="t-num">较上月</th>
    </tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

// ============ 交通运输部·交通运输经济运行情况（半自动抽取） ============
const MOT_COLOR = "#185FA5";

// 预览：取头条指标（货运总量 / 港口货物吞吐 / 交通固定资产投资）做迷你展示
function motCard(d) {
  const el = document.createElement("div");
  el.className = "card express-card mot-wrap";
  const lp = d.latest_period;
  const rows = (d.by_period || {})[lp] || [];
  const rowOf = (ind) => rows.find((r) => r.indicator === ind) || null;
  const labelOf = (p) => (d.periods.find((x) => x.period === p) || {}).period_label || p;
  const sub = (r) => r == null ? "—"
    : (r.cur_val != null
        ? `当月 ${fmt(r.cur_val)}${r.cur_unit || ""}｜累计 ${fmt(r.cum_val)}${r.cum_unit || ""}`
        : `累计 ${fmt(r.cum_val)}${r.cum_unit || ""}`);
  const f = rowOf("freight_total"), p = rowOf("port_cargo"), inv = rowOf("invest_total");
  el.innerHTML = `
    <div class="exp-head"><span class="dot" style="background:${MOT_COLOR}"></span>
      <span class="exp-name">交通运输经济运行情况</span>
      <span class="exp-month">${labelOf(lp)}</span>
      <span class="truck-chev">▾</span></div>
    <div class="exp-card-fill">
      <div class="mot-mini">
        <div class="mot-mini-row"><span>货运总量</span><b>${sub(f)}</b></div>
        <div class="mot-mini-row"><span>港口货物吞吐</span><b>${sub(p)}</b></div>
        <div class="mot-mini-row"><span>交通固定资产投资</span><b>${sub(inv)}</b></div>
      </div>
    </div>`;
  el.addEventListener("click", () => toggleMotDetail(el));
  return el;
}

function toggleMotDetail(cardEl) {
  const grid = cardEl.parentElement;
  const existing = grid.querySelector(".mot-detail");
  if (cardEl.classList.contains("expanded")) {
    cardEl.classList.remove("expanded");
    if (existing) existing.remove();
    return;
  }
  document.querySelectorAll(".express-card.expanded").forEach((c) => c.classList.remove("expanded"));
  grid.querySelectorAll(".detail").forEach((x) => x.remove());
  cardEl.classList.add("expanded");
  // 插在卡片紧后方，避免被 grid 中后面的卡片隔开
  cardEl.after(motDetail(state.motData));
}

// 展开详情：期次下拉 + 按板块分组的子卡（营业性货运量 / 港口吞吐 / 跨区域人员流动 / 城市客运 / 交通固定资产投资）
function motDetail(d) {
  const wrap = document.createElement("div");
  wrap.className = "detail mot-detail";
  const periods = d.periods || [];
  const latest = d.latest_period;
  const cats = d.categories || [];
  const byp = d.by_period || {};
  wrap.innerHTML = `
    <div class="mot-head">
      <label>期次</label>
      <select class="mot-sel" id="motSel">
        ${periods.map((p) => `<option value="${p.period}" ${p.period === latest ? "selected" : ""}>${p.period_label}</option>`).join("")}
      </select>
      <span class="mot-note">${d.source_note || ""}</span>
    </div>
    <div class="mot-grid" id="motGrid"></div>`;
  const sel = wrap.querySelector("#motSel");
  const grid = wrap.querySelector("#motGrid");
  const render = () => {
    const pk = sel.value;
    const rows = byp[pk] || [];
    const byCat = {};
    rows.forEach((r) => { (byCat[r.category] = byCat[r.category] || []).push(r); });
    grid.innerHTML = cats.map((c) => {
      const items = byCat[c.key] || [];
      if (!items.length) return "";
      const body = items.map((r) => {
        const cur = r.cur_val != null
          ? `<span class="mot-cv">当月 ${fmt(r.cur_val)}${r.cur_unit || ""} <i class="${chgClass(r.cur_yoy)}">${pct(r.cur_yoy)}</i></span>`
          : "";
        const cum = r.cum_val != null
          ? `<span class="mot-cv">累计 ${fmt(r.cum_val)}${r.cum_unit || ""} <i class="${chgClass(r.cum_yoy)}">${pct(r.cum_yoy)}</i></span>`
          : "";
        return `<div class="mot-row"><span class="mot-name">${r.label}</span><div class="mot-vals">${cur}${cum}</div></div>`;
      }).join("");
      return `<div class="mot-subcard" style="border-top-color:${c.color}">
        <div class="mot-subhead"><span class="mot-dot" style="background:${c.color}"></span>${c.label}</div>
        <div class="mot-rows">${body}</div></div>`;
    }).join("");
  };
  sel.addEventListener("change", render);
  render();
  return wrap;
}

function spbCard(d) {
  const el = document.createElement("div");
  el.className = "card express-card";
  const s = d.series;
  const L = s[s.length - 1];
  const kpi = (label, val, unit, yoy) => {
    const yc = chgClass(yoy);
    return `<div class="kpi"><span class="kpi-label">${label}</span>
      <span class="kpi-val">${fmt(val)}<i>${unit}</i></span>
      <span class="kpi-yoy ${yc}">同比 ${pct(yoy)}</span></div>`;
  };
  el.innerHTML = `
    <div class="exp-head"><span class="dot" style="background:${SPB_COLOR}"></span>
      <span class="exp-name">全国快递行业（月度）</span><span class="exp-month">${spbLabel(L)}</span></div>
    <div class="exp-card-fill">
    ${kpi("当月快递业务收入", L.rev_month, "亿元", L.rev_month_yoy)}
    ${kpi("当月快递业务量", L.vol_month, "亿件", L.vol_month_yoy)}
    <div class="exp-spark" id="spbSpark"></div>
    </div>`;
  el.querySelector("#spbSpark").appendChild(
    lineChart(s.map((r) => r.month), s.map((r) => r.rev_month),
      (v) => fmt(v), SPB_COLOR, "", 260, 56, false,
      (lb) => { const rec = s.find((r) => r.month === lb); return rec && rec.combined ? "1-2月" : lb.slice(2); }));
  el.addEventListener("click", () => toggleSpbDetail(el));
  return el;
}

async function toggleSpbDetail(cardEl) {
  const grid = cardEl.parentElement;
  const existing = grid.querySelector(".detail");
  if (cardEl.classList.contains("expanded")) {
    cardEl.classList.remove("expanded");
    if (existing) existing.remove();
    return;
  }
  document.querySelectorAll(".express-card.expanded").forEach((c) => c.classList.remove("expanded"));
  grid.querySelectorAll(".detail").forEach((x) => x.remove());
  cardEl.classList.add("expanded");
  const detail = spbDetail(state.spbData);
  // 插在卡片紧后方（而非 grid 末尾），避免被其他卡（如卡车榜）隔开
  cardEl.after(detail);
}

function spbDetail(d) {
  const wrap = document.createElement("div");
  wrap.className = "detail spb-detail";
  const s = d.series;
  const metrics = [
    { key: "rev_month", name: "当月快递业务收入", unit: "亿元" },
    { key: "vol_month", name: "当月快递业务量", unit: "亿件" },
  ];
  const bar = document.createElement("div");
  bar.className = "metric-bar";
  metrics.forEach((m, i) => {
    const b = document.createElement("button");
    b.className = "metric-btn" + (i === 0 ? " active" : "");
    b.textContent = m.name;
    b.addEventListener("click", () => {
      bar.querySelectorAll(".metric-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const chart = wrap.querySelector(".spb-chart");
      chart.innerHTML = "";
      chart.appendChild(drawSpbMetric(s, m));
    });
    bar.appendChild(b);
  });
  wrap.appendChild(bar);
  const chart = document.createElement("div");
  chart.className = "spb-chart";
  chart.appendChild(drawSpbMetric(s, metrics[0]));
  wrap.appendChild(chart);

  // 全月度时序表（当月 + 累计）
  const h4 = document.createElement("h4");
  h4.textContent = `月度时序（共 ${s.length} 期，新→旧）`;
  wrap.appendChild(h4);
  const tbl = document.createElement("table");
  tbl.className = "tbl exp-tbl spb-tbl";
  tbl.innerHTML = `<thead><tr>
    <th>月份</th>
    <th>当月收入(亿)</th><th>收入同比</th>
    <th>当月业务量(亿件)</th><th>量同比</th>
    <th>累计收入(亿)</th><th>累计业务量(亿件)</th>
  </tr></thead>`;
  const tb = document.createElement("tbody");
  for (let i = s.length - 1; i >= 0; i--) {
    const r = s[i];
    const tr = document.createElement("tr");
    if (r.combined) tr.className = "spb-combined";
    tr.innerHTML = `<td>${spbLabel(r)}${r.combined ? ' <span class="tag-comb">合并</span>' : ""}</td>`
      + `<td>${fmt(r.rev_month)}</td><td class="${chgClass(r.rev_month_yoy)}">${pct(r.rev_month_yoy)}</td>`
      + `<td>${fmt(r.vol_month)}</td><td class="${chgClass(r.vol_month_yoy)}">${pct(r.vol_month_yoy)}</td>`
      + `<td>${r.rev_ytd == null ? "—" : fmt(r.rev_ytd)}</td>`
      + `<td>${r.vol_ytd == null ? "—" : fmt(r.vol_ytd)}</td>`;
    tb.appendChild(tr);
  }
  tbl.appendChild(tb);
  const sc = document.createElement("div");
  sc.className = "tbl-scroll";
  sc.appendChild(tbl);
  wrap.appendChild(sc);

  // 口径说明：1-2月为邮局合并发布的两月合计（非单月）；12月取自年报中的12月单行。
  if (s.some((r) => r.combined)) {
    const note = document.createElement("div");
    note.className = "spb-foot-note";
    note.textContent = "说明：2026年1-2月为国家邮政局合并发布的两月合计值（无单月数据，不可拆分）；"
      + "2025年12月取自《2025年邮政行业运行情况》年报中的12月单行。合并月的「当月」数值为两月之和，仅供参考走势。";
    wrap.appendChild(note);
  }
  return wrap;
}

function drawSpbMetric(s, m) {
  const labels = s.map((r) => r.month);
  const vals = s.map((r) => r[m.key]);
  return lineChart(labels, vals, (v) => fmt(v), SPB_COLOR,
    `${m.name}走势（${m.unit}）`, 720, 260, true,
    (lb) => { const rec = s.find((r) => r.month === lb); return rec && rec.combined ? "1-2月" : lb.slice(2); });
}

function drawMetric(comp, m) {
  // 半年度（-H1）基数不进入走势图
  const qs = comp.series.filter((r) => !r.month.endsWith("-H1"));
  const vals = qs.map((s) => s[m.key]);
  // 该指标全为空（如极兔未披露营收/单票）：给出占位说明而非破图
  if (vals.every((v) => v == null)) {
    const div = document.createElement("div");
    div.className = "no-data";
    div.textContent = `${m.name}：该公司未披露（公告未公布该指标）`;
    return div;
  }
  const labels = qs.map((s) => s.month);
  return lineChart(labels, vals, (v) => fmt(v), comp.color,
    `${m.name}走势（${m.unit}）`, 440, 180, true, comp.quarterly ? quarterLabel : null);
}

// ============ 物流榜单（A&A 2026 全球货代 / 3PL / 仓储榜单） ============
async function loadRankings() {
  const d = await (await fetch("data/rankings.json")).json();
  state.rankingsData = d;
  $("#lastUpdated").textContent = d.updated ? `榜单更新：${d.updated}` : "最近更新：—";
  const c = $("#content");
  c.innerHTML = "";
  if (!d.lists || d.lists.length === 0) {
    c.innerHTML = `<div class="empty">尚无物流榜单数据。</div>`;
    return;
  }
  // 顶部搜索栏
  const bar = document.createElement("div");
  bar.className = "rank-bar";
  bar.innerHTML = `<div class="rank-search-wrap"><input type="text" class="rank-search" placeholder="🔍 搜索企业名称（中/英文）…" /><span class="rank-count"></span></div>`;
  c.appendChild(bar);
  const searchInput = bar.querySelector(".rank-search");
  const countEl = bar.querySelector(".rank-count");

  const note = document.createElement("div");
  note.className = "domain-note";
  note.textContent = d.source_note || "";
  c.appendChild(note);

  // 渲染全部榜单卡片
  const listEls = [];
  d.lists.forEach((list, li) => {
    const card = document.createElement("details");
    card.className = "rank-card";
    card.dataset.listIndex = li;
    card.innerHTML = `<summary class="rank-summary"><span class="rank-arrow">▸</span><span class="rank-summary-text"><strong>${list.name}</strong>${list.sub ? `<em>${list.sub}</em>` : ""}</span><span class="rank-badge">${list.rows ? list.rows.length : 0} 家</span></summary>`;
    const body = document.createElement("div");
    body.className = "rank-body";

    // 表格
    const scroll = document.createElement("div");
    scroll.className = "tbl-scroll";
    const tbl = document.createElement("table");
    tbl.className = "tbl ranking-tbl";
    tbl.innerHTML = "<thead><tr>" + list.columns.map((col) => `<th class="${rankAlign(col)}">${col.label}</th>`).join("") + "</tr></thead>";
    const tb = document.createElement("tbody");
    (list.rows || []).forEach((r, ri) => {
      const tr = document.createElement("tr");
      tr.dataset.rank = ri + 1;
      tr.dataset.name = (r.cn || "") + " " + (r.en || "");
      tr.innerHTML = list.columns.map((col) => `<td class="${rankAlign(col)}">${rankCell(col, r)}</td>`).join("");
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    scroll.appendChild(tbl);
    body.appendChild(scroll);

    if (list.note) {
      const fn = document.createElement("p");
      fn.className = "spb-foot-note";
      fn.textContent = list.note;
      body.appendChild(fn);
    }

    card.appendChild(body);
    c.appendChild(card);
    listEls.push({ card, tbl, rows: list.rows || [], columns: list.columns });
  });

  // 搜索过滤
  function doFilter() {
    const q = searchInput.value.trim().toLowerCase();
    let total = 0, visible = 0;
    listEls.forEach(({ card, tbl }) => {
      const rows = tbl.querySelectorAll("tbody tr");
      let cardVisible = false;
      let cardMatchCount = 0;
      rows.forEach((tr) => {
        const name = (tr.dataset.name || "").toLowerCase();
        const match = !q || name.includes(q);
        tr.style.display = match ? "" : "none";
        if (match) { cardVisible = true; cardMatchCount++; }
        total++;
      });
      card.style.display = cardVisible ? "" : "none";
      if (cardVisible) visible += cardMatchCount;
    });
    countEl.textContent = q ? `匹配 ${visible} / ${total}` : `共 ${total} 家`;
  }
  searchInput.addEventListener("input", doFilter);
  // 默认展开第一张卡片
  if (listEls[0]) listEls[0].card.open = true;
  doFilter();

  // 展开/收起箭头旋转
  c.querySelectorAll(".rank-card").forEach((card) => {
    card.addEventListener("toggle", () => {
      const arrow = card.querySelector(".rank-arrow");
      arrow.textContent = card.open ? "▾" : "▸";
    });
  });
}

// 榜单列对齐：rank 居中、name/text 左对齐、int/float1 数值右对齐
function rankAlign(col) {
  if (col.type === "rank") return "t-rank";
  if (col.type === "name") return "t-name";
  if (col.type === "text") return "t-left";
  return "t-num"; // int, float1
}

// 榜单单元格格式化：企业名「中文（英文）」两行；整数千分位；面积保留 1 位小数。
function rankCell(col, r) {
  if (col.type === "name") {
    const cn = r.cn ? `<span class="cn">${r.cn}</span>` : "";
    const en = r.en ? `<span class="en">${r.en}</span>` : "";
    return (cn + en) || "—";
  }
  if (col.type === "int") {
    const v = r[col.key];
    return v == null ? "—" : Number(v).toLocaleString("zh-CN");
  }
  if (col.type === "float1") {
    const v = r[col.key];
    return v == null ? "—" : Number(v).toFixed(1);
  }
  const v = r[col.key];
  return v == null ? "—" : v;
}

// ============ 通用折线图（SVG） ============
function lineChart(labels, vals, fmtFn, color, title, W = 440, H = 180, labelAll = false, labelFn = null) {
  // 内边距自适应：大图用 30px，小图（如 sparkline 260×56）按比例缩小，
  // 保证 H - 2*P - 10 > 0（绘图区高度为正），避免曲线压扁/翻转。
  const P = Math.max(8, Math.min(30, Math.round(Math.min(W, H) * 0.12)));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "chart");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const defined = vals.filter((v) => v != null);
  if (defined.length === 0) {
    return svg;  // 无数据点：返回空 svg，避免 NaN 折线
  }
  const min = Math.min(...defined), max = Math.max(...defined);
  const span = max - min || 1;
  const x = (i) => P + (i * (W - 2 * P)) / (vals.length - 1 || 1);
  const y = (v) => H - P - ((v - min) / span) * (H - 2 * P - 10);
  // 基线
  const base = document.createElementNS("http://www.w3.org/2000/svg", "line");
  base.setAttribute("x1", P); base.setAttribute("x2", W - P);
  base.setAttribute("y1", H - P); base.setAttribute("y2", H - P);
  base.setAttribute("stroke", "#eee"); base.setAttribute("stroke-width", "1");
  svg.appendChild(base);
  // 折线（跳过空值点）
  const pts = vals.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean).join(" ");
  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  poly.setAttribute("points", pts);
  poly.setAttribute("fill", "none");
  poly.setAttribute("stroke", color);
  poly.setAttribute("stroke-width", "2");
  svg.appendChild(poly);
  // 数值标注：labelAll 时每个点都标，否则仅标注末值
  // 防截断策略：边缘点用 start/end 对齐、内部点居中；标签太靠近顶部时下移
  const labelTop = P + 12; // 标签不低于标题区
  if (labelAll) {
    vals.forEach((v, i) => {
      if (v == null) return;
      const px = x(i), py = y(v);
      const p = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      p.setAttribute("cx", px); p.setAttribute("cy", py); p.setAttribute("r", "2.5");
      p.setAttribute("fill", color); svg.appendChild(p);
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      let anchor = "middle";
      let lx = px;
      // 边缘点调整对齐方向，防止文字溢出 viewBox
      if (px < W * 0.1) { anchor = "start"; lx = px + 4; }
      else if (px > W * 0.9) { anchor = "end"; lx = px - 4; }
      let ly = py - 7;
      if (ly < labelTop) ly = py + 14; // 太靠近顶部 → 移到点下方
      t.setAttribute("x", lx); t.setAttribute("y", ly);
      t.setAttribute("text-anchor", anchor); t.setAttribute("font-size", "10");
      t.setAttribute("fill", color); t.textContent = fmtFn(v);
      svg.appendChild(t);
    });
  } else {
    const lastIdx = vals.length - 1;
    const lpx = x(lastIdx), lpy = y(vals[lastIdx]);
    const last = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    last.setAttribute("cx", lpx); last.setAttribute("cy", lpy);
    last.setAttribute("r", "3.5"); last.setAttribute("fill", color);
    svg.appendChild(last);
    const t1 = document.createElementNS("http://www.w3.org/2000/svg", "text");
    let anchor = "end", lx = lpx - 4;
    if (lpx < W * 0.2) { anchor = "start"; lx = lpx + 4; }
    let ly = lpy - 8;
    if (ly < labelTop) ly = lpy + 14;
    t1.setAttribute("x", lx); t1.setAttribute("y", ly);
    t1.setAttribute("text-anchor", anchor); t1.setAttribute("font-size", "11");
    t1.setAttribute("fill", color); t1.textContent = fmtFn(vals[lastIdx]);
    svg.appendChild(t1);
  }
  // x 轴标签（标签多时间隔显示；确保不超出底部）
  const xLabelY = Math.min(H - 4, H - P + 14);
  const step = Math.ceil(labels.length / 6);
  labels.forEach((lb, i) => {
    if (i % step !== 0 && i !== labels.length - 1) return;
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", x(i)); t.setAttribute("y", xLabelY);
    t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", "10");
    t.setAttribute("fill", "#999");
    t.textContent = labelFn ? labelFn(lb) : lb.slice(2);
    svg.appendChild(t);
  });
  if (title) {
    const tt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    tt.setAttribute("x", P); tt.setAttribute("y", 14);
    tt.setAttribute("font-size", "11"); tt.setAttribute("fill", "#666");
    tt.textContent = title;
    svg.appendChild(tt);
  }
  return svg;
}

// ============ 一键刷新（航运域） ============
async function refreshAll() {
  const btn = $("#refreshBtn");
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "刷新中…";
  try {
    const r = await fetch("/api/refresh", { method: "POST", headers: { "X-Owner-Token": OWNER_TOKEN } });
    const d = await r.json();
    const s = d.summary || {};
    toast(`刷新完成：新增 ${s.inserted || 0} 期，已存在/跳过 ${s.skipped || 0}，失败 ${s.errored || 0}`, "ok");
    await loadIndices();
  } catch (e) {
    toast("刷新失败：" + e.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

// ============ 更新行业数据（其他数据域） ============
async function refreshSpb() {
  const btn = $("#spbRefreshBtn");
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "同步中…";
  try {
    const r = await fetch("/api/spb/refresh", { method: "POST", headers: { "X-Owner-Token": OWNER_TOKEN } });
    const d = await r.json();
    const s = d.summary || {};
    let msg = `邮政/卡车同步：新增 ${s.inserted || 0} 期，更新 ${s.updated || 0} 期，跳过 ${s.skipped || 0}，失败 ${s.errored || 0}`;
    // 顺带刷新交通运输部经济运行情况（半自动抽取，失败不影响主流程）
    try {
      const mr = await fetch("/api/mot/refresh", { method: "POST", headers: { "X-Owner-Token": OWNER_TOKEN } });
      const md = await mr.json();
      const ms = md.summary || {};
      msg += `；交通经济运行：新增 ${ms.inserted || 0}，更新 ${ms.updated || 0}，失败 ${ms.errored || 0}`;
    } catch (e) {
      msg += "；交通经济运行同步失败";
    }
    toast(msg, "ok");
    await loadSpb();
  } catch (e) {
    toast("同步失败：" + (e.message || e), "err");
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

// ============ 导入（航运 / 快递） ============
async function importFile() {
  const msg = $("#importMsg"), btn = $("#importBtn");
  const f = $("#importFile").files[0];
  if (!f) { if (msg) msg.textContent = "请先选择文件"; return; }
  if (msg) msg.textContent = "导入中…";
  if (btn) { btn.disabled = true; btn.textContent = "导入中…"; }
  const fd = new FormData();
  fd.append("file", f);
  try {
    const r = await fetch("/api/import", { method: "POST", body: fd, headers: { "X-Owner-Token": OWNER_TOKEN } });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || "导入失败");
    let txt = `已导入 ${d.inserted} 条`;
    if (d.skipped > 0) txt += `，跳过 ${d.skipped} 条`;
    if (d.reason) txt += `（原因：${d.reason}）`;
    if (msg) msg.textContent = txt;
    await loadIndices();
  } catch (e) {
    if (msg) msg.textContent = "导入失败：" + e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "上传并导入"; }
  }
}

async function importExpressFile() {
  const msg = $("#expressImportMsg"), btn = $("#expressImportBtn");
  const f = $("#expressFile").files[0];
  if (!f) { if (msg) msg.textContent = "请先选择文件"; return; }
  if (msg) msg.textContent = "导入中…";
  if (btn) { btn.disabled = true; btn.textContent = "导入中…"; }
  const fd = new FormData();
  fd.append("file", f);
  try {
    const r = await fetch("/api/express/import", { method: "POST", body: fd, headers: { "X-Owner-Token": OWNER_TOKEN } });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || "导入失败");
    let txt = `已导入 ${d.inserted} 条`;
    if (d.ignored > 0) txt += `，忽略 ${d.ignored} 条`;
    if (d.skipped > 0) txt += `，跳过 ${d.skipped} 条`;
    if (d.reason) txt += `（原因：${d.reason}）`;
    if (msg) msg.textContent = txt;
    await loadExpress();
  } catch (e) {
    if (msg) msg.textContent = "导入失败：" + e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "上传并导入"; }
  }
}

function downloadTemplate() {
  const lines = [
    "指数代码,发布日期,综合指数,上期,涨跌,涨跌幅(%),单位",
    "scfi,2026-01-03,1753.21,1760.50,-7.29,0,点",
    "scfi,2026-01-10,1820.50,1753.21,67.29,0,点",
    "ccfi,2026-01-03,1233.45,1220.10,1.1,1,点",
    "cbcfi,2026-01-03,1072.75,973.46,99.29,0,点",
  ];
  const blob = new Blob(["﻿" + lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "运价历史导入模板.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function toast(msg, kind) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast " + (kind || "");
  setTimeout(() => t.classList.add("hidden"), 3600);
}

// ============ 初始化 ============
$("#refreshBtn").addEventListener("click", refreshAll);
$("#importBtn").addEventListener("click", importFile);
const tplBtn = $("#tplBtn");
if (tplBtn) tplBtn.addEventListener("click", downloadTemplate);
$("#expressImportBtn").addEventListener("click", importExpressFile);
$("#spbRefreshBtn").addEventListener("click", refreshSpb);
$("#unlockBtn").addEventListener("click", () => {
  const t = prompt("输入作者令牌以解锁「刷新 / 导入」等管理功能：");
  if (t && t.trim()) {
    OWNER_TOKEN = t.trim();
    try { sessionStorage.setItem("ownerToken", OWNER_TOKEN); } catch (e) {}
    applyOwnerGate();
    syncWriteUI();
    toast("已解锁管理功能");
  }
});

// 按作者身份给 4 个管理 UI + 解锁按钮加/去 owner-only 硬隐藏。
function applyOwnerGate() {
  const owner = isOwner();
  ["#refreshBtn", "#spbRefreshBtn", "#importShipping", "#importExpress"].forEach((s) => {
    const el = $(s);
    if (el) el.classList.toggle("owner-only", !owner);
  });
  // 已是作者（本机或已解锁）则隐藏「解锁管理」按钮
  const ub = $("#unlockBtn");
  if (ub) ub.classList.toggle("owner-only", owner);
}

applyOwnerGate();
syncWriteUI();
loadDomains().then(() => render());
