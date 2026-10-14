// Debts. Shared code lives in lib.js.

let debts = [];

let latestDebt = {};   // debt_id -> latest value row

initProtectedPage(loadAll);

// ---------- Data loading ----------

async function loadAll() {
  const [{ data: d, error: debtErr }, { data: v, error: valErr }] = await Promise.all([
    sb.from('debts').select('*').order('name'),
    sb.from('latest_debt_values').select('*'),
  ]);
  if (failed('Failed to load debts', debtErr) || failed('Failed to load debt values', valErr)) return;
  debts = d || [];
  latestDebt = indexBy(v || [], 'debt_id');
  renderAll();
}

function renderAll() {
  renderDebtsList();
  renderDebtValueRows();
}

// ---------- Debts list ----------

function renderDebtsList() {
  const grid = document.getElementById('debts-grid');
  grid.innerHTML = '';
  const latest = latestDebt;
  for (const debt of debts) {
    const v = latest[debt.id];
    const details = [];
    if (debt.monthly_payment != null) details.push(`${fmtGBP(debt.monthly_payment)}/mo`);
    if (debt.interest_rate != null) details.push(`${Number(debt.interest_rate)}%`);
    if (debt.end_date) details.push(`Ends ${fmtDate(debt.end_date)}`);
    const item = document.createElement('div');
    item.className = 'account-item editable';
    item.innerHTML = `
      <div class="account-item-main">
        <span class="name">${escapeHtml(debt.name)}</span>
        <span class="value">${v ? fmtGBP(v.outstanding_amount) : '—'}</span>
      </div>
      ${details.length ? `<div class="account-detail">${details.join(' · ')}</div>` : ''}
      ${debt.note ? `<div class="account-note">${escapeHtml(debt.note)}</div>` : ''}
    `;
    item.addEventListener('click', () => openDebtModal(debt));
    grid.appendChild(item);
  }
  if (debts.length === 0) {
    grid.innerHTML = '<div class="empty">No debts yet — add one to get started.</div>';
  }
}

// ---------- Add a value ----------

document.getElementById('debt-value-date').valueAsDate = new Date();

function renderDebtValueRows() {
  const container = document.getElementById('debt-value-rows');
  container.innerHTML = '';
  if (debts.length === 0) {
    container.innerHTML = '<div class="empty">No debts yet — add one above.</div>';
    return;
  }
  const latest = latestDebt;
  for (const debt of debts) {
    const v = latest[debt.id];
    const row = document.createElement('div');
    row.className = 'debt-value-row';
    row.innerHTML = `
      <span class="name">${escapeHtml(debt.name)}</span>
      <span class="current-value">${v ? fmtGBP(v.outstanding_amount) : ''}</span>
      <input type="number" step="0.01" min="0" placeholder="0.00" class="dv-outstanding" data-debt-id="${debt.id}">
    `;
    container.appendChild(row);
  }
}

document.getElementById('save-debt-values-btn').addEventListener('click', (e) => busy(e.currentTarget, async () => {
  const msg = document.getElementById('debt-value-msg');
  msg.textContent = '';
  msg.className = 'msg';
  const date = document.getElementById('debt-value-date').value;
  if (!date) { msg.textContent = 'Pick a date.'; msg.className = 'msg error'; return; }

  const container = document.getElementById('debt-value-rows');
  const entries = [];
  for (const input of container.querySelectorAll('.dv-outstanding')) {
    const amount = toNum(input.value);
    if (amount == null) continue;
    if (Number.isNaN(amount) || amount < 0) { msg.textContent = 'Enter valid amounts.'; msg.className = 'msg error'; return; }
    entries.push({ debt_id: input.dataset.debtId, date, outstanding_amount: amount });
  }
  if (entries.length === 0) { msg.textContent = 'Enter at least one outstanding amount.'; msg.className = 'msg error'; return; }

  // One statement, so all rows save or none do; re-entering a date replaces that day's value.
  const { error } = await sb.from('debt_values').upsert(entries, { onConflict: 'debt_id,date' });
  if (error) { msg.textContent = 'Failed to save: ' + error.message; msg.className = 'msg error'; return; }
  msg.textContent = 'Saved.';
  msg.className = 'msg ok';
  await loadAll();
}));

// ---------- Add / edit debt modal ----------

const debtModal = document.getElementById('debt-modal');
const debtForm = document.getElementById('debt-form');
let editingDebtId = null;

function openDebtModal(debt) {
  debtForm.reset();
  editingDebtId = debt ? debt.id : null;
  document.getElementById('debt-modal-title').textContent = debt ? 'Edit debt' : 'Add debt';
  document.getElementById('debt-modal-submit').textContent = debt ? 'Save changes' : 'Add debt';
  document.getElementById('debt-modal-delete').classList.toggle('hidden', !editingDebtId);
  if (debt) {
    document.getElementById('new-debt-name').value = debt.name;
    document.getElementById('new-debt-payment').value = debt.monthly_payment != null ? debt.monthly_payment : '';
    document.getElementById('new-debt-rate').value = debt.interest_rate != null ? debt.interest_rate : '';
    document.getElementById('new-debt-end-date').value = debt.end_date || '';
    document.getElementById('new-debt-note').value = debt.note || '';
  }
  debtModal.classList.remove('hidden');
  document.getElementById('new-debt-name').focus();
}
function closeDebtModal() {
  debtModal.classList.add('hidden');
}

document.getElementById('add-debt-btn').addEventListener('click', () => openDebtModal());
document.getElementById('debt-modal-cancel').addEventListener('click', closeDebtModal);
debtModal.addEventListener('click', (e) => { if (e.target === debtModal) closeDebtModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !debtModal.classList.contains('hidden')) closeDebtModal();
});

document.getElementById('debt-modal-delete').addEventListener('click', async () => {
  if (!editingDebtId) return;
  if (!confirm('Delete this debt and all its recorded values? This can\'t be undone.')) return;
  const { error } = await sb.from('debts').delete().eq('id', editingDebtId);
  if (failed('Failed to delete', error)) return;
  closeDebtModal();
  await loadAll();
});

onSubmit(debtForm, async () => {
  const name = document.getElementById('new-debt-name').value.trim();
  if (!name) return;
  const paymentVal = toNum(document.getElementById('new-debt-payment').value);
  const rateVal = toNum(document.getElementById('new-debt-rate').value);
  if (Number.isNaN(paymentVal) || Number.isNaN(rateVal)) return notify('Enter valid numbers.');
  const endDateVal = document.getElementById('new-debt-end-date').value;
  const noteVal = document.getElementById('new-debt-note').value.trim();
  const record = {
    name,
    monthly_payment: paymentVal,
    interest_rate: rateVal,
    end_date: endDateVal === '' ? null : endDateVal,
    note: noteVal === '' ? null : noteVal,
  };

  if (editingDebtId) {
    const { error } = await sb.from('debts').update(record).eq('id', editingDebtId);
    if (failed('Failed to save changes', error)) return;
  } else {
    const { error } = await sb.from('debts').insert(record);
    if (failed('Failed to add debt', error)) return;
  }
  closeDebtModal();
  await loadAll();
});
