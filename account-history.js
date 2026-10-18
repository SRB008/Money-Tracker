// Account history card on investments.html. Shared code lives in lib.js.
// Wrapped in an IIFE so its names don't clash with app.js globals.
(() => {
let accounts = [];
let selectedView = 'value-chart'; // 'table' | 'chart' | 'value-chart'
let selectedMonths = 3;
let loadToken = 0; // ignores out-of-date responses when clicking quickly

watchSession({ signedIn: loadAccounts, signedOut: () => {} });

// ---------- Account buttons ----------
// Same investment accounts as the investments page performance chart, plus a
// 'Total' that combines them all.

const TOTAL_KEY = '__total__';
let selectedKey = TOTAL_KEY;

async function loadAccounts() {
  const { data, error } = await sb.from('accounts').select('*').order('type').order('name');
  if (failed('Failed to load accounts', error)) return;
  accounts = (data || []).filter(a => a.type === 'ISA' || a.type === 'Pension');
  renderAccountButtons();
  refreshView();
}

function renderAccountButtons() {
  const legend = document.getElementById('account-legend');
  const items = [{ key: TOTAL_KEY, label: 'Total', color: 'var(--series-total)' }]
    .concat(accounts.map(a => ({ key: a.id, label: a.name, color: seriesColor(accounts.indexOf(a)) })));
  legend.innerHTML = items.map(s => {
    const on = s.key === selectedKey;
    return `<button type="button" class="item${on ? '' : ' off'}" data-key="${escapeHtml(String(s.key))}" aria-pressed="${on}">
      <span class="swatch" style="background:${s.color}"></span>${escapeHtml(s.label)}
    </button>`;
  }).join('');
  legend.querySelectorAll('.item').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedKey = btn.dataset.key;
      legend.querySelectorAll('.item').forEach(b => {
        const on = b.dataset.key === selectedKey;
        b.classList.toggle('off', !on);
        b.setAttribute('aria-pressed', on);
      });
      refreshView();
    });
  });
}

function refreshView() {
  if (selectedView === 'chart') loadChart();
  else if (selectedView === 'value-chart') loadValueChart();
  else if (selectedView === 'table' && selectedMonths) loadHistory();
}

function seriesColor(i) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--series-${(i % 8) + 1}`).trim();
}

function selectedAccounts() {
  return selectedKey === TOTAL_KEY ? accounts : accounts.filter(a => a.id === selectedKey);
}

// Fetch entries (date asc) for the selected account(s). For Total, each
// account's last known value is carried forward and summed on every date any
// account was updated; contributions made on a date are summed.
async function fetchEntries(fromStr, withContribution) {
  const accs = selectedAccounts();
  if (accs.length === 0) return { data: [], error: null };
  const cols = withContribution ? 'account_id, date, value, contribution' : 'account_id, date, value';
  const { data, error } = await sb.from('investment_values')
    .select(cols)
    .in('account_id', accs.map(a => a.id))
    .gte('date', fromStr)
    .order('date', { ascending: true });
  if (error) return { data: null, error };
  if (accs.length === 1) return { data: data || [], error: null };

  const rows = data || [];
  // Seed each account with its last value before the window so the first
  // totals are not understated.
  const seeds = await Promise.all(accs.map(a => sb.from('investment_values')
    .select('account_id, date, value')
    .eq('account_id', a.id).lt('date', fromStr)
    .order('date', { ascending: false }).limit(1)));
  const last = {};
  for (const s of seeds) if (s.data && s.data[0]) last[s.data[0].account_id] = Number(s.data[0].value);

  const dates = [...new Set(rows.map(r => r.date))].sort();
  const out = [];
  for (const d of dates) {
    let contribution = null;
    for (const r of rows) {
      if (r.date !== d) continue;
      last[r.account_id] = Number(r.value);
      if (r.contribution != null) contribution = (contribution || 0) + Number(r.contribution);
    }
    out.push({ date: d, value: Object.values(last).reduce((s, v) => s + v, 0), contribution });
  }
  return { data: out, error: null };
}

// ---------- Period / Chart tabs ----------

document.querySelectorAll('#period-tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#period-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.view === 'chart') {
      selectedView = 'chart';
      loadChart();
    } else if (btn.dataset.view === 'value-chart') {
      selectedView = 'value-chart';
      selectedMonths = Number(btn.dataset.months);
      loadValueChart();
    } else {
      selectedView = 'table';
      selectedMonths = Number(btn.dataset.months);
      loadHistory();
    }
  });
});

// ---------- History table ----------

async function loadHistory() {
  const empty = document.getElementById('history-empty');
  const table = document.getElementById('history-table');
  const rows = document.getElementById('history-rows');
  const contributionTh = document.getElementById('history-contribution-th');

  const showContribution = true;
  contributionTh.classList.toggle('hidden', !showContribution);

  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - selectedMonths, today.getDate());
  const fromStr = toISODate(from);

  const token = ++loadToken;
  const res = await fetchEntries(fromStr, true);
  if (token !== loadToken) return;
  if (failed('Failed to load history', res.error)) return;
  const data = (res.data || []).slice().reverse();

  document.getElementById('history-chart-section').classList.add('hidden');
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
  const empty = document.getElementById('history-empty');
  const table = document.getElementById('history-table');
  const chartSection = document.getElementById('history-chart-section');
  const currentLabel = document.getElementById('history-chart-current');

  const today = new Date();
  const windowStart = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
  const fetchFrom = new Date(windowStart.getFullYear() - 1, windowStart.getMonth(), windowStart.getDate());

  const token = ++loadToken;
  const res = await fetchEntries(toISODate(fetchFrom), true);
  if (token !== loadToken) return;
  if (failed('Failed to load history', res.error)) return;
  const data = res.data;

  const points = computeAnnualGrowthSeries(data || [], toISODate(windowStart), toISODate(today));

  table.classList.add('hidden');
  if (points.length === 0) {
    chartSection.classList.add('hidden');
    currentLabel.textContent = '';
    empty.textContent = 'Not enough history for this account to show annual growth — needs at least 12 months of prior values.';
    empty.classList.remove('hidden');
    return;
  }

  const current = points[points.length - 1].pct;
  currentLabel.textContent = `${current >= 0 ? '+' : ''}${current.toFixed(1)}%`;
  currentLabel.className = 'performance-current ' + (current >= 0 ? 'positive' : 'negative');

  document.getElementById('history-chart-caption').textContent = 'Annual % change, less contributions.';
  document.getElementById('history-chart').innerHTML = buildHistoryChartSvg(points.map(p => ({ date: p.date, y: p.pct })), PCT_CHART);
  empty.classList.add('hidden');
  chartSection.classList.remove('hidden');
}

// ---------- Chart: account value over the selected period ----------

async function loadValueChart() {
  const empty = document.getElementById('history-empty');
  const table = document.getElementById('history-table');
  const chartSection = document.getElementById('history-chart-section');
  const currentLabel = document.getElementById('history-chart-current');

  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - selectedMonths, today.getDate());

  const token = ++loadToken;
  const res = await fetchEntries(toISODate(from), false);
  if (token !== loadToken) return;
  if (failed('Failed to load history', res.error)) return;
  const data = res.data;

  table.classList.add('hidden');
  if (!data || data.length === 0) {
    chartSection.classList.add('hidden');
    currentLabel.textContent = '';
    empty.textContent = `No values recorded for this account in the last ${selectedMonths} months.`;
    empty.classList.remove('hidden');
    return;
  }

  const points = data.map(v => ({ date: v.date, y: Number(v.value) }));
  currentLabel.textContent = fmtGBP(points[points.length - 1].y);
  currentLabel.className = 'performance-current';

  document.getElementById('history-chart-caption').textContent = `Recorded value over the last ${selectedMonths} months.`;
  document.getElementById('history-chart').innerHTML = buildHistoryChartSvg(points, VALUE_CHART);
  empty.classList.add('hidden');
  chartSection.classList.remove('hidden');
}

// ---------- Shared SVG line chart ----------

const fmtGBPCompact = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', notation: 'compact', maximumFractionDigits: 1 }).format(n);

const PCT_CHART = {
  includeZero: true,
  tick: (g) => `${g > 0 ? '+' : ''}${g.toFixed(0)}%`,
  tip: (y) => `${y >= 0 ? '+' : ''}${y.toFixed(1)}%`,
};

const VALUE_CHART = {
  includeZero: false,
  tick: fmtGBPCompact,
  tip: fmtGBP,
};

function buildHistoryChartSvg(points, opts) {
  const W = 760, H = 260;
  const pad = { left: 48, right: 16, top: 16, bottom: 28 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const startMs = parseISODate(points[0].date).getTime();
  const endMs = parseISODate(points[points.length - 1].date).getTime();
  const spanMs = Math.max(endMs - startMs, 1);
  const xScale = (dateStr) => pad.left + ((parseISODate(dateStr).getTime() - startMs) / spanMs) * plotW;

  const allY = points.map(p => p.y);
  let minPct = opts.includeZero ? Math.min(0, ...allY) : Math.min(...allY);
  let maxPct = opts.includeZero ? Math.max(0, ...allY) : Math.max(...allY);
  if (minPct === maxPct) { const bump = Math.abs(minPct) * 0.05 || 1; minPct -= bump; maxPct += bump; }
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
    gridLines.push(`<text x="${pad.left - 8}" y="${y}" class="perf-axis-label" text-anchor="end" dominant-baseline="middle">${opts.tick(g)}</text>`);
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

  const zeroY = (opts.includeZero ? yScale(0) : pad.top + plotH).toFixed(1);
  const linePoints = points.map(p => `${xScale(p.date).toFixed(1)},${yScale(p.y).toFixed(1)}`).join(' ');
  const area = `<polygon points="${xScale(points[0].date).toFixed(1)},${zeroY} ${linePoints} ${xScale(points[points.length - 1].date).toFixed(1)},${zeroY}" class="perf-area" style="fill:color-mix(in srgb, var(--series-1) 15%, transparent)" />`;
  const line = `<polyline points="${linePoints}" class="perf-line" style="stroke:var(--series-1);stroke-width:2.5" />`;
  const dots = points.map(p => {
    const x = xScale(p.date).toFixed(1);
    const y = yScale(p.y).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="2.5" style="fill:var(--series-1)"><title>${fmtDate(p.date)}: ${opts.tip(p.y)}</title></circle>`;
  }).join('');

  return `${gridLines.join('')}${area}${line}${dots}${dateLabels.join('')}`;
}

})();
