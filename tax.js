// Tax records. Shared code lives in lib.js.

let taxRecords = [];

initProtectedPage(loadAll);

document.getElementById('tax-date').valueAsDate = new Date();

async function loadAll() {
  const [t, a, s, o] = await Promise.all([
    sb.from('tax_records').select('*').order('tax_date', { ascending: false }).order('created_at', { ascending: false }),
    sb.from('accounts').select('name').order('name'),
    sb.from('shares').select('title, trading_code').order('title'),
    sb.from('other_assets').select('title').order('title'),
  ]);
  if (failed('Failed to load tax records', t.error) || failed('Failed to load accounts', a.error)
    || failed('Failed to load shares', s.error) || failed('Failed to load other assets', o.error)) return;
  taxRecords = t.data || [];
  renderSources(
    (a.data || []).map(x => x.name),
    (s.data || []).map(x => x.trading_code ? `${x.title} (${x.trading_code})` : x.title),
    (o.data || []).map(x => x.title),
  );
  renderTable();
}

function renderSources(accounts, shares, others) {
  const sel = document.getElementById('tax-source');
  const current = sel.value;
  const group = (label, names) => {
    const unique = [...new Set(names)];
    return unique.length
      ? `<optgroup label="${label}">${unique.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}</optgroup>`
      : '';
  };
  sel.innerHTML = '<option value="" disabled selected>Select source…</option>'
    + group('Accounts', accounts) + group('Shares', shares) + group('Other assets', others);
  if (current) sel.value = current;
}

function renderTable() {
  const body = document.getElementById('tax-body');
  if (taxRecords.length === 0) {
    body.innerHTML = '<tr><td colspan="7" class="empty">No tax records yet.</td></tr>';
    return;
  }
  body.innerHTML = taxRecords.map(r => `
    <tr>
      <td>${fmtDate(r.tax_date)}</td>
      <td class="value">${fmtGBP(r.gross_amount)}</td>
      <td>${escapeHtml(r.source)}</td>
      <td>${escapeHtml(r.type)}</td>
      <td>${r.live ? 'Yes' : 'No'}</td>
      <td>${r.notes ? escapeHtml(r.notes) : ''}</td>
      <td class="actions"><button type="button" data-id="${r.id}">Delete</button></td>
    </tr>`).join('');
}

onSubmit(document.getElementById('tax-form'), async () => {
  const amount = toNum(document.getElementById('tax-amount').value);
  if (amount == null || Number.isNaN(amount)) { notify('Enter a valid gross amount'); return; }
  const row = {
    tax_date: document.getElementById('tax-date').value,
    gross_amount: amount,
    source: document.getElementById('tax-source').value,
    type: document.getElementById('tax-type').value.trim(),
    live: document.getElementById('tax-live').checked,
    notes: document.getElementById('tax-notes').value.trim() || null,
  };
  const { error } = await sb.from('tax_records').insert(row);
  if (failed('Failed to save tax record', error)) return;
  notify('Tax record saved', 'ok');
  document.getElementById('tax-amount').value = '';
  document.getElementById('tax-notes').value = '';
  await loadAll();
});

document.getElementById('tax-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-id]');
  if (!btn || !confirm('Delete this tax record?')) return;
  await busy(btn, async () => {
    const { error } = await sb.from('tax_records').delete().eq('id', btn.dataset.id);
    if (failed('Failed to delete', error)) return;
    await loadAll();
  });
});
