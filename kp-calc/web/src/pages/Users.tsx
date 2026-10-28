import { useEffect, useState, type FormEvent } from 'react';
import { api, ROLE_TITLES, type Role, type UserAdmin } from '../api.ts';
import { useApp } from '../app.tsx';
import { ErrorNote } from '../components/Layout.tsx';
import { errText } from '../format.ts';

function absUrl(u: string) {
  try { return new URL(u, window.location.origin).toString(); } catch { return u; }
}

export function InviteLink({ url, who }: { url: string; who: string }) {
  const [copied, setCopied] = useState(false);
  const full = absUrl(url);
  const copy = async () => {
    try { await navigator.clipboard.writeText(full); setCopied(true); } catch {
      const el = document.getElementById('invite-url') as HTMLInputElement | null;
      el?.select();
      try { document.execCommand('copy'); setCopied(true); } catch { /* выделили — скопируют вручную */ }
    }
  };
  return (
    <div className="made">
      <b>Ссылка-приглашение для {who}</b>
      <input id="invite-url" className="code" readOnly value={full} onFocus={(e) => e.target.select()} />
      <div className="actions">
        <button className="btn" type="button" onClick={copy}>{copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}</button>
      </div>
      <span className="foot">Перешлите ссылку человеку: по ней он задаст пароль. Ссылка действует 7 дней.</span>
    </div>
  );
}

export function UsersPage() {
  const { meta, user: me } = useApp();
  const [users, setUsers] = useState<UserAdmin[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ url: string; who: string } | null>(null);

  const load = () => api.users().then((r) => setUsers(r.users)).catch((x) => setErr(errText(x)));
  useEffect(() => { load(); }, []);

  const patch = async (u: UserAdmin, p: Parameters<typeof api.patchUser>[1]) => {
    setErr(null);
    try { const r = await api.patchUser(u.id, p); setUsers((l) => l?.map((x) => (x.id === u.id ? { ...x, ...r.user } : x)) ?? null); } catch (x) { setErr(errText(x)); }
  };
  const reinvite = async (u: UserAdmin) => {
    setErr(null);
    try { const r = await api.newInvite(u.id); setInvite({ url: r.inviteUrl, who: `${u.firstName} ${u.lastName}`.trim() }); load(); } catch (x) { setErr(errText(x)); }
  };

  return (
    <section className="view">
      <div><div className="eyebrow">Настройки · владелец</div><h1>Пользователи</h1></div>
      <ErrorNote text={err} />
      <div className="adm">
        <div className="box">
          <h2>Добавить пользователя</h2>
          <NewUser cities={meta?.cities ?? []} defaultCity={me?.cityId ?? meta?.cities[0]?.id ?? 0} onCreated={(u, url) => { setInvite({ url, who: `${u.firstName} ${u.lastName}`.trim() }); load(); }} />
          {invite && <InviteLink url={invite.url} who={invite.who} />}
        </div>
      </div>
      <div className="box">
        <h2>Сотрудники</h2>
        <table className="utab">
          <thead><tr><th>Имя</th><th>Почта</th><th>Роль</th><th>Город</th><th>Состояние</th><th /></tr></thead>
          <tbody>
            {users?.map((u) => {
              const self = u.id === me?.id;
              return (
                <tr key={u.id} className={u.disabled ? 'off' : undefined}>
                  <td>{u.firstName} {u.lastName}</td>
                  <td>{u.email}</td>
                  <td>
                    <select className="cell" value={u.role} disabled={self} aria-label="Роль" onChange={(e) => patch(u, { role: e.target.value as Role })}>
                      {(Object.keys(ROLE_TITLES) as Role[]).map((r) => <option key={r} value={r}>{ROLE_TITLES[r]}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="cell" value={u.cityId ?? ''} aria-label="Город" onChange={(e) => patch(u, { cityId: Number(e.target.value) })}>
                      {u.cityId == null && <option value="">—</option>}
                      {(meta?.cities ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td>{u.disabled ? 'отключён' : u.invited ? 'приглашён, пароль не задан' : 'работает'}</td>
                  <td className="nowrap">
                    {!self && (u.disabled
                      ? <button className="link" type="button" onClick={() => patch(u, { disabled: false })}>Включить</button>
                      : <button className="link" type="button" onClick={() => { if (window.confirm(`Отключить ${u.firstName} ${u.lastName}? Доступ закроется сразу, клиенты и расчёты останутся.`)) patch(u, { disabled: true }); }}>Отключить</button>)}
                    {' '}<button className="link" type="button" onClick={() => reinvite(u)}>Новая ссылка</button>
                  </td>
                </tr>
              );
            })}
            {!users && !err && <tr><td colSpan={6} className="empty">Загружаем…</td></tr>}
          </tbody>
        </table>
        <p className="foot">«Новая ссылка» — сброс пароля: старый пароль перестаёт действовать, человек задаёт новый по ссылке.</p>
      </div>
    </section>
  );
}

function NewUser({ cities, defaultCity, onCreated }: { cities: { id: number; name: string }[]; defaultCity: number; onCreated: (u: UserAdmin, url: string) => void }) {
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', role: 'manager' as Role, cityId: defaultCity });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!f.cityId && defaultCity) setF((x) => ({ ...x, cityId: defaultCity })); }, [defaultCity, f.cityId]);
  const cityMissing = !f.cityId;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.firstName.trim() || !f.email.trim()) { setErr('Укажите имя и почту.'); return; }
    if (cityMissing) { setErr('Выберите город.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.createUser({ ...f, firstName: f.firstName.trim(), lastName: f.lastName.trim(), email: f.email.trim() });
      onCreated(r.user, r.inviteUrl);
      setF({ firstName: '', lastName: '', email: '', role: 'manager', cityId: f.cityId });
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };

  return (
    <form className="uform-wrap" onSubmit={submit}>
      <div className="uform">
        <label className="field">Имя<input required value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} placeholder="Мария" /></label>
        <label className="field">Фамилия<input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} placeholder="Иванова" /></label>
        <label className="field">Почта<input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="maria@cultura-group.ru" /></label>
        <label className="field">Роль
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {(Object.keys(ROLE_TITLES) as Role[]).map((r) => <option key={r} value={r}>{ROLE_TITLES[r]}</option>)}
          </select>
        </label>
        <label className="field">Город
          <select value={f.cityId} onChange={(e) => setF({ ...f, cityId: Number(e.target.value) })}>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <ErrorNote text={err} />
      <div className="actions"><button className="btn solid" type="submit" disabled={busy}>Добавить пользователя</button></div>
      <p className="foot">Писем пока не отправляем: после добавления появится ссылка-приглашение, перешлите её человеку.</p>
    </form>
  );
}
