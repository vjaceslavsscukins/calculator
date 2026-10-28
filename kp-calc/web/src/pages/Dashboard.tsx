// Приборная панель владельца и руководителя: воронка за период (расчёты → КП → отправлено → открыто → утверждено),
// суммы, маржа, менеджеры и что требует внимания. Все суммы приходят с сервера.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, KP_STATE_TITLES, type Dashboard } from '../api.ts';
import { useApp } from '../app.tsx';
import { ErrorNote } from '../components/Layout.tsx';
import { errText, rub } from '../format.ts';

const iso = (d: Date) => d.toISOString().slice(0, 10);
function presets() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  return [
    { id: 'month', title: 'Этот месяц', from: iso(new Date(Date.UTC(y, m, 1))), to: iso(now) },
    { id: 'prev', title: 'Прошлый месяц', from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) },
    { id: 'q', title: '90 дней', from: iso(new Date(Date.now() - 89 * 86400_000)), to: iso(now) },
    { id: 'year', title: 'С начала года', from: `${y}-01-01`, to: iso(now) },
  ];
}
const pct = (n: number | null) => (n == null ? '—' : `${n} %`);

export function DashboardPage() {
  const nav = useNavigate();
  const { roundTo } = useApp();
  const P = presets();
  const [range, setRange] = useState({ from: P[0].from, to: P[0].to });
  const [d, setD] = useState<Dashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.dashboard(range.from, range.to).then((r) => { setD(r); setErr(null); }).catch((x) => setErr(errText(x)));
  }, [range.from, range.to]);

  const t = d?.totals;
  const funnel = t ? [
    { label: 'Расчётов', n: t.calcs, sub: rub(t.calcSum, roundTo) },
    { label: 'КП собрано', n: t.kps },
    { label: 'Отправлено', n: t.sent, sub: rub(t.sentSum, roundTo) },
    { label: 'Открыто клиентом', n: t.opened, sub: pct(t.openRate) + ' от отправленных' },
    { label: 'Утверждено', n: t.approved, sub: `${rub(t.approvedSum, roundTo)} · ${pct(t.approveRate)}` },
  ] : [];
  const max = Math.max(1, ...funnel.map((f) => f.n));

  return (
    <section className="view">
      <div className="head">
        <div><div className="eyebrow">Руководителю</div><h1>Панель</h1></div>
        <div className="actions">
          <span className="seg big" role="group" aria-label="Период">
            {P.map((p) => <button key={p.id} type="button" aria-pressed={range.from === p.from && range.to === p.to} onClick={() => setRange({ from: p.from, to: p.to })}>{p.title}</button>)}
          </span>
          <label className="field">С<input type="date" value={range.from} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} /></label>
          <label className="field">По<input type="date" value={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} /></label>
        </div>
      </div>
      <ErrorNote text={err} />
      {!d && !err && <p className="foot">Загружаем…</p>}
      {d && t && (
        <>
          <div className="tiles">
            <div className="tile"><span>Отправлено КП на сумму</span><b>{rub(t.sentSum, roundTo)}</b><small>{t.sent} КП · средний чек {rub(t.avgCheck, roundTo)}</small></div>
            <div className="tile"><span>Утверждено клиентами</span><b>{rub(t.approvedSum, roundTo)}</b><small>{t.approved} КП · {pct(t.approveRate)} от отправленных</small></div>
            <div className="tile"><span>Маржа в расчётах периода</span><b>{rub(t.margin, roundTo)}</b><small>{t.calcs} расчётов на {rub(t.calcSum, roundTo)}</small></div>
            <div className="tile"><span>Вопросов от клиентов</span><b>{t.questions}</b><small>открыто клиентом {pct(t.openRate)} отправленных КП</small></div>
          </div>

          <div className="dash-grid">
            <div className="panel">
              <h2>Воронка</h2>
              <div className="funnel">
                {funnel.map((f) => (
                  <div className="fn-row" key={f.label}>
                    <span className="fn-label">{f.label}</span>
                    <span className="fn-bar"><i style={{ width: `${Math.max(2, (f.n / max) * 100)}%` }} /></span>
                    <b className="fn-n">{f.n}</b>
                    <span className="fn-sub">{f.sub ?? ''}</span>
                  </div>
                ))}
              </div>
              <p className="note">Расчёты — созданные за период; КП — собранные за период и что с ними стало.</p>
            </div>

            <div className="panel">
              <h2>Требует внимания</h2>
              <table className="tab">
                <tbody>
                  {d.attention.map((k) => (
                    <tr key={`${k.id}-${k.reason}`} className="click" onClick={() => nav(`/kp/${k.id}`)}>
                      <td className="nowrap"><Link to={`/kp/${k.id}`} onClick={(e) => e.stopPropagation()}>{k.number}</Link></td>
                      <td>{k.clientName}<span className="sub">{k.managerName}</span></td>
                      <td className="wrap">{k.reason}{k.state === 'question' && k.lastQuestion && <span className="sub">«{k.lastQuestion}»</span>}</td>
                      <td className="num">{rub(k.total, roundTo)}</td>
                    </tr>
                  ))}
                  {!d.attention.length && <tr><td className="empty">Всё в порядке: вопросов и зависших КП нет.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h2>Менеджеры</h2>
            <table className="tab">
              <thead><tr>
                <th>Менеджер</th><th className="num">Расчётов</th><th className="num">Маржа</th><th className="num">КП</th><th className="num">Отправлено</th>
                <th className="num">Открыто</th><th className="num">Утверждено</th><th className="num">Сумма отправленных</th><th className="num">Сумма утверждённых</th><th className="num">Вопросов</th>
              </tr></thead>
              <tbody>
                {d.managers.map((m) => (
                  <tr key={m.managerId}>
                    <td>{m.managerName}</td><td className="num">{m.calcs}</td><td className="num">{rub(m.margin, roundTo)}</td><td className="num">{m.kps}</td>
                    <td className="num">{m.sent}</td><td className="num">{m.opened}</td><td className="num">{m.approved}</td>
                    <td className="num">{rub(m.sentSum, roundTo)}</td><td className="num">{rub(m.approvedSum, roundTo)}</td><td className="num">{m.questions}</td>
                  </tr>
                ))}
                {!d.managers.length && <tr><td colSpan={10} className="empty">За период ничего нет.</td></tr>}
              </tbody>
            </table>
            <p className="note">Статусы КП: {Object.values(KP_STATE_TITLES).join(' · ')}. Полный список — в разделе <Link to="/kps">КП</Link>.</p>
          </div>
        </>
      )}
    </section>
  );
}
