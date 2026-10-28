// Приведение входа расчёта к форме CalcInput и вырезание себестоимости из ответов менеджеру.
import { SWITCH_NONE, normalizeSettings } from '../../engine/src/index.ts';
import type { CalcInput, CalcResult, Catalog, LightInput, ProductKind, Row, RowResult, Settings } from '../../engine/src/index.ts';
import type { Pro100Line } from '../../engine/src/index.ts';

export type Role = 'owner' | 'head' | 'manager';
export const KINDS: ProductKind[] = ['kitchen', 'cabinet'];
export const STATUSES = ['draft', 'saved', 'in_kp', 'kp_sent', 'contract', 'archived'];

export class HttpError extends Error {
  status: number;
  extra?: Record<string, unknown>;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const MAX_ROWS = 500;
const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : 0);
const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : num(v));

export function emptyLight(s: Settings): LightInput {
  return { enabled: false, profileId: s.light.profiles[0]?.id ?? '', segments: [] };
}

export function emptyInput(kind: ProductKind, s: Settings): CalcInput {
  return { kind, rows: [], light: emptyLight(s), discountPct: 0 };
}

function cleanRow(r: any): Row {
  if (!r || typeof r !== 'object') throw new HttpError(400, 'Неверная строка расчёта');
  const row: Row = {
    id: str(r.id, 100) || crypto.randomUUID(),
    block: str(r.block, 50),
    qty: num(r.qty),
  };
  if (r.pro100 != null) row.pro100 = str(r.pro100, 100) || null;
  if (r.qtyPro100 != null) row.qtyPro100 = numOrNull(r.qtyPro100);
  if (r.itemId != null) row.itemId = str(r.itemId, 100) || null;
  if (r.own != null) row.own = typeof r.own === 'object' ? { name: str(r.own.name), unit: str(r.own.unit, 30), price: num(r.own.price) } : null;
  if (r.realMaterial != null) row.realMaterial = str(r.realMaterial, 500) || null;
  if (r.linkTo != null) row.linkTo = str(r.linkTo, 100) || null;
  if (r.web != null) {
    row.web = typeof r.web === 'object'
      ? { url: cleanUrl(r.web.url), name: str(r.web.name), price: Math.max(0, num(r.web.price)), unit: str(r.web.unit, 30) || 'шт' }
      : null;
  }
  if (r.noMarkup === true) row.noMarkup = true;
  return row;
}

/** Ссылка на товар: только http(s), иначе пусто (в интерфейсе она открывается в новой вкладке). */
function cleanUrl(v: unknown): string {
  const u = str(v, 2000).trim();
  return /^https?:\/\//i.test(u) ? u : '';
}

/**
 * «Без наценки» меняют только руководитель и владелец. От менеджера: у существующих строк — прежнее значение,
 * у новых — false (менеджер видит признак, но поменять его не может).
 */
export function keepNoMarkup(rows: Row[], prev: Row[]): Row[] {
  const was = new Map(prev.map((r) => [r.id, r.noMarkup === true]));
  return rows.map((r) => {
    const { noMarkup, ...rest } = r;
    return was.get(r.id) ? { ...rest, noMarkup: true } : rest;
  });
}

/** Вход от интерфейса → CalcInput. Вид изделия задаёт расчёт, а не тело запроса. */
export function cleanInput(raw: any, kind: ProductKind, s: Settings): CalcInput {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Нет данных расчёта (input)');
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  if (rows.length > MAX_ROWS) throw new HttpError(400, `Слишком много строк: больше ${MAX_ROWS}`);
  const l = raw.light && typeof raw.light === 'object' ? raw.light : {};
  const segs = Array.isArray(l.segments) ? l.segments.slice(0, 100) : [];
  return {
    kind,
    rows: rows.map(cleanRow),
    light: {
      enabled: l.enabled === true,
      profileId: str(l.profileId, 50) || emptyLight(s).profileId,
      segments: segs.map((x: any) => {
        const seg: LightInput['segments'][number] = { name: str(x?.name, 100), lengthM: num(x?.lengthM), switchId: str(x?.switchId, 50) };
        const profileId = str(x?.profileId, 50);
        if (profileId) seg.profileId = profileId;
        return seg;
      }),
    },
    discountPct: num(raw.discountPct),
    ...(raw.deliveryRub != null && raw.deliveryRub !== '' ? { deliveryRub: Math.max(0, num(raw.deliveryRub)) } : {}),
  };
}

export function cleanUnparsed(raw: unknown): Pro100Line[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 500).map((x: any) => ({ name: str(x?.name, 200), qty: num(x?.qty), unit: str(x?.unit, 30) }));
}

export function parseKind(v: unknown): ProductKind {
  if (!KINDS.includes(v as ProductKind)) throw new HttpError(400, 'Неизвестный вид изделия');
  return v as ProductKind;
}

// --- что видит менеджер ---

function managerRow(r: RowResult): Record<string, unknown> {
  if (r.block === 'light') return { id: r.id, block: r.block, name: r.name, unit: r.unit, qty: r.qty, retail: r.retail };
  const { unitCost, cost, prod, costNote, ...rest } = r;
  return rest;
}

/** Ответ расчёта по роли: менеджеру без себестоимости, производственной цены и маржи. */
export function viewFor(role: Role, v: CalcResult): unknown {
  if (role !== 'manager') return v;
  const { cost, prod, margin, costByGroup, rows, light, ...rest } = v;
  return {
    ...rest,
    rows: rows.map(managerRow),
    light: light ? { ...light, rows: light.rows.map(managerRow) } : null,
  };
}

export function settingsFor(role: Role, s: Settings, rev: number): unknown {
  if (role !== 'manager') return { ...s, rev };
  return {
    montagePct: s.montagePct,
    deliveryDefaultRub: s.deliveryDefaultRub,
    roundTo: s.roundTo,
    light: {
      tape: { name: s.light.tape.name },
      profiles: s.light.profiles.map((p) => ({ id: p.id, name: p.name })),
      switches: s.light.switches.map((p) => ({ id: p.id, name: p.name })),
    },
  };
}

export function catalogFor(role: Role, c: Catalog & { version: number }): unknown {
  if (role !== 'manager') return c;
  return {
    version: c.version,
    groups: c.groups.map((g) => ({ ...g, items: g.items.map(({ price, ...it }) => it) })),
  };
}

// --- проверка настроек от владельца ---

const pos = (v: unknown, name: string, allowZero = false): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (!allowZero && v === 0)) throw new HttpError(400, `Неверное значение: ${name}`);
  return v;
};

export function cleanSettings(raw: any): Settings {
  if (!raw || typeof raw !== 'object' || !raw.light || typeof raw.light !== 'object') throw new HttpError(400, 'Нет настроек');
  const L = raw.light;
  const list = (a: unknown, name: string) => {
    if (!Array.isArray(a)) throw new HttpError(400, `Неверный список: ${name}`);
    return a;
  };
  const named = (a: unknown, name: string) => list(a, name).map((x: any) => {
    if (!str(x?.id, 50) || !str(x?.name)) throw new HttpError(400, `У позиции «${name}» нет кода или названия`);
    return { id: str(x.id, 50), name: str(x.name), price: pos(x.price, `${name}: цена`, true) };
  });
  const t = L.tape ?? {};
  return normalizeSettings({
    kProd: pos(raw.kProd, 'наценка производства'),
    kShop: pos(raw.kShop, 'наценка магазина'),
    waste: pos(raw.waste, 'отходы'),
    edgePerM2: pos(raw.edgePerM2, 'кромка', true),
    ldspSheetArea: pos(raw.ldspSheetArea, 'площадь листа ЛДСП'),
    montagePct: pos(raw.montagePct, 'монтаж, %', true),
    deliveryDefaultRub: pos(raw.deliveryDefaultRub, 'доставка по умолчанию', true),
    lightReserve: pos(raw.lightReserve, 'запас мощности', true),
    roundTo: pos(raw.roundTo, 'шаг округления'),
    light: {
      tape: {
        name: str(t.name) || 'Лента',
        price: pos(t.price, 'цена ленты', true),
        wattPerM: pos(t.wattPerM, 'мощность ленты', true),
        voltage: pos(t.voltage, 'напряжение ленты'),
        maxRunM: pos(t.maxRunM, 'длина участка ленты'),
      },
      profiles: named(L.profiles, 'профили'),
      psus: list(L.psus, 'блоки питания').map((x: any) => ({ watt: pos(x?.watt, 'мощность блока питания'), price: pos(x?.price, 'цена блока питания', true) })),
      // «Нет (напрямую к слаботочке)» есть всегда, цена 0, не редактируется и не удаляется
      switches: named(list(L.switches, 'выключатели').filter((x: any) => x?.id !== SWITCH_NONE), 'выключатели'),
    },
  });
}
