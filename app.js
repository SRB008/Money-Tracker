const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const SERIES_COLORS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
];
function seriesColor(i) {
  const varName = SERIES_COLORS[i % SERIES_COLORS.length].match(/--[\w-]+/)[0];
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

const fmtGBP = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);

let accounts = [];
let values = [];

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
  const [{ data: acc, error: accErr }, { data: val, error: valErr }] = await Promise.all([
    sb.from('accounts').select('*').order('type').order('name'),
    sb.from('investment_values').select('*').order('date'),
  ]);
  if (accErr) return alert('Failed to load accounts: ' + accErr.message);
  if (valErr) return alert('Failed to load values: ' + valErr.message);
  accounts = acc || [];
  values = val || [];
  renderAll();
}

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

function renderAll() {
  renderStats();
  renderAccounts();
  renderValueTabs();
}

// ---------- Stats ----------

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
  const row = document.getElementById('stat-row');
  row.innerHTML = '';
  row.appendChild(statTile('Total', fmtGBP(grandTotal), true));
  for (const type of ['Savings', 'ISA', 'Pension']) {
    row.appendChild(statTile(type, fmtGBP(totals[type] || 0), false));
  }
}
function statTile(label, value, isTotal) {
  const div = document.createElement('div');
  div.className = 'stat-tile' + (isTotal ? ' total' : '');
  div.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
  return div;
}

// ---------- Accounts ----------

const expandedAccounts = new Set();

function renderAccounts() {
  const grid = document.getElementById('accounts-grid');
  grid.innerHTML = '';
  const latest = latestValueByAccount();
  const types = ['Savings', 'ISA', 'Pension'];
  for (const type of types) {
    const list = accounts.filter(a => a.type === type);
    if (list.length === 0) continue;
    const group = document.createElement('div');
    group.className = 'type-group';
    const h3 = document.createElement('h3');
    h3.textContent = type;
    group.appendChild(h3);
    list.forEach((acc, i) => {
      const idx = accounts.indexOf(acc);
      const item = document.createElement('div');
      item.className = 'account-item';
      const v = latest[acc.id];
      const details = [];
      if (acc.type === 'Savings') {
        if (acc.interest_rate != null) details.push(`${Number(acc.interest_rate)}%`);
        if (acc.access) details.push(acc.access);
        if (acc.taxable != null) details.push(acc.taxable ? 'Taxable' : 'Tax-free');
      }
      const hasExtra = acc.type === 'Savings' && (details.length > 0 || acc.note);
      const expanded = expandedAccounts.has(acc.id);
      item.innerHTML = `
        <div class="account-item-main">
          <span class="name-group">
            <span class="name"><span class="dot" style="background:${seriesColor(idx)}"></span>${escapeHtml(acc.name)}</span>
            ${hasExtra ? `<button type="button" class="detail-toggle">${expanded ? 'Hide' : 'Details'}</button>` : ''}
          </span>
          <span class="value">${v ? fmtGBP(v.value) : '—'}</span>
        </div>
        ${hasExtra ? `
        <div class="account-extra ${expanded ? '' : 'hidden'}">
          ${details.length ? `<div class="account-detail">${details.join(' · ')}</div>` : ''}
          ${acc.note ? `<div class="account-note">${escapeHtml(acc.note)}</div>` : ''}
        </div>` : ''}
      `;
      if (hasExtra) {
        item.querySelector('.detail-toggle').addEventListener('click', () => {
          if (expandedAccounts.has(acc.id)) expandedAccounts.delete(acc.id);
          else expandedAccounts.add(acc.id);
          renderAccounts();
        });
      }
      group.appendChild(item);
    });
    grid.appendChild(group);
  }
  if (accounts.length === 0) {
    grid.innerHTML = '<div class="empty">No accounts yet — add one to get started.</div>';
  }
}

// ---------- Add account modal ----------

const accountModal = document.getElementById('account-modal');
const accountForm = document.getElementById('account-form');

function updateSavingsFieldsVisibility() {
  const isSavings = document.getElementById('new-account-type').value === 'Savings';
  document.querySelectorAll('.savings-field').forEach(f => f.classList.toggle('hidden', !isSavings));
}
document.getElementById('new-account-type').addEventListener('change', updateSavingsFieldsVisibility);

function openAccountModal() {
  accountForm.reset();
  updateSavingsFieldsVisibility();
  accountModal.classList.remove('hidden');
  document.getElementById('new-account-name').focus();
}
function closeAccountModal() {
  accountModal.classList.add('hidden');
}

document.getElementById('add-account-btn').addEventListener('click', openAccountModal);
document.getElementById('account-modal-cancel').addEventListener('click', closeAccountModal);
accountModal.addEventListener('click', (e) => { if (e.target === accountModal) closeAccountModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !accountModal.classList.contains('hidden')) closeAccountModal();
});

accountForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-account-name').value.trim();
  const type = document.getElementById('new-account-type').value;
  if (!name) return;
  const record = { name, type };
  if (type === 'Savings') {
    const rate = document.getElementById('new-account-rate').value;
    const note = document.getElementById('new-account-note').value.trim();
    record.interest_rate = rate === '' ? null : rate;
    record.access = document.getElementById('new-account-access').value;
    record.taxable = document.getElementById('new-account-taxable').value === 'Yes';
    record.note = note === '' ? null : note;
  }
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('accounts').insert({ ...record, user_id: user.id });
  if (error) return alert('Failed to add account: ' + error.message);
  closeAccountModal();
  await loadAll();
});

// ---------- Add value ----------

const VALUE_TABS = { Savings: ['Savings'], Investments: ['ISA', 'Pension'] };

document.getElementById('date-Savings').valueAsDate = new Date();
document.getElementById('date-Investments').valueAsDate = new Date();

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    document.querySelector(`.tab-panel[data-tab-panel="${btn.dataset.tab}"]`).classList.remove('hidden');
  });
});

document.querySelectorAll('.save-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => saveTabValues(btn.dataset.tab));
});

function renderValueTabs() {
  for (const tabName of Object.keys(VALUE_TABS)) {
    const types = VALUE_TABS[tabName];
    const container = document.getElementById('rows-' + tabName);
    container.innerHTML = '';
    const tabAccounts = accounts.filter(a => types.includes(a.type));
    if (tabAccounts.length === 0) {
      container.innerHTML = '<div class="empty">No accounts yet — add one above.</div>';
      continue;
    }
    for (const type of types) {
      const list = accounts.filter(a => a.type === type);
      if (list.length === 0) continue;
      if (types.length > 1) {
        const h3 = document.createElement('h3');
        h3.textContent = type;
        container.appendChild(h3);
      }
      for (const acc of list) {
        const row = document.createElement('div');
        row.className = 'value-row';
        row.innerHTML = `
          <span class="name">${escapeHtml(acc.name)}</span>
          <input type="number" step="0.01" min="0" placeholder="0.00" class="value-input" data-account-id="${acc.id}">
        `;
        container.appendChild(row);
      }
    }
  }
}

async function saveTabValues(tabName) {
  const dateInput = document.getElementById('date-' + tabName);
  const msg = document.getElementById('msg-' + tabName);
  msg.textContent = '';
  msg.className = 'msg';
  const date = dateInput.value;
  if (!date) { msg.textContent = 'Pick a date.'; msg.className = 'msg error'; return; }

  const container = document.getElementById('rows-' + tabName);
  const entries = [...container.querySelectorAll('.value-input')]
    .filter(input => input.value.trim() !== '')
    .map(input => ({ account_id: input.dataset.accountId, date, value: input.value }));
  if (entries.length === 0) { msg.textContent = 'Enter at least one value.'; msg.className = 'msg error'; return; }

  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('investment_values').insert(entries.map(e => ({ ...e, user_id: user.id })));
  if (error) { msg.textContent = 'Failed to save: ' + error.message; msg.className = 'msg error'; return; }
  msg.textContent = 'Saved.';
  msg.className = 'msg ok';
  await loadAll();
}

// ---------- utils ----------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
