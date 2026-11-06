// Загрузка прайса группы: файл Excel (.xlsx) или вставка двух колонок из Excel → выбор колонок «название» и «цена» →
// сервер показывает изменения и какие действующие КП изменятся → «Применить». Файл разбирается в браузере.
import { useEffect, useMemo, useState } from 'react';
import { api, type CatalogGroupView, type ImportPreview, type KpImpact, type PriceImportInfo } from '../api.ts';
import { ErrorNote } from './Layout.tsx';
import { dateTime, errText, rubUnit } from '../format.ts';

type Cell = string | number | boolean | Date | null;
type Sheet = { name: string; data: Cell[][] };

const cellText = (c: Cell) => (c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c)).trim();
/** «12 990,50 ₽», «12,990.50», 12990 → число; иначе 0. */
export function priceOf(c: Cell): number {
  if (typeof c === 'number') return Number.isFinite(c) && c > 0 ? c : 0;
  let s = cellText(c).replace(/[\s  ]/g, '').replace(/[^\d.,]/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
/** Колонки по заголовку: «наименование/название/артикул» и «цена/стоимость». */
function guessColumns(rows: Cell[][]): { header: number; name: number; price: number } {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const t = rows[r].map((c) => cellText(c).toLowerCase());
    const name = t.findIndex((x) => /наимен|назван|артикул|декор|товар|позиц/.test(x));
    const price = t.findIndex((x) => /цена|стоим|руб|₽|price/.test(x));
    if (name >= 0 && price >= 0) return { header: r, name, price };
  }
  // без заголовков: первая текстовая и первая числовая колонка
  const first = rows.find((r) => r.some((c) => typeof c === 'number')) ?? [];
  const price = first.findIndex((c) => typeof c === 'number');
  const name = first.findIndex((c) => typeof c === 'string' && c.trim().length > 1);
  return { header: -1, name: Math.max(0, name), price: Math.max(0, price) };
}
const fromPaste = (text: string): Cell[][] => text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t'));
const colName = (i: number) => String.fromCharCode(65 + (i % 26)).repeat(Math.floor(i / 26) + 1);
const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const pct = (n: number | null) => (n == null ? '' : `${n > 0 ? '+' : ''}${String(n).replace('.', ',')} %`);

export function PriceImport({ group, onClose, onApplied }: { group: CatalogGroupView; onClose: () => void; onApplied: () => void }) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [sheetIx, setSheetIx] = useState(0);
  const [paste, setPaste] = useState('');
  const [cols, setCols] = useState({ header: -1, name: 0, price: 1 });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [markMissing, setMarkMissing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ impact: KpImpact[]; text: string } | null>(null);

  const data: Cell[][] = sheets ? sheets[sheetIx]?.data ?? [] : fromPaste(paste);
  useEffect(() => { if (data.length) setCols(guessColumns(data)); setPreview(null); }, [sheets, sheetIx, paste]); // eslint-disable-line react-hooks/exhaustive-deps
  const width = Math.max(0, ...data.slice(0, 50).map((r) => r.length));
  const rows = useMemo(() => data.slice(cols.header + 1)
    .map((r) => ({ name: cellText(r[cols.name] ?? null).replace(/\s+/g, ' '), price: priceOf(r[cols.price] ?? null) }))
    .filter((r) => r.name && r.price > 0), [data, cols]);

  const openFile = async (f: File | undefined) => {
    if (!f) return;
    setErr(null); setPreview(null);
    if (!/\.xlsx$/i.test(f.name)) { setErr('Нужен файл Excel .xlsx. Старый .xls или PDF: откройте в Excel и сохраните как .xlsx, или скопируйте две колонки и вставьте ниже.'); return; }
    try {
      // библиотека Excel грузится только здесь — остальным экранам она не нужна
      const { default: readXlsxFile } = await import('read-excel-file/browser');
      const all = await readXlsxFile(f) as unknown as { sheet: string; data: Cell[][] }[];
      setSheets(all.map((s) => ({ name: s.sheet, data: s.data })));
      setSheetIx(0);
    } catch { setErr('Не удалось прочитать файл. Проверьте, что это Excel .xlsx.'); }
  };

  const check = async () => {
    setBusy(true); setErr(null);
    try { setPreview(await api.importPreview(group.id, rows)); } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.importApply(group.id, rows, markMissing);
      const s = r.summary;
      setDone({ impact: r.impact, text: `Прайс «${group.name}» обновлён: новых ${s.added}, изменилась цена ${s.changed}, помечено «нет в новом прайсе» ${s.missing}${s.restored ? `, вернулись ${s.restored}` : ''}.` });
      onApplied();
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };

  const unit = group.rule === 'sheet' ? 'лист' : group.unit;
  const d = preview?.diff;
  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-label={`Загрузить прайс: ${group.name}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide-modal">
        <div className="modal-head"><h2>Загрузить прайс: {group.name}</h2><button className="x big" type="button" aria-label="Закрыть" onClick={onClose}>×</button></div>
        {done ? (
          <>
            <div className="ok">{done.text}</div>
            <ImpactList impact={done.impact} after />
            <div className="actions"><button className="btn solid" type="button" onClick={onClose}>Готово</button></div>
          </>
        ) : (
          <>
            <p className="note">Цена в файле — за {unit}, как в этой группе. Сравнение по названию позиции (регистр и лишние пробелы не важны). Ничего не меняется, пока не нажмёте «Применить».</p>
            <div className="imp-src">
              <label className="btn">Выбрать файл .xlsx<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => openFile(e.target.files?.[0])} /></label>
              <span className="foot">или скопируйте в Excel две колонки (название и цена) и вставьте:</span>
            </div>
            {!sheets && <textarea className="paste small" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'W960 ST7 Белый классический\t5100\nU702 ST9 Кашемир\t6090'} aria-label="Вставка из Excel" />}
            {sheets && (
              <div className="imp-cols">
                {sheets.length > 1 && <label className="field">Лист<select value={sheetIx} onChange={(e) => setSheetIx(Number(e.target.value))}>{sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}</select></label>}
                <button className="link" type="button" onClick={() => { setSheets(null); setPreview(null); }}>другой файл / вставка</button>
              </div>
            )}
            {data.length > 0 && (
              <>
                <div className="imp-cols">
                  <label className="field">Колонка с названием<select value={cols.name} onChange={(e) => setCols({ ...cols, name: Number(e.target.value) })}>{Array.from({ length: width }, (_, i) => <option key={i} value={i}>{colName(i)}{cols.header >= 0 && data[cols.header]?.[i] != null ? ` — ${cellText(data[cols.header][i]).slice(0, 30)}` : ''}</option>)}</select></label>
                  <label className="field">Колонка с ценой<select value={cols.price} onChange={(e) => setCols({ ...cols, price: Number(e.target.value) })}>{Array.from({ length: width }, (_, i) => <option key={i} value={i}>{colName(i)}{cols.header >= 0 && data[cols.header]?.[i] != null ? ` — ${cellText(data[cols.header][i]).slice(0, 30)}` : ''}</option>)}</select></label>
                  <label className="field">Строка заголовка<select value={cols.header} onChange={(e) => setCols({ ...cols, header: Number(e.target.value) })}><option value={-1}>нет заголовка</option>{data.slice(0, 15).map((_, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label>
                </div>
                <table className="tab imp-sample">
                  <thead><tr><th>Название (первые строки)</th><th className="num">Цена</th></tr></thead>
                  <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i}><td>{r.name}</td><td className="num">{rubUnit(r.price)}</td></tr>)}</tbody>
                </table>
                <p className="foot">Строк с названием и ценой: <b>{rows.length}</b>{rows.length < data.length - cols.header - 1 ? ` (без цены или названия пропущено ${data.length - cols.header - 1 - rows.length})` : ''}</p>
              </>
            )}
            <ErrorNote text={err} />
            {!preview && <div className="actions"><button className="btn solid" type="button" disabled={busy || !rows.length} onClick={check}>{busy ? 'Сравниваем…' : 'Показать изменения'}</button><button className="btn" type="button" onClick={onClose}>Отмена</button></div>}
            {preview && d && (
              <>
                <div className="imp-sum">
                  <span><b>{d.changed.length}</b> изменилась цена</span>
                  <span><b>{d.added.length}</b> новых</span>
                  <span><b>{d.missing.length}</b> нет в файле</span>
                  {d.restored.length > 0 && <span><b>{d.restored.length}</b> вернулись</span>}
                  <span><b>{d.same}</b> без изменений</span>
                </div>
                {d.changed.length > 0 && <Details title={`Изменилась цена (${d.changed.length})`} open>
                  <table className="tab"><tbody>{d.changed.map((c) => <tr key={c.id}><td>{c.name}</td><td className="num">{rubUnit(c.before)} → <b>{rubUnit(c.after)}</b></td><td className={`num ${c.after > c.before ? 'up' : 'down'}`}>{pct(c.pct)}</td></tr>)}</tbody></table>
                </Details>}
                {d.added.length > 0 && <Details title={`Новые позиции (${d.added.length})`}>
                  <table className="tab"><tbody>{d.added.map((a, i) => <tr key={i}><td>{a.name}</td><td className="num">{rubUnit(a.price)}</td></tr>)}</tbody></table>
                </Details>}
                {d.missing.length > 0 && <Details title={`Нет в файле (${d.missing.length})`}>
                  <label className="check"><input type="checkbox" checked={markMissing} onChange={(e) => setMarkMissing(e.target.checked)} /> пометить «нет в новом прайсе» (в выборе не появятся, старые расчёты не сломаются)</label>
                  <table className="tab"><tbody>{d.missing.map((m) => <tr key={m.id}><td>{m.name}</td><td className="num">{rubUnit(m.price)}</td></tr>)}</tbody></table>
                </Details>}
                {d.duplicates.length > 0 && <p className="foot">В файле повторяются: {d.duplicates.slice(0, 5).join(', ')}{d.duplicates.length > 5 ? '…' : ''} — взята последняя строка.</p>}
                <ImpactList impact={preview.impact} />
                <div className="actions">
                  <button className="btn solid" type="button" disabled={busy || (!d.changed.length && !d.added.length && !(markMissing && d.missing.length) && !d.restored.length)} onClick={apply}>{busy ? 'Применяем…' : 'Применить'}</button>
                  <button className="btn" type="button" onClick={() => setPreview(null)}>Назад</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Details({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return <details className="imp-det" open={open}><summary>{title}</summary>{children}</details>;
}

function ImpactList({ impact, after }: { impact: KpImpact[]; after?: boolean }) {
  if (!impact.length) return <p className="foot">Действующих КП с позициями этой группы нет — клиентам ничего пересчитывать не придётся.</p>;
  return (
    <div className="imp-kp">
      <b>{after ? 'Менеджерам отправлено уведомление' : 'Действующие КП'}: при перерасчёте изменятся {impact.length}</b>
      <table className="tab"><tbody>{impact.map((x) => (
        <tr key={x.kpId}><td>{x.number} · {x.client}</td><td className={`num ${x.delta > 0 ? 'up' : 'down'}`}>{x.delta > 0 ? '+' : '−'}{rub(Math.abs(x.delta))} ({pct(x.pct)})</td><td>до {x.validUntil.split('-').reverse().join('.')}</td></tr>
      ))}</tbody></table>
      <p className="foot">Цена в отправленных КП зафиксирована и сама не меняется. Чтобы клиент увидел новую цену — «Новая версия» КП.</p>
    </div>
  );
}

/** История загрузок группы с откатом последней. */
export function ImportHistory({ groupId, version, onRolledBack }: { groupId: string; version: number; onRolledBack: () => void }) {
  const [list, setList] = useState<PriceImportInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.imports(groupId).then((r) => setList(r.imports)).catch(() => setList([])); }, [groupId, version]);
  if (!list?.length) return null;
  return (
    <details className="imp-hist">
      <summary>Загрузки файлом ({list.length})</summary>
      <ErrorNote text={err} />
      <table className="tab"><tbody>{list.map((x) => (
        <tr key={x.id}>
          <td>{dateTime(x.createdAt)} · {x.by || '—'}</td>
          <td>цена {x.summary.changed}, новых {x.summary.added}, «нет в прайсе» {x.summary.missing}</td>
          <td>{x.rolledBackAt ? `откачено ${dateTime(x.rolledBackAt)}` : x.canRollback ? <button className="link" type="button" onClick={async () => {
            if (!confirm('Вернуть цены группы как были до этой загрузки?')) return;
            try { await api.rollbackImport(x.id); onRolledBack(); } catch (e) { setErr(errText(e)); }
          }}>откатить</button> : ''}</td>
        </tr>
      ))}</tbody></table>
    </details>
  );
}
