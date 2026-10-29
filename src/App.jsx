import { useEffect, useRef, useState } from 'react';
import { expenseChange, filterEntries, inMonth, mergeBackup, monthName, monthOf, shiftMonth, summary, toCsv, today } from './lib/finance';
import { sample } from './lib/sample';
import EntryForm from './components/EntryForm';
import Summary from './components/Summary';
import Chart from './components/Chart';
import EntryList from './components/EntryList';
import Trend from './components/Trend';

function load() {
  try {
    return JSON.parse(localStorage.getItem('entries')) || [];
  } catch {
    return [];
  }
}

export default function App() {
  const [entries, setEntries] = useState(load);
  const [month, setMonth] = useState(monthOf(today()));
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState({ type: 'all', text: '' });
  // the last deleted entry, so it can come back with "Undo"
  const [deleted, setDeleted] = useState(null);
  const undoTimer = useRef(null);
  const [notice, setNotice] = useState('');
  const restoreInput = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem('entries', JSON.stringify(entries));
    } catch {
      // no localStorage (private tab), it just doesn't save
    }
  }, [entries]);

  const currentMonth = inMonth(entries, month);
  const shown = filterEntries(currentMonth, filter);
  const filtering = filter.type !== 'all' || filter.text.trim() !== '';

  function save(entry) {
    if (editing) {
      setEntries((list) => list.map((e) => (e.id === editing.id ? { ...e, ...entry } : e)));
      setEditing(null);
    } else {
      setEntries((list) => [...list, { ...entry, id: crypto.randomUUID(), createdAt: Date.now() }]);
    }
    // if it went into another month, jump there so the person sees it was added
    setMonth(monthOf(entry.date));
  }

  function edit(entry) {
    setEditing(entry);
    // on the phone the form sits at the top, far from the list
    document.querySelector('.entry-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // deletes right away and shows "Undo" for a few seconds, instead of a confirm() before
  function remove(entry) {
    setEntries((list) => list.filter((e) => e.id !== entry.id));
    if (editing?.id === entry.id) setEditing(null);
    setDeleted(entry);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setDeleted(null), 6000);
  }

  function undo() {
    setEntries((list) => [...list, deleted]);
    setDeleted(null);
    clearTimeout(undoTimer.current);
  }

  useEffect(() => () => clearTimeout(undoTimer.current), []);

  function download(content, name, type) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type }));
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  // everything lives in localStorage, so this is the only way to move to another browser or phone
  function backup() {
    download(JSON.stringify({ version: 1, entries }, null, 2), `expenses-backup-${today()}.json`, 'application/json');
  }

  async function restore(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const added = mergeBackup(entries, await file.text());
      setEntries((list) => [...list, ...added]);
      setNotice(added.length ? `${added.length} ${added.length === 1 ? 'entry' : 'entries'} restored.` : 'Everything in this backup is already here.');
    } catch (error) {
      setNotice(error.message);
    }
  }

  function exportCsv() {
    // the BOM at the start makes Excel read accents right
    download('﻿' + toCsv(currentMonth), `expenses-${month}.csv`, 'text/csv;charset=utf-8');
  }

  return (
    <div className="app">
      <header>
        <h1>Expense Tracker</h1>
        <div className="month-nav">
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
          <strong>{monthName(month)}</strong>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
        </div>
      </header>

      <Summary
        {...summary(currentMonth)}
        change={expenseChange(entries, month)}
        previousMonth={monthName(shiftMonth(month, -1)).split(' ')[0]}
      />

      <div className="columns">
        <div>
          <EntryForm
            key={editing?.id || 'new'}
            editing={editing}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
          <Chart entries={currentMonth} />
          <Trend entries={entries} month={month} onPick={setMonth} />
        </div>

        <section className="card">
          <div className="list-header">
            <h2>Entries</h2>
            {currentMonth.length > 0 && <button className="secondary" onClick={exportCsv}>Export CSV</button>}
          </div>

          {currentMonth.length > 0 && (
            <div className="filters">
              <div className="segmented" role="group" aria-label="Show">
                {[['all', 'All'], ['expense', 'Expenses'], ['income', 'Income']].map(([value, label]) => (
                  <button
                    key={value}
                    className={filter.type === value ? 'active' : ''}
                    aria-pressed={filter.type === value}
                    onClick={() => setFilter((f) => ({ ...f, type: value }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                type="search"
                placeholder="Search"
                aria-label="Search entries"
                value={filter.text}
                onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
              />
            </div>
          )}

          {shown.length > 0 ? (
            <EntryList entries={shown} onEdit={edit} onDelete={remove} />
          ) : filtering && currentMonth.length > 0 ? (
            <div className="empty">
              <p>No entries match the filter.</p>
              <button className="secondary" onClick={() => setFilter({ type: 'all', text: '' })}>Clear filter</button>
            </div>
          ) : (
            <div className="empty">
              <p>Nothing added in {monthName(month)}.</p>
              {entries.length === 0 && (
                <button className="secondary" onClick={() => setEntries(sample(month, today()))}>
                  Load sample data
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {deleted && (
        <div className="toast" role="status">
          <span>Deleted "{deleted.description}"</span>
          <button className="link" onClick={undo}>Undo</button>
        </div>
      )}

      <div className="backup">
        {entries.length > 0 && <button className="link" onClick={backup}>Download backup</button>}
        <button className="link" onClick={() => restoreInput.current.click()}>Restore backup</button>
        <input ref={restoreInput} type="file" accept="application/json,.json" onChange={restore} hidden />
        {notice && <span role="status">{notice}</span>}
      </div>

      <footer>
        Your data is only saved in your browser · made by{' '}
        <a href="https://github.com/ViniciuscLemos" target="_blank" rel="noreferrer">Vinicius Lemos</a>
      </footer>
    </div>
  );
}
