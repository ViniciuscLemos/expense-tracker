import { calendarWeeks, dayNumber, formatMoney } from '../lib/finance';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// The month as a calendar, each day darker the more went out. Rent day stands out, and so do
// the weekends, which is usually the point.
export default function Calendar({ month, days, todayIso, onPick }) {
  const spent = Object.fromEntries(days.map((d) => [d.day, d.spent]));
  // the darkest shade goes to the biggest day leaving out the one biggest (usually rent),
  // otherwise every other day looks empty next to it
  const sorted = days.map((d) => d.spent).filter(Boolean).sort((a, b) => b - a);
  const top = sorted[1] || sorted[0] || 1;

  const level = (day) => {
    const value = spent[day] || 0;
    if (!value) return 0;
    return Math.min(4, Math.ceil((value / top) * 4));
  };

  return (
    <section className="margin-block calendar" aria-labelledby="calendar-title">
      <h2 id="calendar-title">Day by day</h2>
      <table>
        <thead>
          <tr>{WEEKDAYS.map((w, i) => <th key={i} scope="col" abbr={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}>{w}</th>)}</tr>
        </thead>
        <tbody>
          {calendarWeeks(month).map((week, i) => (
            <tr key={i}>
              {week.map((day, j) => (
                <td key={j}>
                  {day && (
                    <button
                      type="button"
                      className={`cell l${level(day)} ${day === todayIso ? 'today' : ''} ${day > todayIso ? 'later' : ''}`}
                      onClick={() => onPick(day)}
                      disabled={!spent[day]}
                      title={spent[day] ? `${formatMoney(spent[day])} spent` : 'nothing spent'}
                      aria-label={`${dayNumber(day)}: ${spent[day] ? `${formatMoney(spent[day])} spent` : 'nothing spent'}`}
                    >
                      {dayNumber(day)}
                    </button>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
