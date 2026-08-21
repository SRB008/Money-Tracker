const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const fmtGBP = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
const fmtDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

function pad2(n) { return String(n).padStart(2, '0'); }
function toISODate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

let accounts = [];
let selectedMonths = null;

// ---------- Auth ----------

const appView = document.getElementById('app-view');

document.getElementById('signout-btn').addEventListener('click', () => sb.auth.signOut());

sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    appView.classList.remove('hidden');
    document.getElementById('user-email').textContent = session.user.email;
    loadAccounts();
  } else {
    window.location.href = 'index.html';
  }
});

// ---------- Accounts dropdown ----------

async function loadAccounts() {
  const { data, error } = await sb.from('accounts').select('*').order('type').order('name');
  if (error) return alert('Failed to load accounts: ' + error.message);
  accounts = data || [];

  const select = document.getElementById('account-select');
  select.innerHTML = '<option value="">Select an account&hellip;</option>';
  const types = ['ISA', 'Pension', 'Savings'];
  for (const type of types) {
    const list = accounts.filter(a => a.type === type);
    if (list.length === 0) continue;
    const group = document.createElement('optgroup');
    group.label = type;
    for (const acc of list) {
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = acc.name;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }
}

document.getElementById('account-select').addEventListener('change', () => {
  if (selectedMonths) loadHistory();
});

// ---------- Period buttons ----------

document.querySelectorAll('#period-tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#period-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMonths = Number(btn.dataset.months);
    loadHistory();
  });
});

// ---------- History table ----------

async function loadHistory() {
  const accountId = document.getElementById('account-select').value;
  const empty = document.getElementById('history-empty');
  const table = document.getElementById('history-table');
  const rows = document.getElementById('history-rows');
  const contributionTh = document.getElementById('history-contribution-th');

  if (!accountId) {
    empty.textContent = 'Select an account to see its history.';
    empty.classList.remove('hidden');
    table.classList.add('hidden');
    return;
  }

  const account = accounts.find(a => a.id === accountId);
  const showContribution = account && (account.type === 'ISA' || account.type === 'Pension');
  contributionTh.classList.toggle('hidden', !showContribution);

  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - selectedMonths, today.getDate());
  const fromStr = toISODate(from);

  const { data, error } = await sb.from('investment_values')
    .select('date, value, contribution')
    .eq('account_id', accountId)
    .gte('date', fromStr)
    .order('date', { ascending: false });
  if (error) return alert('Failed to load history: ' + error.message);

  if (!data || data.length === 0) {
    empty.textContent = 'No values recorded for this account in the selected period.';
    empty.classList.remove('hidden');
    table.classList.add('hidden');
    return;
  }

  rows.innerHTML = data.map(v => `
    <tr>
      <td>${fmtDate(v.date)}</td>
      ${showContribution ? `<td class="value">${v.contribution != null ? fmtGBP(v.contribution) : '—'}</td>` : ''}
      <td class="value">${fmtGBP(v.value)}</td>
    </tr>
  `).join('');
  empty.classList.add('hidden');
  table.classList.remove('hidden');
}
