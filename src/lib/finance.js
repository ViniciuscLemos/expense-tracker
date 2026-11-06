// Amounts are kept in cents (integers) so there are no rounding problems:
// in JS 0.1 + 0.2 is 0.30000000000000004.

// "12.50" / "12,50" / "1,234.56" / "1.234,56" / "1,500" -> 1250 / 1250 / 123456 / 123456 / 150000 (or null)
export function parseAmount(text) {
  let clean = String(text).trim().replace(/(R\$|\$|\s)/g, '');
  const lastDot = clean.lastIndexOf('.');
  const lastComma = clean.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    // both: whichever comes last is the decimal one
    clean = lastComma > lastDot ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/,/g, '');
  } else if (lastComma !== -1) {
    // a comma followed by 3 digits is a thousands separator: "1,500" is one thousand five hundred
    clean = /^\d{1,3}(,\d{3})+$/.test(clean) ? clean.replace(/,/g, '') : clean.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(clean)) {
    // "1.500" the Brazilian way
    clean = clean.replace(/\./g, '');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return cents > 0 ? cents : null;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const BRL_ROUND = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export const formatMoney = (cents) => BRL.format(cents / 100);
// for sentences, where "R$ 174" reads better than "R$ 174,33"
export const roughMoney = (cents) => BRL_ROUND.format(Math.round(cents / 100));

// the amount as it goes back in the field when editing: "214,60"
export const amountField = (cents) => (cents / 100).toFixed(2).replace('.', ',');

// "2026-10" from "2026-10-06"
export const monthOf = (date) => date.slice(0, 7);

export function shiftMonth(month, by) {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(year, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthName(month, style = 'long') {
  const [year, m] = month.split('-').map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString('en-US', { month: style });
}

export const yearOf = (month) => month.slice(0, 4);

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function asDate(day) {
  const [year, m, d] = day.split('-').map(Number);
  return new Date(year, m - 1, d);
}

// "Thursday" and "8"
export const weekday = (day) => asDate(day).toLocaleDateString('en-US', { weekday: 'long' });
export const dayNumber = (day) => Number(day.slice(8, 10));

// groups entries that are already newest first, with what went out and came in that day
export function groupByDay(entries) {
  const groups = [];
  for (const e of entries) {
    let group = groups.at(-1);
    if (group?.day !== e.day) {
      group = { day: e.day, entries: [], spent: 0, earned: 0 };
      groups.push(group);
    }
    group.entries.push(e);
    if (e.kind === 'income') group.earned += e.amount_cents;
    else group.spent += e.amount_cents;
  }
  return groups;
}

export function toCsv(entries, categoryName) {
  const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = entries.map((e) => [
    e.day,
    quote(e.description),
    quote(categoryName(e.category_id)),
    e.kind === 'income' ? 'Income' : 'Expense',
    (((e.kind === 'income' ? 1 : -1) * e.amount_cents) / 100).toFixed(2),
  ].join(','));
  return ['Date,Description,Category,Type,Amount', ...rows].join('\n');
}

// the weeks of a month for the calendar, Monday first, with nulls before day 1 and after the last
export function calendarWeeks(month) {
  const [year, m] = month.split('-').map(Number);
  const first = new Date(year, m - 1, 1);
  const count = new Date(year, m, 0).getDate();
  const blanks = (first.getDay() + 6) % 7;
  const cells = [...Array(blanks).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

// how far into the month a day is, from 0 to 1, for the "where you should be by now" mark
export function monthProgress(month, todayIso) {
  if (monthOf(todayIso) < month) return 0;
  if (monthOf(todayIso) > month) return 1;
  const [year, m] = month.split('-').map(Number);
  return dayNumber(todayIso) / new Date(year, m, 0).getDate();
}
