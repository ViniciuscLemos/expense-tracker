import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';
import Categories from './components/Categories';
import Goals from './components/Goals';
import Login from './components/Login';
import Month from './components/Month';
import Year from './components/Year';

const PAGES = ['categories', 'year', 'goals'];
const pageFromHash = () => {
  const page = window.location.hash.slice(1);
  return PAGES.includes(page) ? page : 'month';
};

export default function App() {
  // undefined while asking the server who's logged in, null when nobody is
  const [user, setUser] = useState(undefined);
  const [categories, setCategories] = useState([]);
  const [page, setPage] = useState(pageFromHash);
  // the month to open when coming from the year page
  const [startMonth, setStartMonth] = useState(null);

  useEffect(() => {
    api('/me').then(setUser).catch(() => setUser(null));
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const loadCategories = useCallback(() => api('/categories').then(setCategories), []);

  useEffect(() => {
    if (user) loadCategories();
  }, [user, loadCategories]);

  async function logout() {
    await api('/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setCategories([]);
  }

  const open = (next) => {
    window.location.hash = next === 'month' ? '' : next;
    setPage(next);
  };

  if (user === undefined) return <p className="opening">Opening the notebook…</p>;
  if (!user) return <Login onIn={setUser} />;

  return (
    <div className="app">
      <header className="top">
        <p className="wordmark">{user.name}'s expenses<span>.</span></p>
        <nav aria-label="Pages">
          <button type="button" className="link" aria-current={page === 'month' ? 'page' : undefined} onClick={() => { setStartMonth(null); open('month'); }}>month</button>
          <button type="button" className="link" aria-current={page === 'year' ? 'page' : undefined} onClick={() => open('year')}>year</button>
          <button type="button" className="link" aria-current={page === 'goals' ? 'page' : undefined} onClick={() => open('goals')}>goals</button>
          <button type="button" className="link" aria-current={page === 'categories' ? 'page' : undefined} onClick={() => open('categories')}>categories</button>
          <button type="button" className="link" onClick={logout}>log out</button>
        </nav>
      </header>

      {page === 'month' && <Month key={startMonth || 'now'} categories={categories} startMonth={startMonth} onCategories={() => open('categories')} />}
      {page === 'year' && <Year onMonth={(m) => { setStartMonth(m); open('month'); }} />}
      {page === 'goals' && <Goals />}
      {page === 'categories' && <Categories categories={categories} onChanged={loadCategories} />}

      <footer>
        made by <a href="https://github.com/ViniciuscLemos" target="_blank" rel="noreferrer">Vinicius Lemos</a>
        {' · '}
        <a href="/api/docs">the API</a>
      </footer>
    </div>
  );
}
