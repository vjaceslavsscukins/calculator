// Расчёт цены: себестоимость → × наценка производства → × наценка магазина. Доставка и монтаж — % от розницы, скидка на них не действует.
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

const isLdsp = (g: CatalogGroup) => g.category === 'ЛДСП корпус' || g.name.startsWith('ЛДСП');

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

export function computeRow(row: Row, idx: CatalogIndex, s: Settings): RowResult {
  const warnings: string[] = [];
  const qty = Number.isFinite(row.qty) && row.qty > 0 ? row.qty : 0;
  let name = '', unit = 'шт', unitCost = 0, costGroup = 'Свободные строки', costNote: string | undefined;
  if (row.own) {
    name = row.own.name; unit = row.own.unit || 'шт'; unitCost = row.own.price > 0 ? row.own.price : 0;
    if (!(row.own.price > 0)) warnings.push('Нет цены');
  } else {
    const found = idx.item(row.itemId);
    if (!found) {
      warnings.push('Не выбрана позиция прайса');
    } else {
      const { item, group } = found;
      name = `${group.name}: ${item.name}`; unit = group.rule === 'sheet' ? 'м²' : group.unit;
      unitCost = unitCostOf(item, group, s); costGroup = costGroupOf(group);
      if (!(item.price > 0)) warnings.push('Нет цены');
      if (item.status) warnings.push(item.status);
      if (group.rule === 'sheet') costNote = `лист ${fmt(item.price)} ₽ ÷ ${fmt(sheetArea(group, s), 3)} м² × ${fmt(s.waste, 2)} + ${fmt(s.edgePerM2)}`;
    }
  }
  const cost = qty * unitCost, prod = cost * s.kProd, retail = prod * s.kShop;
  return { id: row.id, block: row.block, name, unit, qty, unitCost, cost, prod, retail, costGroup, costNote, warnings };
}

export function compute(input: CalcInput, catalog: Catalog | CatalogIndex, s: Settings): CalcResult {
  const idx = 'groups' in catalog ? indexCatalog(catalog) : catalog;
  const rows = input.rows.filter((r) => r.block !== 'light').map((r) => computeRow(r, idx, s));
  const light = input.light?.enabled ? computeLight(input.light, s) : null;
  const all = light ? rows.concat(light.rows) : rows;
  const sum = (k: 'cost' | 'prod' | 'retail', list = all) => list.reduce((a, r) => a + r[k], 0);
  const cost = sum('cost'), prod = sum('prod'), retail = sum('retail');
  const pct = Math.min(100, Math.max(0, input.discountPct || 0));
  const discount = retail * pct / 100;
  const furnitureAfterDiscount = retail - discount;
  const delivery = retail * s.deliveryPct / 100;
  const costByGroup: Record<string, number> = {};
  for (const r of all) costByGroup[r.costGroup] = (costByGroup[r.costGroup] ?? 0) + r.cost;
  const blocks = blocksOf(input.kind).map((b) => ({ block: b.id, title: b.title, retail: sum('retail', all.filter((r) => r.block === b.id)) }));
  const warnings = all.filter((r) => r.warnings.length).map((r) => `${r.name || 'Строка'}: ${r.warnings.join(', ')}`).concat(light?.warnings ?? []);
  return {
    rows: all, light, blocks, costByGroup, cost, prod, retail, discount, furnitureAfterDiscount, delivery,
    total: furnitureAfterDiscount + delivery, margin: furnitureAfterDiscount - cost, warnings,
  };
}

/** Округление только при выводе: до шага (по умолчанию 100 ₽). */
export function roundRub(n: number, step = 100): number {
  return Math.round(n / step) * step;
}
