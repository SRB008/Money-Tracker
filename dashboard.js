const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const fmtGBP = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Date helpers (local-time safe; avoids UTC/ISO-string shifting) ----------

function pad2(n) { return String(n).padStart(2, '0'); }
function toISODate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseISODate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function startOfDay(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function mondayOf(d) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return startOfDay(addDays(d, diff));
}
function daysInMonth(year, monthIndex0) { return new Date(year, monthIndex0 + 1, 0).getDate(); }

let accounts = [];
let values = [];
let expenses = [];
let occurrences = [];
let debts = [];
let debtValues = [];
let shares = [];
let otherAssets = [];
let drawdownRate = 4;
let retirementSettings = {};

const RETIREMENT_SETTING_KEYS = {
  spend: 'retirement_net_monthly_spend',
  potGrowth: 'retirement_pot_growth_rate',
  spendIncrease: 'retirement_spend_increase_rate',
  dob: 'retirement_dob',
  taxRate: 'retirement_tax_rate',
  statePension: 'retirement_state_pension_enabled',
  statePensionStartDate: 'retirement_state_pension_start_date',
  clearDebt: 'retirement_clear_debt_enabled',
  otherAssetsPension: 'retirement_other_assets_pension_enabled',
};

// ---------- Auth ----------

const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const authForm = document.getElementById('auth-form');
const authTitle = document.getElementById('auth-title');
const authSubmit = document.getElementById('auth-submit');
const authMsg = document.getElementById('auth-msg');
const authToggleText = document.getElementById('auth-toggle-text');
const authToggleLink = document.getElementById('auth-toggle-link');
let authMode = 'signin';

function setAuthMode(mode) {
  authMode = mode;
  authMsg.textContent = '';
  if (mode === 'signin') {
    authTitle.textContent = 'Sign in';
    authSubmit.textContent = 'Sign in';
    authToggleText.textContent = 'Need an account?';
    authToggleLink.textContent = 'Sign up';
  } else {
    authTitle.textContent = 'Create account';
    authSubmit.textContent = 'Sign up';
    authToggleText.textContent = 'Already have an account?';
    authToggleLink.textContent = 'Sign in';
  }
}
authToggleLink.addEventListener('click', () => setAuthMode(authMode === 'signin' ? 'signup' : 'signin'));

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  authMsg.textContent = '';
  authMsg.className = 'msg';
  authSubmit.disabled = true;
  try {
    if (authMode === 'signin') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      authMsg.textContent = 'Account created. Check your email if confirmation is required, then sign in.';
      authMsg.className = 'msg ok';
      setAuthMode('signin');
    }
  } catch (err) {
    authMsg.textContent = err.message;
    authMsg.className = 'msg error';
  } finally {
    authSubmit.disabled = false;
  }
});

document.getElementById('signout-btn').addEventListener('click', () => sb.auth.signOut());

document.getElementById('next8-card').addEventListener('click', () => { window.location.href = 'expenses.html'; });
document.getElementById('stat-row-accounts').addEventListener('click', () => { window.location.href = 'investments.html'; });
document.getElementById('stat-row-debt').addEventListener('click', () => { window.location.href = 'debts.html'; });
document.getElementById('stat-row-outlook').addEventListener('click', () => { window.location.href = 'admin.html'; });

sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    authView.classList.add('hidden');
    appView.classList.remove('hidden');
    document.getElementById('user-email').textContent = session.user.email;
    loadAll();
  } else {
    appView.classList.add('hidden');
    authView.classList.remove('hidden');
  }
});

// ---------- Data loading ----------

async function loadAll() {
  const [
    { data: acc, error: accErr },
    { data: val, error: valErr },
    { data: exps, error: expErr },
    { data: occs, error: occErr },
    { data: d, error: debtErr },
    { data: dv, error: debtValErr },
    { data: setting, error: settingErr },
    { data: shr, error: shrErr },
    { data: oth, error: othErr },
    { data: retSettings, error: retSettingsErr },
  ] = await Promise.all([
    sb.from('accounts').select('*').order('type').order('name'),
    sb.from('investment_values').select('*').order('date'),
    sb.from('expenses').select('*').eq('active', true).order('name'),
    sb.from('expense_occurrences').select('*'),
    sb.from('debts').select('*').order('name'),
    sb.from('debt_values').select('*').order('date'),
    sb.from('app_settings').select('*').eq('key', 'pension_drawdown_rate').maybeSingle(),
    sb.from('shares').select('*').order('title'),
    sb.from('other_assets').select('*').order('title'),
    sb.from('app_settings').select('*').in('key', Object.values(RETIREMENT_SETTING_KEYS)),
  ]);
  if (accErr) return alert('Failed to load accounts: ' + accErr.message);
  if (valErr) return alert('Failed to load values: ' + valErr.message);
  if (expErr) return alert('Failed to load expenses: ' + expErr.message);
  if (occErr) return alert('Failed to load expense occurrences: ' + occErr.message);
  if (debtErr) return alert('Failed to load debts: ' + debtErr.message);
  if (debtValErr) return alert('Failed to load debt values: ' + debtValErr.message);
  if (shrErr) return alert('Failed to load shares: ' + shrErr.message);
  if (othErr) return alert('Failed to load other assets: ' + othErr.message);
  if (retSettingsErr) return alert('Failed to load retirement settings: ' + retSettingsErr.message);
  accounts = acc || [];
  values = val || [];
  expenses = exps || [];
  occurrences = occs || [];
  debts = d || [];
  debtValues = dv || [];
  shares = shr || [];
  otherAssets = oth || [];
  drawdownRate = (!settingErr && setting) ? Number(setting.value) : 4;
  retirementSettings = {};
  for (const row of retSettings || []) retirementSettings[row.key] = row.value;
  renderAll();
}

function renderAll() {
  renderStats();
  renderNext8();
}

// ---------- Stats ----------

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

function latestValueByDebt() {
  const latest = {};
  for (const v of debtValues) {
    const cur = latest[v.debt_id];
    if (!cur || v.date > cur.date || (v.date === cur.date && v.created_at > cur.created_at)) {
      latest[v.debt_id] = v;
    }
  }
  return latest;
}

// ---------- Share value ----------
// Uses the stored `price` column directly (no live Alpha Vantage lookup here —
// see investments.html/app.js for the live-priced view).

function sharesTotalValue() {
  let total = 0;
  for (const share of shares) {
    if (share.price != null) total += Number(share.price) * Number(share.quantity);
  }
  return total;
}

function otherAssetsValueTotal() {
  let total = 0;
  for (const asset of otherAssets) {
    if (asset.value != null) total += Number(asset.value);
  }
  return total;
}

function otherAssetsPensionTotal() {
  let total = 0;
  for (const asset of otherAssets) {
    if (asset.pension && asset.value != null) total += Number(asset.value);
  }
  return total;
}

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
  const otherAssetsTotal = sharesTotalValue() + otherAssetsValueTotal();
  grandTotal += otherAssetsTotal;

  const latestDebt = latestValueByDebt();
  let totalDebt = 0;
  for (const debt of debts) {
    const v = latestDebt[debt.id];
    if (v) totalDebt += Number(v.outstanding_amount);
  }

  const netTotal = grandTotal - totalDebt;

  const accountsRow = document.getElementById('stat-row-accounts');
  accountsRow.innerHTML = '';
  for (const type of ['ISA', 'Pension']) {
    accountsRow.appendChild(statTile(type, fmtGBP(totals[type] || 0), false));
  }
  accountsRow.appendChild(statTile('Other Assets', fmtGBP(otherAssetsTotal), false));
  accountsRow.appendChild(statTile('Savings', fmtGBP(totals.Savings || 0), false));

  const debtRow = document.getElementById('stat-row-debt');
  debtRow.innerHTML = '';
  debtRow.appendChild(statTile('Debt', fmtGBP(totalDebt), false, 'debt'));

  const totalRow = document.getElementById('stat-row-total');
  totalRow.innerHTML = '';
  totalRow.appendChild(statTile('Base Financial Net Worth', fmtGBP(netTotal), true));

  const otherAssetsPensionEnabled = retirementSettings[RETIREMENT_SETTING_KEYS.otherAssetsPension] === 'true';
  const otherAssetsPensionAmt = otherAssetsPensionEnabled ? otherAssetsPensionTotal() : 0;
  const isaTotal = (totals.ISA || 0) + otherAssetsPensionAmt;

  const netIncomePA = (isaTotal + totals.Pension * 0.65 - totalDebt) * (drawdownRate / 100);
  const netIncomePM = netIncomePA / 12;

  const outlookRow = document.getElementById('stat-row-outlook');
  outlookRow.innerHTML = '';
  const incomeTile = document.createElement('div');
  incomeTile.className = 'stat-tile';
  incomeTile.innerHTML = `
    <div class="label">Potential Net Income</div>
    <div class="value">${fmtGBP(netIncomePM)} pm</div>
    <div class="sub-value">${fmtGBP(netIncomePA)} pa · @${drawdownRate}%</div>
  `;
  outlookRow.appendChild(incomeTile);

  renderRetirementOutlook(outlookRow, isaTotal, totals.Pension || 0, totalDebt);
}

// ---------- Retirement outlook ----------
// Mirrors the simulation on the Admin page's Retirement Runway chart, using
// the same saved settings, to surface just the runout age and time remaining.

function parseISODateLocal(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function ageAt(dob, atDate) {
  let years = atDate.getFullYear() - dob.getFullYear();
  let months = atDate.getMonth() - dob.getMonth();
  if (atDate.getDate() < dob.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  return { years, months };
}

function monthDiff(from, to) {
  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  if (to.getDate() < from.getDate()) months--;
  let total = years * 12 + months;
  return total < 0 ? 0 : total;
}

function durationLabel(totalMonths) {
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  if (y === 0) return m + (m === 1 ? ' month' : ' months');
  if (m === 0) return y + (y === 1 ? ' year' : ' years');
  return y + 'y ' + m + 'm';
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

    if (shortfall > 1e-6) {
      depletion = { date };
      break;
    }
  }
  return { depletion };
}

function renderRetirementOutlook(outlookRow, isaTotal, pensionTotal, totalDebt) {
  const spend0 = parseFloat(retirementSettings[RETIREMENT_SETTING_KEYS.spend]);
  const potGrowthPct = parseFloat(retirementSettings[RETIREMENT_SETTING_KEYS.potGrowth]);
  const spendRatePct = parseFloat(retirementSettings[RETIREMENT_SETTING_KEYS.spendIncrease]);
  const taxRatePct = parseFloat(retirementSettings[RETIREMENT_SETTING_KEYS.taxRate]);
  const dobStr = retirementSettings[RETIREMENT_SETTING_KEYS.dob];
  const statePensionEnabled = retirementSettings[RETIREMENT_SETTING_KEYS.statePension] === 'true';
  const statePensionStartStr = retirementSettings[RETIREMENT_SETTING_KEYS.statePensionStartDate];
  const clearDebtEnabled = retirementSettings[RETIREMENT_SETTING_KEYS.clearDebt] === 'true';

  if (!spend0 || Number.isNaN(potGrowthPct) || Number.isNaN(spendRatePct) || Number.isNaN(taxRatePct) || !dobStr) {
    return;
  }

  if (clearDebtEnabled) isaTotal = Math.max(0, isaTotal - totalDebt);
  const dob = parseISODateLocal(dobStr);
  const today = new Date();
  const statePensionStartDate = statePensionStartStr ? parseISODateLocal(statePensionStartStr) : STATE_PENSION_PAYMENT_START;
  const maxMonths = Math.max(12, (100 - ageAt(dob, today).years) * 12);
  const { depletion } = simulateRetirement(isaTotal, pensionTotal, spend0, taxRatePct, potGrowthPct, spendRatePct, maxMonths, statePensionEnabled, statePensionStartDate);

  const ageTile = document.createElement('div');
  ageTile.className = 'stat-tile';
  const durationTile = document.createElement('div');
  durationTile.className = 'stat-tile';

  if (depletion) {
    const age = ageAt(dob, depletion.date);
    const spendLabel = `£${Math.round(spend0).toLocaleString('en-GB')}`;
    const months = monthDiff(today, depletion.date);
    const ageValue = age.months ? `${age.years}y ${age.months}m` : `${age.years}`;
    ageTile.innerHTML = `
      <div class="label">Ok at Future Living until</div>
      <div class="value">${ageValue}</div>
      <div class="sub-value">${spendLabel} pm net</div>
    `;
    durationTile.innerHTML = `
      <div class="label">Ok at Future Living for</div>
      <div class="value">${durationLabel(months)}</div>
      <div class="sub-value">@${spendRatePct}% inflation</div>
    `;
  } else {
    ageTile.innerHTML = `
      <div class="label">At Salary, Ok Until Age</div>
      <div class="value">100+</div>
      <div class="sub-value">Not within projection</div>
    `;
    durationTile.innerHTML = `
      <div class="label">At Salary, Ok For</div>
      <div class="value">${Math.floor(maxMonths / 12)}+ years</div>
    `;
  }
  outlookRow.appendChild(ageTile);
  outlookRow.appendChild(durationTile);
}

function statTile(label, value, isTotal, extraClass) {
  const div = document.createElement('div');
  div.className = 'stat-tile' + (isTotal ? ' total' : '') + (extraClass ? ' ' + extraClass : '');
  div.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
  return div;
}

// ---------- Next 8 days ----------
// Recorded occurrences take priority within their period (calendar month for
// Monthly, Mon-Sun week for Weekly). Periods with no recorded occurrence get a
// projected entry from the expense's typical day/amount.

function computeOccurrences(rangeStart, rangeEnd) {
  const recordedByExpense = {};
  for (const occ of occurrences) {
    (recordedByExpense[occ.expense_id] ||= []).push(occ);
  }

  const results = [];
  for (const exp of expenses) {
    const recs = recordedByExpense[exp.id] || [];
    if (exp.frequency === 'Monthly') {
      let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
      const endCursor = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);
      while (cursor <= endCursor) {
        const y = cursor.getFullYear(), m = cursor.getMonth();
        const monthRecs = recs.filter(r => {
          const rd = parseISODate(r.date);
          return rd.getFullYear() === y && rd.getMonth() === m;
        });
        if (monthRecs.length > 0) {
          for (const r of monthRecs) {
            results.push({ expense: exp, date: r.date, amount: Number(r.amount), recorded: true, occurrenceId: r.id });
          }
        } else {
          const day = Math.min(exp.typical_day, daysInMonth(y, m));
          const date = `${y}-${pad2(m + 1)}-${pad2(day)}`;
          results.push({ expense: exp, date, amount: exp.typical_amount != null ? Number(exp.typical_amount) : null, recorded: false });
        }
        cursor.setMonth(cursor.getMonth() + 1);
      }
    } else {
      let cursor = mondayOf(rangeStart);
      const lastMonday = mondayOf(rangeEnd);
      while (cursor <= lastMonday) {
        const wKey = toISODate(cursor);
        const weekRecs = recs.filter(r => toISODate(mondayOf(parseISODate(r.date))) === wKey);
        if (weekRecs.length > 0) {
          for (const r of weekRecs) {
            results.push({ expense: exp, date: r.date, amount: Number(r.amount), recorded: true, occurrenceId: r.id });
          }
        } else {
          const date = toISODate(addDays(cursor, exp.typical_day - 1));
          results.push({ expense: exp, date, amount: exp.typical_amount != null ? Number(exp.typical_amount) : null, recorded: false });
        }
        cursor = addDays(cursor, 7);
      }
    }
  }

  const startStr = toISODate(rangeStart);
  const endStr = toISODate(rangeEnd);
  return results
    .filter(r => r.date >= startStr && r.date <= endStr)
    .sort((a, b) => a.date.localeCompare(b.date) || (b.amount || 0) - (a.amount || 0));
}

function fmtDayLabel(dateStr) {
  return parseISODate(dateStr).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}

function renderNext8Row(entry, runningTotal) {
  const row = document.createElement('div');
  row.className = 'expense-row next8-row';
  const amountText = entry.amount != null ? fmtGBP(entry.amount) : '—';
  row.innerHTML = `
    <span class="expense-date">${fmtDayLabel(entry.date)}</span>
    <span class="expense-name">${escapeHtml(entry.expense.name)}</span>
    <span class="expense-amount ${entry.recorded ? '' : 'projected'}">${amountText}</span>
    <span class="expense-running-total">${fmtGBP(runningTotal)}</span>
  `;
  return row;
}

function renderNext8() {
  const list = document.getElementById('next8-list');
  const empty = document.getElementById('next8-empty');
  list.innerHTML = '';
  const start = startOfDay(new Date());
  const end = addDays(start, 7);
  const entries = computeOccurrences(start, end);
  if (entries.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  let runningTotal = 0;
  for (const entry of entries) {
    runningTotal += entry.amount || 0;
    list.appendChild(renderNext8Row(entry, runningTotal));
  }
}
