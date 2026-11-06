// Экран расчёта «как в Excel»: блоки-таблицы, справа итоги. Макет — mockups/presentation.html, вкладка «Расчёт».
// Суммы берутся только из view сервера (POST /api/compute для мгновенного отклика, PUT — сохранение).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  api, ApiError, seesCost, STATUS_TITLES, type CalcInput, type Calculation, type CatalogGroupView, type CatalogView, type Row, type Status, type View, type ViewRow,
} from '../../api.ts';
import { useApp } from '../../app.tsx';
import { ErrorNote } from '../../components/Layout.tsx';
import { NumInput } from '../../components/NumInput.tsx';
import { ImagesPanel } from '../../components/Images.tsx';
import { errText, num, rub, time } from '../../format.ts';
import { newId, docOf, groupsForRow, groupsFor, isBackWall } from './shared.ts';
import type { Doc, SaveState, Conflict, LdspLink } from './shared.ts';
import { CalcRow, WebRow, LightRow, AddRow } from './rows.tsx';
import { LightEditor } from './LightEditor.tsx';
import { PasteDialog } from './PasteDialog.tsx';

export function CalculationPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { user, meta, settings, roundTo } = useApp();
  const boss = seesCost(user);
  // лимит скидки роли (сервер проверяет то же): менеджер — до 5 %, руководитель — до 15 %, владелец — любая
  const discMax = user?.role === 'owner' ? 100 : (user?.role === 'head' ? settings?.discountMaxHead : settings?.discountMaxManager) ?? 100;

  const [calc, setCalc] = useState<Calculation | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [catalog, setCatalog] = useState<CatalogView | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
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

  // расчёт и так сохраняется сам через 1,5 с после правки; кнопка отмечает его готовым (статус «Сохранён») и сохраняет сразу
  const saveNow = () => {
    if (doc?.status === 'draft') edit((d) => ({ ...d, status: 'saved' }));
    save();
    setDoneMsg(doc?.status === 'draft' ? 'Расчёт готов и сохранён — его можно добавить в КП.' : 'Сохранено.');
    setTimeout(() => setDoneMsg(null), 5000);
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
    : savedAt ? `сохранено автоматически ${time(savedAt)}` : 'сохранено автоматически';
  const cols = boss ? 6 : 4;
  // «Проверьте»: строки без материала — одной строкой с названиями, остальные предупреждения без повторов
  const NO_ITEM = 'Не выбрана позиция прайса';
  const rowName = (r: Row) => r.pro100 ?? r.own?.name ?? r.web?.name ?? 'строка';
  const noItem = doc.input.rows.filter((r) => viewById.get(r.id)?.warnings?.includes(NO_ITEM));
  const otherWarn = [...new Set((view?.warnings ?? []).filter((w) => !w.includes(NO_ITEM)))];
  const goRow = (id: string) => {
    const el = document.getElementById(`row-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (el?.querySelector('input,select') as HTMLElement | null)?.focus({ preventScroll: true });
  };
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
            {doc.unparsed.length > 0 && (
              <div className="unparsed top" role="status">
                <b>Не разобрано из PRO100 ({doc.unparsed.length}):</b> {doc.unparsed.map((u) => u.name).join(', ')} — решите внизу таблицы: «своей строкой» или «не учитывать».
              </div>
            )}
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
                      <CalcRow key={r.id} row={r} vr={viewById.get(r.id)} groups={groupsForRow(r, allowed.length ? allowed : catalog?.groups ?? [])} boss={boss} roundTo={roundTo}
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
            <label htmlFor="disc">Скидка, %{discMax < 100 && <em className="hint">не больше {num(discMax)} %</em>}</label>
            <NumInput id="disc" digits={2} value={doc.input.discountPct} onValue={(n) => editInput((i) => ({ ...i, discountPct: Math.min(100, Math.max(0, n)) }))} />
          </div>
          {doc.input.discountPct > discMax && <div className="trow small"><span className="mark">Скидка больше {num(discMax)} % — {user?.role === 'manager' ? 'поставит руководитель' : 'только владелец'}. Расчёт не сохранится.</span></div>}
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
          <button className="btn solid" type="button" onClick={saveNow} disabled={saveState === 'saving' || !!conflict}
            title="Правки сохраняются сами. Кнопка отмечает расчёт готовым">{doc.status === 'draft' ? 'Расчёт готов' : saveState === 'dirty' ? 'Сохранить сейчас' : 'Сохранено ✓'}</button>
          {doneMsg && <div className="ok small" role="status">{doneMsg}</div>}
          <button className="btn" type="button" onClick={async () => {
            if (verRef.current !== savedVerRef.current) await save();
            nav(`/clients/${calc.clientId}/kp/new?calc=${calc.id}`);
          }}>Собрать КП</button>
          {boss && settings && 'kProd' in settings && settings.kProd != null && (
            <p className="foot">Наценки: производство ×{num(settings.kProd)}, магазин ×{num(settings.kShop ?? 0)}, одни на всё.{user?.role === 'owner' && <> <Link to="/settings/coefficients">Изменить</Link></>}</p>
          )}
          {(noItem.length > 0 || otherWarn.length > 0) && (
            <div className="warnlist">
              <span>Проверьте</span>
              {noItem.length > 0 && <div>Не выбран материал ({noItem.length}): {noItem.map((r, k) => (
                <span key={r.id}>{k > 0 && ', '}<button className="link-plain" type="button" onClick={() => goRow(r.id)}>{rowName(r)}</button></span>
              ))}</div>}
              {otherWarn.map((w, k) => <div key={k}>{w}</div>)}
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
