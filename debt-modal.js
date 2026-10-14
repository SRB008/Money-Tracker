// Add/edit debt modal, shared by the Debts and Admin pages. Needs lib.js.
// The page must contain the #debt-modal markup. Returns openDebtModal(debt?);
// onSaved() runs after a debt is added, changed or deleted.

function initDebtModal(onSaved) {
  const debtModal = document.getElementById('debt-modal');
  const debtForm = document.getElementById('debt-form');
  let editingDebtId = null;

  function open(debt) {
    debtForm.reset();
    editingDebtId = debt ? debt.id : null;
    document.getElementById('debt-modal-title').textContent = debt ? 'Edit debt' : 'Add debt';
    document.getElementById('debt-modal-submit').textContent = debt ? 'Save changes' : 'Add debt';
    document.getElementById('debt-modal-delete').classList.toggle('hidden', !editingDebtId);
    if (debt) {
      document.getElementById('new-debt-name').value = debt.name;
      document.getElementById('new-debt-payment').value = debt.monthly_payment != null ? debt.monthly_payment : '';
      document.getElementById('new-debt-rate').value = debt.interest_rate != null ? debt.interest_rate : '';
      document.getElementById('new-debt-end-date').value = debt.end_date || '';
      document.getElementById('new-debt-note').value = debt.note || '';
    }
    debtModal.classList.remove('hidden');
    document.getElementById('new-debt-name').focus();
  }
  function close() {
    debtModal.classList.add('hidden');
  }

  document.getElementById('debt-modal-cancel').addEventListener('click', close);
  debtModal.addEventListener('click', (e) => { if (e.target === debtModal) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !debtModal.classList.contains('hidden')) close();
  });

  document.getElementById('debt-modal-delete').addEventListener('click', async () => {
    if (!editingDebtId) return;
    if (!confirm('Delete this debt and all its recorded values? This can\'t be undone.')) return;
    const { error } = await sb.from('debts').delete().eq('id', editingDebtId);
    if (failed('Failed to delete', error)) return;
    close();
    await onSaved();
  });

  onSubmit(debtForm, async () => {
    const name = document.getElementById('new-debt-name').value.trim();
    if (!name) return;
    const paymentVal = toNum(document.getElementById('new-debt-payment').value);
    const rateVal = toNum(document.getElementById('new-debt-rate').value);
    if (Number.isNaN(paymentVal) || Number.isNaN(rateVal)) return notify('Enter valid numbers.');
    const endDateVal = document.getElementById('new-debt-end-date').value;
    const noteVal = document.getElementById('new-debt-note').value.trim();
    const record = {
      name,
      monthly_payment: paymentVal,
      interest_rate: rateVal,
      end_date: endDateVal === '' ? null : endDateVal,
      note: noteVal === '' ? null : noteVal,
    };

    if (editingDebtId) {
      const { error } = await sb.from('debts').update(record).eq('id', editingDebtId);
      if (failed('Failed to save changes', error)) return;
    } else {
      const { error } = await sb.from('debts').insert(record);
      if (failed('Failed to add debt', error)) return;
    }
    close();
    await onSaved();
  });

  return open;
}
