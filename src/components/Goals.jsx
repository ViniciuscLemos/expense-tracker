import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatMoney, monthName, parseAmount, roughMoney, shiftMonth, today, yearOf } from '../lib/finance';

const monthLabel = (m) => `${monthName(m)} ${yearOf(m)}`;

// one sentence on where the goal stands, the way the month page talks
export function goalLine(g) {
  if (g.reached) return `It's all there: ${roughMoney(g.saved_cents)}.`;
  if (!g.by_month) {
    return g.saved_cents
      ? `${roughMoney(g.left_cents)} to go, no rush.`
      : 'Nothing in it yet, and no date. Put something in when a month ends well.';
  }
  if (!g.per_month_cents) return `${monthLabel(g.by_month)} came and ${roughMoney(g.left_cents)} is still missing. Pick a new month?`;
  if (g.months_left === 1) return `${roughMoney(g.left_cents)} this month gets it there.`;
  return `${roughMoney(g.per_month_cents)} a month gets it there by ${monthLabel(g.by_month)}.`;
}

function Goal({ goal, onChanged }) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [sure, setSure] = useState(false);
  const share = Math.min(100, Math.round((100 * goal.saved_cents) / goal.target_cents));

  async function move(sign) {
    const cents = parseAmount(amount);
    if (!cents) { setError('Write an amount, like 150 or 150,00.'); return; }
    try {
      await api(`/goals/${goal.id}/moves`, { method: 'POST', body: { amount_cents: sign * cents } });
      setAmount('');
      setError('');
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove() {
    await api(`/goals/${goal.id}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <li className={`goal ${goal.reached ? 'reached' : ''}`}>
      <div className="goal-head">
        <h2>{goal.name}</h2>
        <span className="goal-figures">{formatMoney(goal.saved_cents)} <span>of {formatMoney(goal.target_cents)}</span></span>
      </div>
      <div className="goal-bar" role="progressbar" aria-label={`${goal.name}, saved so far`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} aria-valuetext={`${share}%`}>
        <span style={{ width: `${share}%` }} />
      </div>
      <p className="goal-line">{goalLine(goal)}</p>

      <form className="goal-move" onSubmit={(e) => { e.preventDefault(); move(1); }}>
        <label>
          <span className="sr-only">Amount for {goal.name}</span>
          <span aria-hidden="true">R$</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" />
        </label>
        <button type="submit" className="ink small">Put in</button>
        <button type="button" className="link" onClick={() => move(-1)} disabled={!goal.saved_cents}>take out</button>
        <span className="goal-tools">
          {sure ? (
            <>
              <span>Delete it and its history?</span>
              <button type="button" className="link danger" onClick={remove}>yes, delete</button>
              <button type="button" className="link" onClick={() => setSure(false)}>keep</button>
            </>
          ) : (
            <button type="button" className="link" onClick={() => setSure(true)}>delete</button>
          )}
        </span>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </li>
  );
}

function NewGoal({ onChanged }) {
  const thisMonth = today().slice(0, 7);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [by, setBy] = useState('');
  const [error, setError] = useState('');

  async function add(e) {
    e.preventDefault();
    const cents = parseAmount(amount);
    if (!name.trim()) { setError('Give it a name.'); return; }
    if (!cents) { setError('Write how much, like 5000 or 5.000,00.'); return; }
    try {
      await api('/goals', { method: 'POST', body: { name, target_cents: cents, by_month: by || null } });
      setName(''); setAmount(''); setBy(''); setError('');
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="new-goal" onSubmit={add} aria-labelledby="new-goal-title">
      <h2 id="new-goal-title">A new goal</h2>
      <div className="new-goal-fields">
        <label><span>For</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="a trip, a laptop, a cushion…" /></label>
        <label><span>How much, R$</span><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="5.000,00" /></label>
        <label><span>By (optional)</span><input type="month" value={by} min={thisMonth} max={shiftMonth(thisMonth, 240)} onChange={(e) => setBy(e.target.value)} /></label>
      </div>
      <button type="submit" className="ink">Start it</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

// Money put aside for something. Each goal shows what's in it and, with a date, what a
// month still takes; putting in and taking out are one tap.
export default function Goals() {
  const [goals, setGoals] = useState(null);
  const [problem, setProblem] = useState('');
  const load = useCallback(() => api('/goals').then(setGoals).catch((e) => setProblem(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const saved = goals ? goals.reduce((sum, g) => sum + g.saved_cents, 0) : 0;
  const monthly = goals ? goals.reduce((sum, g) => sum + (g.per_month_cents || 0), 0) : 0;

  return (
    <main className="goals">
      <h1>Goals</h1>
      {goals && goals.length > 0 && (
        <p className="lede">
          {roughMoney(saved)} put aside so far
          {monthly > 0 && <>, and {roughMoney(monthly)} a month keeps every dated goal on time</>}.
        </p>
      )}
      {goals && goals.length === 0 && (
        <p className="lede">Something to save for? Give it a name and an amount, and a month if it has one: it tells you how much to put aside each month.</p>
      )}
      {problem && <p className="problem" role="alert">{problem}</p>}
      {goals && goals.length > 0 && <ul className="goal-list">{goals.map((g) => <Goal key={g.id} goal={g} onChanged={load} />)}</ul>}
      {goals && <NewGoal onChanged={load} />}
    </main>
  );
}
