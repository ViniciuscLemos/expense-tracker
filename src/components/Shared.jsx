import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatMoney, parseAmount, today } from '../lib/finance';

const KINDS = [
  ['they_paid', 'they paid for both of us'],
  ['they_paid_back', 'they paid me back'],
  ['i_paid_back', 'I paid them back'],
];

// where it stands with one person, in a sentence
export function owesLine(p) {
  if (p.owes_you_cents > 0) return `${p.name} owes you ${formatMoney(p.owes_you_cents)}.`;
  if (p.owes_you_cents < 0) return `You owe ${p.name} ${formatMoney(-p.owes_you_cents)}.`;
  return `You and ${p.name} are square.`;
}

const shortDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });

function Person({ person, onChanged }) {
  const [problem, setProblem] = useState('');
  async function settle() {
    const kind = person.owes_you_cents > 0 ? 'they_paid_back' : 'i_paid_back';
    try {
      await api('/shared/moves', { method: 'POST', body: {
        with_name: person.name, kind, amount_cents: Math.abs(person.owes_you_cents), description: 'settled up', day: today(),
      } });
      onChanged();
    } catch (e) {
      setProblem(e.message);
    }
  }
  async function undo(line) {
    await api(`/shared/moves/${line.id}`, { method: 'DELETE' }).catch((e) => setProblem(e.message));
    onChanged();
  }
  return (
    <li className={`person ${person.owes_you_cents === 0 ? 'square' : ''}`}>
      <div className="person-head">
        <h2>{person.name}</h2>
        <p className="person-line">{owesLine(person)}</p>
        {person.owes_you_cents !== 0 && (
          <button type="button" className="ink small" onClick={settle}>settle up</button>
        )}
      </div>
      <ul className="person-lines">
        {person.lines.map((l) => (
          <li key={`${l.kind}-${l.id}`}>
            <span className="day">{shortDay(l.day)}</span>
            <span className="what">
              {l.description}
              {l.kind === 'split' && <span> · {formatMoney(l.amount_cents)}, half each</span>}
              {l.kind === 'they_paid' && <span> · {person.name} paid {formatMoney(-2 * l.effect_cents)} for both</span>}
            </span>
            <span className={`effect ${l.effect_cents < 0 ? 'minus' : ''}`}>
              {l.effect_cents > 0 ? '+' : '−'}{formatMoney(Math.abs(l.effect_cents))}
            </span>
            {l.kind !== 'split'
              ? <button type="button" className="link" onClick={() => undo(l)} aria-label={`Undo ${l.description}`}>undo</button>
              : <span />}
          </li>
        ))}
      </ul>
      {problem && <p className="error" role="alert">{problem}</p>}
    </li>
  );
}

function NewMove({ people, onChanged }) {
  const [who, setWho] = useState('');
  const [kind, setKind] = useState('they_paid');
  const [amount, setAmount] = useState('');
  const [what, setWhat] = useState('');
  const [day, setDay] = useState(today());
  const [error, setError] = useState('');

  async function add(e) {
    e.preventDefault();
    const cents = parseAmount(amount);
    if (!who.trim()) return setError('Who is it with?');
    if (!cents) return setError('The amount should look like 25,90 or 1.200');
    try {
      await api('/shared/moves', { method: 'POST', body: { with_name: who.trim(), kind, amount_cents: cents, description: what.trim() || null, day } });
      setAmount(''); setWhat(''); setError('');
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="new-goal new-move" onSubmit={add} aria-labelledby="new-move-title">
      <h2 id="new-move-title">Something else between you</h2>
      <div className="new-move-fields">
        <label><span>Who</span><input value={who} onChange={(e) => setWho(e.target.value)} list="people" maxLength={40} placeholder="Júlia" /></label>
        <datalist id="people">{people.map((p) => <option key={p.name} value={p.name} />)}</datalist>
        <label><span>What happened</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label><span>R$</span><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" /></label>
        <label><span>For what (optional)</span><input value={what} onChange={(e) => setWhat(e.target.value)} maxLength={120} placeholder="gas bill" /></label>
        <label><span>Day</span><input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
      </div>
      <button type="submit" className="ink">Write it down</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

// Money between two people: the dinner paid for both, the rent with a flatmate. An expense
// marked "half is someone else's" lands here, and so does whatever they paid or paid back.
export default function Shared() {
  const [people, setPeople] = useState(null);
  const [problem, setProblem] = useState('');
  const load = useCallback(() => api('/shared').then((r) => setPeople(r.people)).catch((e) => setProblem(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const owed = people ? people.reduce((sum, p) => sum + Math.max(0, p.owes_you_cents), 0) : 0;
  const owing = people ? people.reduce((sum, p) => sum + Math.max(0, -p.owes_you_cents), 0) : 0;

  return (
    <main className="goals shared">
      <h1>Shared</h1>
      {people && people.length === 0 && (
        <p className="lede">Paid for two? When you write down an expense, tick <em>half is someone else's</em> and it shows up here, with what they owe you.</p>
      )}
      {people && people.length > 0 && (
        <p className="lede">
          {owed > 0 ? `${formatMoney(owed)} coming back to you` : 'Nothing coming back to you'}
          {owing > 0 ? `, and ${formatMoney(owing)} you owe.` : '.'}
        </p>
      )}
      {problem && <p className="problem" role="alert">{problem}</p>}
      {people && people.length > 0 && <ul className="goal-list people">{people.map((p) => <Person key={p.name} person={p} onChanged={load} />)}</ul>}
      {people && <NewMove people={people} onChanged={load} />}
    </main>
  );
}
