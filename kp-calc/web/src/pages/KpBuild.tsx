// «Собрать КП»: слева расчёты клиента (галочки и порядок), в центре изделия (название, габариты или состав, картинка,
// «Об изделии», «Материалы и комплектация», плашки), справа параметры и итог. Суммы — только с сервера (движок).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, STATUS_TITLES, type KpDraft, type KpDraftItem, type KpItemBody, type KpItemPrice, type KpMaterial, type KpTotals } from '../api.ts';
import { useApp } from '../app.tsx';
import { ErrorNote } from '../components/Layout.tsx';
import { errText, num, rub } from '../format.ts';

interface Edit { title: string; h: string; l: string; d: string; composition: string; about: string; aboutNote: string | null; materials: KpMaterial[]; benefits: string[]; imageId: string | null }

const DIMS = /Высота\s+(\d+)\s*мм\s*·\s*длина\s+(\d+)\s*мм\s*·\s*глубина\s+(\d+)\s*мм/i;

function editOf(it: KpDraftItem, base?: KpDraft['base']): Edit {
  const b = base?.items.find((x) => x.calculationId === it.calculationId);
  const dims = b?.dims ?? it.dims;
  const m = DIMS.exec(dims);
  return {
    title: b?.title ?? it.title,
    h: m?.[1] ?? '', l: m?.[2] ?? '', d: m?.[3] ?? '', composition: m ? '' : dims,
    about: b?.about ?? it.about, aboutNote: null,
    materials: (b?.materials ?? it.materials).map((x) => ({ ...x })),
    benefits: [...(b?.benefits ?? it.benefits)],
    imageId: b ? b.imageId : it.imageId,
  };
}
const dimsOf = (e: Edit) => e.composition.trim()
  || (e.h || e.l || e.d ? [e.h && `Высота ${e.h} мм`, e.l && `длина ${e.l} мм`, e.d && `глубина ${e.d} мм`].filter(Boolean).join(' · ') : '');

export function KpBuildPage() {
  const { id = '' } = useParams();
  const [q] = useSearchParams();
  const nav = useNavigate();
  const { roundTo } = useApp();
  const [draft, setDraft] = useState<KpDraft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [validUntil, setValidUntil] = useState('');
  const [preview, setPreview] = useState<{ items: { calculationId: string; price: KpItemPrice }[]; totals: KpTotals } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const base = q.get('base') ?? undefined;

  useEffect(() => {
    api.kpDraft(id, base).then((d) => {
      setDraft(d);
      setValidUntil(d.validUntil);
      const e: Record<string, Edit> = {};
      for (const it of d.items) e[it.calculationId] = editOf(it, d.base);
      setEdits(e);
      const ids = new Set(d.items.map((x) => x.calculationId));
      const calc = q.get('calc');
      if (d.base) { setSelected(d.base.items.map((x) => x.calculationId).filter((x) => ids.has(x))); setTheme(d.base.theme); }
      else if (calc && ids.has(calc)) setSelected([calc]);
      else setSelected(d.items.map((x) => x.calculationId));
    }).catch((x) => setErr(errText(x)));
  }, [id, base]); // eslint-disable-line react-hooks/exhaustive-deps

  const key = selected.join(',');
  useEffect(() => {
    if (!draft || !selected.length) { setPreview(null); return; }
    let live = true;
    api.kpPreview(id, selected).then((r) => { if (live) setPreview(r); }).catch((x) => { if (live) setFormErr(errText(x)); });
    return () => { live = false; };
  }, [key, draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(draft?.items.map((x) => [x.calculationId, x]) ?? []), [draft]);
  if (err) return <section className="view"><div className="crumbs"><Link to={`/clients/${id}`}>Клиент</Link></div><ErrorNote text={err} /></section>;
  if (!draft) return <section className="view"><p className="foot">Загружаем расчёты клиента…</p></section>;

  const setEdit = (cid: string, p: Partial<Edit>) => setEdits((e) => ({ ...e, [cid]: { ...e[cid], ...p } }));
  const toggle = (cid: string) => setSelected((s) => (s.includes(cid) ? s.filter((x) => x !== cid) : [...s, cid]));
  const move = (cid: string, dir: -1 | 1) => setSelected((s) => {
    const i = s.indexOf(cid), j = i + dir;
    if (i < 0 || j < 0 || j >= s.length) return s;
    const n = [...s]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });

  const form = async () => {
    setFormErr(null);
    if (!selected.length) { setFormErr('Отметьте хотя бы один расчёт.'); return; }
    const empty = selected.find((cid) => !edits[cid].title.trim());
    if (empty) { setFormErr(`Укажите название изделия для «${byId.get(empty)?.calcTitle}».`); return; }
    setBusy(true);
    try {
      const items: KpItemBody[] = selected.map((cid) => {
        const e = edits[cid];
        return {
          calculationId: cid, title: e.title.trim(), dims: dimsOf(e), about: e.about.trim(),
          materials: e.materials.filter((m) => m.role.trim() || m.value.trim()), benefits: e.benefits.map((b) => b.trim()).filter(Boolean), imageId: e.imageId,
        };
      });
      const r = await api.createKp({ clientId: id, ...(draft.base ? { baseKpId: draft.base.id } : {}), theme, validUntil, items });
      nav(`/kp/${r.kp.id}`);
    } catch (x) { setFormErr(errText(x)); setBusy(false); }
  };

  const t = preview?.totals;
  return (
    <section className="view">
      <div className="crumbs"><Link to="/clients">Клиенты</Link> / <Link to={`/clients/${id}`}><b>{draft.client.name}</b></Link> / Собрать КП</div>
      <div className="head">
        <div><div className="eyebrow">{draft.base ? `Новая версия ${draft.base.number}` : 'Коммерческое предложение'}</div><h1>Собрать КП</h1></div>
      </div>
      <div className="kpb">
        <aside className="box kpb-list" aria-label="Расчёты клиента">
          <h2>Расчёты</h2>
          <p className="note">Отметьте изделия для КП. Порядок — стрелками.</p>
          {[...selected.map((cid) => byId.get(cid)!).filter(Boolean), ...draft.items.filter((x) => !selected.includes(x.calculationId))].map((it) => {
            const on = selected.includes(it.calculationId);
            return (
              <div className={`kpb-calc${on ? ' on' : ''}`} key={it.calculationId}>
                <label className="check"><input type="checkbox" checked={on} onChange={() => toggle(it.calculationId)} />
                  <span><b>{it.calcTitle}</b><small>{STATUS_TITLES[it.status]} · {rub(it.price.total, roundTo)}</small></span>
                </label>
                {on && (
                  <span className="ord">
                    <button className="x" type="button" aria-label="Выше" onClick={() => move(it.calculationId, -1)}>↑</button>
                    <button className="x" type="button" aria-label="Ниже" onClick={() => move(it.calculationId, 1)}>↓</button>
                  </span>
                )}
              </div>
            );
          })}
          {!draft.items.length && <p className="note">У клиента нет расчётов.</p>}
        </aside>

        <div className="kpb-items">
          {!selected.length && <div className="panel"><p className="note">Отметьте расчёт слева — здесь появится изделие для КП.</p></div>}
          {selected.map((cid, i) => {
            const it = byId.get(cid);
            if (!it) return null;
            return <ItemEditor key={cid} n={i + 1} it={it} e={edits[cid]} roundTo={roundTo} aiText={draft.aiText}
              price={preview?.items.find((x) => x.calculationId === cid)?.price ?? it.price} onChange={(p) => setEdit(cid, p)} />;
          })}
        </div>

        <aside className="totals kpb-side" aria-label="Параметры КП">
          <h2>Параметры</h2>
          <label className="field">Действует до<input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></label>
          <div className="field">Вид страницы
            <span className="seg" role="group" aria-label="Вид страницы КП">
              <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Тёмный</button>
              <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Светлый</button>
            </span>
          </div>
          <div className="hr" />
          <h2>Итог КП</h2>
          {t ? (
            <>
              {preview!.items.map((x) => <div className="trow small" key={x.calculationId}><span>{edits[x.calculationId]?.title || byId.get(x.calculationId)?.calcTitle}</span><b>{rub(x.price.retail, roundTo)}</b></div>)}
              <div className="trow"><span>Изделия</span><b>{rub(t.goods, roundTo)}</b></div>
              {t.discount > 0 && <div className="trow"><span>Скидка{t.discountPct != null ? ` ${num(t.discountPct)} %` : ''}<em>как в расчётах</em></span><b>−{rub(t.discount, roundTo)}</b></div>}
              {t.discount > 0 && <div className="trow"><span>Мебель со скидкой</span><b>{rub(t.furniture, roundTo)}</b></div>}
              <div className="trow"><span>Монтаж</span><b>{rub(t.montage, roundTo)}</b></div>
              <div className="trow"><span>Доставка</span><b>{rub(t.delivery, roundTo)}</b></div>
              <div className="total"><span>Итого клиенту</span><b>{rub(t.total, roundTo)}</b></div>
            </>
          ) : <p className="foot">Отметьте расчёты — здесь появится итог.</p>}
          <ErrorNote text={formErr} />
          <button className="btn solid" type="button" onClick={form} disabled={busy || !selected.length}>{busy ? 'Формируем…' : 'Сформировать КП'}</button>
          <p className="foot">После формирования цены, тексты и картинки КП фиксируются. Правка — новой версией.</p>
        </aside>
      </div>
    </section>
  );
}

function ItemEditor({ n, it, e, price, roundTo, aiText, onChange }: {
  n: number; it: KpDraftItem; e: Edit; price: KpItemPrice; roundTo: number; aiText: boolean; onChange: (p: Partial<Edit>) => void;
}) {
  const [writing, setWriting] = useState(false);
  const write = async () => {
    setWriting(true);
    try {
      const r = await api.kpText(it.calculationId, { title: e.title, dims: dimsOf(e), materials: e.materials, benefits: e.benefits });
      onChange({ about: r.text, aboutNote: r.note ?? (r.source === 'ai' ? 'Текст написала нейросеть по расчёту — проверьте и поправьте.' : null) });
    } catch (x) { onChange({ aboutNote: errText(x) }); } finally { setWriting(false); }
  };
  const setMat = (k: number, p: Partial<KpMaterial>) => onChange({ materials: e.materials.map((m, j) => (j === k ? { ...m, ...p } : m)) });
  return (
    <section className="panel kpb-item" aria-label={`Изделие ${n}`}>
      <div className="kpb-item-head">
        <div className="eyebrow dark">Изделие {String(n).padStart(2, '0')} · расчёт «{it.calcTitle}»</div>
        <div className="kpb-price">
          {price.discount > 0 && <s>{rub(price.retail, roundTo)}</s>}<b>{rub(price.price, roundTo)}</b>
          {price.discount > 0 && <em>скидка {num(price.discountPct)} %</em>}
        </div>
      </div>
      <div className="kpb-grid">
        <label className="kf wide">Название изделия<input className="in" value={e.title} onChange={(x) => onChange({ title: x.target.value })} placeholder="Кухня с островом" /></label>
        <div className="kf wide">Габариты, мм <em>или состав</em>
          <div className="dims">
            <input className="in" inputMode="numeric" aria-label="Высота, мм" placeholder="высота" value={e.h} onChange={(x) => onChange({ h: x.target.value.replace(/\D/g, '') })} />
            <span>·</span>
            <input className="in" inputMode="numeric" aria-label="Длина, мм" placeholder="длина" value={e.l} onChange={(x) => onChange({ l: x.target.value.replace(/\D/g, '') })} />
            <span>·</span>
            <input className="in" inputMode="numeric" aria-label="Глубина, мм" placeholder="глубина" value={e.d} onChange={(x) => onChange({ d: x.target.value.replace(/\D/g, '') })} />
            <span>или</span>
            <input className="in comp" aria-label="Состав" placeholder="Шкаф · комод · открытая полка" value={e.composition} onChange={(x) => onChange({ composition: x.target.value })} />
          </div>
        </div>
      </div>

      <div className="kf">Картинка в КП</div>
      <div className="pick">
        <button type="button" className={`pick-none${e.imageId ? '' : ' on'}`} onClick={() => onChange({ imageId: null })}>Без картинки</button>
        {it.images.map((img) => (
          <button type="button" key={img.id} className={`pick-img${e.imageId === img.id ? ' on' : ''}`} onClick={() => onChange({ imageId: img.id })} aria-pressed={e.imageId === img.id} title={img.title}>
            <img src={img.url} alt={img.title} loading="lazy" /><span>{img.title}{img.inKp ? ' · в КП' : ''}</span>
          </button>
        ))}
        {!it.images.length && <span className="note">В расчёте нет картинок: загрузите эскиз на экране расчёта.</span>}
      </div>

      <div className="kf kf-row">Об изделии
        <button className="btn small dark" type="button" onClick={write} disabled={writing}>{writing ? 'Пишем…' : 'Написать текст'}</button>
        {!aiText && <span className="note">нейросеть не подключена — шаблон по материалам</span>}
      </div>
      <textarea className="in area" value={e.about} onChange={(x) => onChange({ about: x.target.value })} placeholder="3–4 предложения на «вы»: что даёт клиенту это изделие. Факты, без эпитетов." />
      {e.aboutNote && <span className="sub">{e.aboutNote}</span>}

      <div className="kf kf-row">Материалы и комплектация
        <button className="link" type="button" onClick={() => onChange({ materials: it.materials.map((m) => ({ ...m })) })}>собрать заново из расчёта</button>
      </div>
      <div className="mats">
        {e.materials.map((m, k) => (
          <div className="mat-row" key={k}>
            <input className="in" aria-label="Роль" value={m.role} onChange={(x) => setMat(k, { role: x.target.value })} />
            <input className="in" aria-label="Материал" value={m.value} onChange={(x) => setMat(k, { value: x.target.value })} />
            <button className="x" type="button" aria-label="Убрать строку" onClick={() => onChange({ materials: e.materials.filter((_, j) => j !== k) })}>×</button>
          </div>
        ))}
        <button className="link" type="button" onClick={() => onChange({ materials: [...e.materials, { role: '', value: '' }] })}>+ строка</button>
      </div>

      <div className="kf">Плашки «что вы получаете»</div>
      <div className="chips">
        {e.benefits.map((b, k) => (
          <span className="chip" key={k}>
            <input className="in" aria-label="Плашка" value={b} onChange={(x) => onChange({ benefits: e.benefits.map((v, j) => (j === k ? x.target.value : v)) })} />
            <button className="x" type="button" aria-label="Убрать плашку" onClick={() => onChange({ benefits: e.benefits.filter((_, j) => j !== k) })}>×</button>
          </span>
        ))}
        {e.benefits.length < 8 && <button className="link" type="button" onClick={() => onChange({ benefits: [...e.benefits, ''] })}>+ плашка</button>}
      </div>
    </section>
  );
}
