import { formatMoney, monthName } from '../lib/finance';

// The last six months side by side: a thin line for what came in, a thicker bar for what
// went out. Clicking one opens that month.
export default function SixMonths({ months, current, onPick }) {
  const top = Math.max(1, ...months.flatMap((m) => [m.income, m.expenses]));

  return (
    <section className="margin-block six" aria-labelledby="six-title">
      <h2 id="six-title">The last six months</h2>
      <div className="six-bars">
        {months.map((m) => (
          <button
            key={m.month}
            type="button"
            className={m.month === current ? 'here' : ''}
            onClick={() => onPick(m.month)}
            aria-label={`${monthName(m.month)}: ${formatMoney(m.expenses)} out, ${formatMoney(m.income)} in`}
            title={`${formatMoney(m.expenses)} out · ${formatMoney(m.income)} in`}
          >
            <span className="six-plot">
              <span className="six-in" style={{ height: `${(m.income / top) * 100}%` }} />
              <span className="six-out" style={{ height: `${(m.expenses / top) * 100}%` }} />
            </span>
            <span className="six-label">{monthName(m.month, 'short')}</span>
          </button>
        ))}
      </div>
      <p className="legend"><span className="key-out" /> went out <span className="key-in" /> came in</p>
    </section>
  );
}
