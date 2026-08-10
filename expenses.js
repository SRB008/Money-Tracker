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

// ---------- Rendering: expense rows ----------

function fmtDayLabel(dateStr) {
  return parseISODate(dateStr).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}

function hasDatePassed(dateStr) {
  return dateStr <= toISODate(startOfDay(new Date()));
}

function renderExpenseRow(entry) {
  const row = document.createElement('div');
  row.className = 'expense-row editable' + (hasDatePassed(entry.date) ? ' paid' : '');
  const amountText = entry.amount != null ? fmtGBP(entry.amount) : '—';
  row.innerHTML = `
    <div class="expense-row-main">
      <span class="expense-date">${fmtDayLabel(entry.date)}</span>
      <span class="expense-name">${escapeHtml(entry.expense.name)}</span>
      <span class="expense-amount ${entry.recorded ? '' : 'projected'}">${amountText}</span>
    </div>
  `;
  row.addEventListener('click', () => openOccurrenceModal(entry));
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

async function saveMonthDefaults() {
  const msg = document.getElementById('month-save-msg');
  msg.className = 'msg';

  const start = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const end = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);
  const projected = computeOccurrences(start, end).filter(e => !e.recorded);

  const rows = projected.filter(e => e.amount != null);
  const skipped = projected.length - rows.length;

  if (rows.length === 0) {
    msg.textContent = skipped > 0
      ? 'Nothing saved — those expenses have no typical amount set.'
      : 'Nothing to save — this month is already fully recorded.';
    msg.className = 'msg' + (skipped > 0 ? ' error' : '');
    return;
  }

  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('expense_occurrences').upsert(
    rows.map(e => ({ expense_id: e.expense.id, date: e.date, amount: e.amount, user_id: user.id })),
    { onConflict: 'expense_id,date' }
  );
  if (error) {
    msg.textContent = 'Failed to save: ' + error.message;
    msg.className = 'msg error';
    return;
  }
  msg.textContent = `Saved ${rows.length} expense${rows.length === 1 ? '' : 's'}` +
    (skipped > 0 ? ` (${skipped} skipped — no typical amount).` : '.');
  msg.className = 'msg ok';
  await loadAll();
}
document.getElementById('save-month-btn').addEventListener('click', saveMonthDefaults);

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

  document.getElementById('save-month-btn').disabled = !entries.some(e => !e.recorded);

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

// ---------- Edit a single month occurrence ----------

const occurrenceModal = document.getElementById('occurrence-modal');
const occurrenceForm = document.getElementById('occurrence-form');
let editingOccurrence = null;

function openOccurrenceModal(entry) {
  editingOccurrence = { expenseId: entry.expense.id, occurrenceId: entry.occurrenceId || null };
  document.getElementById('occurrence-modal-title').textContent = entry.expense.name;
  document.getElementById('occurrence-date').value = entry.date;
  document.getElementById('occurrence-amount').value = entry.amount != null ? entry.amount : '';
  document.getElementById('occurrence-modal-delete').classList.toggle('hidden', !editingOccurrence.occurrenceId);
  occurrenceModal.classList.remove('hidden');
  document.getElementById('occurrence-amount').focus();
}
function closeOccurrenceModal() {
  occurrenceModal.classList.add('hidden');
}

document.getElementById('occurrence-modal-cancel').addEventListener('click', closeOccurrenceModal);
occurrenceModal.addEventListener('click', (e) => { if (e.target === occurrenceModal) closeOccurrenceModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !occurrenceModal.classList.contains('hidden')) closeOccurrenceModal();
});

document.getElementById('occurrence-modal-delete').addEventListener('click', async () => {
  if (!editingOccurrence.occurrenceId) return;
  if (!confirm('Delete this recorded expense? It will go back to showing the typical amount.')) return;
  const { error } = await sb.from('expense_occurrences').delete().eq('id', editingOccurrence.occurrenceId);
  if (error) return alert('Failed to delete: ' + error.message);
  closeOccurrenceModal();
  await loadAll();
});

occurrenceForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('occurrence-date').value;
  const amountVal = document.getElementById('occurrence-amount').value;
  if (amountVal === '') return alert('Enter an amount.');

  if (editingOccurrence.occurrenceId) {
    const { error } = await sb.from('expense_occurrences')
      .update({ date, amount: amountVal })
      .eq('id', editingOccurrence.occurrenceId);
    if (error) return alert('Failed to save: ' + error.message);
  } else {
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from('expense_occurrences')
      .upsert({ expense_id: editingOccurrence.expenseId, date, amount: amountVal, user_id: user.id }, { onConflict: 'expense_id,date' });
    if (error) return alert('Failed to save: ' + error.message);
  }
  closeOccurrenceModal();
  await loadAll();
});

// ---------- Expense definitions list ----------

function renderExpensesList() {
  const list = document.getElementById('expenses-grid');
  list.innerHTML = '';
  const freqs = ['Monthly', 'Weekly'];
  for (const freq of freqs) {
    const freqExpenses = expenses
      .filter(e => e.frequency === freq)
      .sort((a, b) => a.typical_day - b.typical_day || (b.typical_amount || 0) - (a.typical_amount || 0));
    if (freqExpenses.length === 0) continue;
    const group = document.createElement('div');
    group.className = 'type-group';
    const h3 = document.createElement('h3');
    h3.textContent = freq;
    group.appendChild(h3);
    for (const exp of freqExpenses) {
      const row = document.createElement('div');
      row.className = 'expense-row editable';
      const dayLabel = freq === 'Monthly' ? String(exp.typical_day) : WEEKDAY_SHORT[exp.typical_day];
      const amountText = exp.typical_amount != null ? fmtGBP(exp.typical_amount) : '—';
      row.innerHTML = `
        <div class="expense-row-main">
          <span class="expense-date">${dayLabel}</span>
          <span class="expense-name">${escapeHtml(exp.name)}</span>
          <span class="expense-amount">${amountText}</span>
        </div>
      `;
      row.addEventListener('click', () => openExpenseModal(exp));
      group.appendChild(row);
    }
    list.appendChild(group);
  }
  if (expenses.length === 0) {
    list.innerHTML = '<div class="empty">No expenses yet — add one to get started.</div>';
  }
}

// ---------- Add / edit expense modal ----------

const expenseModal = document.getElementById('expense-modal');
const expenseForm = document.getElementById('expense-form');
let editingExpenseId = null;

function updateFrequencyFields() {
  const isMonthly = document.getElementById('new-expense-frequency').value === 'Monthly';
  document.getElementById('field-day-monthly').classList.toggle('hidden', !isMonthly);
  document.getElementById('field-day-weekly').classList.toggle('hidden', isMonthly);
}
document.getElementById('new-expense-frequency').addEventListener('change', updateFrequencyFields);

function openExpenseModal(exp) {
  expenseForm.reset();
  editingExpenseId = exp ? exp.id : null;
  document.getElementById('expense-modal-title').textContent = exp ? 'Edit expense' : 'Add expense';
  document.getElementById('expense-modal-submit').textContent = exp ? 'Save changes' : 'Add expense';

  if (exp) {
    document.getElementById('new-expense-name').value = exp.name;
    document.getElementById('new-expense-frequency').value = exp.frequency;
    if (exp.frequency === 'Monthly') {
      document.getElementById('new-expense-day-monthly').value = exp.typical_day;
    } else {
      document.getElementById('new-expense-day-weekly').value = exp.typical_day;
    }
    document.getElementById('new-expense-amount').value = exp.typical_amount != null ? exp.typical_amount : '';
  }

  document.getElementById('expense-modal-delete').classList.toggle('hidden', !editingExpenseId);
  updateFrequencyFields();
  expenseModal.classList.remove('hidden');
  document.getElementById('new-expense-name').focus();
}
function closeExpenseModal() {
  expenseModal.classList.add('hidden');
}

document.getElementById('add-expense-btn').addEventListener('click', () => openExpenseModal());
document.getElementById('expense-modal-cancel').addEventListener('click', closeExpenseModal);
expenseModal.addEventListener('click', (e) => { if (e.target === expenseModal) closeExpenseModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !expenseModal.classList.contains('hidden')) closeExpenseModal();
});

document.getElementById('expense-modal-delete').addEventListener('click', async () => {
  if (!editingExpenseId) return;
  if (!confirm('Delete this expense and all its recorded amounts? This can\'t be undone.')) return;
  const { error } = await sb.from('expenses').delete().eq('id', editingExpenseId);
  if (error) return alert('Failed to delete: ' + error.message);
  closeExpenseModal();
  await loadAll();
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
  const record = { name, frequency, typical_day, typical_amount };

  if (editingExpenseId) {
    const { error } = await sb.from('expenses').update(record).eq('id', editingExpenseId);
    if (error) return alert('Failed to save changes: ' + error.message);
  } else {
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from('expenses').insert({ ...record, user_id: user.id });
    if (error) return alert('Failed to add expense: ' + error.message);
  }
  closeExpenseModal();
  await loadAll();
});
