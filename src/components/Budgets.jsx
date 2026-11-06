import { formatMoney, monthProgress, roughMoney } from '../lib/finance';

// Each category against its budget. In the month that's still going there's a small mark on
// the bar for where the spending "should" be by today, so 60% spent on the 10th looks wrong
// and 60% on the 25th doesn't.
export default function Budgets({ categories, month, todayIso, onSetUp }) {
  const progress = monthProgress(month, todayIso);
  const budgeted = categories.filter((c) => c.budget_cents);
  const loose = categories.filter((c) => !c.budget_cents && c.spent > 0);

  return (
    <section className="margin-block budgets" aria-labelledby="budgets-title">
      <h2 id="budgets-title">Where it went</h2>

      {budgeted.length === 0 && loose.length === 0 && <p className="quiet">Nothing spent yet.</p>}

      <ul>
        {budgeted.map((c) => {
          const share = c.spent / c.budget_cents;
          const over = c.spent - c.budget_cents;
          return (
            <li key={c.id} className={over > 0 ? 'over' : ''}>
              <div className="budget-text">
                <span>{c.name}</span>
                <span className="figures-small">
                  {roughMoney(c.spent)} <span className="of">of {roughMoney(c.budget_cents)}</span>
                </span>
              </div>
              <div className="bar" role="img"
                aria-label={`${c.name}: ${formatMoney(c.spent)} of a ${formatMoney(c.budget_cents)} budget`}>
                <div className="fill" style={{ width: `${Math.min(share, 1) * 100}%`, background: c.color }} />
                {progress > 0 && progress < 1 && <div className="pace" style={{ left: `${progress * 100}%` }} />}
              </div>
              {over > 0 && <p className="over-note">{roughMoney(over)} over</p>}
            </li>
          );
        })}
      </ul>

      {loose.length > 0 && (
        <>
          {budgeted.length > 0 && <h3>No budget</h3>}
          <ul className="loose">
            {loose.map((c) => (
              <li key={c.id}>
                <span><i style={{ background: c.color }} aria-hidden="true" />{c.name}</span>
                <span className="figures-small">{roughMoney(c.spent)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {budgeted.length === 0 && loose.length > 0 && (
        <p className="quiet">
          <button type="button" className="link" onClick={onSetUp}>Set a monthly budget</button> for a category to see how close you are.
        </p>
      )}
    </section>
  );
}
