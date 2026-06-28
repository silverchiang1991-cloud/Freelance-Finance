/* ============================================================
   接案收入管理 — Phase 1
   純前端、資料存在瀏覽器 localStorage,免後端、免註冊。
   資料模型:客戶 client → 案件 project → 收款 payment
   ============================================================ */

'use strict';

/* ---------- 常數 ---------- */
const STORAGE_KEY = 'freelance-income-v1';
const SEED_VERSION_KEY = 'freelance-seed-version';

const PROJECT_STATUS = {
  in_progress: { label: '進行中', cls: 'prog' },
  closed:      { label: '已結案', cls: 'closed' },
};
const PROJECT_STATUS_ORDER = ['in_progress', 'closed'];

// 舊狀態 → 新狀態(資料相容)
const STATUS_MIGRATION = {
  negotiating: 'in_progress',
  in_progress: 'in_progress',
  completed:   'closed',
  closed:      'closed',
};

const PAYMENT_STATUS = {
  unpaid: { label: '未收', cls: 'unpaid' },
  paid:   { label: '已收', cls: 'paid' },
};

/* ---------- 狀態 ---------- */
// 重新匯入機制:當內嵌種子的版本比上次套用的新,就用新種子覆蓋(讓 Google 試算表更新後能反映到 App)。
function maybeApplySeed() {
  const seed = (typeof window !== 'undefined') ? window.__SEED_DATA__ : null;
  const seedVer = (typeof window !== 'undefined' && window.__SEED_VERSION__) || 0;
  if (!seed || !Array.isArray(seed.projects)) return;
  let storedVer = 0, hasData = false;
  try { storedVer = Number(localStorage.getItem(SEED_VERSION_KEY)) || 0; } catch (e) {}
  try { hasData = localStorage.getItem(STORAGE_KEY) !== null; } catch (e) {}
  if (!hasData || seedVer > storedVer) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      localStorage.setItem(SEED_VERSION_KEY, String(seedVer));
    } catch (e) { /* file:// 擋儲存時,loadDB 會改用記憶體中的內嵌種子 */ }
  }
}
maybeApplySeed();

let db = loadDB();
let state = {
  view: 'dashboard',     // dashboard | projects | clients | project-detail
  detailProjectId: null,
  dashboardMode: 'overview',                 // overview | report(總覽頁內切換)
  projectSort: 'status',                     // status | client(案件頁排序)
  // 報表用:統計區間
  reportMode: 'month',                       // month | year
  reportYear: new Date().getFullYear(),
  reportMonth: new Date().getMonth() + 1,    // 1-12
};

/* 圓餅圖配色(柔和、低飽和)。同一個業主用同一個顏色。 */
const PIE_COLORS = ['#7a9cc6', '#7fb18e', '#cbb079', '#d2908f', '#a99bd1',
  '#84b4cc', '#d2a0bf', '#83bbb0', '#dcab86', '#9aa3ad'];
const OTHER_CLIENT_COLOR = '#9aa3ad'; // 其他未指定業主 → 灰
const NO_CLIENT_COLOR = '#b8bec7';    // 沒有業主 → 淺灰

// 指定業主固定顏色(依業主名稱)
const CLIENT_COLOR_OVERRIDES = {};

// 客戶調色盤(儲存的是這些「飽和基準色」;日覽會自動轉成柔和糖果色預覽/呈現)
const CLIENT_PALETTE = ['#f5d24f', '#5fd6c1', '#7a9cc6', '#9d8fe0', '#d2908f',
  '#7fb18e', '#dcab86', '#d2a0bf', '#d05a5a', '#9aa3ad'];
// 調色盤色塊在當前主題下的顯示色(日覽提亮成糖果色,夜覽用原飽和色)
function clientSwatchColor(hex) {
  return document.documentElement.classList.contains('theme-light') ? lightenHex(hex, 0.4) : hex;
}

// 依業主(客戶)決定顏色:優先用客戶自選色 → 指定名稱色 → 灰色;沒有業主用淺灰
function clientColor(clientId) {
  if (!clientId) return NO_CLIENT_COLOR;
  const client = db.clients.find((c) => c.id === clientId);
  if (client && client.color) return client.color;
  if (client && CLIENT_COLOR_OVERRIDES[client.name]) return CLIENT_COLOR_OVERRIDES[client.name];
  const idx = db.clients.findIndex((c) => c.id === clientId);
  return PIE_COLORS[(idx < 0 ? 0 : idx) % PIE_COLORS.length];
}

/* ---------- 資料層 ---------- */
function normalizeDB(data) {
  data.clients = data.clients || [];
  data.projects = data.projects || [];
  data.payments = data.payments || [];
  // 舊案件狀態轉換成新的兩種
  data.projects.forEach((p) => { p.status = STATUS_MIGRATION[p.status] || 'in_progress'; });
  // 收款補上備註、預計收款日欄位
  data.payments.forEach((p) => {
    if (p.note == null) p.note = '';
    if (p.expectedDate == null) p.expectedDate = '';
  });
  return data;
}

function loadDB() {
  // 1) 先嘗試讀本機儲存
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeDB(JSON.parse(raw));
  } catch (e) {
    // 某些瀏覽器在 file:// 下會擋掉 localStorage,這裡不讓它中斷
    console.warn('localStorage 不可用或讀取失敗,改用內嵌資料', e);
  }
  // 2) 還沒有資料(或儲存被擋)→ 用內嵌的種子資料,讓畫面一定有東西
  if (typeof window !== 'undefined' && window.__SEED_DATA__ && Array.isArray(window.__SEED_DATA__.projects)) {
    const seed = normalizeDB(JSON.parse(JSON.stringify(window.__SEED_DATA__)));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(seed)); } catch (e) { /* 存不了就只在記憶體用 */ }
    return seed;
  }
  return { clients: [], projects: [], payments: [] };
}

function saveDB() {
  db._updatedAt = Date.now();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) {
    alert('儲存失敗,可能是瀏覽器空間不足。');
    console.error(e);
  }
  if (typeof dbxScheduleUpload === 'function') dbxScheduleUpload();
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- 工具 ---------- */
function fmtMoney(n) {
  const num = Number(n) || 0;
  return 'NT$' + num.toLocaleString('zh-TW');
}
function fmtDate(s) {
  if (!s) return '—';
  return s; // 已是 yyyy-mm-dd
}
function todayStr() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- 衍生查詢 ---------- */
function clientById(id) { return db.clients.find((c) => c.id === id); }
function projectById(id) { return db.projects.find((p) => p.id === id); }
function paymentsOf(projectId) { return db.payments.filter((p) => p.projectId === projectId); }

// 一個案件「已收」金額
function projectPaid(projectId) {
  return paymentsOf(projectId)
    .filter((p) => p.status === 'paid')
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
}
// 案件報酬 - 已收 = 尚未收到的金額(不可為負)
function projectOutstanding(proj) {
  const out = (Number(proj.amount) || 0) - projectPaid(proj.id);
  return out > 0 ? out : 0;
}
// 案件的「最新收款日」:取底下各筆收款的(實際收款日 / 預計收款日)中最晚的;沒有則回空字串
function projectLatestDate(projectId) {
  const ds = paymentsOf(projectId)
    .map((p) => (p.status === 'paid' ? p.paidDate : p.expectedDate) || '')
    .filter(Boolean);
  return ds.length ? ds.sort()[ds.length - 1] : '';
}

/* ============================================================
   渲染
   ============================================================ */
const viewEl = document.getElementById('view');
const titleEl = document.getElementById('topbar-title');
const fabEl = document.getElementById('fab');

function render() {
  hidePieTooltip();
  // tab 高亮
  document.querySelectorAll('.tab').forEach((t) => {
    const active = t.dataset.view === state.view ||
      (state.view === 'project-detail' && t.dataset.view === 'projects');
    t.classList.toggle('active', active);
  });

  if (state.view === 'dashboard') { titleEl.textContent = '總覽'; fabEl.classList.add('hidden'); renderDashboard(); }
  else if (state.view === 'projects') { titleEl.textContent = '案件'; fabEl.classList.remove('hidden'); renderProjects(); }
  else if (state.view === 'clients') { titleEl.textContent = '客戶'; fabEl.classList.remove('hidden'); renderClients(); }
  else if (state.view === 'project-detail') { titleEl.textContent = '案件明細'; fabEl.classList.add('hidden'); renderProjectDetail(); }

  window.scrollTo(0, 0);
}

/* ---------- 總覽(內含「總覽 / 報表」切換)---------- */
function renderDashboard() {
  const toggle = `
    <div class="seg" id="dash-mode" style="margin-bottom:14px">
      <div class="seg-opt ${state.dashboardMode === 'overview' ? 'active' : ''}" data-dash-mode="overview">總覽</div>
      <div class="seg-opt ${state.dashboardMode === 'report' ? 'active' : ''}" data-dash-mode="report">報表</div>
    </div>`;
  const body = state.dashboardMode === 'report' ? buildReport() : buildOverview();
  viewEl.innerHTML = toggle + body;
}

function buildOverview() {
  const activeProjects = db.projects.filter((p) => p.status === 'in_progress');
  const closedProjects = db.projects.filter((p) => p.status === 'closed');
  // 總收入:全部案件報酬(進行中 + 已結案)
  const totalIncome = db.projects.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  // 尚待收款:進行中案件報酬總和
  const pendingTotal = activeProjects.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  // 實際累計收入:所有「已收」的款(含進行中案件先收的預收款)
  const receivedTotal = db.payments
    .filter((p) => p.status === 'paid')
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  // 累計應收(已結案但未收):已結案案件底下還沒收到的款
  const closedIds = new Set(closedProjects.map((p) => p.id));
  const closedReceivable = db.payments
    .filter((p) => p.status === 'unpaid' && closedIds.has(p.projectId))
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const ym = todayStr().slice(0, 7);
  // 本月應收(預計收款日落在本月、且還沒收到的款)
  const monthDue = db.payments
    .filter((p) => p.status === 'unpaid' && (p.expectedDate || '').slice(0, 7) === ym)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  // 本月已收(實際收款日落在本月、已收的款)
  const monthReceived = db.payments
    .filter((p) => p.status === 'paid' && (p.paidDate || '').slice(0, 7) === ym)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  if (db.projects.length === 0 && db.clients.length === 0) {
    return emptyState('👋', '歡迎使用接案收入管理',
      '先到「客戶」新增你的客戶,或直接到「案件」記下第一個案子。');
  }

  return `
    <div class="hovergroup">
      <div class="stat aurora aurora-hero hero">
        <div class="stat-label">總收入(進行中＋已結案)</div>
        <div class="stat-value">${fmtMoney(totalIncome)}</div>
        <div class="stat-sub">${db.projects.length} 個案件 · ${db.clients.length} 位業主</div>
        <div class="hero-hint">移到此處看本月 ↓</div>
      </div>
      <div class="month-row">
        <div class="stat aurora aurora-orange">
          <div class="stat-label">本月應收</div>
          <div class="stat-value">${fmtMoney(monthDue)}</div>
          <div class="stat-sub">${ym}・尚未收到</div>
        </div>
        <div class="stat aurora aurora-green">
          <div class="stat-label">本月已收</div>
          <div class="stat-value">${fmtMoney(monthReceived)}</div>
          <div class="stat-sub">${ym}・實際入帳</div>
        </div>
      </div>
    </div>

    <div class="trio">
      <div class="stat aurora aurora-green">
        <div class="stat-label">實際累計收入</div>
        <div class="stat-value">${fmtMoney(receivedTotal)}</div>
      </div>
      <div class="stat aurora aurora-red">
        <div class="stat-label">累計應收</div>
        <div class="stat-value">${fmtMoney(closedReceivable)}</div>
      </div>
      <div class="stat aurora aurora-amber">
        <div class="stat-label">尚待收款<br>(進行中)</div>
        <div class="stat-value">${fmtMoney(pendingTotal)}</div>
      </div>
    </div>

    <div class="section-title">案件(移到下方圖示展開)</div>
    <div class="proj-toggles">
      <div class="proj-group">
        <button class="proj-icon">
          <span class="proj-icon-emoji">📂</span>
          <span class="proj-icon-label">進行中</span>
          <span class="proj-count">${activeProjects.length}</span>
        </button>
        <div class="proj-list">
          ${
            activeProjects.length
              ? activeProjects.map((p, i) => projectRow(p, false, i)).join('')
              : `<div class="card"><div class="row-sub" style="text-align:center">目前沒有進行中的案件</div></div>`
          }
        </div>
      </div>
      <div class="proj-group">
        <button class="proj-icon">
          <span class="proj-icon-emoji">✅</span>
          <span class="proj-icon-label">已結案</span>
          <span class="proj-count">${closedProjects.length}</span>
        </button>
        <div class="proj-list">
          ${
            closedProjects.length
              ? closedProjects.map((p, i) => projectRow(p, false, i)).join('')
              : `<div class="card"><div class="row-sub" style="text-align:center">還沒有已結案的案件</div></div>`
          }
        </div>
      </div>
    </div>
  `;
}

/* ---------- 案件列表 ---------- */
function renderProjects() {
  if (db.projects.length === 0) {
    viewEl.innerHTML = emptyState('📁', '還沒有案件',
      '點右下角的「＋」新增你的第一個案件。');
    return;
  }
  const sort = state.projectSort;
  const toggle = `
    <div class="seg" style="margin-bottom:14px">
      <div class="seg-opt ${sort === 'status' ? 'active' : ''}" data-proj-sort="status">依狀態</div>
      <div class="seg-opt ${sort === 'client' ? 'active' : ''}" data-proj-sort="client">依業主</div>
    </div>`;

  let body;
  if (sort === 'client') {
    // 依業主分組(業主名稱排序),沒有業主的放最後
    const byClient = new Map();
    db.projects.forEach((p) => {
      const c = p.clientId ? clientById(p.clientId) : null;
      const key = c ? c.id : '__none__';
      if (!byClient.has(key)) byClient.set(key, { name: c ? c.name : '未指定業主', noClient: !c, items: [] });
      byClient.get(key).items.push(p);
    });
    const groups = [...byClient.values()].sort((a, b) => {
      if (a.noClient !== b.noClient) return a.noClient ? 1 : -1;
      return a.name.localeCompare(b.name, 'zh-Hant');
    });
    body = groups.map((g) => {
      // 同業主內:依最新收款日由新到舊(越晚的排越前面)
      g.items.sort((a, b) => projectLatestDate(b.id).localeCompare(projectLatestDate(a.id)));
      return `<div class="section-title">${esc(g.name)} (${g.items.length})</div>` +
        g.items.map((p) => projectRow(p)).join('');
    }).join('');
  } else {
    body = PROJECT_STATUS_ORDER.map((st) => {
      const items = db.projects.filter((p) => p.status === st);
      if (!items.length) return '';
      return `<div class="section-title">${PROJECT_STATUS[st].label} (${items.length})</div>` +
        items.map((p) => projectRow(p)).join('');
    }).join('');
  }
  viewEl.innerHTML = toggle + body;
}

function projectRow(p, showOutstanding, i) {
  const client = clientById(p.clientId);
  const st = PROJECT_STATUS[p.status] || PROJECT_STATUS.in_progress;
  const out = projectOutstanding(p);
  const sub = showOutstanding
    ? `${client ? esc(client.name) : '未指定客戶'} · 待收 ${fmtMoney(out)}`
    : `${client ? esc(client.name) : '未指定客戶'}`;
  const stagger = (i != null) ? ` stagger" style="--i:${Math.min(i, 10)}` : '';
  return `
    <div class="card card-tappable${stagger}" data-open-project="${p.id}">
      <div class="row">
        <div class="row-main">
          <div class="row-title">${esc(p.name)}</div>
          <div class="row-sub">${sub}</div>
        </div>
        <div style="text-align:right">
          <div class="row-amount">${fmtMoney(p.amount)}</div>
          <div style="margin-top:4px"><span class="badge ${st.cls}">${st.label}</span></div>
        </div>
      </div>
    </div>`;
}

/* ---------- 案件明細 ---------- */
function renderProjectDetail() {
  const p = projectById(state.detailProjectId);
  if (!p) { state.view = 'projects'; render(); return; }
  const client = clientById(p.clientId);
  const st = PROJECT_STATUS[p.status] || PROJECT_STATUS.in_progress;
  const pays = paymentsOf(p.id).sort((a, b) => (b.paidDate || '').localeCompare(a.paidDate || ''));
  const paid = projectPaid(p.id);
  const out = projectOutstanding(p);

  viewEl.innerHTML = `
    <button class="back-link" id="back-projects">‹ 返回案件</button>
    <div class="card">
      <div class="detail-head">
        <div class="detail-title">${esc(p.name)}</div>
        <span class="badge ${st.cls}">${st.label}</span>
      </div>
      <div class="detail-amount">${fmtMoney(p.amount)}</div>
      <div class="kv"><span class="kv-key">客戶</span><span class="kv-val">${client ? esc(client.name) : '未指定'}</span></div>
      <div class="kv"><span class="kv-key">已收款</span><span class="kv-val" style="color:var(--green)">${fmtMoney(paid)}</span></div>
      <div class="kv"><span class="kv-key">尚待收款</span><span class="kv-val" style="color:${out > 0 ? 'var(--amber)' : 'var(--muted)'}">${fmtMoney(out)}</span></div>
      <div class="actions-row">
        <button class="btn btn-ghost btn-sm" data-edit-project="${p.id}">編輯案件</button>
        <button class="btn btn-danger-ghost btn-sm" data-del-project="${p.id}">刪除</button>
      </div>
    </div>

    <div class="section-title">收款紀錄 (${pays.length})</div>
    ${
      pays.length
        ? pays.map(paymentRow).join('')
        : `<div class="card"><div class="row-sub" style="text-align:center">還沒有收款紀錄</div></div>`
    }
    <button class="btn btn-primary btn-block" data-edit-project="${p.id}" style="margin-top:12px">編輯案件 / 收款</button>
  `;
}

function paymentRow(pay) {
  const st = PAYMENT_STATUS[pay.status] || PAYMENT_STATUS.unpaid;
  let sub, overdue = false;
  if (pay.status === 'paid') {
    sub = '實際收款日 ' + fmtDate(pay.paidDate);
  } else if (pay.expectedDate) {
    overdue = pay.expectedDate < todayStr();
    sub = (overdue ? '⚠️ 已逾期・' : '') + '預計收款日 ' + fmtDate(pay.expectedDate);
  } else {
    sub = '尚未收款';
  }
  return `
    <div class="card">
      <div class="row">
        <div class="row-main">
          <div class="row-title">${fmtMoney(pay.amount)}</div>
          <div class="row-sub${overdue ? ' overdue' : ''}">${sub}</div>
          ${pay.note ? `<div class="pay-note">📝 ${esc(pay.note)}</div>` : ''}
        </div>
        <span class="badge ${st.cls}">${st.label}</span>
      </div>
    </div>`;
}

/* ---------- 報表(圓餅圖,回傳 HTML 字串給總覽嵌入)---------- */
function buildReport() {
  const isMonth = state.reportMode === 'month';
  // 區間判斷 + 標籤
  let periodLabel, inPeriod;
  if (isMonth) {
    const ym = `${state.reportYear}-${String(state.reportMonth).padStart(2, '0')}`;
    periodLabel = `${state.reportYear} 年 ${state.reportMonth} 月`;
    inPeriod = (d) => (d || '').slice(0, 7) === ym;
  } else {
    periodLabel = `${state.reportYear} 年`;
    inPeriod = (d) => (d || '').slice(0, 4) === String(state.reportYear);
  }

  // 依案件彙總「已收款」金額
  const byProject = {};
  db.payments
    .filter((p) => p.status === 'paid' && inPeriod(p.paidDate))
    .forEach((p) => { byProject[p.projectId] = (byProject[p.projectId] || 0) + (Number(p.amount) || 0); });

  // 再依「業主」彙總:圓餅圖一個業主一整塊(同業主的多個案子合併,不互相分離)
  const byClient = new Map();
  Object.keys(byProject).forEach((pid) => {
    const proj = projectById(pid);
    const cid = proj ? proj.clientId : null;
    const key = cid || '__none__';
    if (!byClient.has(key)) {
      const c = cid ? clientById(cid) : null;
      byClient.set(key, { name: c ? c.name : '未指定業主', color: clientColor(cid), amount: 0, projects: [] });
    }
    const entry = byClient.get(key);
    entry.amount += byProject[pid];
    entry.projects.push({ name: proj ? proj.name : '(已刪除案件)', amount: byProject[pid] });
  });
  // 圓餅圖切片 = 每個業主一塊(依金額大到小);業主內的案子也排序
  const slices = [...byClient.values()].sort((a, b) => b.amount - a.amount);
  slices.forEach((c) => c.projects.sort((a, b) => b.amount - a.amount));
  const total = slices.reduce((s, x) => s + x.amount, 0);

  const controls = `
    <div class="seg" id="report-mode" style="margin-bottom:14px">
      <div class="seg-opt ${isMonth ? 'active' : ''}" data-report-mode="month">依月</div>
      <div class="seg-opt ${!isMonth ? 'active' : ''}" data-report-mode="year">依年</div>
    </div>
    <div class="period-nav">
      <button class="period-btn" data-report-step="-1" aria-label="上一個">‹</button>
      <div class="period-label">${periodLabel}</div>
      <button class="period-btn" data-report-step="1" aria-label="下一個">›</button>
    </div>`;

  if (total <= 0) {
    return controls + emptyState('📈', '這個期間還沒有收入',
      '這段時間內沒有「已收款」的紀錄。把收款標記為已收、並填上實際收款日,就會出現在這裡。');
  }

  // 圖例:每個案子一列,依業主分組、用業主顏色
  const legend = slices.map((c) =>
    c.projects.map((p) => {
      const pct = total ? Math.round((p.amount / total) * 100) : 0;
      return `
      <div class="legend-row">
        <span class="legend-dot" style="background:${c.color}"></span>
        <span class="legend-name">${esc(p.name)}</span>
        <span class="legend-pct">${pct}%</span>
        <span class="legend-amt">${fmtMoney(p.amount)}</span>
      </div>`;
    }).join('')
  ).join('');

  return `
    ${controls}
    <div class="card">
      <div class="pie-wrap">${pieSVG(slices, total)}</div>
      <div class="legend">${legend}</div>
    </div>`;
}

// 把顏色變深(乘上係數),用來做立體漸層的暗端
function darkenHex(hex, f) {
  const h = (hex || '#888888').replace('#', '');
  const ch = (i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f)));
  return '#' + [ch(0), ch(2), ch(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// 把顏色提亮(往白色混),用來做立體漸層的亮端
function lightenHex(hex, amt) {
  const h = (hex || '#888888').replace('#', '');
  const ch = (i) => { const c = parseInt(h.slice(i, i + 2), 16); return Math.round(c + (255 - c) * amt); };
  return '#' + [ch(0), ch(2), ch(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// 文字在某顏色上要用深字或白字
function textOn(hex) {
  const h = (hex || '#888888').replace('#', '');
  const lum = 0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16);
  return lum > 150 ? darkenHex(hex, 0.32) : '#ffffff';
}

// 以 SVG 畫立體發光圓環:圓環 + 上亮下暗圓柱打光 + 投影浮起
function pieSVG(slices, total) {
  const cx = 110, cy = 110, r = 74, W = 46; // 環半徑、環粗
  const yTop = cy - (r + W / 2), yBot = cy + (r + W / 2);
  const HOVER_OFFSET = 9;
  const polar = (deg, rad) => {
    const a = (deg * Math.PI) / 180;
    return { x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) };
  };
  // 日覽用清新糖果色(整塊粉嫩淺色),夜覽用原本飽和色立體打光
  const light = document.documentElement.classList.contains('theme-light');
  const stops = (c) => light
    ? [lightenHex(c, 0.62), lightenHex(c, 0.42), lightenHex(c, 0.18)]
    : [lightenHex(c, 0.42), c, darkenHex(c, 0.5)];
  // 每塊一個垂直漸層:上方提亮、下方壓深(立體圓柱打光),用真實座標跨整個圓環
  const defs = slices.map((s, i) => {
    const [a, b, d] = stops(s.color);
    return `<linearGradient id="auroraGrad${i}" gradientUnits="userSpaceOnUse" x1="${cx}" y1="${yTop.toFixed(1)}" x2="${cx}" y2="${yBot.toFixed(1)}">` +
      `<stop offset="0" stop-color="${a}"/><stop offset="0.5" stop-color="${b}"/><stop offset="1" stop-color="${d}"/></linearGradient>`;
  }).join('') +
    `<filter id="ringLift" x="-30%" y="-30%" width="160%" height="170%">` +
    `<feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000000" flood-opacity="0.38"/></filter>`;

  const centerTxt =
    `<text x="${cx}" y="${cy - 8}" text-anchor="middle" font-family="var(--font-sans)" font-size="11" fill="var(--muted)">總收入</text>` +
    `<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-family="var(--font-sans)" font-size="17" font-weight="600" fill="var(--text)">${fmtMoney(total)}</text>`;

  if (slices.length === 1) {
    return `<svg viewBox="0 0 220 220" class="pie-svg" role="img" aria-label="收入圓環">` +
      `<defs>${defs}</defs>` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#auroraGrad0)" stroke-width="${W}" filter="url(#ringLift)"/>` +
      centerTxt + `</svg>`;
  }

  let angle = -90;
  const arcs = [], labels = [];
  slices.forEach((s, i) => {
    const frac = s.amount / total;
    const a0 = angle, a1 = angle + frac * 360;
    angle = a1;
    const large = frac > 0.5 ? 1 : 0;
    const p0 = polar(a0, r), p1 = polar(a1, r);
    const mid = (a0 + a1) / 2;
    const dx = (HOVER_OFFSET * Math.cos((mid * Math.PI) / 180)).toFixed(2);
    const dy = (HOVER_OFFSET * Math.sin((mid * Math.PI) / 180)).toFixed(2);
    const pct = Math.round(frac * 100);
    arcs.push(`<path class="pie-slice" style="--tx:${dx}px;--ty:${dy}px" ` +
      `data-name="${esc(s.name)}" data-amount="${fmtMoney(s.amount)}" data-pct="${pct}" ` +
      `fill="none" stroke="url(#auroraGrad${i})" stroke-width="${W}" ` +
      `d="M${p0.x.toFixed(2)},${p0.y.toFixed(2)} A${r},${r} 0 ${large} 1 ${p1.x.toFixed(2)},${p1.y.toFixed(2)}"/>`);
    if (pct >= 6) {
      const lp = polar(mid, r);
      const labelFill = light ? darkenHex(s.color, 0.5) : textOn(s.color);
      labels.push(`<text x="${lp.x.toFixed(1)}" y="${lp.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="var(--font-sans)" font-size="13" font-weight="600" fill="${labelFill}">${pct}%</text>`);
    }
  });
  return `<svg viewBox="0 0 220 220" class="pie-svg" role="img" aria-label="收入圓環">` +
    `<defs>${defs}</defs>` +
    `<g filter="url(#ringLift)">${arcs.join('')}</g>` +
    labels.join('') + centerTxt + `</svg>`;
}

// 報表區間前後切換
function stepReport(dir) {
  if (state.reportMode === 'month') {
    let m = state.reportMonth + dir;
    let y = state.reportYear;
    if (m < 1) { m = 12; y -= 1; }
    else if (m > 12) { m = 1; y += 1; }
    state.reportMonth = m; state.reportYear = y;
  } else {
    state.reportYear += dir;
  }
  render();
}

/* ---------- 客戶列表 ---------- */
function renderClients() {
  if (db.clients.length === 0) {
    viewEl.innerHTML = emptyState('👤', '還沒有客戶',
      '點右下角的「＋」新增你的第一個客戶。');
    return;
  }
  viewEl.innerHTML = db.clients.map((c) => {
    const count = db.projects.filter((p) => p.clientId === c.id).length;
    return `
      <div class="card card-tappable" data-edit-client="${c.id}">
        <div class="row">
          <div class="row-main">
            <div class="row-title">${esc(c.name)}</div>
            <div class="row-sub">${count} 個案件</div>
          </div>
          <span class="chevron">›</span>
        </div>
      </div>`;
  }).join('');
}

/* ---------- 共用 ---------- */
function emptyState(emoji, title, hint) {
  return `<div class="empty">
    <div class="empty-emoji">${emoji}</div>
    <div class="empty-title">${title}</div>
    <div class="empty-hint">${hint}</div>
  </div>`;
}

/* ============================================================
   表單 Modal
   ============================================================ */
const modalRoot = document.getElementById('modal-root');

function closeModal() { modalRoot.innerHTML = ''; }

function openModal(innerHTML) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="backdrop">
      <div class="modal" id="modal">
        <div class="modal-grabber"></div>
        ${innerHTML}
      </div>
    </div>`;
  document.getElementById('backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'backdrop') closeModal();
  });
}

/* ---------- 客戶表單 ---------- */
function clientForm(existing) {
  const c = existing || { name: '' };
  let selectedColor = (existing && existing.color) ? existing.color
    : (existing ? clientColor(existing.id) : CLIENT_PALETTE[db.clients.length % CLIENT_PALETTE.length]);
  const swatches = CLIENT_PALETTE.map((hex) =>
    `<button type="button" class="color-swatch ${hex === selectedColor ? 'active' : ''}" data-color="${hex}" style="background:${clientSwatchColor(hex)}" aria-label="顏色"></button>`).join('');
  openModal(`
    <div class="modal-title">${existing ? '編輯客戶' : '新增客戶'}</div>
    <div class="field">
      <label>客戶名稱 <span class="req">*</span></label>
      <input id="f-name" type="text" value="${esc(c.name)}" placeholder="個人或公司名稱" autocomplete="off" />
      <div class="field-error" id="e-name" style="display:none">請輸入客戶名稱</div>
    </div>
    <div class="field">
      <label>顏色</label>
      <div class="color-grid" id="f-colors">${swatches}</div>
      <div class="field-hint">報表圓餅圖會用這個顏色(日覽會自動轉成柔和糖果色)。</div>
    </div>
    <div class="modal-actions">
      ${existing ? `<button class="btn btn-danger-ghost" id="del">刪除</button>` : ''}
      <button class="btn btn-primary" id="save">儲存</button>
    </div>
  `);
  const nameInput = document.getElementById('f-name');
  nameInput.focus();
  document.querySelectorAll('#f-colors .color-swatch').forEach((sw) => {
    sw.addEventListener('click', () => {
      selectedColor = sw.dataset.color;
      document.querySelectorAll('#f-colors .color-swatch').forEach((o) => o.classList.toggle('active', o === sw));
    });
  });
  document.getElementById('save').addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { document.getElementById('e-name').style.display = 'block'; return; }
    if (existing) {
      existing.name = name; existing.color = selectedColor;
    } else {
      db.clients.push({ id: uid(), name, color: selectedColor, createdAt: Date.now() });
    }
    saveDB(); closeModal(); render();
  });
  if (existing) {
    document.getElementById('del').addEventListener('click', () => {
      const count = db.projects.filter((p) => p.clientId === existing.id).length;
      const msg = count
        ? `這個客戶底下還有 ${count} 個案件。刪除客戶不會刪除案件,但那些案件會變成「未指定客戶」。確定刪除?`
        : '確定刪除這個客戶?';
      if (!confirm(msg)) return;
      db.projects.forEach((p) => { if (p.clientId === existing.id) p.clientId = null; });
      db.clients = db.clients.filter((c) => c.id !== existing.id);
      saveDB(); closeModal(); render();
    });
  }
}

/* ---------- 案件表單(一頁:進度 + 分期收款)---------- */
function projectForm(existing) {
  const st = {
    name: existing ? existing.name : '',
    clientId: existing ? (existing.clientId || '') : (db.clients[0] ? db.clients[0].id : ''),
    status: existing ? existing.status : 'in_progress',
    pays: existing
      ? paymentsOf(existing.id).map((p) => ({
          id: p.id, amount: p.amount, status: p.status,
          date: (p.status === 'paid' ? p.paidDate : p.expectedDate) || '', note: p.note || '',
        }))
      : [],
  };
  if (!st.pays.length) st.pays = [{ amount: '', status: 'unpaid', date: '', note: '' }];

  const paidSum = () => st.pays.filter((p) => p.status === 'paid').reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const totalSum = () => st.pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  function syncFromDom() {
    const root = document.getElementById('pf-root');
    if (!root) return;
    const nm = root.querySelector('#pf-name'); if (nm) st.name = nm.value;
    const cl = root.querySelector('#pf-client'); if (cl) st.clientId = cl.value;
    root.querySelectorAll('.pf-pay').forEach((row) => {
      const p = st.pays[Number(row.dataset.i)]; if (!p) return;
      const a = row.querySelector('.pf-amt'); if (a) p.amount = a.value;
      const d = row.querySelector('.pf-date'); if (d) p.date = d.value;
      const n = row.querySelector('.pf-note'); if (n) p.note = n.value;
    });
  }

  function buildBody() {
    const multi = st.pays.length > 1;
    const paid = paidSum(), tot = totalSum();
    const pct = tot > 0 ? Math.round((paid / tot) * 100) : 0;
    const paysHtml = st.pays.map((p, i) => `
      <div class="pf-pay" data-i="${i}">
        <div class="pf-pay-head">
          <span class="pf-pay-title">${multi ? `第 ${i + 1} 期` : '收款'}</span>
          <div class="seg seg-mini">
            <div class="seg-opt ${p.status === 'unpaid' ? 'active' : ''}" data-pay-status="unpaid" data-i="${i}">未收</div>
            <div class="seg-opt ${p.status === 'paid' ? 'active' : ''}" data-pay-status="paid" data-i="${i}">已收</div>
          </div>
          ${multi ? `<button class="pf-remove" data-remove="${i}" aria-label="移除">✕</button>` : ''}
        </div>
        <div class="pf-pay-row">
          <input class="pf-amt" type="number" inputmode="numeric" value="${p.amount}" placeholder="金額" />
          <input class="pf-date" type="date" value="${p.date || ''}" />
        </div>
        <input class="pf-note" type="text" value="${esc(p.note || '')}" placeholder="備註(選填,如:預收款、代扣所得稅…)" style="margin-top:8px" />
      </div>`).join('');

    return `
      <div class="modal-title">${existing ? '編輯案件' : '新增案件'}</div>
      <div class="field">
        <label>案件名稱 <span class="req">*</span></label>
        <input id="pf-name" type="text" value="${esc(st.name)}" placeholder="例如:XX 官網設計" autocomplete="off" />
        <div class="field-error" id="pf-e-name" style="display:none">請輸入案件名稱</div>
      </div>
      <div class="field">
        <label>所屬客戶</label>
        ${
          db.clients.length
            ? `<select id="pf-client">${db.clients.map((c) => `<option value="${c.id}" ${c.id === st.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`
            : `<div class="field-hint">還沒有客戶,可先留空。</div>`
        }
      </div>

      <div class="pf-status">
        <div class="pf-status-label">進度</div>
        <div class="seg" id="pf-progress">
          ${PROJECT_STATUS_ORDER.map((s) => `<div class="seg-opt ${s === st.status ? 'active' : ''}" data-progress="${s}">${PROJECT_STATUS[s].label}</div>`).join('')}
        </div>
        <div class="pf-pay-summary">
          <span>收款${multi ? `(分 ${st.pays.length} 期)` : ''}</span>
          <span>已收 <b style="color:var(--green)">${fmtMoney(paid)}</b> / ${fmtMoney(tot)}</span>
        </div>
        <div class="pf-bar"><div class="pf-bar-fill" style="width:${pct}%"></div></div>
        ${paysHtml}
        <button class="pf-add" id="pf-add">＋ 新增一期(分次收款)</button>
      </div>

      <div class="field-error" id="pf-e-amount" style="display:none;margin:6px 0 0">請至少填一筆大於 0 的收款金額</div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="pf-save">儲存</button>
      </div>`;
  }

  function bind() {
    const root = document.getElementById('pf-root');
    root.querySelectorAll('#pf-progress .seg-opt').forEach((o) =>
      o.addEventListener('click', () => { syncFromDom(); st.status = o.dataset.progress; refresh(); }));
    root.querySelectorAll('[data-pay-status]').forEach((o) =>
      o.addEventListener('click', () => {
        syncFromDom();
        const p = st.pays[Number(o.dataset.i)];
        p.status = o.dataset.payStatus;
        if (p.status === 'paid' && !p.date) p.date = todayStr();
        refresh();
      }));
    root.querySelectorAll('[data-remove]').forEach((b) =>
      b.addEventListener('click', () => { syncFromDom(); st.pays.splice(Number(b.dataset.remove), 1); refresh(); }));
    const add = root.querySelector('#pf-add');
    if (add) add.addEventListener('click', () => { syncFromDom(); st.pays.push({ amount: '', status: 'unpaid', date: '', note: '' }); refresh(); });
    root.querySelector('#pf-save').addEventListener('click', save);
  }

  function refresh() {
    document.getElementById('pf-root').innerHTML = buildBody();
    bind();
  }

  function save() {
    syncFromDom();
    const name = st.name.trim();
    const valid = st.pays.filter((p) => Number(p.amount) > 0);
    let ok = true;
    if (!name) { document.getElementById('pf-e-name').style.display = 'block'; ok = false; }
    if (!valid.length) { document.getElementById('pf-e-amount').style.display = 'block'; ok = false; }
    if (!ok) return;
    const clientId = st.clientId || null;
    const amount = valid.reduce((s, p) => s + Number(p.amount), 0);
    let projectId;
    if (existing) {
      Object.assign(existing, { name, amount, status: st.status, clientId });
      projectId = existing.id;
      db.payments = db.payments.filter((p) => p.projectId !== projectId);
    } else {
      projectId = uid();
      db.projects.push({ id: projectId, name, amount, status: st.status, clientId, createdAt: Date.now() });
    }
    valid.forEach((p) => {
      db.payments.push({
        id: p.id || uid(), projectId, amount: Number(p.amount), status: p.status,
        paidDate: p.status === 'paid' ? (p.date || todayStr()) : '',
        expectedDate: p.status === 'paid' ? '' : (p.date || ''),
        note: (p.note || '').trim(), createdAt: Date.now(),
      });
    });
    saveDB(); closeModal(); render();
  }

  openModal(`<div id="pf-root">${buildBody()}</div>`);
  bind();
  const nm = document.getElementById('pf-name'); if (nm) nm.focus();
}

/* ---------- 刪除案件 ---------- */
function deleteProject(id) {
  const pays = paymentsOf(id).length;
  const msg = pays
    ? `這個案件有 ${pays} 筆收款紀錄,會一起刪除。確定?`
    : '確定刪除這個案件?';
  if (!confirm(msg)) return;
  db.payments = db.payments.filter((p) => p.projectId !== id);
  db.projects = db.projects.filter((p) => p.id !== id);
  saveDB();
  state.view = 'projects'; state.detailProjectId = null;
  render();
}

/* ---------- 收款表單 ---------- */
function paymentForm(projectId, existing) {
  const pay = existing || { amount: '', status: 'unpaid', paidDate: '', expectedDate: '', note: '' };
  openModal(`
    <div class="modal-title">${existing ? '編輯收款' : '新增收款'}</div>
    <div class="field">
      <label>收款金額 <span class="req">*</span></label>
      <input id="f-amount" type="number" inputmode="numeric" value="${pay.amount}" placeholder="例如:訂金 5000" />
      <div class="field-error" id="e-amount" style="display:none">請輸入大於 0 的金額</div>
    </div>
    <div class="field">
      <label>預計收款日</label>
      <input id="f-expected" type="date" value="${pay.expectedDate || ''}" />
      <div class="field-hint">預計這個月該收到的款,會列入總覽的「本月應收」。</div>
    </div>
    <div class="field">
      <label>收款狀態</label>
      <div class="seg" id="f-status">
        <div class="seg-opt ${pay.status === 'unpaid' ? 'active' : ''}" data-val="unpaid">未收</div>
        <div class="seg-opt ${pay.status === 'paid' ? 'active' : ''}" data-val="paid">已收</div>
      </div>
    </div>
    <div class="field" id="date-field" style="${pay.status === 'paid' ? '' : 'display:none'}">
      <label>實際收款日</label>
      <input id="f-date" type="date" value="${pay.paidDate || ''}" />
      <div class="field-hint">標記「已收」時填入入帳日期。</div>
    </div>
    <div class="field">
      <label>備註</label>
      <textarea id="f-note" rows="2" placeholder="例如:預收款、訂金、尾款…">${esc(pay.note || '')}</textarea>
      <div class="field-hint">可註記是否為預收款,方便確認錢有沒有先入袋。</div>
    </div>
    <div class="modal-actions">
      ${existing ? `<button class="btn btn-danger-ghost" id="del">刪除</button>` : ''}
      <button class="btn btn-primary" id="save">儲存</button>
    </div>
  `);
  let status = pay.status;
  const dateField = document.getElementById('date-field');
  const dateInput = document.getElementById('f-date');
  document.querySelectorAll('#f-status .seg-opt').forEach((opt) => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#f-status .seg-opt').forEach((o) => o.classList.remove('active'));
      opt.classList.add('active');
      status = opt.dataset.val;
      if (status === 'paid') {
        dateField.style.display = '';
        if (!dateInput.value) dateInput.value = todayStr();
      } else {
        dateField.style.display = 'none';
      }
    });
  });
  document.getElementById('save').addEventListener('click', () => {
    const amount = Number(document.getElementById('f-amount').value);
    if (!(amount > 0)) { document.getElementById('e-amount').style.display = 'block'; return; }
    const paidDate = status === 'paid' ? (dateInput.value || todayStr()) : '';
    const expectedDate = document.getElementById('f-expected').value || '';
    const note = document.getElementById('f-note').value.trim();
    if (existing) {
      Object.assign(existing, { amount, status, paidDate, expectedDate, note });
    } else {
      db.payments.push({ id: uid(), projectId, amount, status, paidDate, expectedDate, note, createdAt: Date.now() });
    }
    saveDB(); closeModal(); render();
  });
  if (existing) {
    document.getElementById('del').addEventListener('click', () => {
      if (!confirm('確定刪除這筆收款紀錄?')) return;
      db.payments = db.payments.filter((p) => p.id !== existing.id);
      saveDB(); closeModal(); render();
    });
  }
}

/* ---------- FAB:依目前頁面決定新增什麼 ---------- */
function onFab() {
  if (state.view === 'clients') clientForm();
  else projectForm(); // projects / dashboard 都新增案件
}

/* ---------- 資料備份:匯出 / 還原 ---------- */
function exportData() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `接案收入備份-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (e) {
      alert('檔案讀取失敗,可能不是有效的備份檔。');
      return;
    }
    if (!data || !Array.isArray(data.projects) || !Array.isArray(data.payments)) {
      alert('這個檔案不是接案收入的備份檔。');
      return;
    }
    const c = (data.clients || []).length, p = data.projects.length, y = data.payments.length;
    if (!confirm(`即將用備份檔的資料「覆蓋」目前全部資料:\n${c} 客戶 / ${p} 案件 / ${y} 收款。\n確定還原?`)) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    db = loadDB();
    closeModal();
    state.view = 'dashboard'; state.dashboardMode = 'overview';
    render();
    alert('還原完成!');
  };
  reader.readAsText(file);
}

/* ---------- Dropbox 雲端同步(跨裝置)---------- */
const DBX_KEY = '5nm3dfim2rtub82';
const DBX_TOKENS_KEY = 'freelance-dbx';
const DBX_FILE = '/data.json';
let dbxUploadTimer = null;
let dbxStatus = '';

function dbxAvailable() { return location.protocol === 'http:' || location.protocol === 'https:'; }
function dbxLinked() { try { return !!localStorage.getItem(DBX_TOKENS_KEY); } catch (e) { return false; } }
function dbxRedirectUri() { return location.origin + location.pathname; }
function dbxSetStatus(s) { dbxStatus = s; const el = document.getElementById('dbx-status'); if (el) el.textContent = s; }

function dbxB64url(buf) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function dbxChallenge(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return dbxB64url(hash);
}
function dbxRandom(n) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return Array.from(a, (x) => ('0' + x.toString(16)).slice(-2)).join('');
}

async function dbxLink() {
  const verifier = dbxRandom(48);
  sessionStorage.setItem('dbx-verifier', verifier);
  const challenge = await dbxChallenge(verifier);
  location.href = 'https://www.dropbox.com/oauth2/authorize'
    + '?client_id=' + DBX_KEY
    + '&response_type=code&token_access_type=offline'
    + '&code_challenge=' + challenge + '&code_challenge_method=S256'
    + '&redirect_uri=' + encodeURIComponent(dbxRedirectUri());
}
function dbxUnlink() { try { localStorage.removeItem(DBX_TOKENS_KEY); } catch (e) {} }

async function dbxHandleRedirect() {
  const code = new URLSearchParams(location.search).get('code');
  if (!code) return false;
  const verifier = sessionStorage.getItem('dbx-verifier');
  history.replaceState({}, '', location.pathname); // 清掉網址上的 ?code
  if (!verifier) return false;
  const body = new URLSearchParams({
    code, grant_type: 'authorization_code', client_id: DBX_KEY,
    code_verifier: verifier, redirect_uri: dbxRedirectUri(),
  });
  try {
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    if (!res.ok) return false;
    const j = await res.json();
    localStorage.setItem(DBX_TOKENS_KEY, JSON.stringify({
      refresh_token: j.refresh_token, access_token: j.access_token,
      expires_at: Date.now() + (j.expires_in || 14400) * 1000,
    }));
    sessionStorage.removeItem('dbx-verifier');
    return true;
  } catch (e) { console.warn('dbx token', e); return false; }
}

async function dbxAccessToken() {
  let t;
  try { t = JSON.parse(localStorage.getItem(DBX_TOKENS_KEY) || 'null'); } catch (e) { t = null; }
  if (!t) return null;
  if (t.access_token && t.expires_at > Date.now() + 60000) return t.access_token;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: DBX_KEY });
  try {
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    if (!res.ok) return null;
    const j = await res.json();
    t.access_token = j.access_token;
    t.expires_at = Date.now() + (j.expires_in || 14400) * 1000;
    localStorage.setItem(DBX_TOKENS_KEY, JSON.stringify(t));
    return t.access_token;
  } catch (e) { console.warn('dbx refresh', e); return null; }
}

async function dbxDownload() {
  const tok = await dbxAccessToken();
  if (!tok) return null;
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Dropbox-API-Arg': JSON.stringify({ path: DBX_FILE }) },
  });
  if (res.status === 409) return null; // 雲端還沒有檔案
  if (!res.ok) return null;
  try { return JSON.parse(await res.text()); } catch (e) { return null; }
}

async function dbxUpload() {
  const tok = await dbxAccessToken();
  if (!tok) return false;
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + tok,
      'Dropbox-API-Arg': JSON.stringify({ path: DBX_FILE, mode: 'overwrite', mute: true }),
      'Content-Type': 'application/octet-stream',
    },
    body: JSON.stringify(db),
  });
  return res.ok;
}

function dbxScheduleUpload() {
  if (!dbxLinked()) return;
  dbxSetStatus('儲存中…');
  clearTimeout(dbxUploadTimer);
  dbxUploadTimer = setTimeout(async () => {
    const ok = await dbxUpload();
    dbxSetStatus(ok ? '已同步 ✓' : '同步失敗,稍後重試');
  }, 1500);
}

async function dbxSync() {
  if (!dbxLinked()) return;
  dbxSetStatus('同步中…');
  const remote = await dbxDownload();
  const localTime = db._updatedAt || 0;
  const remoteTime = (remote && remote._updatedAt) || 0;
  if (remote && remoteTime > localTime) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
    db = loadDB();
    render();
    dbxSetStatus('已同步 ✓');
  } else if (!remote || localTime > remoteTime) {
    if (!db._updatedAt) { db._updatedAt = Date.now(); try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) {} }
    const ok = await dbxUpload();
    dbxSetStatus(ok ? '已同步 ✓' : '同步失敗');
  } else {
    dbxSetStatus('已同步 ✓');
  }
}

function settingsModal() {
  const dbxSection = dbxAvailable() ? `
    <div style="border-top:1px solid var(--line);margin:6px 0 16px;padding-top:14px">
      <div style="font-weight:600;margin-bottom:8px">☁️ Dropbox 跨裝置同步</div>
      ${dbxLinked()
        ? `<div class="field-hint" style="margin-bottom:10px">已連結。改動會自動存到你 Dropbox 的 App 專屬資料夾,並在各裝置同步。<br><span id="dbx-status" style="color:var(--green);font-weight:600">${esc(dbxStatus || '已同步 ✓')}</span></div>
           <button class="btn btn-ghost btn-block" id="dbx-unlink">取消連結</button>`
        : `<div class="field-hint" style="margin-bottom:10px">連結後,這台電腦/手機會透過你的 Dropbox 自動同步(資料只進你自己的 Dropbox)。</div>
           <button class="btn btn-primary btn-block" id="dbx-link">🔗 連結 Dropbox 開啟同步</button>`
      }
    </div>` : '';
  openModal(`
    <div class="modal-title">設定 / 備份</div>
    <div class="field-hint" style="margin-bottom:14px">
      目前有 ${db.clients.length} 個客戶、${db.projects.length} 個案件、${db.payments.length} 筆收款。
    </div>
    ${dbxSection}
    <div style="font-weight:600;margin:0 0 8px">💾 手動備份</div>
    <button class="btn btn-primary btn-block" id="do-export" style="margin-bottom:10px">⬇️ 匯出備份(下載檔案)</button>
    <button class="btn btn-ghost btn-block" id="do-import">⬆️ 從備份檔還原</button>
    <input type="file" id="import-file" accept="application/json,.json" style="display:none" />
  `);
  document.getElementById('do-export').addEventListener('click', exportData);
  document.getElementById('do-import').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
  });
  const linkBtn = document.getElementById('dbx-link');
  if (linkBtn) linkBtn.addEventListener('click', dbxLink);
  const unlinkBtn = document.getElementById('dbx-unlink');
  if (unlinkBtn) unlinkBtn.addEventListener('click', () => {
    if (!confirm('取消連結後,這台裝置就不再自動同步(資料仍會留著)。確定?')) return;
    dbxUnlink(); closeModal(); settingsModal();
  });
}

/* ---------- 報表圓餅圖:hover 顯示業主總收入 ---------- */
let pieTooltipEl = null;
function getPieTooltip() {
  if (!pieTooltipEl) {
    pieTooltipEl = document.createElement('div');
    pieTooltipEl.className = 'pie-tooltip';
    pieTooltipEl.hidden = true;
    document.body.appendChild(pieTooltipEl);
  }
  return pieTooltipEl;
}
function showPieTooltip(slice, e) {
  const tip = getPieTooltip();
  tip.innerHTML =
    `<div class="pie-tip-name">${esc(slice.dataset.name)}</div>` +
    `<div class="pie-tip-amt">${esc(slice.dataset.amount)} <span class="pie-tip-pct">${esc(slice.dataset.pct)}%</span></div>`;
  tip.hidden = false;
  movePieTooltip(e);
}
function movePieTooltip(e) {
  const tip = getPieTooltip();
  if (tip.hidden) return;
  const pad = 14;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + tip.offsetWidth > window.innerWidth - 8) x = e.clientX - tip.offsetWidth - pad;
  if (y + tip.offsetHeight > window.innerHeight - 8) y = e.clientY - tip.offsetHeight - pad;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function hidePieTooltip() {
  if (pieTooltipEl) pieTooltipEl.hidden = true;
}

/* ============================================================
   事件綁定
   ============================================================ */
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    state.view = t.dataset.view;
    state.detailProjectId = null;
    render();
  });
});

fabEl.addEventListener('click', onFab);

document.getElementById('settings-btn').addEventListener('click', settingsModal);

// 夜覽 / 日覽 切換
const themeBtn = document.getElementById('theme-btn');
function updateThemeBtn() {
  themeBtn.textContent = document.documentElement.classList.contains('theme-light') ? '☀️' : '🌙';
}
updateThemeBtn();
themeBtn.addEventListener('click', () => {
  const light = document.documentElement.classList.toggle('theme-light');
  try { localStorage.setItem('freelance-theme', light ? 'light' : 'dark'); } catch (e) {}
  updateThemeBtn();
  render(); // 重繪,讓圓餅圖換成對應主題的配色
});

// 圓餅圖 hover 提示框(顯示業主總收入)
viewEl.addEventListener('mouseover', (e) => {
  const slice = e.target.closest('.pie-slice');
  if (slice) showPieTooltip(slice, e);
});
viewEl.addEventListener('mousemove', (e) => {
  if (pieTooltipEl && !pieTooltipEl.hidden) movePieTooltip(e);
});
viewEl.addEventListener('mouseout', (e) => {
  if (e.target.closest('.pie-slice')) hidePieTooltip();
});

// 事件委派:處理列表內的點擊
document.getElementById('view').addEventListener('click', (e) => {
  const openP = e.target.closest('[data-open-project]');
  if (openP) { state.view = 'project-detail'; state.detailProjectId = openP.dataset.openProject; render(); return; }

  const editC = e.target.closest('[data-edit-client]');
  if (editC) { clientForm(clientById(editC.dataset.editClient)); return; }

  const editP = e.target.closest('[data-edit-project]');
  if (editP) { projectForm(projectById(editP.dataset.editProject)); return; }

  const delP = e.target.closest('[data-del-project]');
  if (delP) { deleteProject(delP.dataset.delProject); return; }

  const editPay = e.target.closest('[data-edit-payment]');
  if (editPay) {
    const pay = db.payments.find((x) => x.id === editPay.dataset.editPayment);
    if (pay) paymentForm(pay.projectId, pay);
    return;
  }

  if (e.target.id === 'back-projects') { state.view = 'projects'; state.detailProjectId = null; render(); return; }
  if (e.target.id === 'add-payment') { paymentForm(state.detailProjectId); return; }

  const dashBtn = e.target.closest('[data-dash-mode]');
  if (dashBtn) { state.dashboardMode = dashBtn.dataset.dashMode; render(); return; }

  const sortBtn = e.target.closest('[data-proj-sort]');
  if (sortBtn) { state.projectSort = sortBtn.dataset.projSort; render(); return; }

  const modeBtn = e.target.closest('[data-report-mode]');
  if (modeBtn) { state.reportMode = modeBtn.dataset.reportMode; render(); return; }

  const stepBtn = e.target.closest('[data-report-step]');
  if (stepBtn) { stepReport(Number(stepBtn.dataset.reportStep)); return; }
});

/* ---------- 啟動 ---------- */
// db 已在最上方用 loadDB() 載入(含本機儲存 / 內嵌種子 / localStorage 被擋的處理),直接渲染。
render();

// Dropbox 同步:處理登入回呼 + 開啟時拉一次最新資料
(async function dbxBoot() {
  if (!dbxAvailable()) return; // file:// 不支援 OAuth,跳過
  let justLinked = false;
  try { justLinked = await dbxHandleRedirect(); } catch (e) { console.warn('dbx redirect', e); }
  if (dbxLinked()) {
    try { await dbxSync(); } catch (e) { console.warn('dbx sync', e); }
    if (justLinked) alert('已連結 Dropbox ✓ 之後的改動會自動跨裝置同步。');
  }
})();
