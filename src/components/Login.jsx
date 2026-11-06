import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function Login({ onIn }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(null);

  useEffect(() => {
    api('/config').then((c) => setDemo(c.demo)).catch(() => {});
  }, []);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function send(body, path) {
    setBusy(true);
    setError('');
    try {
      onIn(await api(path, { method: 'POST', body }));
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    if (mode === 'signup') send(form, '/signup');
    else send({ email: form.email, password: form.password }, '/login');
  }

  return (
    <main className="login">
      <div className="login-intro">
        <p className="wordmark">expenses<span>.</span></p>
        <h1>Where did the money go this month?</h1>
        <p>
          Write down what you spend and what comes in. At the end of the month it tells you, in plain words,
          how it went: what you kept, which budget slipped, which days cost the most.
        </p>
      </div>

      <div className="login-side">
        {demo && (
          <div className="demo-note">
            <p>
              <strong>Just looking?</strong> Marina is made up, and her last six months are all written down.
              Change anything you like, it goes back to how it was every time the server restarts.
            </p>
            <button type="button" className="ink" disabled={busy} onClick={() => send(demo, '/login')}>
              Open Marina's notebook
            </button>
          </div>
        )}

        <form onSubmit={submit} className="login-form">
          <h2>{mode === 'login' ? 'Log in' : 'Make an account'}</h2>
          {mode === 'signup' && (
            <label>
              Your name
              <input value={form.name} onChange={set('name')} autoComplete="given-name" maxLength={60} required />
            </label>
          )}
          <label>
            Email
            <input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'signup' ? 8 : undefined}
              required
            />
            {mode === 'signup' && <small>At least 8 characters.</small>}
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="ink" disabled={busy}>
            {mode === 'login' ? 'Log in' : 'Make the account'}
          </button>
          <p className="switch">
            {mode === 'login' ? "First time here? " : 'Already have one? '}
            <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}>
              {mode === 'login' ? 'Make an account' : 'Log in'}
            </button>
          </p>
        </form>
      </div>
    </main>
  );
}
