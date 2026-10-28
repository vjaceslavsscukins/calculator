import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, STATUS_TITLES, type CalcSummary, type Client, type KpSummary, type ProductKind } from '../api.ts';
import { useApp } from '../app.tsx';
import { ErrorNote } from '../components/Layout.tsx';
import { DocsMenu } from '../components/DocsMenu.tsx';
import { dateTime, errText, rub } from '../format.ts';

export function ClientPage() {
  const { id = '' } = useParams();
  const { meta, user, roundTo } = useApp();
  const nav = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [calcs, setCalcs] = useState<CalcSummary[]>([]);
  const [kps, setKps] = useState<KpSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api.client(id).then((r) => { setClient(r.client); setCalcs(r.calculations); }).catch((x) => setErr(errText(x)));
    api.clientKps(id).then((r) => setKps(r.kps)).catch(() => setKps([]));
  }, [id]);

  if (err && !client) return <section className="view"><div className="crumbs"><Link to="/clients">Клиенты</Link></div><ErrorNote text={err} /></section>;
  if (!client) return <section className="view"><p className="foot">Загружаем…</p></section>;

  const boss = user?.role === 'owner' || user?.role === 'head';

  return (
    <section className="view">
      <div className="crumbs"><Link to="/clients">Клиенты</Link> / <b>{client.name}</b></div>
      <div className="head">
        <div><div className="eyebrow">Клиент · {client.cityName}</div><h1>{client.name}</h1></div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => setEditing((v) => !v)}>Изменить данные</button>
          <button className="btn" type="button" disabled={!calcs.length} title={calcs.length ? '' : 'Сначала создайте расчёт'} onClick={() => nav(`/clients/${client.id}/kp/new`)}>Собрать КП</button>
          <button className="btn solid" type="button" onClick={() => setAdding((v) => !v)}>Новый расчёт</button>
        </div>
      </div>
      <div className="client-note">
        <span>Телефон <b>{client.phone}</b></span>
        <span>Город <b>{client.cityName}</b></span>
        <span>Менеджер <b>{client.managerName}</b></span>
      </div>
      {editing && <EditClient client={client} cities={meta?.cities ?? []} canCity={boss} onSaved={(c) => { setClient(c); setEditing(false); }} />}
      {adding && <NewCalcForm kinds={meta?.kinds ?? []} onCreate={async (title, kind) => {
        const r = await api.createCalculation(client.id, title, kind);
        nav(`/calculations/${r.calculation.id}`);
      }} onCancel={() => setAdding(false)} />}
      <ErrorNote text={err} />
      <div className="panel">
        <h2>Расчёты</h2>
        <table className="tab">
          <thead><tr><th>Название</th><th>Изделие</th><th>Статус</th><th className="num">Итого клиенту</th><th>Менеджер</th><th>Изменён</th><th /></tr></thead>
          <tbody>
            {calcs.map((c) => (
              <tr key={c.id} className="click" onClick={() => nav(`/calculations/${c.id}`)}>
                <td><a href={`/calculations/${c.id}`} onClick={(e) => e.preventDefault()}>{c.title}</a></td>
                <td>{meta?.kinds.find((k) => k.id === c.kind)?.title ?? c.kind}</td>
                <td><span className="pill">{STATUS_TITLES[c.status] ?? c.status}</span></td>
                <td className="num">{rub(c.total, roundTo)}</td>
                <td>{c.managerName}</td><td>{dateTime(c.updatedAt)}</td>
                <td className="nowrap"><DocsMenu calcId={c.id} specAt={c.specAt} /></td>
              </tr>
            ))}
            {!calcs.length && <tr><td colSpan={7} className="empty">Расчётов пока нет. Нажмите «Новый расчёт».</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h2>Коммерческие предложения</h2>
        <table className="tab">
          <thead><tr><th>Номер</th><th>Изделия</th><th className="num">Итого</th><th>Сформировано</th><th>Отправлено</th><th>Открыто клиентом</th><th>Действует до</th></tr></thead>
          <tbody>
            {kps?.map((k) => (
              <tr key={k.id} className="click" onClick={() => nav(`/kp/${k.id}`)}>
                <td><a href={`/kp/${k.id}`} onClick={(e) => e.preventDefault()}>{k.number}</a>{k.version > 1 && <span className="ver">версия {k.version}</span>}</td>
                <td className="wrap">{k.items.map((i) => i.title).join(', ')}</td>
                <td className="num">{rub(k.total, roundTo)}</td>
                <td>{dateTime(k.createdAt)}</td>
                <td>{k.sentAt ? dateTime(k.sentAt) : '—'}</td>
                <td>{k.views ? `${k.views} раз, последний ${dateTime(k.lastViewedAt)}` : 'не открыто'}{k.approvedAt && <span className="pill ok-pill">утвердил</span>}</td>
                <td>{k.validUntil.split('-').reverse().join('.')}</td>
              </tr>
            ))}
            {kps && !kps.length && <tr><td colSpan={7} className="empty">КП пока нет. Нажмите «Собрать КП».</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NewCalcForm({ kinds, onCreate, onCancel }: { kinds: { id: ProductKind; title: string }[]; onCreate: (title: string, kind: ProductKind) => Promise<void>; onCancel: () => void }) {
  const [kind, setKind] = useState<ProductKind>(kinds[0]?.id ?? 'kitchen');
  const [title, setTitle] = useState('Кухня');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pickKind = (k: ProductKind) => {
    setKind(k);
    if (!touched) setTitle(k === 'kitchen' ? 'Кухня' : 'Шкаф');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setErr('Укажите название расчёта, например «Кухня угловая».'); return; }
    setBusy(true); setErr(null);
    try { await onCreate(title.trim(), kind); } catch (x) { setErr(errText(x)); setBusy(false); }
  };

  return (
    <form className="box" onSubmit={submit}>
      <h2>Новый расчёт</h2>
      <div className="form-row">
        <label className="field">Вид изделия
          <select value={kind} onChange={(e) => pickKind(e.target.value as ProductKind)}>
            {kinds.map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}
          </select>
        </label>
        <label className="field wide">Название
          <input required value={title} onChange={(e) => { setTitle(e.target.value); setTouched(true); }} placeholder="Кухня угловая, шкаф в прихожую…" />
        </label>
      </div>
      <ErrorNote text={err} />
      <div className="actions">
        <button className="btn solid" type="submit" disabled={busy}>Создать расчёт</button>
        <button className="btn" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  );
}

function EditClient({ client, cities, canCity, onSaved }: { client: Client; cities: { id: number; name: string }[]; canCity: boolean; onSaved: (c: Client) => void }) {
  const [name, setName] = useState(client.name);
  const [phone, setPhone] = useState(client.phone);
  const [cityId, setCityId] = useState(client.cityId);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) { setErr('Имя и телефон обязательны.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.patchClient(client.id, { name: name.trim(), phone: phone.trim(), ...(canCity && cityId !== client.cityId ? { cityId } : {}) });
      onSaved(r.client);
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };
  return (
    <form className="box" onSubmit={submit}>
      <h2>Данные клиента</h2>
      <div className="form-row">
        <label className="field">Имя<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">Телефон<input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        {canCity && (
          <label className="field">Город
            <select value={cityId} onChange={(e) => setCityId(Number(e.target.value))}>{cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
        )}
      </div>
      <ErrorNote text={err} />
      <div className="actions"><button className="btn solid" type="submit" disabled={busy}>Сохранить клиента</button></div>
    </form>
  );
}
