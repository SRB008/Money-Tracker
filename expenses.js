// Bills. Shared code lives in lib.js and schedule.js.

const WEEKDAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

let expenses = [];
let occurrences = [];
let monthCursor = startOfDay(new Date());
monthCursor.setDate(1);

initProtectedPage(loadAll);

// ---------- Data loading ----------

async function loadAll() {
  const [{ data: exps, error: expErr }, { data: occs, error: occErr }] = await Promise.all([
    sb.from('expenses').select('*').eq('active', true).order('name'),
    sb.from('expense_occurrences').select('*'),
  ]);
  if (failed('Failed to load expenses', expErr) || failed('Failed to load expense occurrences', occErr)) return;
  expenses = exps || [];
  occurrences = occs || [];
  renderAll();
}

function renderAll() {
  renderNext8(expenses, occurrences);
  renderMonth();
  renderExpensesList();
}

// ---------- Rendering: expense rows ----------

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

async function saveMonthDefaults() {
  const msg = document.getElementById('month-save-msg');
  msg.className = 'msg';

  const start = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const end = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);
  const projected = computeOccurrences(expenses, occurrences, start, end).filter(e => !e.recorded);

  const rows = projected.filter(e => e.amount != null);
  const skipped = projected.length - rows.length;

  if (rows.length === 0) {
    msg.textContent = skipped > 0
      ? 'Nothing saved — those expenses have no typical amount set.'
      : 'Nothing to save — this month is already fully recorded.';
    msg.className = 'msg' + (skipped > 0 ? ' error' : '');
    return;
  }

  const { error } = await sb.from('expense_occurrences').upsert(
    rows.map(e => ({ expense_id: e.expense.id, date: e.date, amount: e.amount })),
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
document.getElementById('save-month-btn').addEventListener('click', (e) => busy(e.currentTarget, saveMonthDefaults));

function renderMonth() {
  const list = document.getElementById('month-list');
  const empty = document.getElementById('month-empty');
  const totalEl = document.getElementById('month-total');
  list.innerHTML = '';
  document.getElementById('month-label').textContent =
    monthCursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const start = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const end = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);
  const entries = computeOccurrences(expenses, occurrences, start, end);

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
  if (failed('Failed to delete', error)) return;
  closeOccurrenceModal();
  await loadAll();
});

onSubmit(occurrenceForm, async () => {
  const date = document.getElementById('occurrence-date').value;
  const amountVal = toNum(document.getElementById('occurrence-amount').value);
  if (amountVal == null || Number.isNaN(amountVal) || amountVal < 0) return notify('Enter a valid amount.');

  if (editingOccurrence.occurrenceId) {
    const { error } = await sb.from('expense_occurrences')
      .update({ date, amount: amountVal })
      .eq('id', editingOccurrence.occurrenceId);
    if (failed('Failed to save', error)) return;
  } else {
    const { error } = await sb.from('expense_occurrences')
      .upsert({ expense_id: editingOccurrence.expenseId, date, amount: amountVal }, { onConflict: 'expense_id,date' });
    if (failed('Failed to save', error)) return;
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
  if (failed('Failed to delete', error)) return;
  closeExpenseModal();
  await loadAll();
});

onSubmit(expenseForm, async () => {
  const name = document.getElementById('new-expense-name').value.trim();
  const frequency = document.getElementById('new-expense-frequency').value;
  if (!name) return;
  const typical_day = frequency === 'Monthly'
    ? Number(document.getElementById('new-expense-day-monthly').value)
    : Number(document.getElementById('new-expense-day-weekly').value);
  if (!typical_day) return notify('Enter a valid day.');
  const typical_amount = toNum(document.getElementById('new-expense-amount').value);
  if (Number.isNaN(typical_amount)) return notify('Enter a valid amount.');
  const record = { name, frequency, typical_day, typical_amount };

  if (editingExpenseId) {
    const { error } = await sb.from('expenses').update(record).eq('id', editingExpenseId);
    if (failed('Failed to save changes', error)) return;
  } else {
    const { error } = await sb.from('expenses').insert(record);
    if (failed('Failed to add expense', error)) return;
  }
  closeExpenseModal();
  await loadAll();
});
