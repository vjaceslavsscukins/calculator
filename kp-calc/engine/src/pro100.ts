// Разбор вставки из PRO100: строки «название, количество, единица». Сопоставление по названию строки, как в книге-калькуляторе.
import type { ProductKind, Row } from './types.ts';

export interface Pro100Line { name: string; qty: number; unit: string }
export interface Pro100Parse { lines: Pro100Line[]; skipped: string[] }

/** Какая строка PRO100 в какой блок попадает. Для шкафов ЛДСП и фасады идут в «Корпус» и «Фасады». */
export const PRO100_MAP: Record<string, { kitchen: string; cabinet: string }> = {
  'ЛДСП_верх': { kitchen: 'up', cabinet: 'body' },
  'Фасад_верх': { kitchen: 'up', cabinet: 'facade' },
  'ЛДСП_низ': { kitchen: 'low', cabinet: 'body' },
  'Фасад_низ': { kitchen: 'low', cabinet: 'facade' },
  'ХДФ': { kitchen: 'low', cabinet: 'body' },
  'Столешница': { kitchen: 'top', cabinet: 'free' },
  'Фартук': { kitchen: 'top', cabinet: 'free' },
  'Плинтус': { kitchen: 'top', cabinet: 'free' },
  'Петли': { kitchen: 'hw', cabinet: 'hw' },
  'Подъемный_механизм': { kitchen: 'hw', cabinet: 'hw' },
  'Выкатной_механизм': { kitchen: 'hw', cabinet: 'hw' },
  'Цоколь': { kitchen: 'hw', cabinet: 'hw' },
  'Профиль_GOLA_G12': { kitchen: 'hw', cabinet: 'hw' },
  'Профиль_GOLA_G13': { kitchen: 'hw', cabinet: 'hw' },
  'Ручка_верх': { kitchen: 'hw', cabinet: 'hw' },
  'Ручка_низ': { kitchen: 'hw', cabinet: 'hw' },
  'Бутылочница': { kitchen: 'hw', cabinet: 'hw' },
  'Сушка': { kitchen: 'hw', cabinet: 'hw' },
  'Комплект_крабов': { kitchen: 'hw', cabinet: 'hw' },
};

/**
 * Мелкий крепёж из PRO100 в КП не показываем: такие строки молча пропускаются (ни в строки, ни в «Не разобрано»).
 * Сравнение по началу названия без учёта регистра, ё/е, пробелов и подчёркиваний («Ножка_регулируемая» → «Ножка»).
 */
export const PRO100_IGNORED = [
  'Евровинт', 'Полкодержатель', 'Ножка', 'Саморез', 'Конфирмат', 'Шкант', 'Стяжка', 'Заглушка',
  'Минификс', 'Эксцентрик', 'Дюбель', 'Шуруп', 'Гвоздь',
];

const key = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е').replace(/[\s_]+/g, '_');
const MAP_BY_KEY = new Map(Object.keys(PRO100_MAP).map((k) => [key(k), k]));
const bare = (s: string) => key(s).replace(/_/g, '');
const IGNORED_KEYS = PRO100_IGNORED.map(bare);
/** Строка PRO100 — мелкий крепёж, который не показываем. */
export const isIgnoredPro100 = (name: string) => { const k = bare(name); return IGNORED_KEYS.some((i) => k.startsWith(i)); };

/** Разбирает текст, вставленный из PRO100 или из листа Excel (табуляция, «;» или пробелы). Десятичная запятая допускается. */
export function parsePro100(text: string): Pro100Parse {
  const lines: Pro100Line[] = [], skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.+?)[\t;]+\s*(-?\d+(?:[.,]\d+)?)\s*[\t;]*\s*(.*)$/) ?? line.match(/^(\S+)\s+(-?\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (!m) { skipped.push(line); continue; }
    const qty = parseFloat(m[2].replace(',', '.'));
    if (!Number.isFinite(qty)) { skipped.push(line); continue; }
    lines.push({ name: m[1].trim(), qty, unit: m[3].replace(/[\t;]/g, ' ').trim() });
  }
  return { lines, skipped };
}

export interface Pro100Apply { rows: Row[]; unparsed: Pro100Line[] }

/**
 * Превращает строки PRO100 в строки расчёта. Строки одного названия суммируются.
 * defaults — позиция прайса по умолчанию для строки PRO100 (например, последняя выбранная менеджером).
 */
export function applyPro100(kind: ProductKind, lines: Pro100Line[], defaults: Record<string, string> = {}, newId: () => string = () => crypto.randomUUID()): Pro100Apply {
  const agg = new Map<string, number>();
  const unparsed: Pro100Line[] = [];
  for (const l of lines) {
    const known = MAP_BY_KEY.get(key(l.name));
    if (!known) { if (!isIgnoredPro100(l.name)) unparsed.push(l); continue; }
    agg.set(known, Math.round(((agg.get(known) ?? 0) + l.qty) * 1000) / 1000);
  }
  const rows: Row[] = [...agg].map(([name, qty]) => ({
    id: newId(), block: PRO100_MAP[name][kind], pro100: name, qtyPro100: qty, qty, itemId: defaults[name] ?? null,
  }));
  return { rows, unparsed };
}

/** Обновляет количества в существующем расчёте новой вставкой: выбранные материалы сохраняются, исправленные вручную количества — тоже. */
export function mergePro100(existing: Row[], incoming: Row[]): Row[] {
  const out = existing.map((r) => ({ ...r }));
  for (const inc of incoming) {
    const same = out.find((r) => r.pro100 === inc.pro100);
    if (!same) { out.push(inc); continue; }
    const editedByHand = same.qtyPro100 != null && same.qty !== same.qtyPro100;
    same.qtyPro100 = inc.qtyPro100;
    if (!editedByHand) same.qty = inc.qty;
  }
  return out;
}
