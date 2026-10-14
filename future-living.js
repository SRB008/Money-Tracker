// Future living costs. Shared code lives in lib.js.

let costs = [];
let costSort = { key: 'name', dir: 'asc' };

initAuthPage(loadAll);

// ---------- Data loading ----------

async function loadAll() {
  const { data, error } = await sb.from('future_living_costs').select('*').order('created_at');
  if (failed('Failed to load costs', error)) return;
  costs = data || [];
  renderAll();
}

function renderAll() {
  renderTotals();
  renderCosts();
}

// ---------- Totals ----------

function monthlyEquivalent(cost) {
  return cost.frequency === 'monthly' ? Number(cost.amount) : Number(cost.amount) / 12;
}
function yearlyEquivalent(cost) {
  return cost.frequency === 'yearly' ? Number(cost.amount) : Number(cost.amount) * 12;
}

let currentMonthlyTotal = 0;

function renderTotals() {
  const monthlyTotal = costs.reduce((sum, c) => sum + monthlyEquivalent(c), 0);
  const yearlyTotal = costs.reduce((sum, c) => sum + yearlyEquivalent(c), 0);
  currentMonthlyTotal = monthlyTotal;

  const row = document.getElementById('stat-row-totals');
  row.innerHTML = '';
  row.appendChild(statTile('Per month (Net)', fmtGBP(monthlyTotal), { isTotal: true }));
  row.appendChild(statTile('Per year (Net)', fmtGBP(yearlyTotal), { isTotal: true }));
}

// ---------- Push monthly total to retirement settings ----------

document.getElementById('push-monthly-spend-btn').addEventListener('click', (e) => busy(e.currentTarget, async () => {
  const msg = document.getElementById('push-monthly-spend-msg');
  msg.textContent = '';
  msg.className = 'msg';

  const roundedMonthlyTotal = Math.round(currentMonthlyTotal);
  try {
    await saveSettings({ [RETIREMENT_KEYS.spend]: roundedMonthlyTotal });
  } catch (error) { msg.textContent = 'Failed to save: ' + error.message; msg.className = 'msg error'; return; }
  msg.textContent = `Saved ${fmtGBP(roundedMonthlyTotal)} as Net Monthly Spend, Today.`;
  msg.className = 'msg ok';
}));

// ---------- Costs list ----------

const sortHeaders = document.querySelectorAll('.sort-header');
sortHeaders.forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    if (costSort.key === key) {
      costSort.dir = costSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      costSort = { key, dir: 'asc' };
    }
    renderCosts();
  });
});

function updateSortHeaderUI() {
  sortHeaders.forEach(btn => {
    const active = btn.dataset.key === costSort.key;
    btn.classList.toggle('sort-active', active);
    btn.classList.toggle('sort-desc', active && costSort.dir === 'desc');
  });
}

function sortedCosts() {
  const sorted = [...costs];
  const dirMult = costSort.dir === 'desc' ? -1 : 1;
  if (costSort.key === 'yearly') {
    sorted.sort((a, b) => (yearlyEquivalent(a) - yearlyEquivalent(b)) * dirMult);
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name) * dirMult);
  }
  return sorted;
}

function renderCosts() {
  updateSortHeaderUI();
  const list = document.getElementById('costs-list');
  const empty = document.getElementById('costs-empty');
  list.innerHTML = '';

  if (costs.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const cost of sortedCosts()) {
    const row = document.createElement('div');
    row.className = 'expense-row editable';
    row.innerHTML = `
      <div class="expense-row-main">
        <span class="expense-name">${escapeHtml(cost.name)}</span>
        <span class="expense-amount cost-amount-raw">${fmtGBP(cost.amount)} ${cost.frequency === 'monthly' ? '/mo' : '/yr'}</span>
        <span class="expense-amount">${fmtGBP(monthlyEquivalent(cost))}</span>
        <span class="expense-amount">${fmtGBP(yearlyEquivalent(cost))}</span>
      </div>
    `;
    row.addEventListener('click', () => openCostModal(cost));
    list.appendChild(row);
  }
}

// ---------- Add/edit/delete modal ----------

const costModal = document.getElementById('cost-modal');
const costForm = document.getElementById('cost-form');
let editingCostId = null;

document.getElementById('add-cost-btn').addEventListener('click', () => openCostModal(null));

function openCostModal(cost) {
  costForm.reset();
  editingCostId = cost ? cost.id : null;
  document.getElementById('cost-modal-title').textContent = cost ? 'Edit cost' : 'Add cost';
  document.getElementById('cost-modal-submit').textContent = cost ? 'Save changes' : 'Add cost';
  document.getElementById('cost-modal-delete').classList.toggle('hidden', !editingCostId);
  if (cost) {
    document.getElementById('new-cost-name').value = cost.name;
    document.getElementById('new-cost-amount').value = cost.amount;
    document.getElementById('new-cost-frequency').value = cost.frequency;
  }
  costModal.classList.remove('hidden');
  document.getElementById('new-cost-name').focus();
}
function closeCostModal() {
  costModal.classList.add('hidden');
}

document.getElementById('cost-modal-cancel').addEventListener('click', closeCostModal);
costModal.addEventListener('click', (e) => { if (e.target === costModal) closeCostModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !costModal.classList.contains('hidden')) closeCostModal();
});

document.getElementById('cost-modal-delete').addEventListener('click', async () => {
  if (!editingCostId) return;
  if (!confirm('Delete this cost? This can\'t be undone.')) return;
  const { error } = await sb.from('future_living_costs').delete().eq('id', editingCostId);
  if (failed('Failed to delete', error)) return;
  closeCostModal();
  await loadAll();
});

onSubmit(costForm, async () => {
  const name = document.getElementById('new-cost-name').value.trim();
  const amount = toNum(document.getElementById('new-cost-amount').value);
  const frequency = document.getElementById('new-cost-frequency').value;
  if (!name || amount == null || Number.isNaN(amount)) return;
  const record = { name, amount, frequency, updated_at: new Date().toISOString() };

  if (editingCostId) {
    const { error } = await sb.from('future_living_costs').update(record).eq('id', editingCostId);
    if (failed('Failed to save changes', error)) return;
  } else {
    const { error } = await sb.from('future_living_costs').insert(record);
    if (failed('Failed to add cost', error)) return;
  }
  closeCostModal();
  await loadAll();
});
