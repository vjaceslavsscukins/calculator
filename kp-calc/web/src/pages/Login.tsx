import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.ts';
import { useApp } from '../app.tsx';
import { ErrorNote, Logo, ThemeSwitch } from '../components/Layout.tsx';
import { errText } from '../format.ts';

export function LoginPage() {
  const { setUser } = useApp();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api.login(email.trim(), password);
      setUser(r.user);
      nav(loc.state?.from && loc.state.from !== '/login' ? loc.state.from : '/clients', { replace: true });
    } catch (x) {
      setErr(errText(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-theme"><ThemeSwitch /></div>
      <form className="auth-box" onSubmit={submit}>
        <Logo className="auth-logo" />
        <div><div className="eyebrow">Калькулятор КП</div><h1>Вход</h1></div>
        <label className="field">Почта
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">Пароль
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <ErrorNote text={err} />
        <button className="btn solid" type="submit" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
        <p className="foot">Нет доступа? Попросите владельца прислать приглашение.</p>
      </form>
    </div>
  );
}
