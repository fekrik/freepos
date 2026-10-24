import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, session, type Session } from '../api';

export function AdminLogin() {
  const nav = useNavigate();
  const [tenant, setTenant] = useState('demo');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      session.set(await api<Session>('/auth/login', { method: 'POST', json: { tenant, email, password } }), 'admin');
      nav('/admin/products');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <main className="center-screen">
      <form className="glass pin-card animate-in" onSubmit={submit}>
        <div className="logo"><div className="logo-mark">F</div>FreshPOS</div>
        <h1 style={{ fontSize: '1.4rem' }}>Back office sign in</h1>
        <label>Company ID<input id="bo-tenant" className="input" value={tenant} onChange={(e) => setTenant(e.target.value)} /></label>
        <label>Email<input id="bo-email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input id="bo-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button id="bo-submit" className="btn btn-primary btn-lg" disabled={busy}>Sign in</button>
        <div className="error">{err}</div>
      </form>
    </main>
  );
}
