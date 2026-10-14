// Expense projection and the "Next 8 days" list, shared by the dashboard and
// the Bills page. Needs lib.js loaded first.
//
// For each expense, recorded occurrences take priority within their period
// (calendar month for Monthly, Mon-Sun week for Weekly). Periods in range with
// no recorded occurrence get a projected entry from the expense's typical day/amount.

function computeOccurrences(expenses, occurrences, rangeStart, rangeEnd) {
  const recordedByExpense = {};
  for (const occ of occurrences) {
    (recordedByExpense[occ.expense_id] ||= []).push(occ);
  }

  const results = [];
  for (const exp of expenses) {
    const recs = recordedByExpense[exp.id] || [];
    if (exp.frequency === 'Monthly') {
      let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
      const endCursor = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);
      while (cursor <= endCursor) {
        const y = cursor.getFullYear(), m = cursor.getMonth();
        const monthRecs = recs.filter(r => {
          const rd = parseISODate(r.date);
          return rd.getFullYear() === y && rd.getMonth() === m;
        });
        if (monthRecs.length > 0) {
          for (const r of monthRecs) {
            results.push({ expense: exp, date: r.date, amount: Number(r.amount), recorded: true, occurrenceId: r.id });
          }
        } else {
          const day = Math.min(exp.typical_day, daysInMonth(y, m));
          const date = `${y}-${pad2(m + 1)}-${pad2(day)}`;
          results.push({ expense: exp, date, amount: exp.typical_amount != null ? Number(exp.typical_amount) : null, recorded: false });
        }
        cursor.setMonth(cursor.getMonth() + 1);
      }
    } else {
      let cursor = mondayOf(rangeStart);
      const lastMonday = mondayOf(rangeEnd);
      while (cursor <= lastMonday) {
        const wKey = toISODate(cursor);
        const weekRecs = recs.filter(r => toISODate(mondayOf(parseISODate(r.date))) === wKey);
        if (weekRecs.length > 0) {
          for (const r of weekRecs) {
            results.push({ expense: exp, date: r.date, amount: Number(r.amount), recorded: true, occurrenceId: r.id });
          }
        } else {
          const date = toISODate(addDays(cursor, exp.typical_day - 1));
          results.push({ expense: exp, date, amount: exp.typical_amount != null ? Number(exp.typical_amount) : null, recorded: false });
        }
        cursor = addDays(cursor, 7);
      }
    }
  }

  const startStr = toISODate(rangeStart);
  const endStr = toISODate(rangeEnd);
  return results
    .filter(r => r.date >= startStr && r.date <= endStr)
    .sort((a, b) => a.date.localeCompare(b.date) || (b.amount || 0) - (a.amount || 0));
}

function fmtDayLabel(dateStr) {
  return parseISODate(dateStr).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}

function renderNext8Row(entry, runningTotal) {
  const row = document.createElement('div');
  row.className = 'expense-row next8-row';
  const amountText = entry.amount != null ? fmtGBP(entry.amount) : '—';
  row.innerHTML = `
    <span class="expense-date">${fmtDayLabel(entry.date)}</span>
    <span class="expense-name">${escapeHtml(entry.expense.name)}</span>
    <span class="expense-amount ${entry.recorded ? '' : 'projected'}">${amountText}</span>
    <span class="expense-running-total">${fmtGBP(runningTotal)}</span>
  `;
  return row;
}

function renderNext8(expenses, occurrences) {
  const list = document.getElementById('next8-list');
  const empty = document.getElementById('next8-empty');
  list.innerHTML = '';
  const start = startOfDay(new Date());
  const end = addDays(start, 7);
  const entries = computeOccurrences(expenses, occurrences, start, end);
  if (entries.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  let runningTotal = 0;
  for (const entry of entries) {
    runningTotal += entry.amount || 0;
    list.appendChild(renderNext8Row(entry, runningTotal));
  }
}
