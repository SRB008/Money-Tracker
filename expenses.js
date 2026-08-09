const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const fmtGBP = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const WEEKDAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

let expenses = [];
let occurrences = [];
let monthCursor = startOfDay(new Date());
monthCursor.setDate(1);

// ---------- Auth ----------

const appView = document.getElementById('app-view');

sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    appView.classList.remove('hidden');
    document.getElementById('user-email').textContent = session.user.email;
    loadAll();
  } else {
    window.location.href = 'index.html';
  }
});

document.getElementById('signout-btn').addEventListener('click', () => sb.auth.signOut());

// ---------- Data loading ----------

async function loadAll() {
  const [{ data: exps, error: expErr }, { data: occs, error: occErr }] = await Promise.all([
    sb.from('expenses').select('*').eq('active', true).order('name'),
    sb.from('expense_occurrences').select('*'),
  ]);
  if (expErr) return alert('Failed to load expenses: ' + expErr.message);
  if (occErr) return alert('Failed to load expense occurrences: ' + occErr.message);
  expenses = exps || [];
  occurrences = occs || [];
  renderAll();
}

function renderAll() {
  renderNext8();
  renderMonth();
  renderExpensesList();
}

// ---------- Occurrence projection ----------
// For each expense, recorded occurrences take priority within their period
// (calendar month for Monthly, Mon-Sun week for Weekly). Periods in range with
// no recorded occurrence get a projected entry from the expense's typical day/amount.

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
            results.push({ expense: exp, date: r.date, amount: Number(r.amount), recorded: true });
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
            results.push({ expense: exp, date: r.date, amount: Number(r.amount), recorded: true });
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
    .sort((a, b) => a.date.localeCompare(b.date) || (a.amount || 0) - (b.amount || 0));
}

// ---------- Rendering: expense rows ----------

function fmtDayLabel(dateStr) {
  return parseISODate(dateStr).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}

function renderExpenseRow(entry) {
  const row = document.createElement('div');
  row.className = 'expense-row';
  const amountText = entry.amount != null ? fmtGBP(entry.amount) : '—';
  row.innerHTML = `
    <div class="expense-row-main">
      <span class="expense-date">${fmtDayLabel(entry.date)}</span>
      <span class="expense-name">${escapeHtml(entry.expense.name)}</span>
      <span class="expense-amount ${entry.recorded ? '' : 'projected'}">${amountText}</span>
    </div>
  `;
  if (!entry.recorded) {
    const recordDiv = document.createElement('div');
    recordDiv.className = 'expense-record';
    recordDiv.innerHTML = `
      <input type="number" step="0.01" min="0" class="record-amount-input" placeholder="0.00" value="${entry.amount != null ? entry.amount : ''}">
      <button type="button" class="record-save-btn">Save</button>
    `;
    recordDiv.querySelector('.record-save-btn').addEventListener('click', () => recordOccurrence(entry, recordDiv));
    row.appendChild(recordDiv);
  }
  return row;
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

async function recordOccurrence(entry, recordDiv) {
  const input = recordDiv.querySelector('.record-amount-input');
  const amount = input.value;
  if (amount === '') return alert('Enter an amount.');
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('expense_occurrences')
    .upsert({ expense_id: entry.expense.id, date: entry.date, amount, user_id: user.id }, { onConflict: 'expense_id,date' });
  if (error) return alert('Failed to save: ' + error.message);
  await loadAll();
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

function renderMonth() {
  const list = document.getElementById('month-list');
  const empty = document.getElementById('month-empty');
  const totalEl = document.getElementById('month-total');
  list.innerHTML = '';
  document.getElementById('month-label').textContent =
    monthCursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const start = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const end = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);
  const entries = computeOccurrences(start, end);

  if (entries.length === 0) {
    empty.classList.remove('hidden');
    totalEl.textContent = '';
    return;
  }
  empty.classList.add('hidden');
  for (const entry of entries) list.appendChild(renderExpenseRow(entry));

  const total = entries.reduce((sum, e) => sum + (e.amount || 0), 0);
  totalEl.textContent = `Total: ${fmtGBP(total)}`;
}

document.getElementById('month-prev').addEventListener('click', () => {
  monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1);
  renderMonth();
});
document.getElementById('month-next').addEventListener('click', () => {
  monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1);
  renderMonth();
});
document.getElementById('month-today').addEventListener('click', () => {
  monthCursor = startOfDay(new Date());
  monthCursor.setDate(1);
  renderMonth();
});

// ---------- Expense definitions list ----------

// Shading is a simple calendar check, not tied to recorded payments: if the
// expense's typical day has already passed this month, assume it's paid.
// Weekly expenses aren't shaded.
function isPaidThisPeriod(exp) {
  if (exp.frequency !== 'Monthly') return false;
  const today = startOfDay(new Date());
  const day = Math.min(exp.typical_day, daysInMonth(today.getFullYear(), today.getMonth()));
  return day <= today.getDate();
}

function renderExpensesList() {
  const list = document.getElementById('expenses-grid');
  list.innerHTML = '';
  const freqs = ['Monthly', 'Weekly'];
  for (const freq of freqs) {
    const freqExpenses = expenses
      .filter(e => e.frequency === freq)
      .sort((a, b) => a.typical_day - b.typical_day || (a.typical_amount || 0) - (b.typical_amount || 0));
    if (freqExpenses.length === 0) continue;
    const group = document.createElement('div');
    group.className = 'type-group';
    const h3 = document.createElement('h3');
    h3.textContent = freq;
    group.appendChild(h3);
    for (const exp of freqExpenses) {
      const paid = isPaidThisPeriod(exp);
      const row = document.createElement('div');
      row.className = 'expense-row' + (paid ? ' paid' : '');
      const dayLabel = freq === 'Monthly' ? String(exp.typical_day) : WEEKDAY_SHORT[exp.typical_day];
      const amountText = exp.typical_amount != null ? fmtGBP(exp.typical_amount) : '—';
      row.innerHTML = `
        <div class="expense-row-main">
          <span class="expense-date">${dayLabel}</span>
          <span class="expense-name">${escapeHtml(exp.name)}</span>
          <span class="expense-amount">${amountText}</span>
        </div>
      `;
      group.appendChild(row);
    }
    list.appendChild(group);
  }
  if (expenses.length === 0) {
    list.innerHTML = '<div class="empty">No expenses yet — add one to get started.</div>';
  }
}

// ---------- Add expense modal ----------

const expenseModal = document.getElementById('expense-modal');
const expenseForm = document.getElementById('expense-form');

function updateFrequencyFields() {
  const isMonthly = document.getElementById('new-expense-frequency').value === 'Monthly';
  document.getElementById('field-day-monthly').classList.toggle('hidden', !isMonthly);
  document.getElementById('field-day-weekly').classList.toggle('hidden', isMonthly);
}
document.getElementById('new-expense-frequency').addEventListener('change', updateFrequencyFields);

function openExpenseModal() {
  expenseForm.reset();
  updateFrequencyFields();
  expenseModal.classList.remove('hidden');
  document.getElementById('new-expense-name').focus();
}
function closeExpenseModal() {
  expenseModal.classList.add('hidden');
}

document.getElementById('add-expense-btn').addEventListener('click', openExpenseModal);
document.getElementById('expense-modal-cancel').addEventListener('click', closeExpenseModal);
expenseModal.addEventListener('click', (e) => { if (e.target === expenseModal) closeExpenseModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !expenseModal.classList.contains('hidden')) closeExpenseModal();
});

expenseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-expense-name').value.trim();
  const frequency = document.getElementById('new-expense-frequency').value;
  if (!name) return;
  const typical_day = frequency === 'Monthly'
    ? Number(document.getElementById('new-expense-day-monthly').value)
    : Number(document.getElementById('new-expense-day-weekly').value);
  if (!typical_day) return alert('Enter a valid day.');
  const amountVal = document.getElementById('new-expense-amount').value;
  const typical_amount = amountVal === '' ? null : amountVal;

  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('expenses').insert({ name, frequency, typical_day, typical_amount, user_id: user.id });
  if (error) return alert('Failed to add expense: ' + error.message);
  closeExpenseModal();
  await loadAll();
});
