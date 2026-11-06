// Выбор позиции прайса с поиском: показывает выбранный артикул; при вводе ищет по названию/артикулу
// в текущей группе, а если в ней не нашлось — во всех группах блока. Стрелки, Enter, Esc.
import { useEffect, useMemo, useRef, useState } from 'react';

export interface ComboItem { id: string; name: string; group: string; status?: string }

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[\s"«»()*×x.,-]+/g, ' ').trim();

/** Совпадение: все слова запроса есть в названии (порядок не важен). */
export function matches(name: string, query: string): boolean {
  const n = norm(name);
  return norm(query).split(' ').filter(Boolean).every((w) => n.includes(w) || n.replace(/ /g, '').includes(w));
}

export function ItemCombo({ value, groupItems, allItems, onPick, label, placeholder, disabled }: {
  value: string | null | undefined;
  /** Позиции выбранной группы (показываются без поиска). */
  groupItems: ComboItem[];
  /** Где искать, если ввели текст: все группы блока. */
  allItems: ComboItem[];
  onPick: (id: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const cur = allItems.find((it) => it.id === value) ?? groupItems.find((it) => it.id === value);

  const found = useMemo(() => {
    if (!q.trim()) return groupItems.filter((it) => !it.status || it.id === value);
    const inGroup = groupItems.filter((it) => !it.status && matches(it.name, q));
    const rest = allItems.filter((it) => !it.status && matches(it.name, q) && !inGroup.some((x) => x.id === it.id));
    return [...inGroup, ...rest];
  }, [q, groupItems, allItems, value]);
  const shown = found.slice(0, 80);
  const showGroup = q.trim() !== '' || groupItems.length === 0;

  useEffect(() => { setHi(0); }, [q, open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  useEffect(() => { list.current?.children[hi]?.scrollIntoView({ block: 'nearest' }); }, [hi]);

  const pick = (id: string) => { onPick(id); setOpen(false); setQ(''); };
  return (
    <div className="combo" ref={box}>
      <input
        className="in" role="combobox" aria-expanded={open} aria-label={label} disabled={disabled}
        value={open ? q : cur ? cur.name + (cur.status ? ` (${cur.status})` : '') : ''}
        placeholder={open && cur ? cur.name : placeholder}
        title={cur?.name}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(shown.length - 1, h + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === 'Enter' && open && shown[hi]) { e.preventDefault(); pick(shown[hi].id); }
          else if (e.key === 'Escape') { setOpen(false); setQ(''); }
          else if (e.key === 'Tab') { setOpen(false); setQ(''); }
        }}
      />
      {open && (
        <ul className="combo-list" role="listbox" ref={list}>
          {shown.map((it, i) => (
            <li key={it.id} role="option" aria-selected={it.id === value} className={`${i === hi ? 'hi' : ''}${it.id === value ? ' sel' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(it.id); }} onMouseEnter={() => setHi(i)}>
              {it.name}{it.status ? ` (${it.status})` : ''}
              {showGroup && <small>{it.group}</small>}
            </li>
          ))}
          {!shown.length && <li className="none">{q.trim() ? 'Ничего не нашли — проверьте артикул или выберите группу' : 'Сначала выберите группу или начните вводить артикул'}</li>}
          {found.length > shown.length && <li className="none">Ещё {found.length - shown.length} — уточните запрос</li>}
        </ul>
      )}
    </div>
  );
}
