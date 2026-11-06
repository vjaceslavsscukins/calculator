// Строки таблицы расчёта: выбор позиции (группа → артикул с поиском), своя строка, ссылка с сайта, подсветка, «добавить из прайса».
import { useState, type ReactNode } from 'react';
import { api, type BlockDef, type CatalogGroupView, type Row, type ViewRow } from '../../api.ts';
import { pro100Unit } from '../../../../engine/src/pro100.ts';
import { ItemCombo } from '../../components/ItemCombo.tsx';
import { NumInput } from '../../components/NumInput.tsx';
import { errText, num, rub, rubUnit } from '../../format.ts';
import { newId, LINK, LINK_GROUP, toCombo } from './shared.ts';
import type { LdspLink } from './shared.ts';

/** Группы прайса для левого списка; если в блоке несколько категорий (ЛДСП корпус, Фасады) — разделены заголовками. */
export function GroupOptions({ groups }: { groups: CatalogGroupView[] }) {
  const cats = [...new Set(groups.map((g) => g.category))];
  const opts = (list: CatalogGroupView[]) => list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>);
  if (cats.length < 2) return <>{opts(groups)}</>;
  return <>{cats.map((c) => <optgroup key={c} label={c}>{opts(groups.filter((g) => g.category === c))}</optgroup>)}</>;
}

/**
 * Выбор позиции в две ступени, как в книге: слева группа прайса (Egger, AGT…), справа — артикулы только этой группы.
 * Позиции со status (например «нет в новом прайсе») не предлагаем; уже выбранную показываем, чтобы не потерять.
 */
export function ItemSelect({ value, groups, onChange, label, links }: {
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
      {only && (!value || curGroup) ? (
        // группа одна (например, у «Петли» из PRO100) — выбирать нечего, показываем её названием
        <span className="in group-fixed" title="Группа прайса для этой строки">{shown[0].name}</span>
      ) : (
        <select className="in" aria-label={`${label}: группа`} value={gid} onChange={(e) => setPick(e.target.value)}>
          {!gid && <option value="">— группа —</option>}
          {value && !isLink && !curGroup && !pick && <option value="">Позиция не найдена в прайсе</option>}
          {links && <option value={LINK_GROUP}>В цвет корпуса</option>}
          <GroupOptions groups={shown} />
        </select>
      )}
      {gid === LINK_GROUP ? (
        <select className="in" aria-label={label} value={inGroup ? value ?? '' : ''} onChange={(e) => e.target.value && choose(e.target.value)}>
          {!inGroup && <option value="">— выберите строку ЛДСП —</option>}
          {lostLink && <option value={value!}>Строка ЛДСП не найдена</option>}
          {links?.map((l) => <option key={l.id} value={LINK + l.id}>{l.label}</option>)}
          {!links?.length && <option value="" disabled>Сначала выберите ЛДСП корпуса в расчёте</option>}
        </select>
      ) : (
        <ItemCombo value={inGroup ? value : null} label={label} onPick={choose}
          groupItems={toCombo(items, g)} allItems={shown.flatMap((x) => toCombo(x.items, x))}
          placeholder={gid ? 'артикул или поиск…' : 'поиск по артикулу…'} />
      )}
    </div>
  );
}

/** Галочка «без наценки»: только руководитель и владелец (сервер не даёт менеджеру её менять). */
export function NoMarkup({ row, onChange }: { row: Row; onChange: (p: Partial<Row>) => void }) {
  return (
    <label className="nomark" title="Розница = себестоимость: наценки производства и магазина не применяются">
      <input type="checkbox" checked={!!row.noMarkup} onChange={(e) => onChange({ noMarkup: e.target.checked })} />без наценки
    </label>
  );
}

export function CalcRow({ row, vr, groups, boss, roundTo, links, onChange, onDup, onRemove }: {
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
          <button className="link realbtn" type="button" title="Если нужного материала нет в прайсе — впишите, что писать в КП и спецификации" onClick={() => onChange({ realMaterial: '' })}>другой материал</button>
        )}
      </>
    );
    // пока позиция не выбрана — единица, в которой PRO100 дал количество (м², м.п., шт)
    unit = <span className="unit-t">{!row.itemId && !row.linkTo && row.pro100 ? pro100Unit(row.pro100) : vr?.unit ?? ''}</span>;
  }
  return (
    <tr id={`row-${row.id}`} className={warn.length ? 'bad' : undefined}>
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
export function WebRow({ row, vr, boss, roundTo, onChange, onRemove }: {
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

export function LightRow({ r, boss, roundTo }: { r: ViewRow; boss: boolean; roundTo: number }) {
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

export function AddRow({ block, groups, cols, onAdd }: { block: BlockDef; groups: CatalogGroupView[]; cols: number; onAdd: (r: Row) => void }) {
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
            <ItemCombo value={null} label={`Добавить позицию: ${block.title}`}
              groupItems={g ? toCombo(g.items, g) : []} allItems={shown.flatMap((x) => toCombo(x.items, x))}
              placeholder={g ? 'артикул или поиск…' : 'или найти по артикулу…'}
              onPick={(id) => { onAdd({ id: newId(), block: block.id, pro100: null, qtyPro100: null, qty: 1, itemId: id }); setGid(''); }} />
          </span>
        )}
        <button className="link" type="button" onClick={() => onAdd({ id: newId(), block: block.id, pro100: null, qtyPro100: null, qty: 1, own: { name: '', unit: 'шт', price: 0 } })}>+ своя строка</button>
      </td>
    </tr>
  );
}
