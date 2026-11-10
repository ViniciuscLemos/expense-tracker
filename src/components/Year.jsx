import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatMoney, monthName, roughMoney, today } from '../lib/finance';

// The whole year on one page: a few sentences, the twelve months side by side and where the
// money went. Clicking a month opens it.
export default function Year({ onMonth }) {
  const thisYear = Number(today().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState(null);
  const [problem, setProblem] = useState('');
  const turn = useRef(0);

  useEffect(() => {
    const mine = ++turn.current;
    setProblem('');
    api(`/year/${year}`)
      .then((d) => { if (mine === turn.current) setData(d); })
      .catch((e) => setProblem(e.message));
  }, [year]);

  const top = data ? Math.max(1, ...data.months.flatMap((m) => [m.income, m.expenses])) : 1;

  return (
    <main className="year">
      <section className="month-head">
        <div className="month-nav">
          <button type="button" onClick={() => setYear(year - 1)} aria-label="Previous year">←</button>
          <h1>{year}</h1>
          <button type="button" onClick={() => setYear(year + 1)} aria-label="Next year" disabled={year >= thisYear}>→</button>
          {year !== thisYear && <button type="button" className="link back-today" onClick={() => setYear(thisYear)}>back to this year</button>}
        </div>
        {data && (
          <>
            <div className="story" aria-live="polite">{yearStory(data, thisYear).map((l) => <p key={l}>{l}</p>)}</div>
            <dl className="figures">
              <div><dt>came in</dt><dd className="in">{formatMoney(data.income)}</dd></div>
              <div><dt>went out</dt><dd>{formatMoney(data.expenses)}</dd></div>
              <div><dt>{data.balance < 0 ? 'short' : 'kept'}</dt><dd className={data.balance < 0 ? 'short' : ''}>{formatMoney(Math.abs(data.balance))}</dd></div>
            </dl>
          </>
        )}
      </section>

      {problem && <p className="problem" role="alert">{problem}</p>}

      {data && data.months_used > 0 && (
        <div className="year-spread">
          <section className="year-months" aria-labelledby="months-title">
            <h2 id="months-title">Month by month</h2>
            <div className="twelve">
              {data.months.map((m) => {
                const empty = !m.income && !m.expenses;
                return (
                  <button key={m.month} type="button" onClick={() => onMonth(m.month)} disabled={empty}
                    className={[m.month === data.priciest && 'priciest', empty && 'empty'].filter(Boolean).join(' ')}
                    aria-label={`${monthName(m.month)}: ${formatMoney(m.expenses)} out, ${formatMoney(m.income)} in`}
                    title={`${formatMoney(m.expenses)} out · ${formatMoney(m.income)} in`}>
                    <span className="six-plot">
                      <span className="six-in" style={{ height: `${(m.income / top) * 100}%` }} />
                      <span className="six-out" style={{ height: `${(m.expenses / top) * 100}%` }} />
                    </span>
                    <span className="six-label">{monthName(m.month, 'short')}</span>
                  </button>
                );
              })}
            </div>
            <p className="legend"><span className="key-out" /> went out <span className="key-in" /> came in</p>
          </section>

          <section className="year-cats" aria-labelledby="cats-title">
            <h2 id="cats-title">Where it went</h2>
            <ol className="year-cat-list">
              {data.categories.map((c) => {
                const share = data.expenses ? Math.round((100 * c.spent) / data.expenses) : 0;
                return (
                  <li key={c.id}>
                    <span className="name"><i style={{ background: c.color }} aria-hidden="true" />{c.name}</span>
                    <span className="amount">{formatMoney(c.spent)}</span>
                    <span className="share" aria-label={`${share}% of what went out`}>
                      <span style={{ width: `${share}%`, background: c.color }} />
                    </span>
                    <span className="note">{share}% · about {roughMoney(Math.round(c.spent / c.months))} in the {c.months === 1 ? 'one month' : `${c.months} months`} it shows up</span>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      )}

      {data && data.months_used === 0 && (
        <div className="blank-page"><p>Nothing written down in {year}.</p></div>
      )}
    </main>
  );
}

// a few sentences about the year, like the month's
export function yearStory(d, thisYear) {
  if (!d.months_used) return [`Nothing written down in ${d.year}${d.year === thisYear ? ' yet' : ''}.`];
  const lines = [];
  const so = d.year === thisYear ? 'So far in' : 'In';
  lines.push(`${so} ${d.year}, ${roughMoney(d.income)} came in and ${roughMoney(d.expenses)} went out.`);
  if (d.kept_percent != null) {
    lines.push(d.balance >= 0
      ? `You kept ${d.kept_percent}% of what came in, ${roughMoney(d.balance)}.`
      : `You spent ${roughMoney(-d.balance)} more than came in.`);
  }
  if (d.priciest && d.cheapest && d.priciest !== d.cheapest) {
    lines.push(`The most expensive month was ${monthName(d.priciest)}, and the lightest ${monthName(d.cheapest)}.`);
  }
  if (d.categories[0]) {
    const first = d.categories[0];
    lines.push(`${first.name} took the most: ${Math.round((100 * first.spent) / d.expenses)}% of everything.`);
  }
  return lines;
}
