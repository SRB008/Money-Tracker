const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const DEFAULT_DRAWDOWN_RATE = 4;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let shares = [];
let accounts = [];
let investmentValues = [];
let debts = [];
let debtValues = [];

const appView = document.getElementById('app-view');

sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    appView.classList.remove('hidden');
    document.getElementById('user-email').textContent = session.user.email;
    loadSettings();
    loadShares();
    loadAccounts();
    loadRetirementSettings();
    loadInvestmentValues();
    loadDebtsForRetirement();
  } else {
    window.location.href = 'index.html';
  }
});

document.getElementById('signout-btn').addEventListener('click', () => sb.auth.signOut());

async function loadSettings() {
  const { data, error } = await sb
    .from('app_settings')
    .select('*')
    .eq('key', 'pension_drawdown_rate')
    .maybeSingle();
  if (error) return alert('Failed to load settings: ' + error.message);
  const rate = data ? Number(data.value) : DEFAULT_DRAWDOWN_RATE;
  document.getElementById('drawdown-rate').value = rate;
}

// ---------- Retirement drawdown ----------
// Simulates spending down the ISA (non-taxable) and Pension (taxable) pots
// together: both pots grow monthly at Expected Pot Growth, then that month's
// spend (rising smoothly at Spend Increase by) is drawn from each pot in
// proportion to its balance. The pension side is grossed up so the tax it
// loses still leaves the intended net amount in hand; if one pot runs dry
// the rest of that month's spend comes from whichever pot still has money.

const RETIREMENT_SETTING_KEYS = {
  spend: 'retirement_net_monthly_spend',
  potGrowth: 'retirement_pot_growth_rate',
  spendIncrease: 'retirement_spend_increase_rate',
  dob: 'retirement_dob',
  taxRate: 'retirement_tax_rate',
  statePension: 'retirement_state_pension_enabled',
  statePensionStartDate: 'retirement_state_pension_start_date',
  clearDebt: 'retirement_clear_debt_enabled',
};
const hiddenRetirementSeries = new Set();

async function loadRetirementSettings() {
  const { data, error } = await sb
    .from('app_settings')
    .select('*')
    .in('key', Object.values(RETIREMENT_SETTING_KEYS));
  if (error) return alert('Failed to load retirement settings: ' + error.message);
  const byKey = {};
  for (const row of data || []) byKey[row.key] = row.value;
  document.getElementById('retire-monthly-spend').value = byKey[RETIREMENT_SETTING_KEYS.spend] ?? '';
  document.getElementById('retire-pot-growth').value = byKey[RETIREMENT_SETTING_KEYS.potGrowth] ?? '';
  document.getElementById('retire-spend-increase').value = byKey[RETIREMENT_SETTING_KEYS.spendIncrease] ?? '';
  document.getElementById('retire-dob').value = byKey[RETIREMENT_SETTING_KEYS.dob] ?? '';
  document.getElementById('retire-tax-rate').value = byKey[RETIREMENT_SETTING_KEYS.taxRate] ?? '';
  document.getElementById('retire-state-pension').checked = byKey[RETIREMENT_SETTING_KEYS.statePension] === 'true';
  document.getElementById('retire-state-pension-date').value = byKey[RETIREMENT_SETTING_KEYS.statePensionStartDate] ?? toISODateLocal(STATE_PENSION_PAYMENT_START);
  document.getElementById('retire-clear-debt').checked = byKey[RETIREMENT_SETTING_KEYS.clearDebt] === 'true';
  renderRetirementChart();
}

document.getElementById('save-retirement-btn').addEventListener('click', async () => {
  const msg = document.getElementById('retirement-msg');
  msg.textContent = '';
  msg.className = 'msg';

  const { data: { user } } = await sb.auth.getUser();
  const now = new Date().toISOString();
  const rows = [
    { user_id: user.id, key: 'pension_drawdown_rate', value: document.getElementById('drawdown-rate').value, updated_at: now },
    { user_id: user.id, key: RETIREMENT_SETTING_KEYS.spend, value: document.getElementById('retire-monthly-spend').value, updated_at: now },
    { user_id: user.id, key: RETIREMENT_SETTING_KEYS.potGrowth, value: document.getElementById('retire-pot-growth').value, updated_at: now },
    { user_id: user.id, key: RETIREMENT_SETTING_KEYS.spendIncrease, value: document.getElementById('retire-spend-increase').value, updated_at: now },
    { user_id: user.id, key: RETIREMENT_SETTING_KEYS.dob, value: document.getElementById('retire-dob').value, updated_at: now },
    { user_id: user.id, key: RETIREMENT_SETTING_KEYS.taxRate, value: document.getElementById('retire-tax-rate').value, updated_at: now },
    { user_id: user.id, key: RETIREMENT_SETTING_KEYS.statePension, value: document.getElementById('retire-state-pension').checked ? 'true' : 'false', updated_at: now },
    { user_id: user.id, key: RETIREMENT_SETTING_KEYS.statePensionStartDate, value: document.getElementById('retire-state-pension-date').value, updated_at: now },
    { user_id: user.id, key: RETIREMENT_SETTING_KEYS.clearDebt, value: document.getElementById('retire-clear-debt').checked ? 'true' : 'false', updated_at: now },
  ];
  const { error } = await sb.from('app_settings').upsert(rows, { onConflict: 'user_id,key' });
  if (error) { msg.textContent = 'Failed to save: ' + error.message; msg.className = 'msg error'; return; }
  msg.textContent = 'Saved.';
  msg.className = 'msg ok';
  renderRetirementChart();
});

async function loadInvestmentValues() {
  const { data, error } = await sb.from('investment_values').select('*').order('date');
  if (error) return alert('Failed to load investment values: ' + error.message);
  investmentValues = data || [];
  renderRetirementChart();
}

async function loadDebtsForRetirement() {
  const [{ data: d, error: debtErr }, { data: dv, error: debtValErr }] = await Promise.all([
    sb.from('debts').select('*'),
    sb.from('debt_values').select('*').order('date'),
  ]);
  if (debtErr) return alert('Failed to load debts: ' + debtErr.message);
  if (debtValErr) return alert('Failed to load debt values: ' + debtValErr.message);
  debts = d || [];
  debtValues = dv || [];
  renderRetirementChart();
}

function currentPotTotals() {
  const latest = {};
  for (const v of investmentValues) {
    const cur = latest[v.account_id];
    if (!cur || v.date > cur.date || (v.date === cur.date && v.created_at > cur.created_at)) {
      latest[v.account_id] = v;
    }
  }
  let isaTotal = 0, pensionTotal = 0;
  for (const acc of accounts) {
    const v = latest[acc.id];
    if (!v) continue;
    if (acc.type === 'ISA') isaTotal += Number(v.value);
    else if (acc.type === 'Pension') pensionTotal += Number(v.value);
  }
  return { isaTotal, pensionTotal };
}

function currentTotalDebt() {
  const latest = {};
  for (const v of debtValues) {
    const cur = latest[v.debt_id];
    if (!cur || v.date > cur.date || (v.date === cur.date && v.created_at > cur.created_at)) {
      latest[v.debt_id] = v;
    }
  }
  let totalDebt = 0;
  for (const debt of debts) {
    const v = latest[debt.id];
    if (v) totalDebt += Number(v.outstanding_amount);
  }
  return totalDebt;
}

function parseISODateLocal(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toISODateLocal(d) {
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function ageAt(dob, atDate) {
  let years = atDate.getFullYear() - dob.getFullYear();
  let months = atDate.getMonth() - dob.getMonth();
  if (atDate.getDate() < dob.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  return { years, months };
}

// State Pension: a flat £650/month in April-2025 money, uprated once a year
// every April by the Spend Increase by rate — growth keeps accruing from
// April 2025 regardless, but nothing is actually paid out (and netted off
// the spend target) until April 2035, reflecting state pension age (67).
const STATE_PENSION_BASE = 650;
const STATE_PENSION_GROWTH_START = new Date(2025, 3, 1);
const STATE_PENSION_PAYMENT_START = new Date(2035, 3, 1);

function statePensionAmountAt(date, spendRatePct, paymentStartDate) {
  if (date < paymentStartDate) return 0;
  let years = date.getFullYear() - STATE_PENSION_GROWTH_START.getFullYear();
  if (date.getMonth() < STATE_PENSION_GROWTH_START.getMonth()) years -= 1;
  if (years < 0) years = 0;
  const rate = Math.max(spendRatePct, 0) / 100;
  return STATE_PENSION_BASE * Math.pow(1 + rate, years);
}

function simulateRetirement(isa0, pension0, spend0, taxRatePct, growthPct, spendRatePct, maxMonths, statePensionEnabled, statePensionStartDate) {
  const taxRate = Math.min(Math.max(taxRatePct, 0), 99) / 100;
  const monthlyGrowth = Math.pow(1 + Math.max(growthPct, 0) / 100, 1 / 12) - 1;
  const spendRate = Math.max(spendRatePct, 0) / 100;

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  let isa = isa0, pension = pension0;
  const points = [{ date: new Date(today.getFullYear(), today.getMonth(), today.getDate()), isa, pension, total: isa + pension }];
  let depletion = null;

  for (let m = 0; m < maxMonths; m++) {
    isa *= (1 + monthlyGrowth);
    pension *= (1 + monthlyGrowth);
    const date = new Date(start.getFullYear(), start.getMonth() + m, 1);
    let target = spend0 * Math.pow(1 + spendRate, m / 12);
    if (statePensionEnabled) {
      target = Math.max(0, target - statePensionAmountAt(date, spendRatePct, statePensionStartDate));
    }

    const totalAB = isa + pension;
    let desiredIsa = 0, desiredPensionNet = 0;
    if (totalAB > 0) {
      desiredIsa = target * isa / totalAB;
      desiredPensionNet = target * pension / totalAB;
    } else {
      desiredIsa = target;
    }
    const desiredPensionGross = desiredPensionNet / (1 - taxRate);

    let actualIsa = Math.min(desiredIsa, isa);
    let shortfall = desiredIsa - actualIsa;
    let actualPensionGross = Math.min(desiredPensionGross, pension);
    const actualPensionNet = actualPensionGross * (1 - taxRate);
    shortfall += desiredPensionNet - actualPensionNet;

    let remainingIsa = isa - actualIsa;
    let remainingPension = pension - actualPensionGross;
    if (shortfall > 1e-9) {
      const extraIsa = Math.min(shortfall, remainingIsa);
      actualIsa += extraIsa; shortfall -= extraIsa; remainingIsa -= extraIsa;
      if (shortfall > 1e-9) {
        const extraPensionGross = Math.min(shortfall / (1 - taxRate), remainingPension);
        actualPensionGross += extraPensionGross;
        shortfall -= extraPensionGross * (1 - taxRate);
        remainingPension -= extraPensionGross;
      }
    }

    isa -= actualIsa;
    pension -= actualPensionGross;
    if (isa < 1e-6) isa = 0;
    if (pension < 1e-6) pension = 0;

    points.push({ date, isa, pension, total: isa + pension, target });

    if (shortfall > 1e-6) {
      depletion = { date };
      break;
    }
  }
  return { points, depletion };
}

function retirementNiceStep(range) {
  const rough = range / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rough || 1)));
  const norm = rough / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

function retirementNiceCeil(x) {
  if (x <= 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const base = Math.pow(10, exp);
  const f = x / base;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * base;
}

function fmtGBPCompact(v) {
  v = Math.max(0, v);
  if (v >= 1000) {
    const k = v / 1000;
    return '£' + (Number.isInteger(k) ? k : Math.round(k * 10) / 10) + 'k';
  }
  return '£' + Math.round(v);
}

function buildRetirementSvg(series, points, depletion) {
  const W = 760, H = 260;
  const pad = { left: 56, right: 16, top: 16, bottom: 28 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const startMs = points[0].date.getTime();
  const endMs = points[points.length - 1].date.getTime();
  const spanMs = Math.max(endMs - startMs, 1);
  const xScale = (date) => pad.left + ((date.getTime() - startMs) / spanMs) * plotW;

  const allVals = points.flatMap(p => series.map(s => s.valueFn(p)));
  const yMax = retirementNiceCeil(Math.max(1, ...allVals) * 1.05);
  const yScale = (v) => pad.top + (1 - v / yMax) * plotH;

  const step = retirementNiceStep(yMax);
  const gridLines = [];
  for (let g = 0; g <= yMax; g += step) {
    const y = yScale(g).toFixed(1);
    gridLines.push(`<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" class="perf-gridline" />`);
    gridLines.push(`<text x="${pad.left - 8}" y="${y}" class="perf-axis-label" text-anchor="end" dominant-baseline="middle">${fmtGBPCompact(g)}</text>`);
  }

  const spanYears = spanMs / (365.25 * 24 * 3600 * 1000);
  const tickStepYears = Math.max(1, Math.round(retirementNiceStep(spanYears / 6)));
  const firstYear = points[0].date.getFullYear();
  const lastYear = points[points.length - 1].date.getFullYear();
  const yearTicks = [];
  for (let y = firstYear; y <= lastYear; y += tickStepYears) {
    const d = new Date(y, 0, 1);
    if (d.getTime() < startMs || d.getTime() > endMs) continue;
    const x = xScale(d).toFixed(1);
    yearTicks.push(`<line x1="${x}" y1="${pad.top}" x2="${x}" y2="${H - pad.bottom}" class="perf-gridline" />`);
    yearTicks.push(`<text x="${x}" y="${H - 8}" class="perf-axis-label" text-anchor="middle">${y}</text>`);
  }

  const zeroY = yScale(0).toFixed(1);
  const seriesSvg = series.map(s => {
    const linePoints = points.map(p => `${xScale(p.date).toFixed(1)},${yScale(s.valueFn(p)).toFixed(1)}`).join(' ');
    const area = s.isTotal
      ? `<polygon points="${xScale(points[0].date).toFixed(1)},${zeroY} ${linePoints} ${xScale(points[points.length - 1].date).toFixed(1)},${zeroY}" class="perf-area" style="fill:color-mix(in srgb, ${s.color} 15%, transparent)" />`
      : '';
    return `${area}<polyline points="${linePoints}" class="perf-line" style="stroke:${s.color};stroke-width:${s.isTotal ? 2.5 : 1.5}" />`;
  }).join('');

  let marker = '';
  if (depletion) {
    const dx = xScale(depletion.date).toFixed(1);
    marker = `<line x1="${dx}" y1="${pad.top}" x2="${dx}" y2="${H - pad.bottom}" stroke="var(--critical)" stroke-width="1.5" stroke-dasharray="3 3" />`;
  }

  return `${gridLines.join('')}${yearTicks.join('')}${seriesSvg}${marker}`;
}

function renderRetirementChart() {
  const wrap = document.getElementById('retirement-chart-wrap');
  const empty = document.getElementById('retirement-empty');
  const summary = document.getElementById('retirement-summary');
  const legend = document.getElementById('retirement-legend');
  const svg = document.getElementById('retirement-chart');

  const spend0 = parseFloat(document.getElementById('retire-monthly-spend').value);
  const potGrowthPct = parseFloat(document.getElementById('retire-pot-growth').value);
  const spendRatePct = parseFloat(document.getElementById('retire-spend-increase').value);
  const taxRatePct = parseFloat(document.getElementById('retire-tax-rate').value);
  const dobStr = document.getElementById('retire-dob').value;
  const statePensionEnabled = document.getElementById('retire-state-pension').checked;
  const statePensionStartStr = document.getElementById('retire-state-pension-date').value;
  const clearDebtEnabled = document.getElementById('retire-clear-debt').checked;

  if (!spend0 || Number.isNaN(potGrowthPct) || Number.isNaN(spendRatePct) || Number.isNaN(taxRatePct)) {
    wrap.classList.add('hidden');
    legend.innerHTML = '';
    summary.textContent = '';
    empty.classList.remove('hidden');
    return;
  }

  let { isaTotal, pensionTotal } = currentPotTotals();
  if (clearDebtEnabled) isaTotal = Math.max(0, isaTotal - currentTotalDebt());
  const dob = dobStr ? parseISODateLocal(dobStr) : null;
  const statePensionStartDate = statePensionStartStr ? parseISODateLocal(statePensionStartStr) : STATE_PENSION_PAYMENT_START;
  const maxMonths = dob ? Math.max(12, (100 - ageAt(dob, new Date()).years) * 12) : 60 * 12;

  const result = simulateRetirement(isaTotal, pensionTotal, spend0, taxRatePct, potGrowthPct, spendRatePct, maxMonths, statePensionEnabled, statePensionStartDate);

  empty.classList.add('hidden');
  wrap.classList.remove('hidden');

  if (result.depletion) {
    const d = result.depletion.date;
    const dateLabel = d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    if (dob) {
      const age = ageAt(dob, d);
      summary.textContent = `Runs out around ${dateLabel} — you'll be ${age.years}${age.months ? ' years ' + age.months + ' mo' : ' years'} old.`;
    } else {
      summary.textContent = `Runs out around ${dateLabel}.`;
    }
  } else {
    summary.textContent = `Still growing after ${Math.floor(maxMonths / 12)} years under these assumptions.`;
  }

  const series = [
    { key: 'total', label: 'Total', color: 'var(--series-total)', isTotal: true, valueFn: p => p.total },
    { key: 'isa', label: 'ISA', color: 'var(--series-1)', isTotal: false, valueFn: p => p.isa },
    { key: 'pension', label: 'Pension', color: 'var(--series-2)', isTotal: false, valueFn: p => p.pension },
  ];

  legend.innerHTML = series.map(s => {
    const isOff = hiddenRetirementSeries.has(s.key);
    return `
    <button type="button" class="item${isOff ? ' off' : ''}" data-key="${s.key}" aria-pressed="${isOff ? 'true' : 'false'}" aria-label="${isOff ? 'Show' : 'Hide'} ${s.label}">
      <span class="swatch" style="background:${s.color}"></span>${s.label}
    </button>`;
  }).join('');
  legend.querySelectorAll('.item').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (hiddenRetirementSeries.has(key)) hiddenRetirementSeries.delete(key);
      else hiddenRetirementSeries.add(key);
      renderRetirementChart();
    });
  });

  const visibleSeries = series.filter(s => !hiddenRetirementSeries.has(s.key));
  if (visibleSeries.length === 0) {
    svg.innerHTML = `<text x="380" y="130" text-anchor="middle" class="perf-axis-label" style="font-size:13px">All series hidden — click the legend to show one.</text>`;
    return;
  }

  svg.innerHTML = buildRetirementSvg(visibleSeries, result.points, result.depletion);
}

// ---------- Add account modal ----------

const accountModal = document.getElementById('account-modal');
const accountForm = document.getElementById('account-form');
let editingAccountId = null;

function updateSavingsFieldsVisibility() {
  const isSavings = document.getElementById('new-account-type').value === 'Savings';
  document.querySelectorAll('.savings-field').forEach(f => f.classList.toggle('hidden', !isSavings));
}
document.getElementById('new-account-type').addEventListener('change', updateSavingsFieldsVisibility);

function openAccountModal(account) {
  accountForm.reset();
  editingAccountId = account ? account.id : null;
  document.getElementById('account-modal-title').textContent = account ? 'Edit account' : 'Add account';
  document.getElementById('account-modal-submit').textContent = account ? 'Save changes' : 'Add account';
  document.getElementById('account-modal-delete').classList.toggle('hidden', !editingAccountId);
  if (account) {
    document.getElementById('new-account-name').value = account.name;
    document.getElementById('new-account-type').value = account.type;
    document.getElementById('new-account-rate').value = account.interest_rate != null ? account.interest_rate : '';
    document.getElementById('new-account-access').value = account.access || 'Instant';
    document.getElementById('new-account-taxable').value = account.taxable ? 'Yes' : 'No';
    document.getElementById('new-account-note').value = account.note || '';
  }
  updateSavingsFieldsVisibility();
  accountModal.classList.remove('hidden');
  document.getElementById('new-account-name').focus();
}
function closeAccountModal() {
  accountModal.classList.add('hidden');
}

document.getElementById('add-account-btn').addEventListener('click', () => openAccountModal());
document.getElementById('account-modal-cancel').addEventListener('click', closeAccountModal);
accountModal.addEventListener('click', (e) => { if (e.target === accountModal) closeAccountModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !accountModal.classList.contains('hidden')) closeAccountModal();
});

document.getElementById('account-modal-delete').addEventListener('click', async () => {
  if (!editingAccountId) return;
  if (!confirm('Delete this account? This can\'t be undone.')) return;
  const { error } = await sb.from('accounts').delete().eq('id', editingAccountId);
  if (error) return alert('Failed to delete: ' + error.message);
  closeAccountModal();
  await loadAccounts();
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
  } else {
    record.interest_rate = null;
    record.access = null;
    record.taxable = null;
    record.note = null;
  }

  if (editingAccountId) {
    const { error } = await sb.from('accounts').update(record).eq('id', editingAccountId);
    if (error) return alert('Failed to save changes: ' + error.message);
  } else {
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from('accounts').insert({ ...record, user_id: user.id });
    if (error) return alert('Failed to add account: ' + error.message);
  }
  closeAccountModal();
  await loadAccounts();
});

// ---------- Savings accounts list ----------

async function loadAccounts() {
  const { data, error } = await sb.from('accounts').select('*').order('name');
  if (error) return alert('Failed to load accounts: ' + error.message);
  accounts = data || [];
  renderAccounts();
  renderRetirementChart();
}

function renderAccounts() {
  const grid = document.getElementById('accounts-grid');
  grid.innerHTML = '';

  const savingsAccounts = accounts.filter(a => a.type === 'Savings');
  if (savingsAccounts.length === 0) {
    grid.innerHTML = '<div class="empty">No savings accounts yet — add one to get started.</div>';
    return;
  }

  for (const account of savingsAccounts) {
    const row = document.createElement('div');
    row.className = 'expense-row';
    row.innerHTML = `
      <div class="expense-row-main">
        <span class="expense-name">${escapeHtml(account.name)}</span>
        <span class="expense-amount">${account.interest_rate != null ? Number(account.interest_rate) + '%' : '—'}</span>
        <button type="button" class="share-edit-btn" aria-label="Edit ${escapeHtml(account.name)}">&#9998;</button>
      </div>
      ${account.note ? `<div class="account-extra"><div class="account-note">${escapeHtml(account.note)}</div></div>` : ''}
    `;
    row.querySelector('.share-edit-btn').addEventListener('click', () => openAccountModal(account));
    grid.appendChild(row);
  }
}

// ---------- Shares ----------

async function loadShares() {
  const { data, error } = await sb.from('shares').select('*').order('title');
  if (error) return alert('Failed to load shares: ' + error.message);
  shares = data || [];
  renderShares();
}

function renderShares() {
  const grid = document.getElementById('shares-grid');
  grid.innerHTML = '';

  if (shares.length === 0) {
    grid.innerHTML = '<div class="empty">No shares yet — add one to get started.</div>';
    return;
  }

  for (const share of shares) {
    const row = document.createElement('div');
    row.className = 'expense-row';
    row.innerHTML = `
      <div class="expense-row-main">
        <span class="expense-date">${escapeHtml(share.trading_code)}</span>
        <span class="expense-name">${escapeHtml(share.title)}</span>
        <span class="expense-amount">${Number(share.quantity).toLocaleString('en-GB')}</span>
        <button type="button" class="share-edit-btn" aria-label="Edit ${escapeHtml(share.title)}">&#9998;</button>
      </div>
    `;
    row.querySelector('.share-edit-btn').addEventListener('click', () => openShareModal(share));
    grid.appendChild(row);
  }
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

document.getElementById('add-share-btn').addEventListener('click', () => openShareModal());
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
  await loadShares();
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
  await loadShares();
});
