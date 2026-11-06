import { useCallback, useEffect, useRef, useState } from 'react';
import { api, query } from '../lib/api';
import { formatMoney, monthName, monthOf, shiftMonth, toCsv, today, yearOf } from '../lib/finance';
import { story } from '../lib/story';
import Budgets from './Budgets';
import Calendar from './Calendar';
import EntryLine from './EntryLine';
import Ledger from './Ledger';
import SixMonths from './SixMonths';

const SHOW = [['', 'everything'], ['expense', 'spent'], ['income', 'came in']];

export default function Month({ categories, onCategories }) {
  const [month, setMonth] = useState(monthOf(today()));
  const [dash, setDash] = useState(null);
  const [list, setList] = useState({ entries: [], next: null, loading: true });
  const [filter, setFilter] = useState({ kind: '', q: '', category_id: '' });
  const [editing, setEditing] = useState(null);
  const [deleted, setDeleted] = useState(null);
  const [problem, setProblem] = useState('');
  const undoTimer = useRef(null);
  const todayIso = today();

  // each load gets a number, and an answer is only used if no newer load started after it:
  // otherwise a slow first answer could arrive last and put back an older list
  const dashTurn = useRef(0);
  const listTurn = useRef(0);

  const loadDash = useCallback(async () => {
    const turn = ++dashTurn.current;
    try {
      const data = await api(`/dashboard?month=${month}`);
      if (turn === dashTurn.current) setDash(data);
    } catch (e) {
      setProblem(e.message);
    }
  }, [month]);

  const loadList = useCallback(async () => {
    const turn = ++listTurn.current;
    try {
      const page = await api(`/entries${query({ month, ...filter })}`);
      if (turn === listTurn.current) setList({ ...page, loading: false });
    } catch (e) {
      setProblem(e.message);
    }
  }, [month, filter]);

  useEffect(() => { loadDash(); }, [loadDash]);

  // the search waits for a pause in the typing instead of asking on every key
  useEffect(() => {
    const wait = setTimeout(loadList, filter.q ? 250 : 0);
    return () => clearTimeout(wait);
  }, [loadList, filter.q]);

  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const refresh = () => Promise.all([loadDash(), loadList()]);

  async function more() {
    const turn = listTurn.current;
    const page = await api(`/entries${query({ month, ...filter, after: list.next })}`);
    if (turn === listTurn.current) setList((l) => ({ entries: [...l.entries, ...page.entries], next: page.next, loading: false }));
  }

  async function add(entry, repeat) {
    if (repeat) {
      // written down once, and the server writes it again on the same day every month
      const { day, ...rest } = entry;
      await api('/recurring', { method: 'POST', body: { ...rest, first_day: day } });
    } else {
      await api('/entries', { method: 'POST', body: entry });
    }
    // written in another month: go there, so it's clear it was saved
    if (monthOf(entry.day) !== month) setMonth(monthOf(entry.day));
    else await refresh();
  }

  async function save(entry) {
    await api(`/entries/${editing.id}`, { method: 'PATCH', body: entry });
    setEditing(null);
    await refresh();
  }

  // deletes right away and offers "undo" for a few seconds, instead of asking "are you sure?"
  async function remove(entry) {
    try {
      await api(`/entries/${entry.id}`, { method: 'DELETE' });
    } catch (e) {
      return setProblem(e.message);
    }
    setDeleted(entry);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setDeleted(null), 7000);
    refresh();
  }

  async function undo() {
    const { kind, category_id, amount_cents, description, day } = deleted;
    setDeleted(null);
    await api('/entries', { method: 'POST', body: { kind, category_id, amount_cents, description, day } });
    refresh();
  }

  async function exportCsv() {
    let entries = [];
    let after = null;
    do {
      const page = await api(`/entries${query({ month, after })}`);
      entries = entries.concat(page.entries);
      after = page.next;
    } while (after);
    const name = (id) => categories.find((c) => c.id === id)?.name || '';
    const link = document.createElement('a');
    // the BOM at the start makes Excel read the accents right
    link.href = URL.createObjectURL(new Blob(['﻿' + toCsv(entries, name)], { type: 'text/csv;charset=utf-8' }));
    link.download = `expenses-${month}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function go(next) {
    setEditing(null);
    setMonth(next);
  }

  function pickDay(day) {
    document.getElementById(`day-${day}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const filtering = filter.kind || filter.q.trim() || filter.category_id;
  const defaultDay = monthOf(todayIso) === month ? todayIso : `${month}-01`;

  return (
    <main className="month">
      <section className="month-head">
        <div className="month-nav">
          <button type="button" onClick={() => go(shiftMonth(month, -1))} aria-label="Previous month">←</button>
          <h1>{monthName(month)} <span>{yearOf(month)}</span></h1>
          <button type="button" onClick={() => go(shiftMonth(month, 1))} aria-label="Next month">→</button>
          {month !== monthOf(todayIso) && (
            <button type="button" className="link back-today" onClick={() => go(monthOf(todayIso))}>back to this month</button>
          )}
        </div>

        {dash && (
          <>
            <div className="story" aria-live="polite">
              {story(dash, todayIso).map((line) => <p key={line}>{line}</p>)}
            </div>
            <dl className="figures">
              <div><dt>came in</dt><dd className="in">{formatMoney(dash.income)}</dd></div>
              <div><dt>went out</dt><dd>{formatMoney(dash.expenses)}</dd></div>
              <div><dt>{dash.balance < 0 ? 'short' : 'left'}</dt><dd className={dash.balance < 0 ? 'short' : ''}>{formatMoney(Math.abs(dash.balance))}</dd></div>
            </dl>
          </>
        )}
      </section>

      {problem && (
        <p className="problem" role="alert">
          {problem} <button type="button" className="link" onClick={() => { setProblem(''); refresh(); }}>try again</button>
        </p>
      )}

      <div className="spread">
        <section className="ledger" aria-label="Entries">
          {categories.length > 0 && (
            <EntryLine key={`new-${month}`} categories={categories} defaultDay={defaultDay} onSave={add} />
          )}

          <div className="ledger-tools">
            <div className="show" role="group" aria-label="Show">
              {SHOW.map(([value, label]) => (
                <button key={value} type="button" aria-pressed={filter.kind === value}
                  onClick={() => setFilter((f) => ({ ...f, kind: value }))}>{label}</button>
              ))}
            </div>
            <select aria-label="Category" value={filter.category_id}
              onChange={(e) => setFilter((f) => ({ ...f, category_id: e.target.value }))}>
              <option value="">all categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.kind === 'income' ? ' (in)' : ''}</option>)}
            </select>
            <input type="search" placeholder="search" aria-label="Search entries" value={filter.q}
              onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} />
            {dash && (dash.income > 0 || dash.expenses > 0) && (
              <button type="button" className="link" onClick={exportCsv}>CSV</button>
            )}
          </div>

          {list.entries.length > 0 ? (
            <Ledger
              entries={list.entries}
              categories={categories}
              editing={editing}
              onEdit={setEditing}
              onCancel={() => setEditing(null)}
              onSave={save}
              onDelete={remove}
            />
          ) : !list.loading && (
            <div className="blank-page">
              {filtering ? (
                <p>Nothing matches. <button type="button" className="link" onClick={() => setFilter({ kind: '', q: '', category_id: '' })}>Clear the filter</button></p>
              ) : (
                <p>A blank page for {monthName(month)}. Write the first thing down up there.</p>
              )}
            </div>
          )}

          {list.next && <button type="button" className="more" onClick={more}>Older entries</button>}
        </section>

        {dash && (
          <aside className="margin">
            <Budgets categories={dash.categories} month={month} todayIso={todayIso} onSetUp={onCategories} />
            <Calendar month={month} days={dash.days} todayIso={todayIso} onPick={pickDay} />
            <SixMonths months={dash.months} current={month} onPick={go} />
          </aside>
        )}
      </div>

      {deleted && (
        <div className="toast" role="status">
          <span>Crossed out “{deleted.description}”</span>
          <button type="button" className="link" onClick={undo}>undo</button>
        </div>
      )}
    </main>
  );
}
