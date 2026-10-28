// Спецификация к договору (Приложение №2): черновик из расчёта, правка всех полей, сохранение снимком, печать A4.
// Стоимость приходит с сервера (движок), интерфейс её не считает.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.ts';
import type { SpecData, SpecHeader, SpecResponse } from '../api.ts';
import { useApp } from '../app.tsx';
import { ErrorNote } from '../components/Layout.tsx';
import { dateTime, errText, rub } from '../format.ts';

const HEADER: { key: keyof SpecHeader; label: string; required?: boolean; type?: string; wide?: boolean }[] = [
  { key: 'contractNo', label: 'Номер договора', required: true },
  { key: 'contractDate', label: 'Дата договора', required: true, type: 'date' },
  { key: 'clientName', label: 'ФИО клиента', required: true, wide: true },
  { key: 'clientPhone', label: 'Телефон клиента' },
  { key: 'address', label: 'Адрес объекта', required: true, wide: true },
  { key: 'designer', label: 'Дизайнер (менеджер)' },
];

const ruDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('.') : iso);

export function SpecPage() {
  const { id = '' } = useParams();
  const { roundTo } = useApp();
  const [res, setRes] = useState<SpecResponse | null>(null);
  const [data, setData] = useState<SpecData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    api.spec(id).then((r) => { setRes(r); setData(r.spec?.data ?? r.draft); }).catch((x) => setErr(errText(x)));
  }, [id]);

  const missing = useMemo(() => HEADER.filter((f) => f.required && !data?.header[f.key]?.trim()).map((f) => f.label), [data]);

  if (!res || !data) return <section className="view"><ErrorNote text={err} />{!err && <p className="lead">Загружаем…</p>}</section>;

  const edit = (fn: (d: SpecData) => SpecData) => { setData((d) => (d ? fn(d) : d)); setDirty(true); setMsg(null); };
  const setHeader = (k: keyof SpecHeader, v: string) => edit((d) => ({ ...d, header: { ...d.header, [k]: v } }));
  const setField = (si: number, fi: number, p: { label?: string; value?: string }) =>
    edit((d) => ({ ...d, sections: d.sections.map((s, i) => (i !== si ? s : { ...s, fields: s.fields.map((f, j) => (j !== fi ? f : { ...f, ...p })) })) }));
  const addField = (si: number) => edit((d) => ({ ...d, sections: d.sections.map((s, i) => (i !== si ? s : { ...s, fields: [...s.fields, { label: '', value: '' }] })) }));
  const delField = (si: number, fi: number) => edit((d) => ({ ...d, sections: d.sections.map((s, i) => (i !== si ? s : { ...s, fields: s.fields.filter((_, j) => j !== fi) })) }));

  /** Материалы и стоимость — заново из расчёта; шапка (договор, клиент, адрес) остаётся. */
  const fromCalc = () => {
    if (!confirm('Заменить разделы материалов и фурнитуры данными из расчёта? Шапка и примечание останутся, ручные правки в разделах пропадут.')) return;
    edit((d) => ({ ...res.draft, header: d.header, note: d.note, terms: d.terms }));
    setRefresh(true);
  };

  const save = async () => {
    setTried(true);
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api.saveSpec(id, { rev: res.spec?.rev ?? 0, data, refreshTotal: refresh });
      setRes(r); setData(r.spec!.data); setDirty(false); setRefresh(false);
      setMsg(`Спецификация сохранена · ${dateTime(r.spec!.updatedAt)}`);
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };

  const print = () => {
    setTried(true);
    if (missing.length) { setErr(`Перед печатью заполните: ${missing.join(', ')}.`); return; }
    if (dirty) { setErr('Сначала сохраните спецификацию — печатается сохранённый вариант.'); return; }
    window.print();
  };

  const total = res.spec?.total ?? res.calcTotal;
  const totalDiffers = !!res.spec && Math.round(res.spec.total) !== Math.round(res.calcTotal);
  const c = res.calculation;

  return (
    <section className="view spec-view">
      <div className="no-print">
        <div className="crumbs"><Link to={`/clients/${c.clientId}`}>{c.clientName}</Link> / <Link to={`/calculations/${c.id}`}>{c.title}</Link> / <b>Спецификация</b></div>
        <div className="head">
          <div><div className="eyebrow">Документы · Приложение №2 к договору</div><h1>Спецификация</h1></div>
          <div className="actions">
            <button className="btn" type="button" onClick={fromCalc}>Обновить из расчёта</button>
            <button className="btn" type="button" onClick={print}>Печать / PDF</button>
            <button className="btn solid" type="button" disabled={busy || (!dirty && !!res.spec)} onClick={save}>
              {busy ? 'Сохраняю…' : !dirty && res.spec ? 'Сохранено ✓' : 'Сохранить спецификацию'}
            </button>
          </div>
        </div>
        <ErrorNote text={err} />
        {msg && <div className="ok" role="status">{msg}</div>}
        {!res.spec && <div className="ok">Черновик заполнен из расчёта. Проверьте, допишите и сохраните.</div>}
        {totalDiffers && <div className="err">Расчёт изменился: сейчас {rub(res.calcTotal, roundTo)}, в спецификации {rub(res.spec!.total, roundTo)}. Чтобы взять новую стоимость, нажмите «Обновить из расчёта» и сохраните.</div>}

        <div className="box">
          <h2>Шапка</h2>
          <div className="spec-head">
            {HEADER.map((f) => {
              const bad = tried && f.required && !data.header[f.key]?.trim();
              return (
                <label key={f.key} className={`field${f.wide ? ' wide' : ''}${bad ? ' bad' : ''}`}>
                  <span>{f.label}{f.required && <b className="req"> *</b>}</span>
                  <input type={f.type ?? 'text'} value={data.header[f.key]} onChange={(e) => setHeader(f.key, e.target.value)} aria-required={f.required} />
                </label>
              );
            })}
            <label className="field wide"><span>Изделие</span>
              <input value={data.title} onChange={(e) => edit((d) => ({ ...d, title: e.target.value }))} />
            </label>
          </div>
          <p className="foot">* обязательно перед печатью. Номер договора пока вписывается вручную.</p>
        </div>

        {data.sections.map((s, si) => (
          <div className="box" key={si}>
            <h2>{s.title}</h2>
            <div className="spec-fields">
              {s.fields.map((f, fi) => (
                <div className="spec-field" key={fi}>
                  <input className="in" aria-label="Название поля" value={f.label} placeholder="Название" onChange={(e) => setField(si, fi, { label: e.target.value })} />
                  <textarea className="in" aria-label={f.label || 'Значение'} rows={1} value={f.value} placeholder="—" onChange={(e) => setField(si, fi, { value: e.target.value })} />
                  <button className="x" type="button" aria-label="Удалить строку" onClick={() => delField(si, fi)}>×</button>
                </div>
              ))}
            </div>
            <div><button className="link" type="button" onClick={() => addField(si)}>+ строка</button></div>
          </div>
        ))}

        <div className="box">
          <h2>Примечание и условия</h2>
          <label className="field">Примечание (всё, что не вошло в разделы)
            <textarea className="in" rows={3} value={data.note} onChange={(e) => edit((d) => ({ ...d, note: e.target.value }))} />
          </label>
          <label className="field">Условия
            <textarea className="in" rows={3} value={data.terms} onChange={(e) => edit((d) => ({ ...d, terms: e.target.value }))} />
          </label>
          <p className="lead">Стоимость товара: <b>{rub(total, roundTo)}</b>{res.spec ? ' — зафиксирована при сохранении' : ' — из расчёта'}</p>
          {res.spec && <p className="foot">Сохранил {res.spec.updatedBy || '—'}, {dateTime(res.spec.updatedAt)}</p>}
        </div>
      </div>

      <SpecPrint data={data} total={total} roundTo={roundTo} />
    </section>
  );
}

/** Лист A4 для печати: виден только при печати. */
function SpecPrint({ data, total, roundTo }: { data: SpecData; total: number; roundTo: number }) {
  const h = data.header;
  return (
    <article className="spec-print" aria-hidden="true">
      <header className="sp-top">
        <img src="/logo/cultura-group-logo-gray.svg" alt="cultura group" />
        <div>
          <div className="sp-eyebrow">Приложение №2</div>
          <div className="sp-sub">к договору оказания услуг по изготовлению под заказ корпусной мебели № {h.contractNo || '____'} от {ruDate(h.contractDate) || '__.__.____'}</div>
        </div>
      </header>
      <h1 className="sp-title">Спецификация{data.title ? ` · ${data.title}` : ''}</h1>
      <table className="sp-meta"><tbody>
        <tr><th>Заказчик</th><td>{h.clientName}</td><th>Телефон</th><td>{h.clientPhone}</td></tr>
        <tr><th>Адрес объекта</th><td>{h.address}</td><th>Дизайнер</th><td>{h.designer}</td></tr>
      </tbody></table>
      {data.sections.map((s, i) => (
        <section key={i} className="sp-sec">
          <h2>{s.title}</h2>
          <table><tbody>
            {s.fields.filter((f) => f.label.trim() || f.value.trim()).map((f, j) => <tr key={j}><th>{f.label}</th><td>{f.value || '—'}</td></tr>)}
          </tbody></table>
        </section>
      ))}
      {data.note.trim() && <section className="sp-sec"><h2>Примечание</h2><p>{data.note}</p></section>}
      <p className="sp-terms">{data.terms}</p>
      <div className="sp-total"><span>Стоимость товара</span><b>{rub(total, roundTo)}</b></div>
      <div className="sp-sign">
        <div>Со спецификацией согласен<span className="line" />Заказчик / {h.clientName}</div>
        <div>Исполнитель<span className="line" />CULTURA GROUP</div>
      </div>
    </article>
  );
}
