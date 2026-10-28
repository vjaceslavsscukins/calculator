// Экран расчёта «как в Excel»: блоки-таблицы, справа итоги. Макет — mockups/presentation.html, вкладка «Расчёт».
// Суммы берутся только из view сервера (POST /api/compute для мгновенного отклика, PUT — сохранение).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  api, ApiError, seesCost, STATUS_TITLES,
  type BlockDef, type CalcInput, type Calculation, type CatalogGroupView, type CatalogView, type Pro100Line, type Row, type Status, type View, type ViewRow,
} from '../api.ts';
import { useApp } from '../app.tsx';
import { ErrorNote } from '../components/Layout.tsx';
import { NumInput } from '../components/NumInput.tsx';
import { errText, num, rub, rubUnit, time } from '../format.ts';

interface Doc { title: string; status: Status; input: CalcInput; unparsed: Pro100Line[] }
type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
interface Conflict { rev: number; updatedAt?: string; updatedBy?: string }

const newId = () => {
  try { return crypto.randomUUID(); } catch { return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; }
};

function docOf(c: Calculation): Doc {
  const input: CalcInput = {
    kind: c.input?.kind ?? c.kind,
    rows: c.input?.rows ?? [],
    light: c.input?.light ?? { enabled: false, profileId: '', segments: [] },
    discountPct: c.input?.discountPct ?? 0,
  };
  return { title: c.title, status: c.status, input, unparsed: c.unparsed ?? [] };
}

/** Группы прайса, из которых можно выбирать в блоке (BLOCKS движка: категории и отдельные группы фурнитуры). */
function groupsFor(block: BlockDef | undefined, catalog: CatalogView | null): CatalogGroupView[] {
  if (!block || !catalog) return [];
  return catalog.groups.filter((g) => block.categories.includes(g.category) || (g.category === 'Фурнитура' && block.fittingGroups?.includes(g.name)));
}

export function CalculationPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { user, meta, settings, roundTo } = useApp();
  const boss = seesCost(user);

  const [calc, setCalc] = useState<Calculation | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [catalog, setCatalog] = useState<CatalogView | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [computeErr, setComputeErr] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [busyCopy, setBusyCopy] = useState(false);

  const docRef = useRef<Doc | null>(null);
  const revRef = useRef(0);
  const verRef = useRef(0); // номер правки
  const savedVerRef = useRef(0); // правка, которая уже на сервере
  const savingRef = useRef(false);
  const againRef = useRef(false);
  const conflictRef = useRef<Conflict | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const computeTimer = useRef<ReturnType<typeof setTimeout>>();
  const computeSeq = useRef(0);

  const load = useCallback(async () => {
    const r = await api.calculation(id);
    setCalc(r.calculation);
    const d = docOf(r.calculation);
    setDoc(d); docRef.current = d;
    setView(r.view);
    revRef.current = r.calculation.rev;
    savedVerRef.current = verRef.current;
    setSaveState('saved'); setSaveErr(null);
    setSavedAt(r.calculation.updatedAt ? new Date(r.calculation.updatedAt) : null);
  }, [id]);

  useEffect(() => {
    setLoadErr(null); setCalc(null); setDoc(null); setView(null); setConflict(null); conflictRef.current = null;
    load().catch((x) => setLoadErr(errText(x)));
    api.catalog().then(setCatalog).catch((x) => setLoadErr(errText(x)));
  }, [load]);

  const save = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const d = docRef.current;
    if (!d || conflictRef.current) return;
    if (savingRef.current) { againRef.current = true; return; }
    savingRef.current = true;
    let failed = false;
    const ver = verRef.current;
    setSaveState('saving');
    try {
      const r = await api.saveCalculation(id, { rev: revRef.current, title: d.title, status: d.status, input: d.input, unparsed: d.unparsed });
      revRef.current = r.calculation.rev;
      setCalc(r.calculation);
      savedVerRef.current = ver;
      setSavedAt(new Date());
      setSaveErr(null);
      if (ver === verRef.current) { setView(r.view); setSaveState('saved'); } else setSaveState('dirty');
    } catch (x) {
      if (x instanceof ApiError && x.status === 409) {
        const c: Conflict = { rev: Number(x.body.rev), updatedAt: x.body.updatedAt as string | undefined, updatedBy: x.body.updatedBy as string | undefined };
        conflictRef.current = c; setConflict(c);
        setSaveState('dirty');
      } else {
        failed = true;
        setSaveState('error'); setSaveErr(errText(x));
      }
    } finally {
      savingRef.current = false;
      // после ошибки сети повторяем только по новой правке, чтобы не долбить сервер
      if (!conflictRef.current && (againRef.current || (!failed && verRef.current !== savedVerRef.current))) {
        againRef.current = false;
        saveTimer.current = setTimeout(save, 400);
      }
    }
  }, [id]);

  /** Любая правка: локально, затем мгновенный пересчёт и автосохранение через ~1,5 с. */
  const edit = useCallback((fn: (d: Doc) => Doc) => {
    const cur = docRef.current;
    if (!cur) return;
    const next = fn(cur);
    docRef.current = next;
    setDoc(next);
    verRef.current += 1;
    setSaveState('dirty');
    clearTimeout(computeTimer.current);
    const seq = ++computeSeq.current;
    computeTimer.current = setTimeout(() => {
      api.compute(next.input).then((r) => { if (seq === computeSeq.current) { setView(r.view); setComputeErr(null); } })
        .catch((x) => { if (seq === computeSeq.current) setComputeErr(errText(x)); });
    }, 250);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 1500);
  }, [save]);

  const editInput = useCallback((fn: (i: CalcInput) => CalcInput) => edit((d) => ({ ...d, input: fn(d.input) })), [edit]);
  const editRow = useCallback((rowId: string, patch: Partial<Row>) =>
    editInput((i) => ({ ...i, rows: i.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)) })), [editInput]);

  // несохранённые правки — предупредить при закрытии вкладки, отправить при уходе со страницы
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (verRef.current !== savedVerRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => {
      window.removeEventListener('beforeunload', h);
      clearTimeout(computeTimer.current);
      if (verRef.current !== savedVerRef.current && !conflictRef.current && docRef.current) {
        clearTimeout(saveTimer.current);
        const d = docRef.current;
        api.saveCalculation(id, { rev: revRef.current, title: d.title, status: d.status, input: d.input, unparsed: d.unparsed }).catch(() => {});
      }
    };
  }, [id]);

  const takeTheirs = async () => {
    try {
      conflictRef.current = null; setConflict(null);
      clearTimeout(saveTimer.current);
      await load();
    } catch (x) { setSaveErr(errText(x)); }
  };
  const overwrite = () => {
    if (!conflict) return;
    revRef.current = conflict.rev;
    conflictRef.current = null; setConflict(null);
    save();
  };

  const saveNow = () => {
    if (doc?.status === 'draft') edit((d) => ({ ...d, status: 'saved' }));
    save();
  };

  const copy = async () => {
    setBusyCopy(true);
    try {
      if (verRef.current !== savedVerRef.current) await save();
      const r = await api.copyCalculation(id);
      nav(`/calculations/${r.calculation.id}`);
    } catch (x) { setSaveErr(errText(x)); } finally { setBusyCopy(false); }
  };

  const blocks = useMemo(() => (doc ? meta?.blocks?.[doc.input.kind] ?? [] : []), [meta, doc?.input.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewById = useMemo(() => {
    const m = new Map<string, ViewRow>();
    for (const r of view?.rows ?? []) if (r.id) m.set(r.id, r);
    return m;
  }, [view]);

  if (loadErr && !doc) return <section className="view"><div className="crumbs"><Link to="/calculations">Расчёты</Link></div><ErrorNote text={loadErr} /></section>;
  if (!doc || !calc) return <section className="view"><p className="foot">Загружаем расчёт…</p></section>;

  const kindTitle = meta?.kinds.find((k) => k.id === doc.input.kind)?.title ?? '';
  const pill = saveState === 'saving' ? 'сохраняем…'
    : saveState === 'dirty' ? 'есть несохранённые правки'
    : saveState === 'error' ? 'не сохранено'
    : savedAt ? `сохранено ${time(savedAt)}` : 'сохранено';
  const cols = boss ? 8 : 6;
  const lightRows = view?.light?.rows ?? [];

  return (
    <section className="view">
      <div className="crumbs"><Link to="/clients">Клиенты</Link> / <Link to={`/clients/${calc.clientId}`}><b>{calc.clientName}</b></Link> / Расчёты</div>
      <div className="head">
        <div className="title-wrap">
          <div className="eyebrow">{kindTitle}</div>
          <div className="title-line">
            <input className="h1-input" aria-label="Название расчёта" value={doc.title} onChange={(e) => edit((d) => ({ ...d, title: e.target.value }))} />
            <span className={`pill${saveState === 'error' ? ' bad' : ''}`}>{STATUS_TITLES[doc.status]} · {pill}</span>
          </div>
        </div>
        <div className="actions">
          <label className="field inline">Статус
            <select value={doc.status} onChange={(e) => edit((d) => ({ ...d, status: e.target.value as Status }))}>
              {(Object.keys(STATUS_TITLES) as Status[]).map((s) => <option key={s} value={s}>{STATUS_TITLES[s]}</option>)}
            </select>
          </label>
          <button className="btn" type="button" onClick={() => setPasteOpen(true)}>Вставить из PRO100</button>
          <button className="btn" type="button" onClick={copy} disabled={busyCopy}>Скопировать расчёт</button>
        </div>
      </div>

      {conflict && (
        <div className="conflict" role="alert">
          <span>Расчёт изменили на другом компьютере{conflict.updatedBy ? ` (${conflict.updatedBy}${conflict.updatedAt ? `, ${time(conflict.updatedAt)}` : ''})` : ''}. Ваши правки пока не сохранены.</span>
          <div className="actions">
            <button className="btn" type="button" onClick={takeTheirs}>Загрузить их версию</button>
            <button className="btn" type="button" onClick={overwrite}>Перезаписать своей</button>
          </div>
        </div>
      )}
      <ErrorNote text={saveErr ? `Не удалось сохранить: ${saveErr}` : null} />
      <ErrorNote text={computeErr ? `Не удалось пересчитать: ${computeErr}` : null} />

      <div className="work">
        <div className="work-main">
          <section className="panel" aria-label="Расчёт">
            <h2>Материалы и фурнитура</h2>
            <p className="note">Количество пришло из PRO100, его можно исправить. В каждом блоке — строка из прайса или своя; «+ вид» добавляет ещё одну позицию того же типа.</p>
            <table className="calc-table">
              <colgroup>
                <col style={{ width: '13%' }} /><col />
                <col style={{ width: 96 }} /><col style={{ width: 64 }} />
                {boss && <col style={{ width: 130 }} />}{boss && <col style={{ width: 112 }} />}
                <col style={{ width: 112 }} /><col style={{ width: 84 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Строка</th><th>Материал / позиция</th><th className="num">Кол-во</th><th>Ед.</th>
                  {boss && <th className="num">Себест. за ед.</th>}{boss && <th className="num">Себестоимость</th>}
                  <th className="num">Розница</th><th />
                </tr>
              </thead>
              <tbody>
                {blocks.map((b) => {
                  const retail = view?.blocks.find((x) => x.block === b.id)?.retail;
                  const head = <tr className="block" key={`h-${b.id}`}><td colSpan={cols}>{b.title}<span>{rub(retail ?? 0, roundTo)}</span></td></tr>;
                  if (b.id === 'light') {
                    return [head, ...(doc.input.light.enabled
                      ? lightRows.map((r, k) => <LightRow key={`l-${k}`} r={r} boss={boss} roundTo={roundTo} />)
                      : [<tr key="l-none"><td colSpan={cols} className="muted-cell">Подсветки нет. Включите её в расчёте подсветки под таблицей.</td></tr>]),
                    <tr className="add" key="l-add"><td colSpan={cols} /></tr>];
                  }
                  const allowed = groupsFor(b, catalog);
                  const rows = doc.input.rows.filter((r) => r.block === b.id);
                  return [head,
                    ...rows.map((r) => (
                      <CalcRow key={r.id} row={r} vr={viewById.get(r.id)} groups={allowed.length ? allowed : catalog?.groups ?? []} boss={boss} roundTo={roundTo}
                        onChange={(p) => editRow(r.id, p)}
                        onDup={() => editInput((i) => {
                          const at = i.rows.findIndex((x) => x.id === r.id);
                          const copyRow: Row = r.own
                            ? { id: newId(), block: r.block, pro100: null, qtyPro100: null, qty: 1, own: { ...r.own } }
                            : { id: newId(), block: r.block, pro100: null, qtyPro100: null, qty: 1, itemId: r.itemId ?? null };
                          return { ...i, rows: [...i.rows.slice(0, at + 1), copyRow, ...i.rows.slice(at + 1)] };
                        })}
                        onRemove={() => editInput((i) => ({ ...i, rows: i.rows.filter((x) => x.id !== r.id) }))}
                      />
                    )),
                    <AddRow key={`a-${b.id}`} block={b} groups={allowed} cols={cols} onAdd={(row) => editInput((i) => {
                      const last = i.rows.map((x) => x.block).lastIndexOf(b.id);
                      const at = last < 0 ? i.rows.length : last + 1;
                      return { ...i, rows: [...i.rows.slice(0, at), row, ...i.rows.slice(at)] };
                    })} />,
                  ];
                })}
              </tbody>
            </table>

            <div className="unparsed">
              {doc.unparsed.length ? (
                <>
                  <b>Не разобрано из PRO100:</b>
                  {doc.unparsed.map((u, k) => (
                    <span className="chip" key={`${u.name}-${k}`}>{u.name} · {num(u.qty)} {u.unit}
                      <button className="link" type="button" onClick={() => edit((d) => ({
                        ...d, unparsed: d.unparsed.filter((_, j) => j !== k),
                        input: { ...d.input, rows: [...d.input.rows, { id: newId(), block: 'free', pro100: null, qtyPro100: null, qty: u.qty, own: { name: u.name, unit: u.unit || 'шт', price: 0 } }] },
                      }))}>своей строкой</button>
                      <button className="link" type="button" onClick={() => edit((d) => ({ ...d, unparsed: d.unparsed.filter((_, j) => j !== k) }))}>не учитывать</button>
                    </span>
                  ))}
                </>
              ) : <span className="muted-dark">Все строки PRO100 разобраны.</span>}
            </div>

            <LightEditor doc={doc} view={view} settings={settings} onChange={(light) => editInput((i) => ({ ...i, light }))} />
          </section>
        </div>

        <aside className="totals" aria-label="Итог">
          <h2>Итог</h2>
          {boss && view?.cost != null && <div className="trow"><span>Себестоимость<em>руководитель</em></span><b>{rub(view.cost, roundTo)}</b></div>}
          {boss && view?.costByGroup && (
            <div className="grouplist">
              {Object.entries(view.costByGroup).filter(([, v]) => v).map(([k, v]) => <div className="trow small" key={k}><span>{k}</span><b>{rub(v, roundTo)}</b></div>)}
            </div>
          )}
          {boss && view?.prod != null && <div className="trow"><span>Производственная</span><b>{rub(view.prod, roundTo)}</b></div>}
          <div className="trow"><span>Розница</span><b>{rub(view?.retail, roundTo)}</b></div>
          <div className="disc">
            <label htmlFor="disc">Скидка, %</label>
            <NumInput id="disc" digits={2} value={doc.input.discountPct} onValue={(n) => editInput((i) => ({ ...i, discountPct: Math.min(100, Math.max(0, n)) }))} />
          </div>
          {!!view?.discount && <div className="trow small"><span>Скидка</span><b>−{rub(view.discount, roundTo)}</b></div>}
          <div className="trow"><span>Мебель со скидкой</span><b>{rub(view?.furnitureAfterDiscount, roundTo)}</b></div>
          <div className="hr" />
          <div className="trow"><span>Доставка и монтаж {settings ? `${num(settings.deliveryPct)} %` : ''}<em>без скидки</em></span><b>{rub(view?.delivery, roundTo)}</b></div>
          <div className="total"><span>Итого клиенту</span><b>{rub(view?.total, roundTo)}</b></div>
          {boss && view?.margin != null && <div className="trow"><span>Маржа<em>руководитель</em></span><b>{rub(view.margin, roundTo)}</b></div>}
          <button className="btn solid" type="button" onClick={saveNow} disabled={saveState === 'saving' || !!conflict}>Сохранить расчёт</button>
          <button className="btn" type="button" disabled title="Сборка КП — следующий этап">Собрать КП · скоро</button>
          {boss && settings && 'kProd' in settings && settings.kProd != null && (
            <p className="foot">Наценки: производство ×{num(settings.kProd)}, магазин ×{num(settings.kShop ?? 0)}, одни на всё.{user?.role === 'owner' && <> <Link to="/settings/coefficients">Изменить</Link></>}</p>
          )}
          {!!view?.warnings.length && (
            <div className="warnlist">
              <span>Проверьте</span>
              {view.warnings.map((w, k) => <div key={k}>{w}</div>)}
            </div>
          )}
        </aside>
      </div>

      {pasteOpen && (
        <PasteDialog
          kind={doc.input.kind} rows={doc.input.rows} blocks={blocks}
          onClose={() => setPasteOpen(false)}
          onApply={(rows, unparsed) => { edit((d) => ({ ...d, unparsed, input: { ...d.input, rows } })); setPasteOpen(false); }}
        />
      )}
    </section>
  );
}

function ItemSelect({ value, groups, onChange, label }: { value: string | null | undefined; groups: CatalogGroupView[]; onChange: (id: string) => void; label: string }) {
  // Позиции со status (например «нет в новом прайсе») не предлагаем; уже выбранную показываем, чтобы не потерять.
  const cur = value ? groups.flatMap((g) => g.items.map((it) => ({ g, it }))).find((x) => x.it.id === value) : undefined;
  return (
    <select className="in" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="">— выберите позицию —</option>}
      {value && !cur && <option value={value}>Позиция не найдена в прайсе</option>}
      {groups.map((g) => {
        const items = g.items.filter((it) => !it.status || it.id === value);
        if (!items.length) return null;
        return (
          <optgroup key={g.id} label={g.name}>
            {items.map((it) => <option key={it.id} value={it.id}>{it.name}{it.status ? ` (${it.status})` : ''}</option>)}
          </optgroup>
        );
      })}
    </select>
  );
}

function CalcRow({ row, vr, groups, boss, roundTo, onChange, onDup, onRemove }: {
  row: Row; vr: ViewRow | undefined; groups: CatalogGroupView[]; boss: boolean; roundTo: number;
  onChange: (p: Partial<Row>) => void; onDup: () => void; onRemove: () => void;
}) {
  const edited = !!row.pro100 && row.qtyPro100 != null && row.qty !== row.qtyPro100;
  const warn = vr?.warnings?.filter(Boolean) ?? [];
  let label: ReactNode, mat: ReactNode, unit: ReactNode;
  if (row.own) {
    const own = row.own;
    label = <span className="pro hand">своя</span>;
    mat = (
      <div className="own">
        <input className="in" aria-label="Название" value={own.name} placeholder="Название" onChange={(e) => onChange({ own: { ...own, name: e.target.value } })} />
        <label className="own-price"><NumInput className="in" aria-label="Цена закупки за единицу, ₽" digits={2} value={own.price} onValue={(n) => onChange({ own: { ...own, price: n } })} /><span>₽ за ед.</span></label>
      </div>
    );
    unit = <input className="in unit" aria-label="Единица" value={own.unit} onChange={(e) => onChange({ own: { ...own, unit: e.target.value } })} />;
  } else {
    label = row.pro100 ? <span className="pro">{row.pro100}</span> : <span className="pro hand">добавлена</span>;
    mat = (
      <>
        <ItemSelect value={row.itemId} groups={groups} label="Позиция прайса" onChange={(itemId) => onChange({ itemId: itemId || null })} />
        {row.realMaterial != null ? (
          <span className="real">
            <input className="in" aria-label="Реальный материал" placeholder="Реальный материал для КП и спецификации" value={row.realMaterial} onChange={(e) => onChange({ realMaterial: e.target.value })} />
            <button className="x" type="button" aria-label="Убрать реальный материал" onClick={() => onChange({ realMaterial: null })}>×</button>
          </span>
        ) : (
          <button className="link" type="button" onClick={() => onChange({ realMaterial: '' })}>другой материал</button>
        )}
      </>
    );
    unit = vr?.unit ?? '';
  }
  return (
    <tr className={warn.length ? 'bad' : undefined}>
      <td>{label}</td>
      <td>{mat}{warn.length > 0 && <span className="sub mark">{warn.join(', ')}</span>}</td>
      <td className="num">
        <NumInput className={`in qty${edited ? ' edited' : ''}`} aria-label="Количество" value={row.qty} onValue={(qty) => onChange({ qty: Math.max(0, qty) })} />
        {edited && <span className="sub mark">PRO100: {num(row.qtyPro100)}</span>}
      </td>
      <td>{unit}</td>
      {boss && <td className="num">{vr?.unitCost != null ? rubUnit(vr.unitCost) : '—'}{vr?.costNote && <span className="sub">{vr.costNote}</span>}</td>}
      {boss && <td className="num">{vr?.cost != null ? rub(vr.cost, roundTo) : '—'}</td>}
      <td className="num">{vr ? rub(vr.retail, roundTo) : '—'}</td>
      <td className="num nowrap">
        <button className="link" type="button" onClick={onDup}>+ вид</button>
        {!row.pro100 && <button className="x" type="button" aria-label="Удалить строку" onClick={onRemove}>×</button>}
      </td>
    </tr>
  );
}

function LightRow({ r, boss, roundTo }: { r: ViewRow; boss: boolean; roundTo: number }) {
  return (
    <tr className={r.warnings?.length ? 'bad' : undefined}>
      <td><span className="pro hand">авто</span></td>
      <td>{r.name}<span className="sub">из расчёта подсветки{r.warnings?.length ? ` · ${r.warnings.join(', ')}` : ''}</span></td>
      <td className="num">{num(r.qty)}</td>
      <td>{r.unit}</td>
      {boss && <td className="num">{r.unitCost != null ? rubUnit(r.unitCost) : '—'}</td>}
      {boss && <td className="num">{r.cost != null ? rub(r.cost, roundTo) : '—'}</td>}
      <td className="num">{rub(r.retail, roundTo)}</td>
      <td />
    </tr>
  );
}

function AddRow({ block, groups, cols, onAdd }: { block: BlockDef; groups: CatalogGroupView[]; cols: number; onAdd: (r: Row) => void }) {
  return (
    <tr className="add">
      <td colSpan={cols}>
        {groups.length > 0 && (
          <select className="in add-select" aria-label={`Добавить позицию: ${block.title}`} value="" onChange={(e) => {
            if (e.target.value) onAdd({ id: newId(), block: block.id, pro100: null, qtyPro100: null, qty: 1, itemId: e.target.value });
          }}>
            <option value="">+ добавить из прайса…</option>
            {groups.map((g) => {
              const items = g.items.filter((it) => !it.status);
              return items.length ? <optgroup key={g.id} label={g.name}>{items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}</optgroup> : null;
            })}
          </select>
        )}
        <button className="link" type="button" onClick={() => onAdd({ id: newId(), block: block.id, pro100: null, qtyPro100: null, qty: 1, own: { name: '', unit: 'шт', price: 0 } })}>+ своя строка</button>
      </td>
    </tr>
  );
}

function LightEditor({ doc, view, settings, onChange }: {
  doc: Doc; view: View | null; settings: ReturnType<typeof useApp>['settings']; onChange: (l: CalcInput['light']) => void;
}) {
  const light = doc.input.light;
  const L = settings?.light;
  const profiles = L?.profiles ?? [];
  const switches = L?.switches ?? [];
  const lr = view?.light;
  const reserve = settings && 'lightReserve' in settings && typeof settings.lightReserve === 'number' ? settings.lightReserve : null;
  const setSeg = (k: number, p: Partial<CalcInput['light']['segments'][number]>) =>
    onChange({ ...light, segments: light.segments.map((s, j) => (j === k ? { ...s, ...p } : s)) });

  return (
    <div className="light" aria-label="Расчёт подсветки">
      <div className="light-head">
        <h3>Подсветка</h3>
        <label className="check">
          <input type="checkbox" checked={light.enabled} onChange={(e) => onChange({
            ...light, enabled: e.target.checked,
            profileId: light.profileId || profiles[0]?.id || '',
            segments: e.target.checked && !light.segments.length ? [{ name: 'Под верхними шкафами', lengthM: 0, switchId: switches[0]?.id ?? '' }] : light.segments,
          })} />
          Есть подсветка
        </label>
      </div>
      <p className="note">Вы задаёте профиль и участки. Мощность, блок питания и выключатели считаются сами. Паз включён в цену профиля.</p>
      {light.enabled && (
        <>
          <div className="lgrid">
            <label>Лента<span className="fixed">{L?.tape.name ?? '—'}</span></label>
            <label>Профиль
              <select className="in" value={light.profileId} onChange={(e) => onChange({ ...light, profileId: e.target.value })}>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </div>
          <div className="seglist">
            <div className="segrow seghead"><span>Участок</span><span>Длина, м</span><span>Включение</span><span /></div>
            {light.segments.map((s, k) => (
              <div className="segrow" key={k}>
                <input className="in" aria-label="Участок" value={s.name} onChange={(e) => setSeg(k, { name: e.target.value })} />
                <NumInput className="in" aria-label="Длина, м" digits={2} value={s.lengthM} onValue={(n) => setSeg(k, { lengthM: Math.max(0, n) })} />
                <select className="in" aria-label="Включение" value={s.switchId} onChange={(e) => setSeg(k, { switchId: e.target.value })}>
                  {switches.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <button className="x" type="button" aria-label="Удалить участок" onClick={() => onChange({ ...light, segments: light.segments.filter((_, j) => j !== k) })}>×</button>
              </div>
            ))}
          </div>
          <button className="link" type="button" onClick={() => onChange({ ...light, segments: [...light.segments, { name: 'Новый участок', lengthM: 1, switchId: switches[0]?.id ?? '' }] })}>+ участок</button>
          {lr && (
            <div className="lsum">
              <span>Лента <b>{num(lr.lengthM)} м</b></span>
              <span>Мощность <b>{num(lr.watt, 1)} Вт</b></span>
              <span>С запасом{reserve != null ? ` ${num(reserve * 100, 0)} %` : ''} <b>{num(lr.needWatt, 0)} Вт</b></span>
              <span>Блок питания <b>{lr.psuCount > 1 ? `${lr.psuCount} × ` : ''}{lr.psuWatt} Вт</b></span>
            </div>
          )}
          {lr?.warnings.map((w, k) => <div className="warn" key={k}>{w}</div>)}
        </>
      )}
    </div>
  );
}

function PasteDialog({ kind, rows, blocks, onClose, onApply }: {
  kind: CalcInput['kind']; rows: Row[]; blocks: BlockDef[]; onClose: () => void; onApply: (rows: Row[], unparsed: Pro100Line[]) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ rows: Row[]; unparsed: Pro100Line[]; skipped: string[] } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const parse = async () => {
    if (!text.trim()) { setErr('Вставьте текст из PRO100: название, количество, единица в каждой строке.'); return; }
    setBusy(true); setErr(null);
    try { setRes(await api.parsePro100(kind, text, rows)); } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };

  const pro = res?.rows.filter((r) => r.pro100) ?? [];
  const title = (id: string) => blocks.find((b) => b.id === id)?.title ?? id;

  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Вставка из PRO100">
        <div className="modal-head"><h2>Вставить из PRO100</h2><button className="x big" type="button" aria-label="Закрыть" onClick={onClose}>×</button></div>
        <p className="note">Скопируйте вывод PRO100 (или столбцы из Excel) и вставьте сюда. Выбранные материалы и исправленные вручную количества сохранятся.</p>
        <textarea ref={area} className="paste" value={text} onChange={(e) => { setText(e.target.value); setRes(null); }} placeholder={'ЛДСП_верх\t5,87\tм²\nФасад_низ\t3,48\tм²\nПетли\t12\tшт'} />
        <ErrorNote text={err} />
        {res && (
          <div className="paste-res">
            <table className="tab compact">
              <thead><tr><th>Строка PRO100</th><th className="num">Кол-во</th><th>Блок</th></tr></thead>
              <tbody>
                {pro.map((r) => <tr key={r.id}><td><span className="pro">{r.pro100}</span></td><td className="num">{num(r.qtyPro100 ?? r.qty)}</td><td>{title(r.block)}</td></tr>)}
                {!pro.length && <tr><td colSpan={3} className="empty">Ни одной знакомой строки.</td></tr>}
              </tbody>
            </table>
            {res.unparsed.length > 0 && <p className="note"><b>Не разобрано:</b> {res.unparsed.map((u) => `${u.name} · ${num(u.qty)} ${u.unit}`).join('; ')}. Их можно добавить своей строкой или не учитывать.</p>}
            {res.skipped.length > 0 && <p className="note"><b>Не прочитано:</b> {res.skipped.join('; ')}</p>}
          </div>
        )}
        <div className="actions">
          {!res
            ? <button className="btn solid" type="button" onClick={parse} disabled={busy}>{busy ? 'Разбираем…' : 'Разобрать вставку'}</button>
            : <button className="btn solid" type="button" onClick={() => onApply(res.rows, res.unparsed)}>Применить к расчёту</button>}
          <button className="btn" type="button" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
