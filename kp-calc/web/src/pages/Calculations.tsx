import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, STATUS_TITLES, type CalcSummary, type Status } from '../api.ts';
import { useApp } from '../app.tsx';
import { ErrorNote } from '../components/Layout.tsx';
import { DocsMenu } from '../components/DocsMenu.tsx';
import { dateTime, errText, rub } from '../format.ts';

export function CalculationsPage() {
  const { meta, roundTo } = useApp();
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [list, setList] = useState<CalcSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api.calculations(status || undefined, q.trim() || undefined)
        .then((r) => { setList(r.calculations); setErr(null); })
        .catch((x) => setErr(errText(x)));
    }, 250);
    return () => clearTimeout(t);
  }, [status, q]);

  return (
    <section className="view">
      <div className="head">
        <div><div className="eyebrow">Реестр</div><h1>Расчёты</h1></div>
        <p className="foot">Новый расчёт создаётся в карточке клиента.</p>
      </div>
      <div className="form-row">
        <label className="field">Статус
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Все</option>
            {(Object.keys(STATUS_TITLES) as Status[]).map((s) => <option key={s} value={s}>{STATUS_TITLES[s]}</option>)}
          </select>
        </label>
        <label className="field wide">Поиск по клиенту или названию
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Анна, кухня угловая…" />
        </label>
      </div>
      <ErrorNote text={err} />
      <div className="panel">
        <table className="tab">
          <thead><tr><th>Клиент</th><th>Расчёт</th><th>Изделие</th><th>Статус</th><th className="num">Итого клиенту</th><th>Менеджер</th><th>Город</th><th>Изменён</th><th /></tr></thead>
          <tbody>
            {list?.map((c) => (
              <tr key={c.id} className="click" onClick={() => nav(`/calculations/${c.id}`)}>
                <td><Link to={`/clients/${c.clientId}`} onClick={(e) => e.stopPropagation()}>{c.clientName}</Link></td>
                <td>{c.title}</td>
                <td>{meta?.kinds.find((k) => k.id === c.kind)?.title ?? c.kind}</td>
                <td><span className="pill">{STATUS_TITLES[c.status] ?? c.status}</span></td>
                <td className="num">{rub(c.total, roundTo)}</td>
                <td>{c.managerName}</td><td>{c.cityName}</td><td>{dateTime(c.updatedAt)}</td>
                <td className="nowrap"><DocsMenu calcId={c.id} specAt={c.specAt} /></td>
              </tr>
            ))}
            {list && !list.length && <tr><td colSpan={9} className="empty">Ничего не нашли.</td></tr>}
            {!list && !err && <tr><td colSpan={9} className="empty">Загружаем…</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
