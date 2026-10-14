// Shared helpers for every page. Load after config.js and before the page script.

const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

// ---------- Formatting ----------

const fmtGBP = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
const fmtGBP0 = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);
const fmtDate = (s) => parseISODate(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Numbers ----------
// Form inputs arrive as strings. toNum turns a raw input value into a number
// (blank -> null, unparseable -> NaN) so callers validate once and send real
// numbers to the database rather than strings.

function toNum(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s === '' ? null : Number(s);
}
function round2(n) { return Math.round(n * 100) / 100; }

// ---------- Dates (local-time safe; avoids UTC/ISO-string shifting) ----------

function pad2(n) { return String(n).padStart(2, '0'); }
function toISODate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseISODate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function startOfDay(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function mondayOf(d) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return startOfDay(addDays(d, diff));
}
function daysInMonth(year, monthIndex0) { return new Date(year, monthIndex0 + 1, 0).getDate(); }

function ageAt(dob, atDate) {
  let years = atDate.getFullYear() - dob.getFullYear();
  let months = atDate.getMonth() - dob.getMonth();
  if (atDate.getDate() < dob.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  return { years, months };
}

// ---------- Charts ----------

// A tidy axis step giving roughly five gridlines across range.
function niceStep(range) {
  const rough = range / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rough || 1)));
  const norm = rough / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

// ---------- Feedback: toasts and busy buttons ----------

function notify(message, kind = 'error') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const toast = document.createElement('div');
  toast.className = 'toast ' + kind;
  toast.textContent = message;
  toast.addEventListener('click', () => toast.remove());
  host.appendChild(toast);
  setTimeout(() => toast.remove(), kind === 'error' ? 8000 : 4000);
}

// Reports a Supabase error; returns true if there was one.
function failed(prefix, error) {
  if (!error) return false;
  notify(`${prefix}: ${error.message}`);
  return true;
}

// Runs fn with the button disabled so a double click can't submit twice.
async function busy(btn, fn) {
  if (btn) {
    if (btn.disabled) return;
    btn.disabled = true;
  }
  try {
    return await fn();
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Form submit that can't be fired twice while the request is in flight.
function onSubmit(form, handler) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    return busy(e.submitter, () => handler(e));
  });
}

// ---------- Auth ----------
// onAuthStateChange fires for token refreshes and tab refocus as well as real
// sign-ins. Only react once per signed-in user, and defer the callback so it
// can safely call back into supabase-js.

function watchSession({ signedIn, signedOut }) {
  let activeUserId = null;
  sb.auth.onAuthStateChange((event, session) => {
    if (session) {
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
      if (activeUserId === session.user.id) return;
      activeUserId = session.user.id;
      setTimeout(() => signedIn(session), 0);
    } else {
      activeUserId = null;
      signedOut();
    }
  });
}

// Standard setup for a page that requires sign-in: reveal #app-view, show the
// email, wire Sign out, and run load() once. Signed-out users go to index.html
// unless the page supplies its own signedOut handler.
function initProtectedPage(load, signedOut) {
  const appView = document.getElementById('app-view');
  document.getElementById('signout-btn').addEventListener('click', () => sb.auth.signOut());
  watchSession({
    signedIn: (session) => {
      const authView = document.getElementById('auth-view');
      if (authView) authView.classList.add('hidden');
      appView.classList.remove('hidden');
      document.getElementById('user-email').textContent = session.user.email;
      load(session);
    },
    signedOut: signedOut || (() => { window.location.href = 'index.html'; }),
  });
}

// Pages with an inline sign-in form (index.html, future-living.html).
function initAuthPage(load) {
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
    await busy(authSubmit, async () => {
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
      }
    });
  });

  initProtectedPage(load, () => {
    appView.classList.add('hidden');
    authView.classList.remove('hidden');
  });
}

// ---------- Settings (app_settings: one jsonb value per key) ----------

async function loadSettings(keys) {
  const { data, error } = await sb.from('app_settings').select('key, value').in('key', keys);
  if (error) throw error;
  const out = {};
  for (const row of data || []) out[row.key] = row.value;
  return out;
}

// values: { key: jsonValue }. A null/undefined value clears that setting.
// user_id comes from the column default.
async function saveSettings(values) {
  const now = new Date().toISOString();
  const entries = Object.entries(values);
  const rows = entries.filter(([, v]) => v != null).map(([key, value]) => ({ key, value, updated_at: now }));
  const cleared = entries.filter(([, v]) => v == null).map(([key]) => key);
  if (rows.length) {
    const { error } = await sb.from('app_settings').upsert(rows, { onConflict: 'user_id,key' });
    if (error) throw error;
  }
  if (cleared.length) {
    const { error } = await sb.from('app_settings').delete().in('key', cleared);
    if (error) throw error;
  }
}

// ---------- Latest-value lookups ----------

// For rows with a date (and created_at as tie-break): the newest row per key.
function latestBy(rows, key) {
  const latest = {};
  for (const v of rows) {
    const cur = latest[v[key]];
    if (!cur || v.date > cur.date || (v.date === cur.date && v.created_at > cur.created_at)) {
      latest[v[key]] = v;
    }
  }
  return latest;
}

// For rows already reduced to one-per-key (the latest_* views).
function indexBy(rows, key) {
  const out = {};
  for (const r of rows) out[r[key]] = r;
  return out;
}

// ---------- Portfolio maths (single source for every page) ----------

// latest: account_id -> latest value row
function accountTotals(accounts, latest) {
  const byType = { Savings: 0, ISA: 0, Pension: 0 };
  let total = 0;
  for (const acc of accounts) {
    const v = latest[acc.id];
    if (!v) continue;
    byType[acc.type] = (byType[acc.type] || 0) + Number(v.value);
    total += Number(v.value);
  }
  return { byType, total };
}

function sharesTotal(shares) {
  let total = 0;
  for (const s of shares) {
    if (s.price != null) total += Number(s.price) * Number(s.quantity);
  }
  return total;
}

function otherAssetsTotal(otherAssets, { pensionOnly = false } = {}) {
  let total = 0;
  for (const a of otherAssets) {
    if (a.value == null) continue;
    if (pensionOnly && !a.pension) continue;
    total += Number(a.value);
  }
  return total;
}

// debtLatest: debt_id -> latest value row
function debtTotal(debts, debtLatest) {
  let total = 0;
  for (const d of debts) {
    const v = debtLatest[d.id];
    if (v) total += Number(v.outstanding_amount);
  }
  return total;
}

// Savings accounts split into taxable / tax-free (ISA) / all, with the annual
// interest each group earns and its blended rate.
function savingsPerformance(accounts, latest) {
  const groups = { taxable: { sum: 0, interest: 0 }, isa: { sum: 0, interest: 0 }, all: { sum: 0, interest: 0 } };
  for (const acc of accounts) {
    if (acc.type !== 'Savings') continue;
    const v = latest[acc.id];
    if (!v) continue;
    const value = Number(v.value);
    const interest = value * Number(acc.interest_rate || 0) / 100;
    const targets = [groups.all];
    if (acc.taxable === true) targets.push(groups.taxable);
    else if (acc.taxable === false) targets.push(groups.isa);
    for (const g of targets) {
      g.sum += value;
      g.interest += interest;
    }
  }
  for (const g of Object.values(groups)) g.rate = g.sum > 0 ? (g.interest / g.sum) * 100 : 0;
  return groups;
}

function statTile(label, value, { isTotal = false, extraClass = '' } = {}) {
  const div = document.createElement('div');
  div.className = 'stat-tile' + (isTotal ? ' total' : '') + (extraClass ? ' ' + extraClass : '');
  div.innerHTML = `<div class="label">${escapeHtml(label)}</div><div class="value">${value}</div>`;
  return div;
}
