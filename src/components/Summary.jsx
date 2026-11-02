import { formatMoney, savingsRate } from '../lib/finance';

export default function Summary({ income, expenses, balance, change, previousMonth }) {
  const saved = savingsRate({ income, balance });
  return (
    <div className="summary">
      <div className="card">
        <span>Income</span>
        <strong className="green">{formatMoney(income)}</strong>
      </div>
      <div className="card">
        <span>Expenses</span>
        <strong className="red">{formatMoney(expenses)}</strong>
        {change !== null && (
          <small>
            {change === 0 ? 'Same as' : `${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than`} {previousMonth}
          </small>
        )}
      </div>
      <div className="card">
        <span>Month balance</span>
        <strong className={balance < 0 ? 'red' : ''}>{formatMoney(balance)}</strong>
        {saved !== null && (
          <small>{saved >= 0 ? `Kept ${saved}% of what came in` : `${-saved}% more than came in`}</small>
        )}
      </div>
    </div>
  );
}
