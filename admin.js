const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const DEFAULT_DRAWDOWN_RATE = 4;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let shares = [];

const appView = document.getElementById('app-view');

sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    appView.classList.remove('hidden');
    document.getElementById('user-email').textContent = session.user.email;
    loadSettings();
    loadShares();
  } else {
    window.location.href = 'index.html';
  }
});

document.getElementById('signout-btn').addEventListener('click', () => sb.auth.signOut());

async function loadSettings() {
  const { data, error } = await sb
    .from('app_settings')
    .select('*')
    .eq('key', 'pension_drawdown_rate')
    .maybeSingle();
  if (error) return alert('Failed to load settings: ' + error.message);
  const rate = data ? Number(data.value) : DEFAULT_DRAWDOWN_RATE;
  document.getElementById('drawdown-rate').value = rate;
}

document.getElementById('save-drawdown-btn').addEventListener('click', async () => {
  const msg = document.getElementById('drawdown-msg');
  msg.textContent = '';
  msg.className = 'msg';

  const rateVal = document.getElementById('drawdown-rate').value;
  if (rateVal === '') { msg.textContent = 'Enter a rate.'; msg.className = 'msg error'; return; }

  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('app_settings').upsert(
    { user_id: user.id, key: 'pension_drawdown_rate', value: rateVal, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,key' }
  );
  if (error) { msg.textContent = 'Failed to save: ' + error.message; msg.className = 'msg error'; return; }
  msg.textContent = 'Saved.';
  msg.className = 'msg ok';
});

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
});

// ---------- Shares ----------

async function loadShares() {
  const { data, error } = await sb.from('shares').select('*').order('title');
  if (error) return alert('Failed to load shares: ' + error.message);
  shares = data || [];
  renderShares();
}

function renderShares() {
  const grid = document.getElementById('shares-grid');
  grid.innerHTML = '';

  if (shares.length === 0) {
    grid.innerHTML = '<div class="empty">No shares yet — add one to get started.</div>';
    return;
  }

  for (const share of shares) {
    const row = document.createElement('div');
    row.className = 'expense-row';
    row.innerHTML = `
      <div class="expense-row-main">
        <span class="expense-date">${escapeHtml(share.trading_code)}</span>
        <span class="expense-name">${escapeHtml(share.title)}</span>
        <span class="expense-amount">${Number(share.quantity).toLocaleString('en-GB')}</span>
        <button type="button" class="share-edit-btn" aria-label="Edit ${escapeHtml(share.title)}">&#9998;</button>
      </div>
    `;
    row.querySelector('.share-edit-btn').addEventListener('click', () => openShareModal(share));
    grid.appendChild(row);
  }
}

const shareModal = document.getElementById('share-modal');
const shareForm = document.getElementById('share-form');
let editingShareId = null;

function openShareModal(share) {
  shareForm.reset();
  editingShareId = share ? share.id : null;
  document.getElementById('share-modal-title').textContent = share ? 'Edit share' : 'Add share';
  document.getElementById('share-modal-submit').textContent = share ? 'Save changes' : 'Add share';
  document.getElementById('share-modal-delete').classList.toggle('hidden', !editingShareId);
  if (share) {
    document.getElementById('new-share-title').value = share.title;
    document.getElementById('new-share-code').value = share.trading_code;
    document.getElementById('new-share-quantity').value = share.quantity;
    document.getElementById('new-share-price').value = share.price != null ? share.price : '';
  }
  shareModal.classList.remove('hidden');
  document.getElementById('new-share-title').focus();
}
function closeShareModal() {
  shareModal.classList.add('hidden');
}

document.getElementById('add-share-btn').addEventListener('click', () => openShareModal());
document.getElementById('share-modal-cancel').addEventListener('click', closeShareModal);
shareModal.addEventListener('click', (e) => { if (e.target === shareModal) closeShareModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !shareModal.classList.contains('hidden')) closeShareModal();
});

document.getElementById('share-modal-delete').addEventListener('click', async () => {
  if (!editingShareId) return;
  if (!confirm('Delete this share? This can\'t be undone.')) return;
  const { error } = await sb.from('shares').delete().eq('id', editingShareId);
  if (error) return alert('Failed to delete: ' + error.message);
  closeShareModal();
  await loadShares();
});

shareForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('new-share-title').value.trim();
  const trading_code = document.getElementById('new-share-code').value.trim();
  const quantity = document.getElementById('new-share-quantity').value;
  const priceVal = document.getElementById('new-share-price').value;
  if (!title || !trading_code || quantity === '') return;
  const record = { title, trading_code, quantity, price: priceVal === '' ? null : priceVal, updated_at: new Date().toISOString() };

  if (editingShareId) {
    const { error } = await sb.from('shares').update(record).eq('id', editingShareId);
    if (error) return alert('Failed to save changes: ' + error.message);
  } else {
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from('shares').insert({ ...record, user_id: user.id });
    if (error) return alert('Failed to add share: ' + error.message);
  }
  closeShareModal();
  await loadShares();
});
