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

// ---------- Edit debt modal (shared; debts are added from Admin) ----------

const openDebtModal = initDebtModal(loadAll);
