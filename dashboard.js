// Dashboard. Shared code lives in lib.js, retirement.js and schedule.js.

let accounts = [];
let latestAccount = {};   // account_id -> latest value row (latest_account_values view)
let expenses = [];
let occurrences = [];
let debts = [];
let latestDebt = {};      // debt_id -> latest value row (latest_debt_values view)
let shares = [];
let otherAssets = [];
let settings = {};

document.getElementById('next8-card').addEventListener('click', () => { window.location.href = 'expenses.html'; });
document.getElementById('stat-row-accounts').addEventListener('click', () => { window.location.href = 'investments.html'; });
document.getElementById('stat-row-debt').addEventListener('click', () => { window.location.href = 'debts.html'; });
document.getElementById('stat-row-outlook').addEventListener('click', () => { window.location.href = 'admin.html'; });

initAuthPage(loadAll);

// ---------- Data loading ----------

async function loadAll() {
  // Only recorded occurrences near today matter for the next-8-days list.
  const today = startOfDay(new Date());
  const occFrom = toISODate(new Date(Math.min(new Date(today.getFullYear(), today.getMonth(), 1), mondayOf(today))));
  const occTo = toISODate(addDays(today, 40));

  const results = await Promise.all([
    sb.from('accounts').select('*').order('type').order('name'),
    sb.from('latest_account_values').select('*'),
    sb.from('expenses').select('*').eq('active', true).order('name'),
    sb.from('expense_occurrences').select('*').gte('date', occFrom).lte('date', occTo),
    sb.from('debts').select('*').order('name'),
    sb.from('latest_debt_values').select('*'),
    sb.from('shares').select('*').order('title'),
    sb.from('other_assets').select('*').order('title'),
    sb.from('app_settings').select('key, value').in('key', RETIREMENT_SETTING_KEYS),
  ]);
  const labels = ['accounts', 'values', 'expenses', 'expense occurrences', 'debts', 'debt values', 'shares', 'other assets', 'settings'];
  for (let i = 0; i < results.length; i++) {
    if (failed(`Failed to load ${labels[i]}`, results[i].error)) return;
  }
  const [acc, val, exps, occs, d, dv, shr, oth, sett] = results.map(r => r.data || []);
  accounts = acc;
  latestAccount = indexBy(val, 'account_id');
  expenses = exps;
  occurrences = occs;
  debts = d;
  latestDebt = indexBy(dv, 'debt_id');
  shares = shr;
  otherAssets = oth;
  settings = {};
  for (const row of sett) settings[row.key] = row.value;
  renderAll();
}

function renderAll() {
  renderStats();
  renderNext8(expenses, occurrences);
}

// ---------- Stats ----------

function renderStats() {
  const totals = accountTotals(accounts, latestAccount);
  const otherTotal = sharesTotal(shares) + otherAssetsTotal(otherAssets);
  const debtSum = debtTotal(debts, latestDebt);
  const netWorth = totals.total + otherTotal - debtSum;

  const accountsRow = document.getElementById('stat-row-accounts');
  accountsRow.innerHTML = '';
  for (const type of ['ISA', 'Pension']) {
    accountsRow.appendChild(statTile(type, fmtGBP0(totals.byType[type] || 0)));
  }
  accountsRow.appendChild(statTile('Savings', fmtGBP0(totals.byType.Savings || 0)));
  accountsRow.appendChild(statTile('Other Assets', fmtGBP0(otherTotal)));

  const debtRow = document.getElementById('stat-row-debt');
  debtRow.innerHTML = '';
  debtRow.appendChild(statTile('Debt', fmtGBP0(debtSum), { extraClass: 'debt' }));

  const totalRow = document.getElementById('stat-row-total');
  totalRow.innerHTML = '';
  totalRow.appendChild(statTile('Base Financial Net Worth', fmtGBP0(netWorth), { isTotal: true }));

  const cfg = retirementConfig(settings);
  const drawdownRate = drawdownRateOf(settings);
  const otherAssetsPensionOn = settings[RETIREMENT_KEYS.otherAssetsPension] === true;
  const pots = retirementPots(totals, otherAssets, { otherAssetsPension: otherAssetsPensionOn });

  const netIncomePA = (pots.isa + pots.pension * PENSION_NET_FACTOR - debtSum) * (drawdownRate / 100);
  const outlookRow = document.getElementById('stat-row-outlook');
  outlookRow.innerHTML = '';
  const incomeTile = document.createElement('div');
  incomeTile.className = 'stat-tile';
  incomeTile.innerHTML = `
    <div class="label">Potential Net Income</div>
    <div class="value">${fmtGBP0(netIncomePA / 12)} pm</div>
    <div class="sub-value">${fmtGBP0(netIncomePA)} pa · @${drawdownRate}%</div>
  `;
  outlookRow.appendChild(incomeTile);

  if (cfg && cfg.dob) renderRetirementOutlook(outlookRow, cfg, pots, debtSum);
}

// ---------- Retirement outlook ----------
// Uses the same model and saved settings as the Admin page's Retirement
// Runway chart, to surface just the runout age and time remaining.

function monthDiff(from, to) {
  const years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  if (to.getDate() < from.getDate()) months--;
  const total = years * 12 + months;
  return total < 0 ? 0 : total;
}

function durationLabel(totalMonths) {
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  if (y === 0) return m + (m === 1 ? ' month' : ' months');
  if (m === 0) return y + (y === 1 ? ' year' : ' years');
  return y + 'y ' + m + 'm';
}

function renderRetirementOutlook(outlookRow, cfg, pots, debtSum) {
  const today = new Date();
  const maxMonths = retirementHorizonMonths(cfg, today);
  const { depletion } = simulateRetirement(cfg, retirementStartingIsa(pots, cfg, debtSum), pots.pension, maxMonths);

  const ageTile = document.createElement('div');
  ageTile.className = 'stat-tile';
  const durationTile = document.createElement('div');
  durationTile.className = 'stat-tile';

  if (depletion) {
    const age = ageAt(cfg.dob, depletion.date);
    const spendLabel = `£${Math.round(cfg.spend0).toLocaleString('en-GB')}`;
    const months = monthDiff(today, depletion.date);
    const ageValue = age.months ? `${age.years}y ${age.months}m` : `${age.years}`;
    ageTile.innerHTML = `
      <div class="label">Ok at Future Living until</div>
      <div class="value">${ageValue}</div>
      <div class="sub-value">${spendLabel} pm net</div>
    `;
    durationTile.innerHTML = `
      <div class="label">Ok at Future Living for</div>
      <div class="value">${durationLabel(months)}</div>
      <div class="sub-value">@${cfg.spendRatePct}% inflation</div>
    `;
  } else {
    ageTile.innerHTML = `
      <div class="label">At Salary, Ok Until Age</div>
      <div class="value">100+</div>
      <div class="sub-value">Not within projection</div>
    `;
    durationTile.innerHTML = `
      <div class="label">At Salary, Ok For</div>
      <div class="value">${Math.floor(maxMonths / 12)}+ years</div>
    `;
  }
  outlookRow.appendChild(ageTile);
  outlookRow.appendChild(durationTile);
}
