const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const fmtGBP = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
const fmtDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let debts = [];
let debtValues = [];

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
  const [{ data: d, error: debtErr }, { data: v, error: valErr }] = await Promise.all([
    sb.from('debts').select('*').order('name'),
    sb.from('debt_values').select('*').order('date'),
  ]);
  if (debtErr) return alert('Failed to load debts: ' + debtErr.message);
  if (valErr) return alert('Failed to load debt values: ' + valErr.message);
  debts = d || [];
  debtValues = v || [];
  renderAll();
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

function renderAll() {
  renderDebtsList();
  renderDebtValueRows();
}

// ---------- Debts list ----------

function renderDebtsList() {
  const grid = document.getElementById('debts-grid');
  grid.innerHTML = '';
  const latest = latestValueByDebt();
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
  const latest = latestValueByDebt();
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

document.getElementById('save-debt-values-btn').addEventListener('click', async () => {
  const msg = document.getElementById('debt-value-msg');
  msg.textContent = '';
  msg.className = 'msg';
  const date = document.getElementById('debt-value-date').value;
  if (!date) { msg.textContent = 'Pick a date.'; msg.className = 'msg error'; return; }

  const container = document.getElementById('debt-value-rows');
  const entries = [];
  container.querySelectorAll('.dv-outstanding').forEach(input => {
    if (input.value.trim() === '') return;
    entries.push({
      debt_id: input.dataset.debtId,
      date,
      outstanding_amount: input.value,
    });
  });
  if (entries.length === 0) { msg.textContent = 'Enter at least one outstanding amount.'; msg.className = 'msg error'; return; }

  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('debt_values').insert(entries.map(e => ({ ...e, user_id: user.id })));
  if (error) { msg.textContent = 'Failed to save: ' + error.message; msg.className = 'msg error'; return; }
  msg.textContent = 'Saved.';
  msg.className = 'msg ok';
  await loadAll();
});

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
  if (error) return alert('Failed to delete: ' + error.message);
  closeDebtModal();
  await loadAll();
});

debtForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-debt-name').value.trim();
  if (!name) return;
  const paymentVal = document.getElementById('new-debt-payment').value;
  const rateVal = document.getElementById('new-debt-rate').value;
  const endDateVal = document.getElementById('new-debt-end-date').value;
  const noteVal = document.getElementById('new-debt-note').value.trim();
  const record = {
    name,
    monthly_payment: paymentVal === '' ? null : paymentVal,
    interest_rate: rateVal === '' ? null : rateVal,
    end_date: endDateVal === '' ? null : endDateVal,
    note: noteVal === '' ? null : noteVal,
  };

  if (editingDebtId) {
    const { error } = await sb.from('debts').update(record).eq('id', editingDebtId);
    if (error) return alert('Failed to save changes: ' + error.message);
  } else {
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from('debts').insert({ ...record, user_id: user.id });
    if (error) return alert('Failed to add debt: ' + error.message);
  }
  closeDebtModal();
  await loadAll();
});
