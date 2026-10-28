import { useEffect, useState } from 'react';
import { api, type AuditEntry } from '../api.ts';
import { ErrorNote } from '../components/Layout.tsx';
import { dateTime, errText } from '../format.ts';

function details(d: unknown): string {
  if (d == null) return '';
  if (typeof d === 'string') return d;
  if (typeof d === 'object') {
    const o = d as Record<string, unknown>;
    const parts: string[] = [];
    if (o.group || o.item) parts.push([o.group, o.item].filter(Boolean).map(String).join(': '));
    for (const [k, v] of Object.entries(o)) {
      if (k === 'group' || k === 'item' || k === 'itemId') continue;
      const name = KEY_TITLES[k] ?? k;
      if (v && typeof v === 'object' && 'before' in v && 'after' in v) {
        const c = v as { before: unknown; after: unknown };
        parts.push(`${name}: ${fmt(c.before)} → ${fmt(c.after)}`);
      } else parts.push(`${name}: ${fmt(v)}`);
    }
    return parts.join('; ');
  }
  return String(d);
}
const KEY_TITLES: Record<string, string> = {
  price: 'цена', name: 'название', status: 'пометка', email: 'почта', role: 'роль', cityId: 'город', disabled: 'отключён',
  firstName: 'имя', lastName: 'фамилия', kProd: 'наценка производства', kShop: 'наценка магазина', waste: 'отходы',
  edgePerM2: 'кромка, ₽/м²', ldspSheetArea: 'площадь листа', deliveryPct: 'доставка и монтаж, %', montagePct: 'монтаж, %', deliveryDefaultRub: 'доставка по умолчанию, ₽', lightReserve: 'запас мощности',
  roundTo: 'округление', light: 'подсветка',
};
const fmt = (v: unknown) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function AuditPage() {
  const [list, setList] = useState<AuditEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.audit(200).then((r) => setList(r.entries)).catch((x) => setErr(errText(x))); }, []);
  return (
    <section className="view">
      <div><div className="eyebrow">Кто, что и когда поменял</div><h1>Журнал</h1></div>
      <ErrorNote text={err} />
      <div className="panel">
        <table className="tab">
          <thead><tr><th style={{ width: 150 }}>Когда</th><th style={{ width: 180 }}>Кто</th><th style={{ width: 180 }}>Действие</th><th style={{ width: 200 }}>Что</th><th>Подробности</th></tr></thead>
          <tbody>
            {list?.map((e, k) => (
              <tr key={k}><td>{dateTime(e.at)}</td><td>{e.userName}</td><td>{e.action}</td><td>{e.entity}</td><td className="wrap">{details(e.details)}</td></tr>
            ))}
            {list && !list.length && <tr><td colSpan={5} className="empty">Записей пока нет.</td></tr>}
            {!list && !err && <tr><td colSpan={5} className="empty">Загружаем…</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
