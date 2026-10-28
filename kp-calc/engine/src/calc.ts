// Расчёт цены: себестоимость → × наценка производства → × наценка магазина. Монтаж — % от розницы, доставка — суммой; скидка на них не действует.
import type { Catalog, CatalogGroup, CatalogItem, CalcInput, CalcResult, Row, RowResult, Settings } from './types.ts';
import { blocksOf } from './blocks.ts';
import { computeLight } from './light.ts';

export interface CatalogIndex {
  item(id: string | null | undefined): { item: CatalogItem; group: CatalogGroup } | undefined;
}

export function indexCatalog(catalog: Catalog): CatalogIndex {
  const map = new Map<string, { item: CatalogItem; group: CatalogGroup }>();
  for (const group of catalog.groups) for (const item of group.items) map.set(item.id, { item, group });
  return { item: (id) => (id ? map.get(id) : undefined) };
}

export const isLdsp = (g: CatalogGroup) => g.category === 'ЛДСП корпус' || g.name.startsWith('ЛДСП');

/** Площадь листа группы: у ЛДСП — из настроек, у остальных плит — своя. */
export function sheetArea(group: CatalogGroup, s: Settings): number {
  if (isLdsp(group) || !group.sheetArea) return s.ldspSheetArea;
  return group.sheetArea;
}

/** Себестоимость единицы позиции прайса. */
export function unitCostOf(item: CatalogItem, group: CatalogGroup, s: Settings): number {
  if (group.rule !== 'sheet') return item.price;
  return (item.price / sheetArea(group, s)) * s.waste + s.edgePerM2;
}

export function costGroupOf(group: CatalogGroup | undefined): string {
  if (!group) return 'Свободные строки';
  switch (group.category) {
    case 'ЛДСП корпус': return 'ЛДСП корпус';
    case 'Фасады': return 'Фасады';
    case 'Столешницы': case 'Стеновые панели': case 'Плинтус': return 'Столешницы и панели';
    default: return 'Фурнитура';
  }
}

const fmt = (n: number, d = 0) => n.toLocaleString('ru-RU', { maximumFractionDigits: d });

/** Строка, у которой выбран ЛДСП корпуса (её можно взять как «в цвет корпуса» для задней стенки). */
export function isLdspRow(row: Row, idx: CatalogIndex): boolean {
  if (row.own || row.web || row.linkTo) return false;
  const found = idx.item(row.itemId);
  return !!found && isLdsp(found.group);
}

/**
 * Себестоимость строки. rows — все строки расчёта (нужны для задней стенки «ЛДСП в цвет корпуса», Row.linkTo).
 * У свободной строки и ссылки с сайта с noMarkup наценки не применяются: розница = себестоимость.
 */
export function computeRow(row: Row, idx: CatalogIndex, s: Settings, rows: Row[] = []): RowResult {
  const warnings: string[] = [];
  const qty = Number.isFinite(row.qty) && row.qty > 0 ? row.qty : 0;
  let name = '', unit = 'шт', unitCost = 0, costGroup = 'Свободные строки', costNote: string | undefined;
  const fromItem = (found: { item: CatalogItem; group: CatalogGroup }) => {
    const { item, group } = found;
    name = `${group.name}: ${item.name}`; unit = group.rule === 'sheet' ? 'м²' : group.unit;
    unitCost = unitCostOf(item, group, s); costGroup = costGroupOf(group);
    if (!(item.price > 0)) warnings.push('Нет цены');
    if (item.status) warnings.push(item.status);
    if (group.rule === 'sheet') costNote = `лист ${fmt(item.price)} ₽ ÷ ${fmt(sheetArea(group, s), 3)} м² × ${fmt(s.waste, 2)} + ${fmt(s.edgePerM2)}`;
  };
  if (row.own) {
    name = row.own.name; unit = row.own.unit || 'шт'; unitCost = row.own.price > 0 ? row.own.price : 0;
    if (!(row.own.price > 0)) warnings.push('Нет цены');
  } else if (row.web) {
    name = row.web.name || 'Товар по ссылке'; unit = row.web.unit || 'шт'; unitCost = row.web.price > 0 ? row.web.price : 0;
    costGroup = 'Покупное по ссылкам';
    if (!(row.web.price > 0)) warnings.push('Нет цены');
  } else if (row.linkTo) {
    const src = rows.find((r) => r.id === row.linkTo);
    const found = src && isLdspRow(src, idx) ? idx.item(src.itemId) : undefined;
    if (!src) {
      name = 'ЛДСП в цвет корпуса';
      warnings.push('Строка ЛДСП корпуса, в цвет которой задняя стенка, не найдена');
    } else if (!found) {
      name = 'ЛДСП в цвет корпуса';
      warnings.push('В строке-источнике не выбран ЛДСП корпуса');
    } else {
      fromItem(found);
      name = `В цвет корпуса: ${name}`;
    }
  } else {
    const found = idx.item(row.itemId);
    if (!found) warnings.push('Не выбрана позиция прайса');
    else fromItem(found);
  }
  const cost = qty * unitCost;
  const plain = !!row.noMarkup && !!(row.own || row.web);
  const prod = plain ? cost : cost * s.kProd, retail = plain ? cost : prod * s.kShop;
  return { id: row.id, block: row.block, name, unit, qty, unitCost, cost, prod, retail, costGroup, costNote, warnings };
}

export function compute(input: CalcInput, catalog: Catalog | CatalogIndex, s: Settings): CalcResult {
  const idx = 'groups' in catalog ? indexCatalog(catalog) : catalog;
  const rows = input.rows.filter((r) => r.block !== 'light').map((r) => computeRow(r, idx, s, input.rows));
  const light = input.light?.enabled ? computeLight(input.light, s) : null;
  const all = light ? rows.concat(light.rows) : rows;
  const sum = (k: 'cost' | 'prod' | 'retail', list = all) => list.reduce((a, r) => a + r[k], 0);
  const cost = sum('cost'), prod = sum('prod'), retail = sum('retail');
  const pct = Math.min(100, Math.max(0, input.discountPct || 0));
  const discount = retail * pct / 100;
  const furnitureAfterDiscount = retail - discount;
  const montage = retail * (s.montagePct || 0) / 100;
  const d = input.deliveryRub ?? s.deliveryDefaultRub;
  const delivery = Number.isFinite(d) && (d as number) > 0 ? (d as number) : 0;
  const costByGroup: Record<string, number> = {};
  for (const r of all) costByGroup[r.costGroup] = (costByGroup[r.costGroup] ?? 0) + r.cost;
  const blocks = blocksOf(input.kind).map((b) => ({ block: b.id, title: b.title, retail: sum('retail', all.filter((r) => r.block === b.id)) }));
  const warnings = all.filter((r) => r.warnings.length).map((r) => `${r.name || 'Строка'}: ${r.warnings.join(', ')}`).concat(light?.warnings ?? []);
  return {
    rows: all, light, blocks, costByGroup, cost, prod, retail, discount, furnitureAfterDiscount, montage, delivery,
    total: furnitureAfterDiscount + montage + delivery, margin: furnitureAfterDiscount - cost, warnings,
  };
}

/** Округление только при выводе: до шага (по умолчанию 100 ₽). */
export function roundRub(n: number, step = 100): number {
  return Math.round(n / step) * step;
}
