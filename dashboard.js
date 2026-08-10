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
let drawdownRate = 4;

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
  ] = await Promise.all([
    sb.from('accounts').select('*').order('type').order('name'),
    sb.from('investment_values').select('*').order('date'),
    sb.from('expenses').select('*').eq('active', true).order('name'),
    sb.from('expense_occurrences').select('*'),
    sb.from('debts').select('*').order('name'),
    sb.from('debt_values').select('*').order('date'),
    sb.from('app_settings').select('*').eq('key', 'pension_drawdown_rate').maybeSingle(),
  ]);
  if (accErr) return alert('Failed to load accounts: ' + accErr.message);
  if (valErr) return alert('Failed to load values: ' + valErr.message);
  if (expErr) return alert('Failed to load expenses: ' + expErr.message);
  if (occErr) return alert('Failed to load expense occurrences: ' + occErr.message);
  if (debtErr) return alert('Failed to load debts: ' + debtErr.message);
  if (debtValErr) return alert('Failed to load debt values: ' + debtValErr.message);
  accounts = acc || [];
  values = val || [];
  expenses = exps || [];
  occurrences = occs || [];
  debts = d || [];
  debtValues = dv || [];
  drawdownRate = (!settingErr && setting) ? Number(setting.value) : 4;
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

  const latestDebt = latestValueByDebt();
  let totalDebt = 0;
  for (const debt of debts) {
    const v = latestDebt[debt.id];
    if (v) totalDebt += Number(v.outstanding_amount);
  }

  const netTotal = grandTotal - totalDebt;

  const accountsRow = document.getElementById('stat-row-accounts');
  accountsRow.innerHTML = '';
  for (const type of ['Savings', 'ISA', 'Pension']) {
    accountsRow.appendChild(statTile(type, fmtGBP(totals[type] || 0), false));
  }

  const debtRow = document.getElementById('stat-row-debt');
  debtRow.innerHTML = '';
  debtRow.appendChild(statTile('Debt', fmtGBP(totalDebt), false, 'debt'));

  const totalRow = document.getElementById('stat-row-total');
  totalRow.innerHTML = '';
  totalRow.appendChild(statTile('Total', fmtGBP(netTotal), true));

  const netIncomePA = (totals.ISA + totals.Pension * 0.65 - totalDebt) * (drawdownRate / 100);
  const netIncomePM = netIncomePA / 12;

  const outlookRow = document.getElementById('stat-row-outlook');
  outlookRow.innerHTML = '';
  const incomeTile = document.createElement('div');
  incomeTile.className = 'stat-tile';
  incomeTile.innerHTML = `
    <div class="label">Potential Net Income</div>
    <div class="value">${fmtGBP(netIncomePA)} pa</div>
    <div class="sub-value">${fmtGBP(netIncomePM)} pm&nbsp; |&nbsp; @${drawdownRate}%</div>
  `;
  outlookRow.appendChild(incomeTile);
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
