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
  document.getElementById('edit-source').innerHTML = sel.innerHTML;
}

const PENCIL_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';
const NOTE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>';

let sortKey = 'tax_date';
let sortDir = -1; // -1 = descending, 1 = ascending

document.querySelector('#tax-table thead').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const key = th.dataset.sort;
  if (key === sortKey) sortDir = -sortDir;
  else { sortKey = key; sortDir = key === 'tax_date' ? -1 : 1; }
  renderTable();
});

let typeFilter = 'All';

document.getElementById('type-filter').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-filter]');
  if (!btn) return;
  typeFilter = btn.dataset.filter;
  document.querySelectorAll('#type-filter button').forEach(b => b.classList.toggle('active', b === btn));
  renderTable();
});

function renderTable() {
  document.querySelectorAll('#tax-table th[data-sort]').forEach(th => {
    th.querySelector('.sort-ind').textContent = th.dataset.sort === sortKey ? (sortDir === 1 ? '▲' : '▼') : '';
  });
  const body = document.getElementById('tax-body');
  const visible = taxRecords.filter(r => typeFilter === 'All' || r.type === typeFilter);
  const total = visible.reduce((sum, r) => sum + Number(r.gross_amount), 0);
  document.getElementById('tax-total').textContent = fmtGBP(round2(total));
  if (visible.length === 0) {
    body.innerHTML = '<tr><td colspan="7" class="empty">No tax records' + (typeFilter === 'All' ? ' yet.' : ' for this type.') + '</td></tr>';
    return;
  }
  const sorted = [...visible].sort((a, b) => {
    const x = String(a[sortKey]), y = String(b[sortKey]);
    const c = sortKey === 'tax_date' ? x.localeCompare(y) : x.localeCompare(y, 'en', { sensitivity: 'base' });
    return (c || String(b.created_at).localeCompare(String(a.created_at))) * (c ? sortDir : 1);
  });
  body.innerHTML = sorted.map(r => `
    <tr>
      <td>${fmtDate(r.tax_date)}</td>
      <td class="value">${fmtGBP(r.gross_amount)}</td>
      <td>${escapeHtml(r.source)}</td>
      <td>${escapeHtml(r.type)}</td>
      <td>${r.live ? 'Yes' : 'No'}</td>
      <td>${r.notes && r.notes.trim() ? `<button type="button" class="note-icon" data-note-id="${r.id}" title="${escapeHtml(r.notes)}" aria-label="Show note" style="padding:2px 4px;border:0;background:none;cursor:pointer;color:inherit">${NOTE_SVG}</button>` : ''}</td>
      <td class="actions">
        <button type="button" data-edit-id="${r.id}" title="Edit" aria-label="Edit">${PENCIL_SVG}</button>
        <button type="button" data-id="${r.id}">Delete</button>
      </td>
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

// ---------- Edit modal ----------

let editingId = null;
const taxModal = document.getElementById('tax-modal');

function openEdit(rec) {
  editingId = rec.id;
  const src = document.getElementById('edit-source');
  if (![...src.options].some(o => o.value === rec.source)) {
    src.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(rec.source)}">${escapeHtml(rec.source)}</option>`);
  }
  document.getElementById('edit-date').value = rec.tax_date;
  document.getElementById('edit-amount').value = rec.gross_amount;
  src.value = rec.source;
  document.getElementById('edit-type').value = rec.type;
  document.getElementById('edit-live').checked = rec.live;
  document.getElementById('edit-notes').value = rec.notes || '';
  taxModal.classList.remove('hidden');
}
function closeEdit() { taxModal.classList.add('hidden'); editingId = null; }

document.getElementById('tax-modal-cancel').addEventListener('click', closeEdit);
taxModal.addEventListener('click', (e) => { if (e.target === taxModal) closeEdit(); });

onSubmit(document.getElementById('tax-edit-form'), async () => {
  const amount = toNum(document.getElementById('edit-amount').value);
  if (amount == null || Number.isNaN(amount)) { notify('Enter a valid gross amount'); return; }
  const row = {
    tax_date: document.getElementById('edit-date').value,
    gross_amount: amount,
    source: document.getElementById('edit-source').value,
    type: document.getElementById('edit-type').value,
    live: document.getElementById('edit-live').checked,
    notes: document.getElementById('edit-notes').value.trim() || null,
  };
  const { error } = await sb.from('tax_records').update(row).eq('id', editingId);
  if (failed('Failed to update tax record', error)) return;
  closeEdit();
  notify('Tax record updated', 'ok');
  await loadAll();
});

document.getElementById('tax-body').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('button[data-edit-id]');
  if (editBtn) { openEdit(taxRecords.find(r => r.id === editBtn.dataset.editId)); return; }
  const noteBtn = e.target.closest('button[data-note-id]');
  if (noteBtn) { notify(taxRecords.find(r => r.id === noteBtn.dataset.noteId).notes, 'ok'); return; }
  const btn = e.target.closest('button[data-id]');
  if (!btn || !confirm('Delete this tax record?')) return;
  await busy(btn, async () => {
    const { error } = await sb.from('tax_records').delete().eq('id', btn.dataset.id);
    if (failed('Failed to delete', error)) return;
    await loadAll();
  });
});
