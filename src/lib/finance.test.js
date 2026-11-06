import { describe, expect, it } from 'vitest';
import {
  calendarWeeks, formatMoney, groupByDay, monthName, monthProgress, parseAmount, roughMoney, shiftMonth, toCsv,
} from './finance';
import { story } from './story';

describe('amounts', () => {
  it('reads what people actually type', () => {
    expect(parseAmount('25,90')).toBe(2590);
    expect(parseAmount('25.90')).toBe(2590);
    expect(parseAmount('R$ 1.234,56')).toBe(123456);
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseAmount('1.500')).toBe(150000);
    expect(parseAmount('1,500')).toBe(150000);
    expect(parseAmount('12')).toBe(1200);
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1,2,3')).toBeNull();
    expect(parseAmount('10.999')).toBe(1099900); // a thousands dot, not three decimals
  });

  it('writes reais', () => {
    expect(formatMoney(123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56');
    expect(roughMoney(17433).replace(/\s/g, ' ')).toBe('R$ 174');
  });
});

describe('months and days', () => {
  it('moves between months across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthName('2026-10')).toBe('October');
  });

  it('builds the calendar with Monday first', () => {
    const weeks = calendarWeeks('2026-10'); // October 1st 2026 is a Thursday
    expect(weeks[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('knows how far into the month today is', () => {
    expect(monthProgress('2026-10', '2026-11-02')).toBe(1);
    expect(monthProgress('2026-12', '2026-11-02')).toBe(0);
    expect(monthProgress('2026-11', '2026-11-15')).toBe(0.5);
  });

  it('groups entries by day with what went out and came in', () => {
    const groups = groupByDay([
      { id: 3, day: '2026-10-08', kind: 'expense', amount_cents: 2000 },
      { id: 2, day: '2026-10-08', kind: 'income', amount_cents: 5000 },
      { id: 1, day: '2026-10-02', kind: 'expense', amount_cents: 100 },
    ]);
    expect(groups.map((g) => [g.day, g.spent, g.earned])).toEqual([['2026-10-08', 2000, 5000], ['2026-10-02', 100, 0]]);
  });

  it('exports a CSV that Excel reads', () => {
    const csv = toCsv([{ day: '2026-10-08', description: 'Pizza "big"', category_id: 1, kind: 'expense', amount_cents: 8900 }], () => 'Food');
    expect(csv.split('\n')[1]).toBe('2026-10-08,"Pizza ""big""","Food",Expense,-89.00');
  });
});

describe('the month in words', () => {
  const base = {
    month: '2026-10', income: 500000, expenses: 261280, balance: 238720, per_day: 8428,
    previous: { income: 500000, expenses: 291280 }, categories: [],
  };
  const plain = (lines) => lines.join(' ').replace(/\s/g, ' ');

  it('tells a past month with the comparison', () => {
    expect(plain(story(base, '2026-11-06'))).toBe(
      'In October you spent R$ 2.613, about R$ 84 a day. That\'s R$ 300 less than September. ' +
      'Of the R$ 5.000 that came in, R$ 2.387 was kept.');
  });

  it("doesn't compare a month still going with a whole one", () => {
    const text = plain(story(base, '2026-10-10'));
    expect(text).toContain('So far in October');
    expect(text).toContain('September ended at R$ 2.913.');
    expect(text).toContain('is still here');
  });

  it('says when more went out than came in, and which budget slipped', () => {
    const d = {
      ...base, income: 100000, balance: -161280,
      categories: [{ name: 'Food', spent: 90000, budget_cents: 80000 }, { name: 'Fun', spent: 1000, budget_cents: 20000 }],
    };
    const text = plain(story(d, '2026-11-06'));
    expect(text).toContain('More went out than came in: R$ 1.613 short.');
    expect(text).toContain('Food went R$ 100 over its budget.');
  });

  it('an empty month is just that', () => {
    const d = { ...base, income: 0, expenses: 0, balance: 0 };
    expect(story(d, '2026-10-02')).toEqual(['Nothing written down for October yet.']);
    expect(story({ ...d, month: '2026-12' }, '2026-10-02')).toEqual(["December hasn't started yet."]);
  });
});
