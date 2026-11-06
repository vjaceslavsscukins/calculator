// Окно «Вставить из PRO100»: разбор вставки сервером и применение к расчёту.
import { useEffect, useRef, useState } from 'react';
import { api, type BlockDef, type CalcInput, type Pro100Line, type Row } from '../../api.ts';
import { ErrorNote } from '../../components/Layout.tsx';
import { errText, num } from '../../format.ts';

export function PasteDialog({ kind, rows, blocks, onClose, onApply }: {
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
