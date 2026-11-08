import { dayNumber, formatMoney, weekday } from '../lib/finance';

// The three biggest things that went out this month. Usually rent, and then the one
// you'd forgotten about.
export default function Biggest({ items, total, onPick }) {
  if (!items.length) return null;
  return (
    <section className="margin-block biggest" aria-labelledby="biggest-title">
      <h2 id="biggest-title">The biggest ones</h2>
      <ol>
        {items.map((e) => (
          <li key={e.id}>
            <button type="button" className="biggest-row" onClick={() => onPick(e.day)}>
              <span className="what">
                {e.description}
                <small><i style={{ background: e.color }} aria-hidden="true" />{e.category} · {weekday(e.day)} {dayNumber(e.day)}</small>
              </span>
              <span className="figures-small">{formatMoney(e.amount_cents)}</span>
            </button>
          </li>
        ))}
      </ol>
      {total > 0 && (
        <p className="quiet">
          Together, {Math.round((100 * items.reduce((sum, e) => sum + e.amount_cents, 0)) / total)}% of what went out.
        </p>
      )}
    </section>
  );
}
