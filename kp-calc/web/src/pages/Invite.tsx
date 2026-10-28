import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.ts';
import { useApp } from '../app.tsx';
import { ErrorNote, Logo, ThemeSwitch } from '../components/Layout.tsx';
import { errText } from '../format.ts';

export function InvitePage() {
  const { token = '' } = useParams();
  const { setUser } = useApp();
  const nav = useNavigate();
  const [info, setInfo] = useState<{ email: string; firstName: string } | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.invite(token).then(setInfo).catch((x) => setBad(x?.status === 404 ? 'Ссылка устарела или уже использована. Попросите владельца прислать новую.' : errText(x)));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (p1.length < 8) { setErr('Пароль должен быть не короче 8 символов.'); return; }
    if (p1 !== p2) { setErr('Пароли не совпадают.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.acceptInvite(token, p1);
      setUser(r.user);
      nav('/clients', { replace: true });
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
        <div><div className="eyebrow">Приглашение</div><h1>Задайте пароль</h1></div>
        {bad && <><ErrorNote text={bad} /><Link className="link-dark" to="/login">Перейти ко входу</Link></>}
        {!bad && !info && <p className="foot">Проверяем ссылку…</p>}
        {info && (
          <>
            <p className="lead">Здравствуйте, {info.firstName}. Ваша почта для входа: <b>{info.email}</b>. Придумайте пароль не короче 8 символов.</p>
            <label className="field">Пароль
              <input type="password" autoComplete="new-password" required value={p1} onChange={(e) => setP1(e.target.value)} />
            </label>
            <label className="field">Пароль ещё раз
              <input type="password" autoComplete="new-password" required value={p2} onChange={(e) => setP2(e.target.value)} />
            </label>
            <ErrorNote text={err} />
            <button className="btn solid" type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить пароль и войти'}</button>
          </>
        )}
      </form>
    </div>
  );
}
