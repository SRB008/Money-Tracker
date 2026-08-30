const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const fmtGBP = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let costs = [];
let costSort = { key: 'name', dir: 'asc' };

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
  const { data, error } = await sb.from('future_living_costs').select('*').order('created_at');
  if (error) return alert('Failed to load costs: ' + error.message);
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
  row.appendChild(statTile('Per month (Net)', fmtGBP(monthlyTotal), true));
  row.appendChild(statTile('Per year (Net)', fmtGBP(yearlyTotal), true));
}
function statTile(label, value, isTotal) {
  const div = document.createElement('div');
  div.className = 'stat-tile' + (isTotal ? ' total' : '');
  div.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
  return div;
}

// ---------- Push monthly total to retirement settings ----------

document.getElementById('push-monthly-spend-btn').addEventListener('click', async () => {
  const msg = document.getElementById('push-monthly-spend-msg');
  msg.textContent = '';
  msg.className = 'msg';

  const roundedMonthlyTotal = Math.round(currentMonthlyTotal);
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('app_settings').upsert(
    { user_id: user.id, key: 'retirement_net_monthly_spend', value: String(roundedMonthlyTotal), updated_at: new Date().toISOString() },
    { onConflict: 'user_id,key' }
  );
  if (error) { msg.textContent = 'Failed to save: ' + error.message; msg.className = 'msg error'; return; }
  msg.textContent = `Saved ${fmtGBP(roundedMonthlyTotal)} as Net Monthly Spend, Today.`;
  msg.className = 'msg ok';
});

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
  if (error) return alert('Failed to delete: ' + error.message);
  closeCostModal();
  await loadAll();
});

costForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-cost-name').value.trim();
  const amount = document.getElementById('new-cost-amount').value;
  const frequency = document.getElementById('new-cost-frequency').value;
  if (!name || amount === '') return;
  const record = { name, amount, frequency, updated_at: new Date().toISOString() };

  if (editingCostId) {
    const { error } = await sb.from('future_living_costs').update(record).eq('id', editingCostId);
    if (error) return alert('Failed to save changes: ' + error.message);
  } else {
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from('future_living_costs').insert({ ...record, user_id: user.id });
    if (error) return alert('Failed to add cost: ' + error.message);
  }
  closeCostModal();
  await loadAll();
});
