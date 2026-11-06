import { monthName, monthOf, roughMoney, shiftMonth } from './finance';

// The month in a few plain sentences, the way you'd tell someone, instead of three boxes
// with numbers. `d` is what GET /api/dashboard returns.
export function story(d, todayIso) {
  const name = monthName(d.month);
  const before = monthName(shiftMonth(d.month, -1));
  const current = monthOf(todayIso) === d.month;
  const future = monthOf(todayIso) < d.month;
  const lines = [];

  if (!d.expenses && !d.income) {
    lines.push(future ? `${name} hasn't started yet.` : `Nothing written down for ${name}${current ? ' yet' : ''}.`);
    return lines;
  }

  if (d.expenses) {
    const perDay = d.per_day ? `, about ${roughMoney(d.per_day)} a day` : '';
    lines.push(current
      ? `So far in ${name} you've spent ${roughMoney(d.expenses)}${perDay}.`
      : `In ${name} you spent ${roughMoney(d.expenses)}${perDay}.`);
  }

  // a month still going isn't compared with a whole one: on the 5th it would always look cheaper
  if (d.previous.expenses && d.expenses) {
    if (current) {
      lines.push(`${before} ended at ${roughMoney(d.previous.expenses)}.`);
    } else {
      const diff = d.expenses - d.previous.expenses;
      if (Math.abs(diff) < d.previous.expenses * 0.02) lines.push(`About the same as ${before}.`);
      else lines.push(`That's ${roughMoney(Math.abs(diff))} ${diff < 0 ? 'less' : 'more'} than ${before}.`);
    }
  }

  if (d.income) {
    if (d.balance >= 0) {
      lines.push(`Of the ${roughMoney(d.income)} that came in, ${roughMoney(d.balance)} ${current ? 'is still here' : 'was kept'}.`);
    } else {
      lines.push(`More went out than came in: ${roughMoney(-d.balance)} short.`);
    }
  }

  const budgeted = d.categories.filter((c) => c.budget_cents);
  const over = budgeted.filter((c) => c.spent > c.budget_cents).sort((a, b) => (b.spent - b.budget_cents) - (a.spent - a.budget_cents));
  if (over.length === 1) {
    lines.push(`${over[0].name} went ${roughMoney(over[0].spent - over[0].budget_cents)} over its budget.`);
  } else if (over.length > 1) {
    lines.push(`${over.length} budgets went over, ${over[0].name} by the most (${roughMoney(over[0].spent - over[0].budget_cents)}).`);
  } else if (budgeted.length) {
    lines.push(current ? 'Every budget is holding so far.' : 'Every budget held.');
  }

  return lines;
}
