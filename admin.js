// Admin. Shared code lives in lib.js and retirement.js.

let shares = [];
let accounts = [];
let latestAccount = {};   // account_id -> latest value row (latest_account_values view)
let debts = [];
let latestDebt = {};      // debt_id -> latest value row (latest_debt_values view)
let otherAssets = [];

initProtectedPage(loadAll);

// One round of queries on page load; the chart is drawn once everything is in.
async function loadAll() {
  const results = await Promise.all([
    sb.from('accounts').select('*').order('name'),
    sb.from('latest_account_values').select('*'),
    sb.from('shares').select('*').order('title'),
    sb.from('other_assets').select('*').order('title'),
    sb.from('debts').select('*'),
    sb.from('latest_debt_values').select('*'),
    sb.from('app_settings').select('key, value').in('key', RETIREMENT_SETTING_KEYS),
  ]);
  const labels = ['accounts', 'values', 'shares', 'other assets', 'debts', 'debt values', 'settings'];
  for (let i = 0; i < results.length; i++) {
    if (failed(`Failed to load ${labels[i]}`, results[i].error)) return;
  }
  const [acc, val, shr, oth, d, dv, sett] = results.map(r => r.data || []);
  accounts = acc;
  latestAccount = indexBy(val, 'account_id');
  shares = shr;
  otherAssets = oth;
  debts = d;
  latestDebt = indexBy(dv, 'debt_id');
  const settings = {};
  for (const row of sett) settings[row.key] = row.value;

  applySettingsToForm(settings);
  renderAccounts();
  renderShares();
  renderOtherAssets();
  renderRetirementChart();
}

// Net Monthly Spend is displayed and stored as a whole number.
document.getElementById('retire-monthly-spend').addEventListener('change', (e) => {
  if (e.target.value === '') return;
  e.target.value = Math.round(Number(e.target.value));
});

// ---------- Retirement settings ----------
// The model itself lives in retirement.js; this page edits its inputs and
// draws the runway chart from whatever is currently in the form.

const hiddenRetirementSeries = new Set();
const K = RETIREMENT_KEYS;

function applySettingsToForm(settings) {
  const set = (id, v) => { document.getElementById(id).value = v ?? ''; };
  set('drawdown-rate', drawdownRateOf(settings));
  const spend = settings[K.spend];
  set('retire-monthly-spend', spend != null ? Math.round(Number(spend)) : '');
  set('retire-pot-growth', settings[K.potGrowth]);
  set('retire-spend-increase', settings[K.spendIncrease]);
  set('retire-dob', settings[K.dob]);
  set('retire-tax-rate', settings[K.taxRate]);
  set('retire-state-pension-date', settings[K.statePensionStartDate] ?? toISODate(STATE_PENSION_PAYMENT_START));
  document.getElementById('retire-other-assets-pension').checked = settings[K.otherAssetsPension] === true;
  document.getElementById('retire-state-pension').checked = settings[K.statePension] === true;
  document.getElementById('retire-clear-debt').checked = settings[K.clearDebt] === true;
}

// The form as a settings object (blank fields -> null), in the same shape
// that is stored in app_settings.
function formSettings() {
  const num = (id) => toNum(document.getElementById(id).value);
  const text = (id) => document.getElementById(id).value || null;
  const checked = (id) => document.getElementById(id).checked;
  const spend = num('retire-monthly-spend');
  return {
    [K.drawdownRate]: num('drawdown-rate'),
    [K.spend]: spend == null || Number.isNaN(spend) ? spend : Math.round(spend),
    [K.potGrowth]: num('retire-pot-growth'),
    [K.spendIncrease]: num('retire-spend-increase'),
    [K.dob]: text('retire-dob'),
    [K.taxRate]: num('retire-tax-rate'),
    [K.otherAssetsPension]: checked('retire-other-assets-pension'),
    [K.statePension]: checked('retire-state-pension'),
    [K.statePensionStartDate]: text('retire-state-pension-date'),
    [K.clearDebt]: checked('retire-clear-debt'),
  };
}

document.getElementById('save-retirement-btn').addEventListener('click', (e) => busy(e.currentTarget, async () => {
  const msg = document.getElementById('retirement-msg');
  msg.textContent = '';
  msg.className = 'msg';

  const settings = formSettings();
  if (Object.values(settings).some(v => typeof v === 'number' && Number.isNaN(v))) {
    msg.textContent = 'Enter valid numbers.'; msg.className = 'msg error'; return;
  }
  try {
    await saveSettings(settings);
  } catch (error) {
    msg.textContent = 'Failed to save: ' + error.message; msg.className = 'msg error'; return;
  }
  msg.textContent = 'Saved.';
  msg.className = 'msg ok';
  renderRetirementChart();
}));

function retirementNiceCeil(x) {
  if (x <= 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const base = Math.pow(10, exp);
  const f = x / base;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * base;
}

function fmtGBPCompact(v) {
  v = Math.max(0, v);
  if (v >= 1000) {
    const k = v / 1000;
    return '£' + (Number.isInteger(k) ? k : Math.round(k * 10) / 10) + 'k';
  }
  return '£' + Math.round(v);
}

function buildRetirementSvg(series, points, depletion) {
  const W = 760, H = 260;
  const pad = { left: 56, right: 16, top: 16, bottom: 28 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const startMs = points[0].date.getTime();
  const endMs = points[points.length - 1].date.getTime();
  const spanMs = Math.max(endMs - startMs, 1);
  const xScale = (date) => pad.left + ((date.getTime() - startMs) / spanMs) * plotW;

  const allVals = points.flatMap(p => series.map(s => s.valueFn(p)));
  const yMax = retirementNiceCeil(Math.max(1, ...allVals) * 1.05);
  const yScale = (v) => pad.top + (1 - v / yMax) * plotH;

  const step = niceStep(yMax);
  const gridLines = [];
  for (let g = 0; g <= yMax; g += step) {
    const y = yScale(g).toFixed(1);
    gridLines.push(`<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" class="perf-gridline" />`);
    gridLines.push(`<text x="${pad.left - 8}" y="${y}" class="perf-axis-label" text-anchor="end" dominant-baseline="middle">${fmtGBPCompact(g)}</text>`);
  }

  const spanYears = spanMs / (365.25 * 24 * 3600 * 1000);
  const tickStepYears = Math.max(1, Math.round(niceStep(spanYears / 6)));
  const firstYear = points[0].date.getFullYear();
  const lastYear = points[points.length - 1].date.getFullYear();
  const yearTicks = [];
  for (let y = firstYear; y <= lastYear; y += tickStepYears) {
    const d = new Date(y, 0, 1);
    if (d.getTime() < startMs || d.getTime() > endMs) continue;
    const x = xScale(d).toFixed(1);
    yearTicks.push(`<line x1="${x}" y1="${pad.top}" x2="${x}" y2="${H - pad.bottom}" class="perf-gridline" />`);
    yearTicks.push(`<text x="${x}" y="${H - 8}" class="perf-axis-label" text-anchor="middle">${y}</text>`);
  }

  const zeroY = yScale(0).toFixed(1);
  const seriesSvg = series.map(s => {
    const linePoints = points.map(p => `${xScale(p.date).toFixed(1)},${yScale(s.valueFn(p)).toFixed(1)}`).join(' ');
    const area = s.isTotal
      ? `<polygon points="${xScale(points[0].date).toFixed(1)},${zeroY} ${linePoints} ${xScale(points[points.length - 1].date).toFixed(1)},${zeroY}" class="perf-area" style="fill:color-mix(in srgb, ${s.color} 15%, transparent)" />`
      : '';
    return `${area}<polyline points="${linePoints}" class="perf-line" style="stroke:${s.color};stroke-width:${s.isTotal ? 2.5 : 1.5}" />`;
  }).join('');

  let marker = '';
  if (depletion) {
    const dx = xScale(depletion.date).toFixed(1);
    marker = `<line x1="${dx}" y1="${pad.top}" x2="${dx}" y2="${H - pad.bottom}" stroke="var(--critical)" stroke-width="1.5" stroke-dasharray="3 3" />`;
  }

  return `${gridLines.join('')}${yearTicks.join('')}${seriesSvg}${marker}`;
}

function renderRetirementChart() {
  const wrap = document.getElementById('retirement-chart-wrap');
  const empty = document.getElementById('retirement-empty');
  const summary = document.getElementById('retirement-summary');
  const legend = document.getElementById('retirement-legend');
  const svg = document.getElementById('retirement-chart');

  const cfg = retirementConfig(formSettings());
  if (!cfg) {
    wrap.classList.add('hidden');
    legend.innerHTML = '';
    summary.textContent = '';
    empty.classList.remove('hidden');
    return;
  }

  const pots = retirementPots(accountTotals(accounts, latestAccount), otherAssets, cfg);
  const dob = cfg.dob;
  const maxMonths = retirementHorizonMonths(cfg);
  const result = simulateRetirement(cfg, retirementStartingIsa(pots, cfg, debtTotal(debts, latestDebt)), pots.pension, maxMonths);

  empty.classList.add('hidden');
  wrap.classList.remove('hidden');

  if (result.depletion) {
    const d = result.depletion.date;
    const dateLabel = d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    if (dob) {
      const age = ageAt(dob, d);
      summary.textContent = `Runs out around ${dateLabel} — you'll be ${age.years}${age.months ? ' years ' + age.months + ' mo' : ' years'} old.`;
    } else {
      summary.textContent = `Runs out around ${dateLabel}.`;
    }
  } else {
    summary.textContent = `Still growing after ${Math.floor(maxMonths / 12)} years under these assumptions.`;
  }

  const series = [
    { key: 'total', label: 'Total', color: 'var(--series-total)', isTotal: true, valueFn: p => p.total },
    { key: 'isa', label: 'ISA', color: 'var(--series-1)', isTotal: false, valueFn: p => p.isa },
    { key: 'pension', label: 'Pension', color: 'var(--series-2)', isTotal: false, valueFn: p => p.pension },
  ];

  legend.innerHTML = series.map(s => {
    const isOff = hiddenRetirementSeries.has(s.key);
    return `
    <button type="button" class="item${isOff ? ' off' : ''}" data-key="${s.key}" aria-pressed="${isOff ? 'true' : 'false'}" aria-label="${isOff ? 'Show' : 'Hide'} ${s.label}">
      <span class="swatch" style="background:${s.color}"></span>${s.label}
    </button>`;
  }).join('');
  legend.querySelectorAll('.item').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (hiddenRetirementSeries.has(key)) hiddenRetirementSeries.delete(key);
      else hiddenRetirementSeries.add(key);
      renderRetirementChart();
    });
  });

  const visibleSeries = series.filter(s => !hiddenRetirementSeries.has(s.key));
  if (visibleSeries.length === 0) {
    svg.innerHTML = `<text x="380" y="130" text-anchor="middle" class="perf-axis-label" style="font-size:13px">All series hidden — click the legend to show one.</text>`;
    return;
  }

  svg.innerHTML = buildRetirementSvg(visibleSeries, result.points, result.depletion);
}

// ---------- Add account modal ----------

const accountModal = document.getElementById('account-modal');
const accountForm = document.getElementById('account-form');
let editingAccountId = null;

function updateSavingsFieldsVisibility() {
  const isSavings = document.getElementById('new-account-type').value === 'Savings';
  document.querySelectorAll('.savings-field').forEach(f => f.classList.toggle('hidden', !isSavings));
}
document.getElementById('new-account-type').addEventListener('change', updateSavingsFieldsVisibility);

function openAccountModal(account) {
  accountForm.reset();
  editingAccountId = account ? account.id : null;
  document.getElementById('account-modal-title').textContent = account ? 'Edit account' : 'Add account';
  document.getElementById('account-modal-submit').textContent = account ? 'Save changes' : 'Add account';
  document.getElementById('account-modal-delete').classList.toggle('hidden', !editingAccountId);
  if (account) {
    document.getElementById('new-account-name').value = account.name;
    document.getElementById('new-account-type').value = account.type;
    document.getElementById('new-account-rate').value = account.interest_rate != null ? account.interest_rate : '';
    document.getElementById('new-account-access').value = account.access || 'Instant';
    document.getElementById('new-account-taxable').value = account.taxable ? 'Yes' : 'No';
    document.getElementById('new-account-note').value = account.note || '';
  }
  updateSavingsFieldsVisibility();
  accountModal.classList.remove('hidden');
  document.getElementById('new-account-name').focus();
}
function closeAccountModal() {
  accountModal.classList.add('hidden');
}

document.getElementById('add-account-btn').addEventListener('click', () => openAccountModal());
document.getElementById('account-modal-cancel').addEventListener('click', closeAccountModal);
accountModal.addEventListener('click', (e) => { if (e.target === accountModal) closeAccountModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !accountModal.classList.contains('hidden')) closeAccountModal();
});

document.getElementById('account-modal-delete').addEventListener('click', async () => {
  if (!editingAccountId) return;
  if (!confirm('Delete this account? This can\'t be undone.')) return;
  const { error } = await sb.from('accounts').delete().eq('id', editingAccountId);
  if (failed('Failed to delete', error)) return;
  closeAccountModal();
  await loadAccounts();
});

onSubmit(accountForm, async () => {
  const name = document.getElementById('new-account-name').value.trim();
  const type = document.getElementById('new-account-type').value;
  if (!name) return;
  const record = { name, type };
  if (type === 'Savings') {
    const rate = toNum(document.getElementById('new-account-rate').value);
    if (Number.isNaN(rate)) return notify('Enter a valid interest rate.');
    const note = document.getElementById('new-account-note').value.trim();
    record.interest_rate = rate;
    record.access = document.getElementById('new-account-access').value;
    record.taxable = document.getElementById('new-account-taxable').value === 'Yes';
    record.note = note === '' ? null : note;
  } else {
    record.interest_rate = null;
    record.access = null;
    record.taxable = null;
    record.note = null;
  }

  if (editingAccountId) {
    const { error } = await sb.from('accounts').update(record).eq('id', editingAccountId);
    if (failed('Failed to save changes', error)) return;
  } else {
    const { error } = await sb.from('accounts').insert({ ...record });
    if (failed('Failed to add account', error)) return;
  }
  closeAccountModal();
  await loadAccounts();
});

// ---------- Savings accounts list ----------

async function loadAccounts() {
  const { data, error } = await sb.from('accounts').select('*').order('name');
  if (failed('Failed to load accounts', error)) return;
  accounts = data || [];
  renderAccounts();
  renderRetirementChart();
}

function renderAccounts() {
  const grid = document.getElementById('accounts-grid');
  grid.innerHTML = '';

  const savingsAccounts = accounts.filter(a => a.type === 'Savings');
  if (savingsAccounts.length === 0) {
    grid.innerHTML = '<div class="empty">No savings accounts yet — add one to get started.</div>';
    return;
  }

  for (const account of savingsAccounts) {
    const row = document.createElement('div');
    row.className = 'expense-row';
    row.innerHTML = `
      <div class="expense-row-main">
        <span class="expense-name">${escapeHtml(account.name)}</span>
        <span class="expense-amount">${account.interest_rate != null ? Number(account.interest_rate) + '%' : '—'}</span>
        <button type="button" class="share-edit-btn" aria-label="Edit ${escapeHtml(account.name)}">&#9998;</button>
      </div>
      ${account.note ? `<div class="account-extra"><div class="account-note">${escapeHtml(account.note)}</div></div>` : ''}
    `;
    row.querySelector('.share-edit-btn').addEventListener('click', () => openAccountModal(account));
    grid.appendChild(row);
  }
}

// ---------- Shares ----------

async function loadShares() {
  const { data, error } = await sb.from('shares').select('*').order('title');
  if (failed('Failed to load shares', error)) return;
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
    const price = share.price != null ? Number(share.price) : null;
    const row = document.createElement('div');
    row.className = 'expense-row';
    row.innerHTML = `
      <div class="expense-row-main">
        <span class="expense-date">${escapeHtml(share.trading_code)}</span>
        <span class="expense-name">${escapeHtml(share.title)}</span>
        <span class="expense-amount">${Number(share.quantity).toLocaleString('en-GB')}</span>
        <span class="share-price">${price != null ? price.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' }) : '—'}</span>
        <span class="share-price-update">
          <input type="number" step="0.0001" min="0" class="share-price-input" placeholder="0.00" value="${price != null ? price : ''}">
          <button type="button" class="share-price-save">Save</button>
        </span>
        <button type="button" class="share-edit-btn" aria-label="Edit ${escapeHtml(share.title)}">&#9998;</button>
      </div>
    `;
    row.querySelector('.share-edit-btn').addEventListener('click', () => openShareModal(share));
    const priceInput = row.querySelector('.share-price-input');
    const saveBtn = row.querySelector('.share-price-save');
    saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
      const newPrice = toNum(priceInput.value);
      if (newPrice == null) return;
      if (Number.isNaN(newPrice) || newPrice < 0) return notify('Enter a valid price.');
      const { error } = await sb.from('shares').update({ price: newPrice, updated_at: new Date().toISOString() }).eq('id', share.id);
      if (failed('Failed to update price', error)) return;
      await loadShares();
    }));
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
  if (failed('Failed to delete', error)) return;
  closeShareModal();
  await loadShares();
});

onSubmit(shareForm, async () => {
  const title = document.getElementById('new-share-title').value.trim();
  const trading_code = document.getElementById('new-share-code').value.trim();
  const quantity = toNum(document.getElementById('new-share-quantity').value);
  const price = toNum(document.getElementById('new-share-price').value);
  if (!title || !trading_code || quantity == null) return;
  if (Number.isNaN(quantity) || Number.isNaN(price)) return notify('Enter valid numbers.');
  const record = { title, trading_code, quantity, price, updated_at: new Date().toISOString() };

  if (editingShareId) {
    const { error } = await sb.from('shares').update(record).eq('id', editingShareId);
    if (failed('Failed to save changes', error)) return;
  } else {
    const { error } = await sb.from('shares').insert({ ...record });
    if (failed('Failed to add share', error)) return;
  }
  closeShareModal();
  await loadShares();
});

// ---------- Other assets ----------

async function loadOtherAssets() {
  const { data, error } = await sb.from('other_assets').select('*').order('title');
  if (failed('Failed to load other assets', error)) return;
  otherAssets = data || [];
  renderOtherAssets();
  renderRetirementChart();
}

function renderOtherAssets() {
  const grid = document.getElementById('other-assets-grid');
  grid.innerHTML = '';

  if (otherAssets.length === 0) {
    grid.innerHTML = '<div class="empty">No other assets yet — add one to get started.</div>';
    return;
  }

  for (const asset of otherAssets) {
    const row = document.createElement('div');
    row.className = 'expense-row';
    row.innerHTML = `
      <div class="expense-row-main">
        <span class="expense-name">${escapeHtml(asset.title)}</span>
        <span class="expense-amount">${escapeHtml(asset.type || '')}</span>
        <span class="expense-amount">${asset.quantity != null ? asset.quantity : ''}</span>
        <span class="expense-amount">${asset.pension ? 'Yes' : 'No'}</span>
        <button type="button" class="share-edit-btn" aria-label="Edit ${escapeHtml(asset.title)}">&#9998;</button>
      </div>
    `;
    row.querySelector('.share-edit-btn').addEventListener('click', () => openOtherAssetModal(asset));
    grid.appendChild(row);
  }
}

const otherAssetModal = document.getElementById('other-asset-modal');
const otherAssetForm = document.getElementById('other-asset-form');
let editingOtherAssetId = null;

function openOtherAssetModal(asset) {
  otherAssetForm.reset();
  editingOtherAssetId = asset ? asset.id : null;
  document.getElementById('other-asset-modal-title').textContent = asset ? 'Edit asset' : 'Add asset';
  document.getElementById('other-asset-modal-submit').textContent = asset ? 'Save changes' : 'Add asset';
  document.getElementById('other-asset-modal-delete').classList.toggle('hidden', !editingOtherAssetId);
  if (asset) {
    document.getElementById('new-other-asset-title').value = asset.title;
    document.getElementById('new-other-asset-pension').value = asset.pension ? 'Yes' : 'No';
    document.getElementById('new-other-asset-type').value = asset.type || '';
    document.getElementById('new-other-asset-quantity').value = asset.quantity ?? '';
  }
  otherAssetModal.classList.remove('hidden');
  document.getElementById('new-other-asset-title').focus();
}
function closeOtherAssetModal() {
  otherAssetModal.classList.add('hidden');
}

document.getElementById('add-other-asset-btn').addEventListener('click', () => openOtherAssetModal());
document.getElementById('other-asset-modal-cancel').addEventListener('click', closeOtherAssetModal);
otherAssetModal.addEventListener('click', (e) => { if (e.target === otherAssetModal) closeOtherAssetModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !otherAssetModal.classList.contains('hidden')) closeOtherAssetModal();
});

document.getElementById('other-asset-modal-delete').addEventListener('click', async () => {
  if (!editingOtherAssetId) return;
  if (!confirm('Delete this asset? This can\'t be undone.')) return;
  const { error } = await sb.from('other_assets').delete().eq('id', editingOtherAssetId);
  if (failed('Failed to delete', error)) return;
  closeOtherAssetModal();
  await loadOtherAssets();
});

onSubmit(otherAssetForm, async () => {
  const title = document.getElementById('new-other-asset-title').value.trim();
  if (!title) return;
  const pension = document.getElementById('new-other-asset-pension').value === 'Yes';
  const type = document.getElementById('new-other-asset-type').value.trim() || null;
  const quantity = toNum(document.getElementById('new-other-asset-quantity').value);
  if (Number.isNaN(quantity) || quantity < 0) return notify('Enter a valid quantity.');

  if (editingOtherAssetId) {
    // value (quantity x unit price) is generated by the database.
    const { error } = await sb.from('other_assets').update({ title, pension, type, quantity }).eq('id', editingOtherAssetId);
    if (failed('Failed to save changes', error)) return;
  } else {
    const { error } = await sb.from('other_assets').insert({ title, pension, type, quantity });
    if (failed('Failed to add asset', error)) return;
  }
  closeOtherAssetModal();
  await loadOtherAssets();
});
