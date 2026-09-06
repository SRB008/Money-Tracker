const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const fmtGBP = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
const fmtDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

function pad2(n) { return String(n).padStart(2, '0'); }
function toISODate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseISODate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

let accounts = [];
let selectedView = null; // 'table' | 'chart'
let selectedMonths = null;

// ---------- Auth ----------

const appView = document.getElementById('app-view');

document.getElementById('signout-btn').addEventListener('click', () => sb.auth.signOut());

sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    appView.classList.remove('hidden');
    document.getElementById('user-email').textContent = session.user.email;
    loadAccounts();
  } else {
    window.location.href = 'index.html';
  }
});

// ---------- Accounts dropdown ----------

async function loadAccounts() {
  const { data, error } = await sb.from('accounts').select('*').order('type').order('name');
  if (error) return alert('Failed to load accounts: ' + error.message);
  accounts = data || [];

  const select = document.getElementById('account-select');
  select.innerHTML = '<option value="">Select an account&hellip;</option>';
  const types = ['ISA', 'Pension', 'Savings'];
  for (const type of types) {
    const list = accounts.filter(a => a.type === type);
    if (list.length === 0) continue;
    const group = document.createElement('optgroup');
    group.label = type;
    for (const acc of list) {
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = acc.name;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }
}

document.getElementById('account-select').addEventListener('change', () => {
  if (selectedView === 'chart') loadChart();
  else if (selectedView === 'table' && selectedMonths) loadHistory();
});

// ---------- Period / Chart tabs ----------

document.querySelectorAll('#period-tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#period-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.view === 'chart') {
      selectedView = 'chart';
      loadChart();
    } else {
      selectedView = 'table';
      selectedMonths = Number(btn.dataset.months);
      loadHistory();
    }
  });
});

// ---------- History table ----------

async function loadHistory() {
  const accountId = document.getElementById('account-select').value;
  const empty = document.getElementById('history-empty');
  const table = document.getElementById('history-table');
  const rows = document.getElementById('history-rows');
  const contributionTh = document.getElementById('history-contribution-th');

  document.getElementById('history-chart-section').classList.add('hidden');

  if (!accountId) {
    empty.textContent = 'Select an account to see its history.';
    empty.classList.remove('hidden');
    table.classList.add('hidden');
    return;
  }

  const account = accounts.find(a => a.id === accountId);
  const showContribution = account && (account.type === 'ISA' || account.type === 'Pension');
  contributionTh.classList.toggle('hidden', !showContribution);

  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - selectedMonths, today.getDate());
  const fromStr = toISODate(from);

  const { data, error } = await sb.from('investment_values')
    .select('date, value, contribution')
    .eq('account_id', accountId)
    .gte('date', fromStr)
    .order('date', { ascending: false });
  if (error) return alert('Failed to load history: ' + error.message);

  if (!data || data.length === 0) {
    empty.textContent = 'No values recorded for this account in the selected period.';
    empty.classList.remove('hidden');
    table.classList.add('hidden');
    return;
  }

  rows.innerHTML = data.map(v => `
    <tr>
      <td>${fmtDate(v.date)}</td>
      ${showContribution ? `<td class="value">${v.contribution != null ? fmtGBP(v.contribution) : '—'}</td>` : ''}
      <td class="value">${fmtGBP(v.value)}</td>
    </tr>
  `).join('');
  empty.classList.add('hidden');
  table.classList.remove('hidden');
}

// ---------- Chart: rolling annual growth over the last 3 months ----------
// For each recorded value date D in the last 3 months, the baseline is the
// account's value ~12 months before D (its last known value on or before
// that date). Growth % = (value(D) - baseline - contributions made between
// baseline and D) / baseline. Points with no baseline (under a year of
// history) are skipped. Mirrors the "organic growth" calc in app.js.

function valueAsOf(entries, dateStr) {
  let result = null;
  for (const e of entries) {
    if (e.date > dateStr) break;
    result = e;
  }
  return result;
}

function computeAnnualGrowthSeries(entries, windowStartStr, todayStr) {
  const points = [];
  for (const e of entries) {
    if (e.date < windowStartStr || e.date > todayStr) continue;
    const d = parseISODate(e.date);
    const baselineDate = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
    const baseline = valueAsOf(entries, toISODate(baselineDate));
    if (!baseline) continue;
    const baselineValue = Number(baseline.value);
    if (baselineValue <= 0) continue;

    let contribution = 0;
    for (const c of entries) {
      if (c.date > baseline.date && c.date <= e.date && c.contribution != null) contribution += Number(c.contribution);
    }

    const pct = ((Number(e.value) - baselineValue - contribution) / baselineValue) * 100;
    points.push({ date: e.date, pct });
  }
  return points;
}

async function loadChart() {
  const accountId = document.getElementById('account-select').value;
  const empty = document.getElementById('history-empty');
  const table = document.getElementById('history-table');
  const chartSection = document.getElementById('history-chart-section');
  const currentLabel = document.getElementById('history-chart-current');

  table.classList.add('hidden');
  chartSection.classList.add('hidden');
  currentLabel.textContent = '';

  if (!accountId) {
    empty.textContent = 'Select an account to see its history.';
    empty.classList.remove('hidden');
    return;
  }

  const today = new Date();
  const windowStart = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
  const fetchFrom = new Date(windowStart.getFullYear() - 1, windowStart.getMonth(), windowStart.getDate());

  const { data, error } = await sb.from('investment_values')
    .select('date, value, contribution')
    .eq('account_id', accountId)
    .gte('date', toISODate(fetchFrom))
    .order('date', { ascending: true });
  if (error) return alert('Failed to load history: ' + error.message);

  const points = computeAnnualGrowthSeries(data || [], toISODate(windowStart), toISODate(today));

  if (points.length === 0) {
    empty.textContent = 'Not enough history for this account to show annual growth — needs at least 12 months of prior values.';
    empty.classList.remove('hidden');
    return;
  }

  const current = points[points.length - 1].pct;
  currentLabel.textContent = `${current >= 0 ? '+' : ''}${current.toFixed(1)}%`;
  currentLabel.className = 'performance-current ' + (current >= 0 ? 'positive' : 'negative');

  document.getElementById('history-chart').innerHTML = buildHistoryChartSvg(points);
  empty.classList.add('hidden');
  chartSection.classList.remove('hidden');
}

function niceStep(range) {
  const rough = range / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rough || 1)));
  const norm = rough / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

function buildHistoryChartSvg(points) {
  const W = 760, H = 260;
  const pad = { left: 48, right: 16, top: 16, bottom: 28 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const startMs = parseISODate(points[0].date).getTime();
  const endMs = parseISODate(points[points.length - 1].date).getTime();
  const spanMs = Math.max(endMs - startMs, 1);
  const xScale = (dateStr) => pad.left + ((parseISODate(dateStr).getTime() - startMs) / spanMs) * plotW;

  const allPct = points.map(p => p.pct);
  let minPct = Math.min(0, ...allPct);
  let maxPct = Math.max(0, ...allPct);
  if (minPct === maxPct) { minPct -= 1; maxPct += 1; }
  const rangePad = (maxPct - minPct) * 0.1 || 1;
  minPct -= rangePad;
  maxPct += rangePad;
  const yScale = (pct) => pad.top + (1 - (pct - minPct) / (maxPct - minPct)) * plotH;

  const step = niceStep(maxPct - minPct);
  const gridLines = [];
  const firstTick = Math.ceil(minPct / step) * step;
  for (let g = firstTick; g <= maxPct; g += step) {
    const y = yScale(g).toFixed(1);
    const isZero = Math.abs(g) < 1e-9;
    gridLines.push(`<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" class="perf-gridline${isZero ? ' perf-zeroline' : ''}" />`);
    gridLines.push(`<text x="${pad.left - 8}" y="${y}" class="perf-axis-label" text-anchor="end" dominant-baseline="middle">${g > 0 ? '+' : ''}${g.toFixed(0)}%</text>`);
  }

  const dateLabels = [];
  const seenDates = new Set();
  for (const p of points) {
    const d = parseISODate(p.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!seenDates.has(key)) {
      seenDates.add(key);
      const x = xScale(p.date).toFixed(1);
      dateLabels.push(`<text x="${x}" y="${H - 8}" class="perf-axis-label" text-anchor="middle">${d.toLocaleDateString('en-GB', { month: 'short' })}</text>`);
    }
  }

  const zeroY = yScale(0).toFixed(1);
  const linePoints = points.map(p => `${xScale(p.date).toFixed(1)},${yScale(p.pct).toFixed(1)}`).join(' ');
  const area = `<polygon points="${xScale(points[0].date).toFixed(1)},${zeroY} ${linePoints} ${xScale(points[points.length - 1].date).toFixed(1)},${zeroY}" class="perf-area" style="fill:color-mix(in srgb, var(--series-1) 15%, transparent)" />`;
  const line = `<polyline points="${linePoints}" class="perf-line" style="stroke:var(--series-1);stroke-width:2.5" />`;
  const dots = points.map(p => {
    const x = xScale(p.date).toFixed(1);
    const y = yScale(p.pct).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="2.5" style="fill:var(--series-1)"><title>${fmtDate(p.date)}: ${p.pct >= 0 ? '+' : ''}${p.pct.toFixed(1)}%</title></circle>`;
  }).join('');

  return `${gridLines.join('')}${area}${line}${dots}${dateLabels.join('')}`;
}
