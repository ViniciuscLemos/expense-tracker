import { dayNumber, formatMoney, groupByDay, monthName, monthOf, weekday, yearOf } from '../lib/finance';
import EntryLine from './EntryLine';

export default function Ledger({ entries, categories, withMonth, editing, onEdit, onCancel, onSave, onDelete }) {
  const byId = Object.fromEntries(categories.map((c) => [c.id, c]));

  return (
    <ol className="ledger-days">
      {groupByDay(entries).map((group) => (
        <li key={group.day} id={`day-${group.day}`} className="day">
          <h3>
            <span className="day-number">{dayNumber(group.day)}</span>
            <span className="day-name">
              {weekday(group.day)}
              {/* a search across months has to say which month each day is in */}
              {withMonth && <span className="day-month"> · {monthName(monthOf(group.day))} {yearOf(monthOf(group.day))}</span>}
            </span>
            <span className="day-total">
              {group.earned > 0 && <span className="in">+{formatMoney(group.earned)}</span>}
              {group.spent > 0 && <span>{formatMoney(group.spent)}</span>}
            </span>
          </h3>
          <ul>
            {group.entries.map((e) => {
              const category = byId[e.category_id];
              if (editing?.id === e.id) {
                return (
                  <li key={e.id} className="entry">
                    <EntryLine categories={categories} editing={e} onSave={onSave} onCancel={onCancel} />
                  </li>
                );
              }
              return (
                <li key={e.id} className={`entry ${e.kind}`}>
                  <span className="desc">{e.description}</span>
                  <span className="cat">
                    <i style={{ background: category?.color }} aria-hidden="true" />
                    {category?.name}
                    {e.recurring_id && <span className="monthly" title="Written down every month on its own">· every month</span>}
                    {e.split_with && <span className="monthly" title={`Half of it is ${e.split_with}'s`}>· half {e.split_with}'s</span>}
                  </span>
                  <span className="amount">{e.kind === 'income' ? '+' : ''}{formatMoney(e.amount_cents)}</span>
                  <span className="row-actions">
                    <button type="button" className="link" onClick={() => onEdit(e)} aria-label={`Edit ${e.description}`}>edit</button>
                    <button type="button" className="link" onClick={() => onDelete(e)} aria-label={`Delete ${e.description}`}>delete</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
