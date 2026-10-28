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
import { ImagesPanel } from '../components/Images.tsx';
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
    deliveryRub: c.input?.deliveryRub ?? null,
  };
  return { title: c.title, status: c.status, input, unparsed: c.unparsed ?? [] };
}

const HDF_GROUP = 'ХДФ (задняя стенка)';

/** Строка ЛДСП корпуса, которую можно взять «в цвет корпуса» для задней стенки. */
export interface LdspLink { id: string; label: string }

/** Ссылка в выпадающем списке: «link:<id строки>». */
const LINK = 'link:';

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
  // строки с ЛДСП корпуса — варианты «в цвет корпуса» для задней стенки
  const ldspLinks = useMemo<LdspLink[]>(() => {
    if (!doc || !catalog) return [];
    const byItem = new Map<string, { g: CatalogGroupView; name: string }>();
    for (const g of catalog.groups) if (g.category === 'ЛДСП корпус') for (const it of g.items) byItem.set(it.id, { g, name: it.name });
    const list = doc.input.rows.filter((r) => !r.own && !r.web && !r.linkTo && r.itemId && byItem.has(r.itemId));
    return list.map((r) => {
      const title = blocks.find((b) => b.id === r.block)?.title ?? r.block;
      const same = list.filter((x) => x.block === r.block).length > 1;
      const it = byItem.get(r.itemId!)!;
      return { id: r.id, label: `ЛДСП в цвет корпуса: как в блоке „${title}“${same ? ` (${it.name})` : ''}` };
    });
  }, [doc, catalog, blocks]);
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
  const cols = boss ? 6 : 4;
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
          <Link className="btn" to={`/calculations/${id}/spec`}>Спецификация</Link>
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
                <col />
                <col style={{ width: 134 }} />
                {boss && <col style={{ width: 92 }} />}{boss && <col style={{ width: 98 }} />}
                <col style={{ width: 98 }} /><col style={{ width: boss ? 104 : 66 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Строка PRO100 · материал / позиция</th><th className="num">Кол-во, ед.</th>
                  {boss && <th className="num">Себест. за ед.</th>}{boss && <th className="num">Себест.</th>}
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
                  if (b.id === 'web') {
                    return [head,
                      ...rows.map((r) => (
                        <WebRow key={r.id} row={r} vr={viewById.get(r.id)} boss={boss} roundTo={roundTo}
                          onChange={(p) => editRow(r.id, p)}
                          onRemove={() => editInput((i) => ({ ...i, rows: i.rows.filter((x) => x.id !== r.id) }))} />
                      )),
                      <tr className="add" key="a-web"><td colSpan={cols}>
                        <button className="link" type="button" onClick={() => editInput((i) => ({
                          ...i, rows: [...i.rows, { id: newId(), block: 'web', pro100: null, qtyPro100: null, qty: 1, web: { url: '', name: '', price: 0, unit: 'шт' } }],
                        }))}>+ ссылка</button>
                      </td></tr>,
                    ];
                  }
                  return [head,
                    ...rows.map((r) => (
                      <CalcRow key={r.id} row={r} vr={viewById.get(r.id)} groups={allowed.length ? allowed : catalog?.groups ?? []} boss={boss} roundTo={roundTo}
                        links={isBackWall(r, catalog) ? ldspLinks.filter((l) => l.id !== r.id) : null}
                        onChange={(p) => editRow(r.id, p)}
                        onDup={() => editInput((i) => {
                          const at = i.rows.findIndex((x) => x.id === r.id);
                          const copyRow: Row = r.own
                            ? { id: newId(), block: r.block, pro100: null, qtyPro100: null, qty: 1, own: { ...r.own } }
                            : { id: newId(), block: r.block, pro100: null, qtyPro100: null, qty: 1, itemId: r.itemId ?? null, linkTo: r.linkTo ?? null };
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
          <ImagesPanel calcId={calc.id} />
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
          <div className="trow"><span>Монтаж {settings && settings.montagePct != null ? `${num(settings.montagePct)} %` : ''}<em>без скидки</em></span><b>{rub(view?.montage, roundTo)}</b></div>
          <div className="disc">
            <label htmlFor="delivery">Доставка, ₽<em className="hint">без скидки</em></label>
            <NumInput id="delivery" digits={0} value={doc.input.deliveryRub ?? settings?.deliveryDefaultRub ?? 0}
              onValue={(n) => editInput((i) => ({ ...i, deliveryRub: Math.max(0, n) }))} />
          </div>
          <div className="total"><span>Итого клиенту</span><b>{rub(view?.total, roundTo)}</b></div>
          {boss && view?.margin != null && <div className="trow"><span>Маржа<em>руководитель</em></span><b>{rub(view.margin, roundTo)}</b></div>}
          <button className="btn solid" type="button" onClick={saveNow} disabled={saveState === 'saving' || !!conflict}>Сохранить расчёт</button>
          <button className="btn" type="button" onClick={async () => {
            if (verRef.current !== savedVerRef.current) await save();
            nav(`/clients/${calc.clientId}/kp/new?calc=${calc.id}`);
          }}>Собрать КП</button>
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

/** Строка задней стенки: PRO100 «ХДФ», позиция из группы «ХДФ (задняя стенка)» или уже «в цвет корпуса». */
function isBackWall(r: Row, catalog: CatalogView | null): boolean {
  if (r.own || r.web) return false;
  if (r.linkTo || r.pro100 === 'ХДФ') return true;
  const g = r.itemId ? catalog?.groups.find((x) => x.items.some((it) => it.id === r.itemId)) : undefined;
  return g?.name === HDF_GROUP;
}

const LINK_GROUP = '__link';

/** Группы прайса для левого списка; если в блоке несколько категорий (ЛДСП корпус, Фасады) — разделены заголовками. */
function GroupOptions({ groups }: { groups: CatalogGroupView[] }) {
  const cats = [...new Set(groups.map((g) => g.category))];
  const opts = (list: CatalogGroupView[]) => list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>);
  if (cats.length < 2) return <>{opts(groups)}</>;
  return <>{cats.map((c) => <optgroup key={c} label={c}>{opts(groups.filter((g) => g.category === c))}</optgroup>)}</>;
}

/**
 * Выбор позиции в две ступени, как в книге: слева группа прайса (Egger, AGT…), справа — артикулы только этой группы.
 * Позиции со status (например «нет в новом прайсе») не предлагаем; уже выбранную показываем, чтобы не потерять.
 */
function ItemSelect({ value, groups, onChange, label, links }: {
  value: string | null | undefined; groups: CatalogGroupView[]; onChange: (id: string) => void; label: string; links?: LdspLink[] | null;
}) {
  const isLink = !!value && value.startsWith(LINK);
  const curGroup = value && !isLink ? groups.find((g) => g.items.some((it) => it.id === value)) : undefined;
  const lostLink = isLink && !links?.some((l) => LINK + l.id === value);
  const shown = groups.filter((g) => g.id === curGroup?.id || g.items.some((it) => !it.status));
  // группа, выбранная слева, пока артикул справа ещё не выбран
  const [pick, setPick] = useState('');
  const only = !links && shown.length === 1 ? shown[0].id : '';
  const gid = pick || (isLink ? LINK_GROUP : curGroup?.id) || only;
  const g = gid && gid !== LINK_GROUP ? shown.find((x) => x.id === gid) : undefined;
  const items = g ? g.items.filter((it) => !it.status || it.id === value) : [];
  const inGroup = gid === LINK_GROUP ? isLink : !!curGroup && curGroup.id === gid;
  const choose = (v: string) => { setPick(''); onChange(v); };
  return (
    <div className="pick2">
      <select className="in" aria-label={`${label}: группа`} value={gid} onChange={(e) => setPick(e.target.value)}>
        {!gid && <option value="">— группа —</option>}
        {value && !isLink && !curGroup && !pick && <option value="">Позиция не найдена в прайсе</option>}
        {links && <option value={LINK_GROUP}>В цвет корпуса</option>}
        <GroupOptions groups={shown} />
      </select>
      <select className="in" aria-label={label} value={inGroup ? value ?? '' : ''} disabled={!gid} onChange={(e) => e.target.value && choose(e.target.value)}>
        {!inGroup && <option value="">{gid ? '— выберите артикул —' : '← сначала группа'}</option>}
        {gid === LINK_GROUP && <>
          {lostLink && <option value={value!}>Строка ЛДСП не найдена</option>}
          {links?.map((l) => <option key={l.id} value={LINK + l.id}>{l.label}</option>)}
          {!links?.length && <option value="" disabled>Сначала выберите ЛДСП корпуса в расчёте</option>}
        </>}
        {items.map((it) => <option key={it.id} value={it.id}>{it.name}{it.status ? ` (${it.status})` : ''}</option>)}
      </select>
    </div>
  );
}

/** Галочка «без наценки»: только руководитель и владелец (сервер не даёт менеджеру её менять). */
function NoMarkup({ row, onChange }: { row: Row; onChange: (p: Partial<Row>) => void }) {
  return (
    <label className="nomark" title="Розница = себестоимость: наценки производства и магазина не применяются">
      <input type="checkbox" checked={!!row.noMarkup} onChange={(e) => onChange({ noMarkup: e.target.checked })} />без наценки
    </label>
  );
}

function CalcRow({ row, vr, groups, boss, roundTo, links, onChange, onDup, onRemove }: {
  row: Row; vr: ViewRow | undefined; groups: CatalogGroupView[]; boss: boolean; roundTo: number; links: LdspLink[] | null;
  onChange: (p: Partial<Row>) => void; onDup: () => void; onRemove: () => void;
}) {
  const edited = !!row.pro100 && row.qtyPro100 != null && row.qty !== row.qtyPro100;
  const warn = vr?.warnings?.filter(Boolean) ?? [];
  let label: ReactNode, mat: ReactNode, unit: ReactNode;
  if (row.own) {
    const own = row.own;
    label = <span className="pro hand">своя строка</span>;
    mat = (
      <div className="own">
        <input className="in" aria-label="Название" value={own.name} placeholder="Название" onChange={(e) => onChange({ own: { ...own, name: e.target.value } })} />
        <label className="own-price"><NumInput className="in" aria-label="Цена закупки за единицу, ₽" digits={2} value={own.price} onValue={(n) => onChange({ own: { ...own, price: n } })} /><span>₽ за ед.</span></label>
      </div>
    );
    unit = <input className="in unit" aria-label="Единица" value={own.unit} onChange={(e) => onChange({ own: { ...own, unit: e.target.value } })} />;
  } else {
    label = row.pro100 ? <span className="pro">{row.pro100}</span> : null;
    mat = (
      <>
        <ItemSelect value={row.linkTo ? LINK + row.linkTo : row.itemId} groups={groups} label="Позиция прайса" links={links}
          onChange={(v) => onChange(v.startsWith(LINK) ? { linkTo: v.slice(LINK.length), itemId: null } : { itemId: v || null, linkTo: null })} />
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
    unit = <span className="unit-t">{vr?.unit ?? ''}</span>;
  }
  return (
    <tr className={warn.length ? 'bad' : undefined}>
      <td>
        {label && <div className="rowlabel">{label}</div>}{mat}
        {boss && vr?.costNote && <span className="sub">себестоимость м²: {vr.costNote}</span>}
        {warn.length > 0 && <span className="sub mark">{warn.join(', ')}</span>}
      </td>
      <td className="num">
        <span className="qtybox">
          <NumInput className={`in qty${edited ? ' edited' : ''}`} aria-label="Количество" value={row.qty} onValue={(qty) => onChange({ qty: Math.max(0, qty) })} />
          {unit}
        </span>
        {edited && <span className="sub mark">PRO100: {num(row.qtyPro100)}</span>}
      </td>
      {boss && <td className="num">{vr?.unitCost != null ? rubUnit(vr.unitCost) : '—'}</td>}
      {boss && <td className="num">{vr?.cost != null ? rub(vr.cost, roundTo) : '—'}</td>}
      <td className="num">{vr ? rub(vr.retail, roundTo) : '—'}</td>
      <td className="num nowrap">
        {boss && row.own && <NoMarkup row={row} onChange={onChange} />}
        <button className="link" type="button" onClick={onDup}>+ вид</button>
        {!row.pro100 && <button className="x" type="button" aria-label="Удалить строку" onClick={onRemove}>×</button>}
      </td>
    </tr>
  );
}

/** Товар по ссылке с сайта: ссылка, название, цена закупки за штуку, количество. */
function WebRow({ row, vr, boss, roundTo, onChange, onRemove }: {
  row: Row; vr: ViewRow | undefined; boss: boolean; roundTo: number; onChange: (p: Partial<Row>) => void; onRemove: () => void;
}) {
  const web = row.web ?? { url: '', name: '', price: 0, unit: 'шт' };
  const warn = vr?.warnings?.filter(Boolean) ?? [];
  const href = /^https?:\/\//i.test(web.url.trim()) ? web.url.trim() : '';
  const [look, setLook] = useState<{ busy: boolean; msg: string | null; bad?: boolean; tried?: string }>({ busy: false, msg: null });
  /** Подтянуть название и цену по ссылке (сервер скачивает страницу); менеджер потом правит. */
  const fetchInfo = async (url: string) => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u) || look.tried === u) return;
    setLook({ busy: true, msg: 'Смотрим страницу…', tried: u });
    try {
      const r = await api.linkPreview(u);
      const cur = { ...web, url: u };
      const patch: Partial<typeof web> = {};
      if (!cur.name.trim() && r.name) patch.name = r.name;
      if (!(cur.price > 0) && r.price && (!r.currency || r.currency === 'RUB' || r.currency === 'RUR')) patch.price = r.price;
      onChange({ web: { ...cur, ...patch } });
      const got = [patch.name ? 'название' : '', patch.price ? 'цену' : ''].filter(Boolean).join(' и ');
      setLook({ busy: false, tried: u, msg: got ? `С сайта подставили ${got} — проверьте.` : r.price && r.currency && r.currency !== 'RUB' ? `На сайте цена в ${r.currency}: введите в рублях.` : 'На странице: ' + r.name + (r.price ? ` · ${r.price}` : '') });
    } catch (x) { setLook({ busy: false, tried: u, bad: true, msg: `${errText(x)}. Введите название и цену вручную.` }); }
  };
  return (
    <tr className={warn.length ? 'bad' : undefined}>
      <td>
        <div className="weburl">
          <input className="in" aria-label="Ссылка на товар" placeholder="https://… вставьте ссылку — подтянем название и цену" value={web.url}
            onChange={(e) => onChange({ web: { ...web, url: e.target.value } })}
            onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t) setTimeout(() => fetchInfo(t), 0); }}
            onBlur={(e) => fetchInfo(e.target.value)} />
          {href
            ? <a className="open" href={href} target="_blank" rel="noopener noreferrer" aria-label="Открыть ссылку в новой вкладке" title="Открыть в новой вкладке">↗</a>
            : <span className="open off" aria-hidden="true">↗</span>}
        </div>
        <div className="own">
          <input className="in" aria-label="Название товара" value={web.name} placeholder="Название" onChange={(e) => onChange({ web: { ...web, name: e.target.value } })} />
          <label className="own-price"><NumInput className="in" aria-label="Цена по ссылке за штуку, ₽" digits={2} value={web.price} onValue={(n) => onChange({ web: { ...web, price: Math.max(0, n) } })} /><span>₽ за шт</span></label>
        </div>
        {look.msg && <span className={`sub${look.bad ? ' mark' : ''}`} role="status">{look.msg}</span>}
        {warn.length > 0 && <span className="sub mark">{warn.join(', ')}</span>}
      </td>
      <td className="num">
        <span className="qtybox">
          <NumInput className="in qty" aria-label="Количество" value={row.qty} onValue={(qty) => onChange({ qty: Math.max(0, qty) })} />
          <span className="unit-t">шт</span>
        </span>
      </td>
      {boss && <td className="num">{vr?.unitCost != null ? rubUnit(vr.unitCost) : '—'}</td>}
      {boss && <td className="num">{vr?.cost != null ? rub(vr.cost, roundTo) : '—'}</td>}
      <td className="num">{vr ? rub(vr.retail, roundTo) : '—'}</td>
      <td className="num nowrap">
        {boss && <NoMarkup row={row} onChange={onChange} />}
        <button className="x" type="button" aria-label="Удалить ссылку" onClick={onRemove}>×</button>
      </td>
    </tr>
  );
}

function LightRow({ r, boss, roundTo }: { r: ViewRow; boss: boolean; roundTo: number }) {
  return (
    <tr className={r.warnings?.length ? 'bad' : undefined}>
      <td><div className="rowlabel"><span className="pro hand">авто</span></div>{r.name}<span className="sub">из расчёта подсветки{r.warnings?.length ? ` · ${r.warnings.join(', ')}` : ''}</span></td>
      <td className="num">{num(r.qty)} <span className="unit-t">{r.unit}</span></td>
      {boss && <td className="num">{r.unitCost != null ? rubUnit(r.unitCost) : '—'}</td>}
      {boss && <td className="num">{r.cost != null ? rub(r.cost, roundTo) : '—'}</td>}
      <td className="num">{rub(r.retail, roundTo)}</td>
      <td />
    </tr>
  );
}

function AddRow({ block, groups, cols, onAdd }: { block: BlockDef; groups: CatalogGroupView[]; cols: number; onAdd: (r: Row) => void }) {
  const shown = groups.filter((g) => g.items.some((it) => !it.status));
  const [gid, setGid] = useState('');
  const g = shown.find((x) => x.id === gid);
  return (
    <tr className="add">
      <td colSpan={cols}>
        {shown.length > 0 && (
          <span className="add-pick">
            <select className="in" aria-label={`Добавить позицию: ${block.title}, группа`} value={gid} onChange={(e) => setGid(e.target.value)}>
              <option value="">+ добавить из прайса: группа…</option>
              <GroupOptions groups={shown} />
            </select>
            {g && (
              <select className="in" aria-label={`Добавить позицию: ${block.title}`} value="" onChange={(e) => {
                if (!e.target.value) return;
                onAdd({ id: newId(), block: block.id, pro100: null, qtyPro100: null, qty: 1, itemId: e.target.value });
                setGid('');
              }}>
                <option value="">— артикул —</option>
                {g.items.filter((it) => !it.status).map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </select>
            )}
          </span>
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
  // по умолчанию — первый настоящий выключатель, а не «Нет (напрямую)»
  const firstSwitch = switches.find((w) => w.id !== 'none')?.id ?? switches[0]?.id ?? '';
  // профиль выбирается у каждого участка; новый участок получает первый профиль из настроек
  // (LightInput.profileId остаётся в данных только для старых расчётов)
  const firstProfile = profiles[0]?.id ?? '';
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
            segments: e.target.checked && !light.segments.length ? [{ name: 'Под верхними шкафами', lengthM: 0, switchId: firstSwitch, profileId: firstProfile }] : light.segments,
          })} />
          Есть подсветка
        </label>
      </div>
      <p className="note">Вы задаёте участки: длину, профиль и включение у каждого участка. Мощность, блок питания и выключатели считаются сами; участки «Нет (напрямую к слаботочке)» — без выключателя и блока питания. Паз включён в цену профиля.</p>
      {light.enabled && (
        <>
          <div className="lgrid">
            <label>Лента<span className="fixed">{L?.tape.name ?? '—'}</span></label>
          </div>
          <div className="seglist">
            <div className="segrow seghead"><span>Участок</span><span>Длина, м</span><span>Профиль</span><span>Включение</span><span /></div>
            {light.segments.map((s, k) => (
              <div className="segrow" key={k}>
                <input className="in" aria-label="Участок" value={s.name} onChange={(e) => setSeg(k, { name: e.target.value })} />
                <NumInput className="in" aria-label="Длина, м" digits={2} value={s.lengthM} onValue={(n) => setSeg(k, { lengthM: Math.max(0, n) })} />
                <select className="in" aria-label="Профиль" value={s.profileId || light.profileId} onChange={(e) => setSeg(k, { profileId: e.target.value })}>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className="in" aria-label="Включение" value={s.switchId} onChange={(e) => setSeg(k, { switchId: e.target.value })}>
                  {switches.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <button className="x" type="button" aria-label="Удалить участок" onClick={() => onChange({ ...light, segments: light.segments.filter((_, j) => j !== k) })}>×</button>
              </div>
            ))}
          </div>
          <button className="link" type="button" onClick={() => onChange({ ...light, segments: [...light.segments, { name: 'Новый участок', lengthM: 1, switchId: firstSwitch, profileId: firstProfile }] })}>+ участок</button>
          {lr && (
            <div className="lsum">
              <span>Лента <b>{num(lr.lengthM)} м</b></span>
              <span>Мощность <b>{num(lr.watt, 1)} Вт</b></span>
              <span>С запасом{reserve != null ? ` ${num(reserve * 100, 0)} %` : ''} <b>{num(lr.needWatt, 0)} Вт</b></span>
              <span>Блок питания <b>{lr.psuCount ? `${lr.psuCount > 1 ? `${lr.psuCount} × ` : ''}${lr.psuWatt} Вт` : 'не нужен'}</b></span>
              {!!lr.directM && <span>Напрямую к слаботочке <b>{num(lr.directM)} м</b></span>}
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
