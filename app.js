const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const SERIES_COLORS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
];
function seriesColor(i) {
  const varName = SERIES_COLORS[i % SERIES_COLORS.length].match(/--[\w-]+/)[0];
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

const fmtGBP = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);

// ---------- Date helpers (local-time safe; avoids UTC/ISO-string shifting) ----------

function pad2(n) { return String(n).padStart(2, '0'); }
function toISODate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseISODate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function startOfDay(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }

let accounts = [];
let values = [];
let shares = [];

// ---------- Auth ----------

const appView = document.getElementById('app-view');

document.getElementById('signout-btn').addEventListener('click', () => sb.auth.signOut());

sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    appView.classList.remove('hidden');
    document.getElementById('user-email').textContent = session.user.email;
    loadAll();
  } else {
    window.location.href = 'index.html';
  }
});

// ---------- Data loading ----------

async function loadAll() {
  const [{ data: acc, error: accErr }, { data: val, error: valErr }, { data: shr, error: shrErr }] = await Promise.all([
    sb.from('accounts').select('*').order('type').order('name'),
    sb.from('investment_values').select('*').order('date'),
    sb.from('shares').select('*').order('title'),
  ]);
  if (accErr) return alert('Failed to load accounts: ' + accErr.message);
  if (valErr) return alert('Failed to load values: ' + valErr.message);
  if (shrErr) return alert('Failed to load shares: ' + shrErr.message);
  accounts = acc || [];
  values = val || [];
  shares = shr || [];
  renderAll();
}

function latestValueByAccount() {
  const latest = {};
  for (const v of values) {
    const cur = latest[v.account_id];
    if (!cur || v.date > cur.date || (v.date === cur.date && v.created_at > cur.created_at)) {
      latest[v.account_id] = v;
    }
  }
  return latest;
}

function renderAll() {
  renderStats();
  renderAccounts();
  renderValueTabs();
  renderPerformanceChart();
  renderShares();
}

// ---------- Stats ----------

function renderStats() {
  const latest = latestValueByAccount();
  const totals = { Savings: 0, ISA: 0, Pension: 0 };
  let grandTotal = 0;
  for (const acc of accounts) {
    const v = latest[acc.id];
    if (v) {
      totals[acc.type] = (totals[acc.type] || 0) + Number(v.value);
      grandTotal += Number(v.value);
    }
  }
  const sharesTotal = sharesTotalValue();
  grandTotal += sharesTotal;

  const totalRow = document.getElementById('stat-row-total');
  totalRow.innerHTML = '';
  totalRow.appendChild(statTile('Total', fmtGBP(grandTotal), true));

  const row = document.getElementById('stat-row-accounts');
  row.innerHTML = '';
  for (const type of ['Savings', 'ISA', 'Pension']) {
    row.appendChild(statTile(type, fmtGBP(totals[type] || 0), false));
  }
  row.appendChild(statTile('Shares', fmtGBP(sharesTotal), false));
}
function statTile(label, value, isTotal) {
  const div = document.createElement('div');
  div.className = 'stat-tile' + (isTotal ? ' total' : '');
  div.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
  return div;
}

// ---------- Accounts ----------

const expandedAccounts = new Set();

function renderAccounts() {
  const grid = document.getElementById('accounts-grid');
  grid.innerHTML = '';
  const latest = latestValueByAccount();
  const types = ['Savings', 'ISA', 'Pension'];
  for (const type of types) {
    const list = accounts.filter(a => a.type === type);
    if (list.length === 0) continue;
    const group = document.createElement('div');
    group.className = 'type-group';
    const h3 = document.createElement('h3');
    h3.textContent = type;
    group.appendChild(h3);
    list.forEach((acc, i) => {
      const idx = accounts.indexOf(acc);
      const item = document.createElement('div');
      item.className = 'account-item';
      const v = latest[acc.id];
      const details = [];
      if (acc.type === 'Savings') {
        if (acc.interest_rate != null) details.push(`${Number(acc.interest_rate)}%`);
        if (acc.access) details.push(acc.access);
        if (acc.taxable != null) details.push(acc.taxable ? 'Taxable' : 'Tax-free');
      }
      const hasExtra = acc.type === 'Savings' && (details.length > 0 || acc.note);
      const expanded = expandedAccounts.has(acc.id);
      item.innerHTML = `
        <div class="account-item-main">
          <span class="name-group">
            <span class="name"><span class="dot" style="background:${seriesColor(idx)}"></span>${escapeHtml(acc.name)}</span>
            ${hasExtra ? `<button type="button" class="detail-toggle${expanded ? ' expanded' : ''}" aria-label="${expanded ? 'Hide details' : 'Show details'}">&#9654;</button>` : ''}
          </span>
          <span class="value">${v ? fmtGBP(v.value) : '—'}</span>
        </div>
        ${hasExtra ? `
        <div class="account-extra ${expanded ? '' : 'hidden'}">
          ${details.length ? `<div class="account-detail">${details.join(' · ')}</div>` : ''}
          ${acc.note ? `<div class="account-note">${escapeHtml(acc.note)}</div>` : ''}
        </div>` : ''}
      `;
      if (hasExtra) {
        item.querySelector('.detail-toggle').addEventListener('click', () => {
          if (expandedAccounts.has(acc.id)) expandedAccounts.delete(acc.id);
          else expandedAccounts.add(acc.id);
          renderAccounts();
        });
      }
      group.appendChild(item);
    });
    grid.appendChild(group);
  }
  if (accounts.length === 0) {
    grid.innerHTML = '<div class="empty">No accounts yet — add one to get started.</div>';
  }
}

// ---------- Add account modal ----------

const accountModal = document.getElementById('account-modal');
const accountForm = document.getElementById('account-form');

function updateSavingsFieldsVisibility() {
  const isSavings = document.getElementById('new-account-type').value === 'Savings';
  document.querySelectorAll('.savings-field').forEach(f => f.classList.toggle('hidden', !isSavings));
}
document.getElementById('new-account-type').addEventListener('change', updateSavingsFieldsVisibility);

function openAccountModal() {
  accountForm.reset();
  updateSavingsFieldsVisibility();
  accountModal.classList.remove('hidden');
  document.getElementById('new-account-name').focus();
}
function closeAccountModal() {
  accountModal.classList.add('hidden');
}

document.getElementById('add-account-btn').addEventListener('click', openAccountModal);
document.getElementById('account-modal-cancel').addEventListener('click', closeAccountModal);
accountModal.addEventListener('click', (e) => { if (e.target === accountModal) closeAccountModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !accountModal.classList.contains('hidden')) closeAccountModal();
});

accountForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-account-name').value.trim();
  const type = document.getElementById('new-account-type').value;
  if (!name) return;
  const record = { name, type };
  if (type === 'Savings') {
    const rate = document.getElementById('new-account-rate').value;
    const note = document.getElementById('new-account-note').value.trim();
    record.interest_rate = rate === '' ? null : rate;
    record.access = document.getElementById('new-account-access').value;
    record.taxable = document.getElementById('new-account-taxable').value === 'Yes';
    record.note = note === '' ? null : note;
  }
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('accounts').insert({ ...record, user_id: user.id });
  if (error) return alert('Failed to add account: ' + error.message);
  closeAccountModal();
  await loadAll();
});

// ---------- Add value ----------

const VALUE_TABS = { Savings: ['Savings'], Investments: ['ISA', 'Pension'] };

document.getElementById('date-Savings').valueAsDate = new Date();
document.getElementById('date-Investments').valueAsDate = new Date();

document.querySelectorAll('#value-tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#value-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    document.querySelector(`.tab-panel[data-tab-panel="${btn.dataset.tab}"]`).classList.remove('hidden');
  });
});

document.querySelectorAll('.save-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => saveTabValues(btn.dataset.tab));
});

function renderValueTabs() {
  for (const tabName of Object.keys(VALUE_TABS)) {
    const types = VALUE_TABS[tabName];
    const showContribution = tabName === 'Investments';
    const container = document.getElementById('rows-' + tabName);
    container.innerHTML = '';
    const tabAccounts = accounts.filter(a => types.includes(a.type));
    if (tabAccounts.length === 0) {
      container.innerHTML = '<div class="empty">No accounts yet — add one above.</div>';
      continue;
    }
    for (const type of types) {
      const list = accounts.filter(a => a.type === type);
      if (list.length === 0) continue;
      if (types.length > 1) {
        const h3 = document.createElement('h3');
        h3.textContent = type;
        container.appendChild(h3);
      }
      for (const acc of list) {
        const row = document.createElement('div');
        row.className = 'value-row';
        row.innerHTML = `
          <span class="name">${escapeHtml(acc.name)}</span>
          <input type="number" step="0.01" min="0" placeholder="0.00" class="value-input" data-account-id="${acc.id}">
          ${showContribution ? `<input type="number" step="0.01" min="0" placeholder="0.00" class="contribution-input" data-account-id="${acc.id}">` : ''}
        `;
        container.appendChild(row);
      }
    }
  }
}

async function saveTabValues(tabName) {
  const dateInput = document.getElementById('date-' + tabName);
  const msg = document.getElementById('msg-' + tabName);
  msg.textContent = '';
  msg.className = 'msg';
  const date = dateInput.value;
  if (!date) { msg.textContent = 'Pick a date.'; msg.className = 'msg error'; return; }

  const container = document.getElementById('rows-' + tabName);
  const entries = [...container.querySelectorAll('.value-input')]
    .filter(input => input.value.trim() !== '')
    .map(input => {
      const entry = { account_id: input.dataset.accountId, date, value: input.value };
      const contribInput = container.querySelector(`.contribution-input[data-account-id="${input.dataset.accountId}"]`);
      if (contribInput && contribInput.value.trim() !== '') {
        entry.contribution = contribInput.value;
      }
      return entry;
    });
  if (entries.length === 0) { msg.textContent = 'Enter at least one value.'; msg.className = 'msg error'; return; }

  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('investment_values').insert(entries.map(e => ({ ...e, user_id: user.id })));
  if (error) { msg.textContent = 'Failed to save: ' + error.message; msg.className = 'msg error'; return; }
  msg.textContent = 'Saved.';
  msg.className = 'msg ok';
  await loadAll();
}

// ---------- Performance chart ----------
// Growth % is measured from a fixed baseline (each account's value 12 months
// ago), carrying each account's last known value forward between its own
// update dates. Contributions are subtracted from the raw gain so only
// organic growth counts: pct = (currentTotal - baselineTotal - contributions) / baselineTotal.

function valueAsOf(entries, dateStr) {
  let result = null;
  for (const e of entries) {
    if (e.date <= dateStr && (!result || e.date > result.date || (e.date === result.date && e.created_at > result.created_at))) {
      result = e;
    }
  }
  return result;
}

// Growth series for a single set of entries (one account, or the combined
// portfolio) relative to a fixed baseline date. Carries the last known value
// forward between update dates; contributions are subtracted the moment
// they're recorded so only organic growth counts.
function computeGrowthSeries(entriesList, baselineStr, todayStr) {
  const baselineValue = entriesList.reduce((sum, entries) => {
    const v = valueAsOf(entries, baselineStr);
    return sum + (v ? Number(v.value) : 0);
  }, 0);
  if (baselineValue <= 0) return null;

  const dateSet = new Set([baselineStr, todayStr]);
  for (const entries of entriesList) {
    for (const e of entries) {
      if (e.date > baselineStr && e.date <= todayStr) dateSet.add(e.date);
    }
  }
  const dates = [...dateSet].sort();

  let cumulativeContribution = 0;
  const points = dates.map(dateStr => {
    if (dateStr > baselineStr) {
      for (const entries of entriesList) {
        for (const e of entries) {
          if (e.date === dateStr && e.contribution != null) cumulativeContribution += Number(e.contribution);
        }
      }
    }
    const currentValue = entriesList.reduce((sum, entries) => {
      const v = valueAsOf(entries, dateStr);
      return sum + (v ? Number(v.value) : 0);
    }, 0);
    const pct = dateStr === baselineStr ? 0 : ((currentValue - baselineValue - cumulativeContribution) / baselineValue) * 100;
    return { date: dateStr, pct };
  });

  return points.length >= 2 ? points : null;
}

function renderPerformanceChart() {
  const wrap = document.getElementById('performance-chart-wrap');
  const empty = document.getElementById('performance-empty');
  const currentLabel = document.getElementById('performance-current');
  const legend = document.getElementById('performance-legend');
  const svg = document.getElementById('performance-chart');

  const today = startOfDay(new Date());
  const baselineDate = new Date(today.getFullYear(), today.getMonth() - 12, today.getDate());
  const baselineStr = toISODate(baselineDate);
  const todayStr = toISODate(today);

  const entriesByAccount = {};
  for (const v of values) {
    (entriesByAccount[v.account_id] ||= []).push(v);
  }

  const eligibleAccounts = accounts.filter(acc => valueAsOf(entriesByAccount[acc.id] || [], baselineStr) !== null);

  const totalPoints = eligibleAccounts.length > 0
    ? computeGrowthSeries(eligibleAccounts.map(acc => entriesByAccount[acc.id]), baselineStr, todayStr)
    : null;

  if (!totalPoints) {
    wrap.classList.add('hidden');
    currentLabel.textContent = '';
    legend.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  const series = [{ label: 'Total', color: 'var(--series-1)', points: totalPoints, isTotal: true }];
  for (const acc of eligibleAccounts) {
    const points = computeGrowthSeries([entriesByAccount[acc.id]], baselineStr, todayStr);
    if (points) series.push({ label: acc.name, color: seriesColor(accounts.indexOf(acc)), points, isTotal: false });
  }

  empty.classList.add('hidden');
  wrap.classList.remove('hidden');

  const current = totalPoints[totalPoints.length - 1].pct;
  currentLabel.textContent = `${current >= 0 ? '+' : ''}${current.toFixed(1)}%`;
  currentLabel.className = 'performance-current ' + (current >= 0 ? 'positive' : 'negative');

  legend.innerHTML = series.map(s => `
    <span class="item"><span class="swatch" style="background:${s.color}"></span>${escapeHtml(s.label)}</span>
  `).join('');

  svg.innerHTML = buildPerformanceSvg(series, baselineStr, todayStr);
}

function niceStep(range) {
  const rough = range / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

function buildPerformanceSvg(series, baselineStr, todayStr) {
  const W = 760, H = 260;
  const pad = { left: 48, right: 16, top: 16, bottom: 28 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const startMs = parseISODate(baselineStr).getTime();
  const endMs = parseISODate(todayStr).getTime();
  const spanMs = Math.max(endMs - startMs, 1);
  const xScale = (dateStr) => pad.left + ((parseISODate(dateStr).getTime() - startMs) / spanMs) * plotW;

  const allPct = series.flatMap(s => s.points.map(p => p.pct));
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

  const totalSeries = series.find(s => s.isTotal) || series[0];
  const monthLabels = [];
  const seenMonths = new Set();
  for (const p of totalSeries.points) {
    const d = parseISODate(p.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!seenMonths.has(key)) {
      seenMonths.add(key);
      const x = xScale(p.date).toFixed(1);
      monthLabels.push(`<text x="${x}" y="${H - 8}" class="perf-axis-label" text-anchor="middle">${d.toLocaleDateString('en-GB', { month: 'short' })}</text>`);
    }
  }

  const zeroY = yScale(0).toFixed(1);
  const seriesSvg = series.map(s => {
    const linePoints = s.points.map(p => `${xScale(p.date).toFixed(1)},${yScale(p.pct).toFixed(1)}`).join(' ');
    const area = s.isTotal
      ? `<polygon points="${xScale(s.points[0].date).toFixed(1)},${zeroY} ${linePoints} ${xScale(s.points[s.points.length - 1].date).toFixed(1)},${zeroY}" class="perf-area" style="fill:color-mix(in srgb, ${s.color} 15%, transparent)" />`
      : '';
    const dots = s.points.map(p => {
      const x = xScale(p.date).toFixed(1);
      const y = yScale(p.pct).toFixed(1);
      const dateLabel = parseISODate(p.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      return `<circle cx="${x}" cy="${y}" r="${s.isTotal ? 2.5 : 2}" style="fill:${s.color}"><title>${escapeHtml(s.label)} — ${dateLabel}: ${p.pct >= 0 ? '+' : ''}${p.pct.toFixed(1)}%</title></circle>`;
    }).join('');
    return `${area}<polyline points="${linePoints}" class="perf-line" style="stroke:${s.color};stroke-width:${s.isTotal ? 2.5 : 1.5}" />${dots}`;
  }).join('');

  return `${gridLines.join('')}${seriesSvg}${monthLabels.join('')}`;
}

// ---------- Shares ----------
// Prices are stored in the database; each row has its own update icon that
// fetches the latest quote from Alpha Vantage's GLOBAL_QUOTE endpoint (same
// approach as share.html) and writes it straight to that share's row — there
// is no automatic/background lookup.

async function fetchSharePrice(tradingCode) {
  let symbol = tradingCode.trim().toUpperCase();
  if (!symbol.includes('.')) symbol = symbol + '.LON';
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${window.ALPHA_VANTAGE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Network error contacting Alpha Vantage.');
  const data = await res.json();

  if (data.Note) throw new Error('API rate limit reached.');
  if (data.Information) throw new Error(data.Information);
  if (data['Error Message']) throw new Error('Ticker not found.');

  const quote = data['Global Quote'];
  const raw = quote && quote['05. price'];
  if (!raw || raw === '0.0000') throw new Error('No data found for that ticker.');
  return Number(raw) / 100;
}

// Share ids refreshed via the update icon during this page visit — used to
// tell a just-fetched price apart from one that's merely sitting in the
// database from an earlier visit.
const refreshedShareIds = new Set();

async function updateSharePrice(share, btn) {
  btn.disabled = true;
  try {
    const price = await fetchSharePrice(share.trading_code);
    const { error } = await sb.from('shares').update({ price, updated_at: new Date().toISOString() }).eq('id', share.id);
    if (error) { alert('Failed to save price: ' + error.message); return; }
    refreshedShareIds.add(share.id);
    await loadAll();
  } catch (err) {
    alert('Failed to fetch price: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

function sharesTotalValue() {
  let total = 0;
  for (const share of shares) {
    if (share.price != null) total += Number(share.price) * Number(share.quantity);
  }
  return total;
}

function renderShares() {
  const grid = document.getElementById('shares-grid');
  const totalEl = document.getElementById('shares-total');
  grid.innerHTML = '';

  if (shares.length === 0) {
    totalEl.textContent = '';
    grid.innerHTML = '<div class="empty">No shares yet — add one to get started.</div>';
    return;
  }

  let total = 0;
  for (const share of shares) {
    const price = share.price != null ? Number(share.price) : null;
    const value = price != null ? price * Number(share.quantity) : null;
    if (value != null) total += value;

    const row = document.createElement('div');
    row.className = 'expense-row editable';
    row.innerHTML = `
      <div class="expense-row-main">
        <span class="expense-date">${escapeHtml(share.trading_code)}</span>
        <span class="expense-name">${escapeHtml(share.title)}</span>
        <span class="expense-amount">${Number(share.quantity).toLocaleString('en-GB')}</span>
        <span class="share-price${refreshedShareIds.has(share.id) ? '' : ' fallback'}">${price != null ? fmtGBP(price) : '—'}</span>
        <span class="expense-running-total">${value != null ? fmtGBP(value) : '—'}</span>
        <button type="button" class="share-update-btn" aria-label="Update ${escapeHtml(share.title)} price">&#8635;</button>
      </div>
    `;
    row.querySelector('.share-update-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      updateSharePrice(share, e.currentTarget);
    });
    row.addEventListener('click', () => openShareModal(share));
    grid.appendChild(row);
  }

  totalEl.textContent = `Total: ${fmtGBP(total)}`;
}

const shareModal = document.getElementById('share-modal');
const shareForm = document.getElementById('share-form');
let editingShareId = null;

function openShareModal(share) {
  shareForm.reset();
  editingShareId = share ? share.id : null;
  document.getElementById('share-modal-title').textContent = share ? 'Edit share' : 'Add share';
  document.getElementById('share-modal-submit').textContent = share ? 'Save changes' : 'Add share';
  document.getElementById('share-modal-delete').classList.toggle('hidden', !editingShareId);
  if (share) {
    document.getElementById('new-share-title').value = share.title;
    document.getElementById('new-share-code').value = share.trading_code;
    document.getElementById('new-share-quantity').value = share.quantity;
    document.getElementById('new-share-price').value = share.price != null ? share.price : '';
  }
  shareModal.classList.remove('hidden');
  document.getElementById('new-share-title').focus();
}
function closeShareModal() {
  shareModal.classList.add('hidden');
}

document.getElementById('share-modal-cancel').addEventListener('click', closeShareModal);
shareModal.addEventListener('click', (e) => { if (e.target === shareModal) closeShareModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !shareModal.classList.contains('hidden')) closeShareModal();
});

document.getElementById('share-modal-delete').addEventListener('click', async () => {
  if (!editingShareId) return;
  if (!confirm('Delete this share? This can\'t be undone.')) return;
  const { error } = await sb.from('shares').delete().eq('id', editingShareId);
  if (error) return alert('Failed to delete: ' + error.message);
  closeShareModal();
  await loadAll();
});

shareForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('new-share-title').value.trim();
  const trading_code = document.getElementById('new-share-code').value.trim();
  const quantity = document.getElementById('new-share-quantity').value;
  const priceVal = document.getElementById('new-share-price').value;
  if (!title || !trading_code || quantity === '') return;
  const record = { title, trading_code, quantity, price: priceVal === '' ? null : priceVal, updated_at: new Date().toISOString() };

  if (editingShareId) {
    const { error } = await sb.from('shares').update(record).eq('id', editingShareId);
    if (error) return alert('Failed to save changes: ' + error.message);
  } else {
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from('shares').insert({ ...record, user_id: user.id });
    if (error) return alert('Failed to add share: ' + error.message);
  }
  closeShareModal();
  await loadAll();
});

// ---------- utils ----------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
