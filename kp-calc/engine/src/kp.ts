// Коммерческое предложение: цены изделий и итог КП из результатов расчёта (compute), список «Материалы и комплектация»
// и плашки выгод по строкам расчёта. Чистые функции; округление — только при выводе.
import type { CalcInput, CalcResult, Settings } from './types.ts';
import type { CatalogIndex } from './calc.ts';
import { isLdspRow } from './calc.ts';

/** Цена изделия в КП: розница («было»), скидка, мебель со скидкой («стало»), монтаж и доставка отдельно. */
export interface KpItemPrice {
  retail: number;
  discountPct: number;
  discount: number;
  /** Мебель со скидкой. */
  price: number;
  montage: number;
  delivery: number;
  /** price + montage + delivery. */
  total: number;
}

export interface KpTotals {
  /** Сумма розницы изделий. */
  goods: number;
  discount: number;
  /** Процент скидки, если у всех изделий со скидкой он одинаковый; иначе null. */
  discountPct: number | null;
  /** Мебель со скидкой. */
  furniture: number;
  montage: number;
  delivery: number;
  total: number;
}

export function kpItemPrice(r: CalcResult, input: Pick<CalcInput, 'discountPct'>): KpItemPrice {
  return {
    retail: r.retail,
    discountPct: Math.min(100, Math.max(0, input.discountPct || 0)),
    discount: r.discount,
    price: r.furnitureAfterDiscount,
    montage: r.montage,
    delivery: r.delivery,
    total: r.total,
  };
}

/** Итог КП = сумма изделий. Скидка показывается как в расчётах; монтаж и доставка — отдельными строками. */
export function kpTotals(items: KpItemPrice[]): KpTotals {
  const sum = (k: keyof KpItemPrice) => items.reduce((a, x) => a + x[k], 0);
  const pcts = [...new Set(items.filter((x) => x.discount > 0).map((x) => x.discountPct))];
  return {
    goods: sum('retail'),
    discount: sum('discount'),
    discountPct: pcts.length === 1 ? pcts[0] : null,
    furniture: sum('price'),
    montage: sum('montage'),
    delivery: sum('delivery'),
    total: sum('total'),
  };
}

export interface KpMaterial { role: string; value: string }

/** Группы, у которых в КП пишем «группа, позиция» (материал), а не только позицию. */
const MATERIAL_CATEGORIES = new Set(['ЛДСП корпус', 'Фасады', 'Столешницы', 'Стеновые панели']);

/** Роль строки по блоку и группе прайса. null — в КП не показываем (навесы и прочий крепёж). */
function roleOf(category: string, group: string, block: string, kind: CalcInput['kind']): { role: string; part?: 'up' | 'low' } | null {
  const part = kind === 'kitchen' && (block === 'up' || block === 'low') ? block : undefined;
  if (category === 'ЛДСП корпус') return { role: 'Корпус', part };
  if (category === 'Фасады') return { role: 'Фасады', part };
  if (category === 'Столешницы') return { role: 'Столешница' };
  if (category === 'Стеновые панели') return { role: 'Стеновая панель' };
  if (category === 'Плинтус') return { role: 'Плинтус' };
  const g = group.toLowerCase();
  if (g.startsWith('хдф')) return { role: 'Задняя стенка' };
  if (g.startsWith('петл')) return { role: 'Петли' };
  if (g.startsWith('подъём') || g.startsWith('подъем')) return { role: 'Подъёмники' };
  if (g.startsWith('ящик')) return { role: 'Ящики' };
  if (g.includes('ручк') || g.includes('gola')) return { role: 'Открывание' };
  if (g.startsWith('сушк') || g.startsWith('бутылочниц')) return { role: 'Наполнение' };
  if (g.startsWith('плинтус')) return { role: 'Плинтус' };
  if (g.startsWith('цоколь')) return { role: 'Цоколь' };
  if (g.startsWith('навес')) return null;
  return { role: group };
}

const ROLE_ORDER = ['Корпус', 'Фасады', 'Задняя стенка', 'Столешница', 'Стеновая панель', 'Плинтус', 'Ящики', 'Петли', 'Подъёмники', 'Открывание', 'Наполнение', 'Цоколь', 'Подсветка'];
const PART_TITLES: Record<string, Record<'up' | 'low', string>> = {
  Корпус: { up: 'Корпус верхних шкафов', low: 'Корпус нижних шкафов' },
  Фасады: { up: 'Фасады верхние', low: 'Фасады нижние' },
};

/**
 * «Материалы и комплектация» для КП по строкам расчёта: роль → «реальный материал» или название позиции.
 * Одинаковые роли сливаются; у кухни корпус и фасады делятся на верх и низ, если материалы разные.
 * Менеджер потом правит список вручную.
 */
export function kpMaterials(input: CalcInput, idx: CatalogIndex, s: Settings): KpMaterial[] {
  type Entry = { role: string; part?: 'up' | 'low'; value: string; order: number };
  const entries: Entry[] = [];
  let extra = 1000;
  const valueOf = (rowId: string): string => {
    const r = input.rows.find((x) => x.id === rowId);
    if (!r) return '';
    if (r.realMaterial?.trim()) return r.realMaterial.trim();
    const f = idx.item(r.itemId);
    return f ? (MATERIAL_CATEGORIES.has(f.group.category) ? `${f.group.name}, ${f.item.name}` : f.item.name) : '';
  };
  for (const r of input.rows) {
    if (r.block === 'light' || !(r.qty > 0)) continue;
    if (r.own || r.web) {
      const name = (r.realMaterial?.trim() || r.own?.name || r.web?.name || '').trim();
      if (name) entries.push({ role: 'Дополнительно', value: name, order: extra++ });
      continue;
    }
    if (r.linkTo) {
      const src = input.rows.find((x) => x.id === r.linkTo);
      const v = r.realMaterial?.trim() || (src && isLdspRow(src, idx) ? `ЛДСП в цвет корпуса (${valueOf(src.id)})` : '');
      if (v) entries.push({ role: 'Задняя стенка', value: v, order: ROLE_ORDER.indexOf('Задняя стенка') });
      continue;
    }
    const f = idx.item(r.itemId);
    if (!f) continue;
    const role = roleOf(f.group.category, f.group.name, r.block, input.kind);
    if (!role) continue;
    const value = valueOf(r.id);
    if (!value) continue;
    const order = ROLE_ORDER.indexOf(role.role);
    entries.push({ ...role, value, order: order < 0 ? 500 : order });
  }
  if (input.light?.enabled && input.light.segments.some((x) => x.lengthM > 0)) {
    const profiles = [...new Set(input.light.segments.filter((x) => x.lengthM > 0)
      .map((x) => s.light.profiles.find((p) => p.id === (x.profileId || input.light.profileId))?.name).filter(Boolean))];
    const switches = [...new Set(input.light.segments.filter((x) => x.lengthM > 0 && x.switchId !== 'none')
      .map((x) => s.light.switches.find((w) => w.id === x.switchId)?.name).filter(Boolean))];
    const v = [s.light.tape.name, ...profiles.map((p) => String(p).toLowerCase()), ...switches.map((w) => String(w).toLowerCase())].join(', ');
    entries.push({ role: 'Подсветка', value: v, order: ROLE_ORDER.indexOf('Подсветка') });
  }

  // слияние: одна строка на роль; у корпуса и фасадов кухни — верх и низ отдельно, если материалы разные
  const out: (KpMaterial & { order: number; sub: number })[] = [];
  const byRole = new Map<string, Entry[]>();
  for (const e of entries) byRole.set(e.role, [...(byRole.get(e.role) ?? []), e]);
  for (const [role, list] of byRole) {
    const order = Math.min(...list.map((e) => e.order));
    const uniq = (xs: string[]) => [...new Set(xs)];
    const parts = PART_TITLES[role];
    const up = uniq(list.filter((e) => e.part === 'up').map((e) => e.value));
    const low = uniq(list.filter((e) => e.part === 'low').map((e) => e.value));
    const rest = uniq(list.filter((e) => !e.part).map((e) => e.value));
    if (parts && up.length && low.length && uniq([...up, ...low]).join('|') !== up.join('|')) {
      out.push({ role: parts.up, value: up.join('; '), order, sub: 0 });
      out.push({ role: parts.low, value: low.join('; '), order, sub: 1 });
      if (rest.length) out.push({ role, value: rest.join('; '), order, sub: 2 });
    } else {
      out.push({ role, value: uniq(list.map((e) => e.value)).join('; '), order, sub: 0 });
    }
  }
  return out.sort((a, b) => a.order - b.order || a.sub - b.sub).map(({ role, value }) => ({ role, value }));
}

/** Плашки «что вы получаете» по материалам. Только то, что следует из расчёта; менеджер правит. */
export function kpBenefits(materials: KpMaterial[]): string[] {
  const all = materials.map((m) => `${m.role} ${m.value}`.toLowerCase());
  const has = (re: RegExp) => all.some((x) => re.test(x));
  const out: string[] = [];
  if (has(/доводчик|blumotion/)) out.push('Плавное закрывание с доводчиками');
  if (has(/gola/)) out.push('Без ручек — профиль Gola');
  if (has(/tip-on|push/)) out.push('Открывание от нажатия');
  if (has(/blum/)) out.push('Фурнитура Blum');
  else if (has(/hettich/)) out.push('Фурнитура Hettich');
  if (has(/^подсветка/)) out.push(has(/сенсор|взмах/) ? 'Подсветка с сенсором' : 'Встроенная подсветка');
  out.push('Контрольная сборка на производстве');
  return out.slice(0, 5);
}
