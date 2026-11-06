import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { amountField, formatMoney, parseAmount } from '../lib/finance';

const PALETTE = ['#c2703d', '#4a6fa5', '#5b8c85', '#b5577a', '#c44536', '#7a6aa8', '#a68a3d', '#3f7d58', '#6a9a4f', '#8a8378'];

function Row({ category, others, onChanged }) {
  const [name, setName] = useState(category.name);
  const [budget, setBudget] = useState(category.budget_cents ? amountField(category.budget_cents) : '');
  const [moving, setMoving] = useState(false);
  const [moveTo, setMoveTo] = useState(others[0]?.id || '');
  const [error, setError] = useState('');

  async function change(body) {
    setError('');
    try {
      await api(`/categories/${category.id}`, { method: 'PATCH', body });
      await onChanged();
    } catch (e) {
      setError(e.message);
      setName(category.name);
    }
  }

  function saveName() {
    if (name.trim() && name.trim() !== category.name) change({ name: name.trim() });
    else setName(category.name);
  }

  function saveBudget() {
    if (!budget.trim()) {
      if (category.budget_cents) change({ budget_cents: null });
      return;
    }
    const cents = parseAmount(budget);
    if (!cents) return setError('The budget should look like 900 or 1.200,50');
    if (cents !== category.budget_cents) change({ budget_cents: cents });
  }

  async function remove() {
    setError('');
    try {
      await api(`/categories/${category.id}${moving ? `?move_to=${moveTo}` : ''}`, { method: 'DELETE' });
      await onChanged();
    } catch (e) {
      if (e.status === 409) setMoving(true);
      setError(e.message);
    }
  }

  return (
    <li className={`category-row ${category.archived ? 'archived' : ''}`}>
      <label className="swatch" style={{ background: category.color }}>
        <span className="sr-only">Color of {category.name}</span>
        <input type="color" value={category.color} onChange={(e) => change({ color: e.target.value })} />
      </label>

      <input className="name" aria-label="Name" value={name} maxLength={40}
        onChange={(e) => setName(e.target.value)} onBlur={saveName}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />

      {category.kind === 'expense' ? (
        <label className="budget-field">
          <span>budget R$</span>
          <input value={budget} placeholder="none" inputMode="decimal" aria-label={`Monthly budget for ${category.name}`}
            onChange={(e) => setBudget(e.target.value)} onBlur={saveBudget}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        </label>
      ) : <span />}

      <span className="count">{category.entries} {category.entries === 1 ? 'entry' : 'entries'}</span>

      <span className="row-actions always">
        <button type="button" className="link" onClick={() => change({ archived: !category.archived })}>
          {category.archived ? 'bring back' : 'archive'}
        </button>
        <button type="button" className="link" onClick={remove} aria-label={`Delete ${category.name}`}>delete</button>
      </span>

      {moving && (
        <div className="move">
          {others.length ? (
            <>
              <label>
                {category.entries > 0
                  ? `Move its ${category.entries} ${category.entries === 1 ? 'entry' : 'entries'} to`
                  : 'Move its entries to'}
                <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                  {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <button type="button" className="ink small" onClick={remove}>Move and delete</button>
            </>
          ) : <span>There's no other category to move them to. Archive it instead.</span>}
          <button type="button" className="link" onClick={() => { setMoving(false); setError(''); }}>cancel</button>
        </div>
      )}

      {error && !(moving && error.includes('this category')) && <p className="error" role="alert">{error}</p>}
    </li>
  );
}

function NewCategory({ kind, onChanged }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      await api('/categories', { method: 'POST', body: { kind, name: name.trim(), color } });
      setName('');
      setError('');
      await onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="new-category" onSubmit={submit}>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
        placeholder={kind === 'expense' ? 'a new one, like "Pets"' : 'a new one, like "Gifts"'}
        aria-label={`New ${kind} category`} />
      <button type="submit" className="link">add</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

// what's written down on its own every month: rent, salary, the internet bill
function Recurring({ categories }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const name = (id) => categories.find((c) => c.id === id)?.name || '';

  const load = () => api('/recurring').then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function act(path, options) {
    setError('');
    try {
      await api(path, options);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (!list) return null;
  const nextLabel = (r) => new Date(`${r.next_day}T12:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <section className="category-group recurring">
      <h2>Every month</h2>
      {list.length === 0 ? (
        <p className="quiet">
          Nothing yet. When writing an entry, tick <em>every month</em> and it gets written down on its own on that day.
        </p>
      ) : (
        <ul>
          {list.map((r) => (
            <li key={r.id} className={`recurring-row ${r.active ? '' : 'archived'}`}>
              <span className="name-text">{r.description}</span>
              <span className="figures-small">{r.kind === 'income' ? '+' : ''}{formatMoney(r.amount_cents)}</span>
              <span className="count">on the {r.day_of_month}{['th', 'st', 'nd', 'rd'][(r.day_of_month % 10 > 3 || [11, 12, 13].includes(r.day_of_month)) ? 0 : r.day_of_month % 10]} · {name(r.category_id)}</span>
              <span className="count">{r.active ? `next ${nextLabel(r)}` : 'paused'}</span>
              <span className="row-actions always">
                <button type="button" className="link" onClick={() => act(`/recurring/${r.id}`, { method: 'PATCH', body: { active: !r.active } })}>
                  {r.active ? 'pause' : 'start again'}
                </button>
                <button type="button" className="link" aria-label={`Stop ${r.description}`}
                  onClick={() => act(`/recurring/${r.id}`, { method: 'DELETE' })}>stop</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="quiet">Pausing or stopping keeps what was already written down. Changing the amount only changes the months to come.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function Import({ onChanged }) {
  const input = useRef(null);
  const [notice, setNotice] = useState('');

  async function pick(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error("That file isn't a backup.");
      }
      const entries = Array.isArray(data) ? data : data?.entries;
      if (!Array.isArray(entries)) throw new Error("That file isn't a backup.");
      const result = await api('/entries/import', { method: 'POST', body: { entries } });
      setNotice(result.imported
        ? `${result.imported} ${result.imported === 1 ? 'entry' : 'entries'} brought in.`
        : 'Everything in that file is already here.');
      await onChanged();
    } catch (e) {
      setNotice(e.message);
    }
  }

  return (
    <section className="import">
      <h2>From the old version</h2>
      <p>
        The first version of this app saved everything in the browser. If you used it, its
        “Download backup” file can come in here. Bringing the same file twice doesn't repeat anything.
      </p>
      <button type="button" className="ink small" onClick={() => input.current.click()}>Choose the backup file</button>
      <input ref={input} type="file" accept="application/json,.json" onChange={pick} hidden />
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

export default function Categories({ categories, onChanged }) {
  // the counts of entries change while writing on the month page, so they're read again here
  useEffect(() => { onChanged(); }, [onChanged]);

  const groups = [['expense', 'What you spend on'], ['income', 'Where money comes from']];

  return (
    <main className="categories">
      <h1>Categories</h1>
      <p className="lede">
        Rename them, change the color, give the spending ones a monthly budget. A category you
        don't use anymore can be archived: its old entries stay, it just leaves the list.
      </p>

      {groups.map(([kind, title]) => {
        const mine = categories.filter((c) => c.kind === kind);
        return (
          <section key={kind} className="category-group">
            <h2>{title}</h2>
            <ul>
              {mine.map((c) => (
                <Row key={`${c.id}-${c.name}-${c.budget_cents}-${c.archived}`} category={c}
                  others={mine.filter((o) => o.id !== c.id && !o.archived)} onChanged={onChanged} />
              ))}
            </ul>
            <NewCategory kind={kind} onChanged={onChanged} />
          </section>
        );
      })}

      <Recurring categories={categories} />

      <Import onChanged={onChanged} />
    </main>
  );
}
