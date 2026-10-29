import { describe, expect, it } from 'vitest';
import { sample } from './sample';
import {
  dayLabel, expenseChange, expensesByCategory, filterEntries, formatMoney, groupByDate, inMonth, mergeBackup, monthlyTotals,
  monthName, parseAmount,
  shiftMonth, summary, toCsv,
} from './finance';

const entries = [
  { id: 1, description: 'Salary', amount: 300000, type: 'income', category: 'Salary', date: '2026-10-05', createdAt: 1 },
  { id: 2, description: 'Groceries', amount: 45090, type: 'expense', category: 'Food', date: '2026-10-06', createdAt: 2 },
  { id: 3, description: 'Rent', amount: 120000, type: 'expense', category: 'Housing', date: '2026-10-01', createdAt: 3 },
  { id: 4, description: 'Food delivery', amount: 3850, type: 'expense', category: 'Food', date: '2026-10-03', createdAt: 4 },
  { id: 5, description: 'Uber', amount: 2200, type: 'expense', category: 'Transport', date: '2026-09-28', createdAt: 5 },
];

describe('finance', () => {
  it('restores a backup without repeating entries', () => {
    const saved = entries.map((e) => ({ ...e, id: String(e.id) }));
    const backup = JSON.stringify({ version: 1, entries: saved });
    expect(mergeBackup([], backup)).toHaveLength(5);
    expect(mergeBackup(saved.slice(0, 3), backup).map((e) => e.id)).toEqual(['4', '5']);
    expect(() => mergeBackup([], 'not json')).toThrow("isn't a backup");
    expect(() => mergeBackup([], JSON.stringify([{ id: 'x', amount: -1 }]))).toThrow("isn't a backup");
  });

  it('compares the expenses with the month before', () => {
    // october 168,940 against september 2,200
    expect(expenseChange(entries, '2026-10')).toBe(7579);
    expect(expenseChange(entries, '2026-11')).toBe(-100);
    expect(expenseChange(entries, '2026-09')).toBeNull();
  });

  it('reads the typed amount in cents', () => {
    expect(parseAmount('12.50')).toBe(1250);
    expect(parseAmount('12,50')).toBe(1250);
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseAmount('1,500')).toBe(150000);
    expect(parseAmount('2,000,000')).toBe(200000000);
    expect(parseAmount('$ 10')).toBe(1000);
    expect(parseAmount('0.1')).toBe(10);
    expect(parseAmount('abc')).toBe(null);
    expect(parseAmount('0')).toBe(null);
    expect(parseAmount('-5')).toBe(null);
  });

  it('filters the month and sorts newest first', () => {
    expect(inMonth(entries, '2026-10').map((e) => e.id)).toEqual([2, 1, 4, 3]);
    expect(inMonth(entries, '2026-09').map((e) => e.id)).toEqual([5]);
  });

  it('calculates the month balance', () => {
    expect(summary(inMonth(entries, '2026-10'))).toEqual({ income: 300000, expenses: 168940, balance: 131060 });
  });

  it('adds up expenses by category', () => {
    expect(expensesByCategory(inMonth(entries, '2026-10'))).toEqual([
      { category: 'Housing', amount: 120000 },
      { category: 'Food', amount: 48940 },
    ]);
  });

  it('changes month across the year', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('writes the month name and the amount in dollars', () => {
    expect(monthName('2026-10')).toBe('October 2026');
    expect(monthName('2027-03')).toBe('March 2027');
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(5)).toBe('$0.05');
  });

  it('builds the csv', () => {
    const csv = toCsv([entries[1], { ...entries[0], description: 'Salary "out"' }]).split('\n');
    expect(csv[0]).toBe('Date,Description,Category,Type,Amount');
    expect(csv[1]).toBe('2026-10-06,"Groceries",Food,Expense,-450.90');
    expect(csv[2]).toBe('2026-10-05,"Salary ""out""",Salary,Income,3000.00');
  });

  it("sample data for the current month isn't in the future", () => {
    const dates = sample('2026-10', '2026-10-08').map((e) => e.date).filter((d) => d.startsWith('2026-10'));
    expect(dates.every((d) => d >= '2026-10-01' && d <= '2026-10-08')).toBe(true);
    // in another month it uses the normal days
    expect(sample('2026-09', '2026-10-08').at(-1).date).toBe('2026-09-22');
  });

  it('totals of the last months, oldest first', () => {
    const totals = monthlyTotals(entries, '2026-10', 3);
    expect(totals.map((t) => t.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(totals[0]).toEqual({ month: '2026-08', income: 0, expenses: 0 });
    expect(totals[1].expenses).toBe(2200);
    expect(totals[2]).toEqual({ month: '2026-10', income: 300000, expenses: 168940 });
  });

  it('filters by type and by text', () => {
    expect(filterEntries(entries, { type: 'income' }).map((e) => e.id)).toEqual([1]);
    expect(filterEntries(entries, { text: 'FOOD' }).map((e) => e.id)).toEqual([2, 4]); // category too
    expect(filterEntries(entries, { type: 'expense', text: 'uber' }).map((e) => e.id)).toEqual([5]);
    expect(filterEntries(entries).length).toBe(5);
  });

  it('groups the list by day with the net amount', () => {
    const groups = groupByDate(inMonth(entries, '2026-10'));
    expect(groups.map((g) => g.date)).toEqual(['2026-10-06', '2026-10-05', '2026-10-03', '2026-10-01']);
    expect(groups[1].net).toBe(300000);
    expect(groups[3].net).toBe(-120000);
    expect(dayLabel('2026-10-09')).toBe('Fri, Oct 9');
  });

  it('sample data also fills the two months before, for the chart', () => {
    const months = new Set(sample('2026-10', '2026-10-08').map((e) => e.date.slice(0, 7)));
    expect([...months].sort()).toEqual(['2026-08', '2026-09', '2026-10']);
  });
});
