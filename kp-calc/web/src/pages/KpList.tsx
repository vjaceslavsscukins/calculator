// Реестр КП: все КП в зоне видимости (менеджер — свои, руководитель — свой город, владелец — все),
// статус у клиента, просмотры и вопросы клиентов. Показывается последняя версия каждого КП.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, KP_STATE_TITLES, type KpListItem, type KpState } from '../api.ts';
import { useApp } from '../app.tsx';
import { ErrorNote } from '../components/Layout.tsx';
import { dateTime, errText, rub } from '../format.ts';

const dmy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');

export function KpListPage() {
  const nav = useNavigate();
  const { roundTo, user } = useApp();
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const [list, setList] = useState<KpListItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api.kps({ state, q }).then((r) => { setList(r.kps); setErr(null); }).catch((x) => setErr(errText(x)));
    }, 250);
    return () => clearTimeout(t);
  }, [state, q]);

  const many = user?.role !== 'manager';
  return (
    <section className="view">
      <div className="head">
        <div><div className="eyebrow">Реестр</div><h1>Коммерческие предложения</h1></div>
        <p className="foot">Последняя версия каждого КП. Новое КП собирается в карточке клиента.</p>
      </div>
      <div className="form-row">
        <label className="field">Статус
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">Все</option>
            {(Object.keys(KP_STATE_TITLES) as KpState[]).map((s) => <option key={s} value={s}>{KP_STATE_TITLES[s]}</option>)}
          </select>
        </label>
        <label className="field wide">Поиск по номеру, клиенту, изделию
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="КП-0012, Анна, кухня…" />
        </label>
      </div>
      <ErrorNote text={err} />
      <div className="panel">
        <table className="tab">
          <thead><tr>
            <th>КП</th><th>Клиент</th><th>Изделия</th><th className="num">Итого</th><th>Статус</th><th>Вопрос клиента</th>
            {many && <th>Менеджер</th>}<th>Отправлено</th><th>Действует до</th>
          </tr></thead>
          <tbody>
            {list?.map((k) => (
              <tr key={k.id} className="click" onClick={() => nav(`/kp/${k.id}`)}>
                <td className="nowrap"><Link to={`/kp/${k.id}`} onClick={(e) => e.stopPropagation()}>{k.number}</Link>{k.version > 1 && <span className="ver">версия {k.version}</span>}</td>
                <td><Link to={`/clients/${k.clientId}`} onClick={(e) => e.stopPropagation()}>{k.clientName}</Link></td>
                <td className="wrap">{k.items.join(', ')}</td>
                <td className="num">{rub(k.total, roundTo)}</td>
                <td>
                  <span className={`pill st-${k.state}`}>{KP_STATE_TITLES[k.state]}</span>
                  {k.views > 0 && <span className="sub">открыто {k.views} раз · {dateTime(k.lastViewedAt)}</span>}
                </td>
                <td className="wrap">{k.lastQuestion
                  ? <><span className="q">«{k.lastQuestion}»</span><span className="sub">{dateTime(k.lastQuestionAt)}{k.questions > 1 ? ` · всего вопросов ${k.questions}` : ''}</span></>
                  : '—'}</td>
                {many && <td>{k.managerName}<span className="sub">{k.cityName}</span></td>}
                <td>{k.sentAt ? dateTime(k.sentAt) : '—'}</td>
                <td>{dmy(k.validUntil)}</td>
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
