const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const DEFAULT_DRAWDOWN_RATE = 4;

const appView = document.getElementById('app-view');

sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    appView.classList.remove('hidden');
    document.getElementById('user-email').textContent = session.user.email;
    loadSettings();
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
