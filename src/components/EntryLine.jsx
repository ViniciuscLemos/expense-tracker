import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { amountField, parseAmount, today } from '../lib/finance';

// The line at the top of the notebook where a new entry is written, and the same line again
// in place of an entry being edited.
export default function EntryLine({ categories, editing, defaultDay, onSave, onCancel }) {
  const [kind, setKind] = useState(editing?.kind || 'expense');
  const usable = (k) => categories.filter((c) => c.kind === k && (!c.archived || c.id === editing?.category_id));
  const [categoryId, setCategoryId] = useState(editing?.category_id || usable('expense')[0]?.id || '');
  const [description, setDescription] = useState(editing?.description || '');
  const [amount, setAmount] = useState(editing ? amountField(editing.amount_cents) : '');
  const [day, setDay] = useState(editing?.day || defaultDay || today());
  const [repeat, setRepeat] = useState(false);
  // paid for two: half of it is someone else's, and they owe it
  const [split, setSplit] = useState(!!editing?.split_with);
  const [splitWith, setSplitWith] = useState(editing?.split_with || '');
  const [known, setKnown] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef(null);

  function changeKind(next) {
    setKind(next);
    if (next !== 'expense') setSplit(false);
    setCategoryId(usable(next)[0]?.id || '');
  }

  async function submit(e) {
    e.preventDefault();
    const cents = parseAmount(amount);
    if (!description.trim()) return setError('What was it?');
    if (!cents) return setError('The amount should look like 25,90 or 1.200');
    if (!day) return setError('Which day?');
    if (split && !splitWith.trim()) return setError('Half of it is whose?');
    if (split && repeat) return setError('A split goes on one entry at a time for now: untick one of them.');
    const entry = { kind, category_id: Number(categoryId), amount_cents: cents, description: description.trim(), day };
    if (split) entry.split_with = splitWith.trim();
    else if (editing?.split_with) entry.split_with = '';
    setBusy(true);
    try {
      await onSave(entry, repeat);
      setError('');
      if (!editing) {
        setDescription('');
        setAmount('');
        setRepeat(false);
        setSplit(false);
        setSplitWith('');
        first.current?.focus();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`entry-line ${editing ? 'editing' : ''}`} onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onCancel?.()}>
      <div className="kind" role="group" aria-label="Kind">
        <button type="button" aria-pressed={kind === 'expense'} onClick={() => changeKind('expense')}>spent</button>
        <button type="button" aria-pressed={kind === 'income'} onClick={() => changeKind('income')}>got</button>
      </div>

      <label className="what">
        <span>What</span>
        <input ref={first} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder={kind === 'expense' ? 'groceries, rent, a coffee…' : 'salary, a freelance job…'} maxLength={120}
          autoFocus={!!editing} />
      </label>

      <label className="how-much">
        <span>R$</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" inputMode="decimal" />
      </label>

      <label className="which">
        <span>Category</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {usable(kind).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>

      <label className="when">
        <span>Day</span>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </label>

      <div className="line-extras">
        {!editing && (
          <label className="repeat">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            every month, on this day
          </label>
        )}
        {kind === 'expense' && (
          <label className="repeat">
            <input type="checkbox" checked={split} onChange={(e) => {
              setSplit(e.target.checked);
              // the people already shared with, to pick instead of typing
              if (e.target.checked && !known.length) api('/shared').then((r) => setKnown(r.people.map((p) => p.name))).catch(() => {});
            }} />
            half is someone else's
          </label>
        )}
        {split && (
          <label className="split-with">
            <span className="sr-only">Whose half</span>
            <input value={splitWith} onChange={(e) => setSplitWith(e.target.value)} placeholder="whose? Bia, Júlia…"
              maxLength={40} list={`known-${editing?.id || 'new'}`} autoFocus={!editing} />
            <datalist id={`known-${editing?.id || 'new'}`}>{known.map((n) => <option key={n} value={n} />)}</datalist>
          </label>
        )}
      </div>

      <div className="line-actions">
        <button type="submit" className="ink" disabled={busy}>{editing ? 'Save' : 'Write it down'}</button>
        {editing && <button type="button" className="link" onClick={onCancel}>cancel</button>}
      </div>

      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
