import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type CatalogGroupView, type CatalogItemView, type CatalogView } from '../api.ts';
import { ErrorNote } from '../components/Layout.tsx';
import { NumInput } from '../components/NumInput.tsx';
import { errText, rubUnit } from '../format.ts';

export function PricesPage() {
  const [catalog, setCatalog] = useState<CatalogView | null>(null);
  const [sel, setSel] = useState<string>('');
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.catalog().then((c) => { setCatalog(c); setSel((s) => s || c.groups[0]?.id || ''); }).catch((x) => setErr(errText(x)));
  }, []);

  const byCat = useMemo(() => {
    const m = new Map<string, CatalogGroupView[]>();
    for (const g of catalog?.groups ?? []) { if (!m.has(g.category)) m.set(g.category, []); m.get(g.category)!.push(g); }
    return [...m];
  }, [catalog]);

  const group = catalog?.groups.find((g) => g.id === sel);
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (group?.items ?? []).filter((it) => !t || it.name.toLowerCase().includes(t));
  }, [group, q]);

  const replaceItem = (item: CatalogItemView) => setCatalog((c) => c && ({
    ...c, groups: c.groups.map((g) => (g.id !== sel ? g : { ...g, items: g.items.some((i) => i.id === item.id) ? g.items.map((i) => (i.id === item.id ? { ...i, ...item } : i)) : [...g.items, item] })),
  }));

  const total = catalog?.groups.reduce((a, g) => a + g.items.length, 0) ?? 0;

  return (
    <section className="view">
      <div className="head">
        <div><div className="eyebrow">Руководитель и владелец</div><h1>Прайсы</h1></div>
        <p className="foot">{catalog ? `${catalog.groups.length} групп, ${total} позиций. Изменения цен пишутся в журнал; отправленные КП не меняются.` : ''}</p>
      </div>
      <ErrorNote text={err} />
      <div className="box">
        <div className="prw">
          <div className="glist" aria-label="Группы прайса">
            {byCat.map(([cat, gs]) => (
              <div key={cat}>
                <div className="gcat">{cat}</div>
                {gs.map((g) => (
                  <button type="button" key={g.id} className={g.id === sel ? 'on' : undefined} onClick={() => { setSel(g.id); setQ(''); setAdding(false); }}>
                    <span>{g.name}</span><small>{g.items.length}</small>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="prices-right">
            {group && (
              <>
                <div className="head">
                  <div>
                    <div className="eyebrow">{group.category}</div>
                    <h2>{group.name}</h2>
                    <span className="foot">
                      {group.rule === 'sheet' ? `Цена за лист${group.sheetArea ? `, ${String(group.sheetArea).replace('.', ',')} м²` : ''}; в расчёте — за м²` : `Цена за ${group.unit}`}
                      {group.source ? ` · источник: ${group.source}` : ''}
                    </span>
                  </div>
                  <div className="actions">
                    <button className="btn" type="button" onClick={() => setAdding((v) => !v)}>+ позиция</button>
                    <span className="soon"><button className="btn" type="button" disabled>Загрузить Excel</button><small>скоро</small></span>
                  </div>
                </div>
                {adding && <AddItem groupId={group.id} onAdded={(it) => { replaceItem(it); setAdding(false); }} />}
                <label className="field">Поиск в группе<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название, декор или артикул" /></label>
                <table className="tab">
                  <thead><tr><th>Позиция</th><th>Ед.</th><th className="num">Цена поставщика, ₽</th><th /></tr></thead>
                  <tbody>
                    {items.map((it) => <ItemRow key={it.id} item={it} unit={group.rule === 'sheet' ? 'лист' : group.unit} onSaved={replaceItem} />)}
                    {!items.length && <tr><td colSpan={4} className="empty">Ничего не нашли.</td></tr>}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ItemRow({ item, unit, onSaved }: { item: CatalogItemView; unit: string; onSaved: (it: CatalogItemView) => void }) {
  const [price, setPrice] = useState(item.price ?? 0);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setPrice(item.price ?? 0), [item.price]);

  const commit = async () => {
    if (price === (item.price ?? 0)) return;
    if (!(price > 0)) { setErr('Цена должна быть больше нуля.'); setState('error'); return; }
    setState('saving'); setErr(null);
    try {
      const r = await api.patchItem(item.id, { price });
      onSaved({ ...item, ...r.item });
      setState('saved');
    } catch (x) { setErr(errText(x)); setState('error'); }
  };

  return (
    <tr className={state === 'error' ? 'bad' : undefined}>
      <td>{item.name}{item.status && <span className="sub mark">{item.status}</span>}{err && <span className="sub mark">{err}</span>}</td>
      <td>{unit}</td>
      <td className="num">
        <NumInput className="in price" aria-label={`Цена: ${item.name}`} digits={2} value={price} onValue={setPrice}
          onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setPrice(item.price ?? 0); }} />
      </td>
      <td className="state">{state === 'saving' ? 'сохраняем…' : state === 'saved' ? `сохранено · ${rubUnit(item.price)}` : ''}</td>
    </tr>
  );
}

function AddItem({ groupId, onAdded }: { groupId: string; onAdded: (it: CatalogItemView) => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr('Укажите название позиции.'); return; }
    if (!(price > 0)) { setErr('Укажите цену больше нуля.'); return; }
    setBusy(true); setErr(null);
    try { const r = await api.addItem(groupId, name.trim(), price); onAdded(r.item); } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };
  return (
    <form className="inline-form" onSubmit={submit}>
      <label className="field wide">Название<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <label className="field">Цена, ₽<NumInput digits={2} value={price} onValue={setPrice} /></label>
      <button className="btn solid" type="submit" disabled={busy}>Добавить позицию</button>
      <ErrorNote text={err} />
    </form>
  );
}
