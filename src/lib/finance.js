// Amounts are kept in cents (integers) so there are no rounding problems:
// in JS 0.1 + 0.2 is 0.30000000000000004.

export const CATEGORIES = {
  expense: ['Food', 'Housing', 'Transport', 'Fun', 'Health', 'Education', 'Shopping', 'Other'],
  income: ['Salary', 'Freelance', 'Allowance', 'Other'],
};

// "12.50" / "12,50" / "1,234.56" / "1,500" -> 1250 / 1250 / 123456 / 150000 (or null if it can't)
export function parseAmount(text) {
  let clean = String(text).trim().replace(/[$\s]/g, '');
  if (clean.includes('.')) clean = clean.replace(/,/g, '');
  // a comma followed by 3 digits and no dot is a thousands separator: "1,500" is one thousand five hundred
  else if (/^\d{1,3}(,\d{3})+$/.test(clean)) clean = clean.replace(/,/g, '');
  // otherwise the comma is a decimal one ("12,50"), for people used to that
  else clean = clean.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return cents > 0 ? cents : null;
}

export function formatMoney(cents) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// "2026-10" from "2026-10-06"
export const monthOf = (date) => date.slice(0, 7);

export function inMonth(entries, month) {
  return entries
    .filter((e) => monthOf(e.date) === month)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

export function summary(entries) {
  let income = 0;
  let expenses = 0;
  for (const e of entries) {
    if (e.type === 'income') income += e.amount;
    else expenses += e.amount;
  }
  return { income, expenses, balance: income - expenses };
}

// how much the expenses went up or down (in %) from the month before, or null without a base to compare
export function expenseChange(entries, month) {
  const before = summary(inMonth(entries, shiftMonth(month, -1))).expenses;
  if (!before) return null;
  const now = summary(inMonth(entries, month)).expenses;
  return Math.round((100 * (now - before)) / before);
}

// expenses added up by category, biggest first
export function expensesByCategory(entries) {
  const total = {};
  for (const e of entries) {
    if (e.type !== 'expense') continue;
    total[e.category] = (total[e.category] || 0) + e.amount;
  }
  return Object.entries(total)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function shiftMonth(month, by) {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(year, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthName(month) {
  const [year, m] = month.split('-').map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function toCsv(entries) {
  const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = entries.map((e) => [
    e.date,
    quote(e.description),
    e.category,
    e.type === 'income' ? 'Income' : 'Expense',
    ((e.type === 'income' ? 1 : -1) * e.amount / 100).toFixed(2),
  ].join(','));
  return ['Date,Description,Category,Type,Amount', ...rows].join('\n');
}

// backup file -> entries that aren't in the list yet (same id = same entry, so restoring twice adds nothing)
export function mergeBackup(entries, text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't a backup.");
  }
  const list = Array.isArray(data) ? data : data?.entries;
  const valid = (e) =>
    e && typeof e.id === 'string' && typeof e.description === 'string' && Number.isInteger(e.amount) &&
    e.amount > 0 && ['income', 'expense'].includes(e.type) && /^\d{4}-\d{2}-\d{2}$/.test(e.date);
  if (!Array.isArray(list) || !list.every(valid)) throw new Error("This file isn't a backup.");
  const known = new Set(entries.map((e) => e.id));
  return list.filter((e) => !known.has(e.id));
}

// one color per category, used in the donut, in the bars and in the list
export const CATEGORY_COLORS = {
  Food: '#f59e0b',
  Housing: '#6366f1',
  Transport: '#0ea5e9',
  Fun: '#ec4899',
  Health: '#ef4444',
  Education: '#8b5cf6',
  Shopping: '#14b8a6',
  Salary: '#1f8a5e',
  Freelance: '#22c55e',
  Allowance: '#84cc16',
};

export const categoryColor = (category) => CATEGORY_COLORS[category] || '#94a3b8';

// income and expenses of the last `count` months, oldest first, ending in `month`
export function monthlyTotals(entries, month, count = 6) {
  const months = Array.from({ length: count }, (_, i) => shiftMonth(month, i - count + 1));
  const totals = Object.fromEntries(months.map((m) => [m, { month: m, income: 0, expenses: 0 }]));
  for (const e of entries) {
    const row = totals[monthOf(e.date)];
    if (!row) continue;
    if (e.type === 'income') row.income += e.amount;
    else row.expenses += e.amount;
  }
  return months.map((m) => totals[m]);
}

// filter of the list: type (all, income, expense) and text in the description or category
export function filterEntries(entries, { type = 'all', text = '' } = {}) {
  const term = text.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (type === 'all' || e.type === type) &&
      (!term || e.description.toLowerCase().includes(term) || e.category.toLowerCase().includes(term))
  );
}

// groups entries that are already sorted by date, with the net amount of each day
export function groupByDate(entries) {
  const groups = [];
  for (const e of entries) {
    let group = groups.at(-1);
    if (group?.date !== e.date) {
      group = { date: e.date, entries: [], net: 0 };
      groups.push(group);
    }
    group.entries.push(e);
    group.net += e.type === 'income' ? e.amount : -e.amount;
  }
  return groups;
}

// "Fri, Oct 9"
export function dayLabel(date) {
  const [year, m, d] = date.split('-').map(Number);
  return new Date(year, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
