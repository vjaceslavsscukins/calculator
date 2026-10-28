import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Client } from '../api.ts';
import { useApp } from '../app.tsx';
import { ErrorNote } from '../components/Layout.tsx';
import { dateTime, errText } from '../format.ts';

export function ClientsPage() {
  const { user, meta } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [list, setList] = useState<Client[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      api.clients(q.trim() || undefined).then((r) => { setList(r.clients); setErr(null); }).catch((x) => setErr(errText(x)));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <section className="view">
      <div className="head">
        <div><div className="eyebrow">Работа идёт от клиента</div><h1>Клиенты</h1></div>
        <div className="actions"><button className="btn solid" type="button" onClick={() => setAdding((v) => !v)}>Новый клиент</button></div>
      </div>
      {adding && user && <NewClientForm defaultCityId={user.cityId} cities={meta?.cities ?? []} onDone={(c) => nav(`/clients/${c.id}`)} onCancel={() => setAdding(false)} />}
      <label className="field narrow">Поиск по имени или телефону
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Анна или +7 918…" />
      </label>
      <ErrorNote text={err} />
      <div className="panel">
        <table className="tab">
          <thead><tr><th>Клиент</th><th>Телефон</th><th>Город</th><th>Менеджер</th><th className="num">Расчётов</th><th>Изменён</th></tr></thead>
          <tbody>
            {list?.map((c) => (
              <tr key={c.id} className="click" onClick={() => nav(`/clients/${c.id}`)}>
                <td><a href={`/clients/${c.id}`} onClick={(e) => e.preventDefault()}>{c.name}</a></td>
                <td>{c.phone}</td><td>{c.cityName}</td><td>{c.managerName}</td>
                <td className="num">{c.calcCount ?? '—'}</td><td>{dateTime(c.updatedAt)}</td>
              </tr>
            ))}
            {list && !list.length && <tr><td colSpan={6} className="empty">{q ? 'Никого не нашли. Проверьте имя или телефон.' : 'Клиентов пока нет. Нажмите «Новый клиент».'}</td></tr>}
            {!list && !err && <tr><td colSpan={6} className="empty">Загружаем…</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NewClientForm({ defaultCityId, cities, onDone, onCancel }: { defaultCityId: number; cities: { id: number; name: string }[]; onDone: (c: Client) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cityId, setCityId] = useState(defaultCityId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) { setErr('Укажите имя и телефон клиента.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.createClient({ name: name.trim(), phone: phone.trim(), cityId });
      onDone(r.client);
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };

  return (
    <form className="box" onSubmit={submit}>
      <h2>Новый клиент</h2>
      <div className="form-row">
        <label className="field">Имя<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Анна Козлова" autoFocus /></label>
        <label className="field">Телефон<input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 918 000-00-00" /></label>
        <label className="field">Город
          <select value={cityId} onChange={(e) => setCityId(Number(e.target.value))}>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <ErrorNote text={err} />
      <div className="actions">
        <button className="btn solid" type="submit" disabled={busy}>Добавить клиента</button>
        <button className="btn" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  );
}
