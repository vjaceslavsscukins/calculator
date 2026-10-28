import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute, computeRow, indexCatalog, roundRub, unitCostOf, DEFAULT_SETTINGS } from '../src/index.ts';
import type { Catalog, CalcInput, Settings } from '../src/index.ts';

const S: Settings = { ...DEFAULT_SETTINGS };
const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

const catalog: Catalog = {
  groups: [
    { id: 'g1', category: 'ЛДСП корпус', name: 'ЛДСП Egger', unit: 'м²', rule: 'sheet', sheetArea: 5.796, items: [{ id: 'w1000', name: 'W1000 Белый Премиум ST9', price: 5100 }, { id: 'zero', name: 'Без цены', price: 0 }, { id: 'gone', name: 'Выведен', price: 4070, status: 'нет в новом прайсе' }] },
    { id: 'g2', category: 'Фасады', name: 'Egger Perfect Sense TOP', unit: 'м²', rule: 'sheet', sheetArea: 3.416, items: [{ id: 'pst', name: 'W1000', price: 15950 }] },
    { id: 'g3', category: 'Фурнитура', name: 'Петли', unit: 'шт', rule: 'unit', items: [{ id: 'blum', name: 'Петля Blum с доводчиком', price: 450 }] },
    { id: 'g4', category: 'Столешницы', name: 'Ботаника ДСП 38', unit: 'м.п.', rule: 'unit', items: [{ id: 'bot', name: 'Кат 1', price: 6828 }] },
  ],
};
const idx = indexCatalog(catalog);
const base = (rows: CalcInput['rows'], extra: Partial<CalcInput> = {}): CalcInput => ({ kind: 'kitchen', rows, light: { enabled: false, profileId: 'inset', segments: [] }, discountPct: 0, ...extra });

test('пример владельца: 100 000 × 1,8 = 180 000 × 2 = 360 000', () => {
  const r = compute(base([{ id: 'a', block: 'free', qty: 1, own: { name: 'Пример', unit: 'шт', price: 100000 } }]), catalog, S);
  assert.equal(r.cost, 100000); assert.equal(r.prod, 180000); assert.equal(r.retail, 360000);
});

test('ЛДСП: лист ÷ 5,796 × 1,2 + 150', () => {
  const g = catalog.groups[0];
  near(unitCostOf(g.items[0], g, S), 5100 / 5.796 * 1.2 + 150);
});

test('площадь листа ЛДСП берётся из настроек, у плитных фасадов — своя', () => {
  const s2 = { ...S, ldspSheetArea: 5.7 };
  near(computeRow({ id: 'x', block: 'up', qty: 1, itemId: 'w1000' }, idx, s2).unitCost, 5100 / 5.7 * 1.2 + 150);
  near(computeRow({ id: 'y', block: 'up', qty: 1, itemId: 'pst' }, idx, s2).unitCost, 15950 / 3.416 * 1.2 + 150);
});

test('скидка не действует на доставку и монтаж', () => {
  const r = compute(base([{ id: 'a', block: 'free', qty: 1, own: { name: 'x', unit: 'шт', price: 100000 } }], { discountPct: 10 }), catalog, S);
  assert.equal(r.retail, 360000); assert.equal(r.discount, 36000); assert.equal(r.delivery, 36000);
  assert.equal(r.total, 360000 - 36000 + 36000); assert.equal(r.margin, 324000 - 100000);
});

test('нет цены и выведенная позиция — предупреждения, а не тихий ноль', () => {
  assert.deepEqual(computeRow({ id: 'z', block: 'up', qty: 2, itemId: 'zero' }, idx, S).warnings, ['Нет цены']);
  assert.deepEqual(computeRow({ id: 'g', block: 'up', qty: 1, itemId: 'gone' }, idx, S).warnings, ['нет в новом прайсе']);
  assert.deepEqual(computeRow({ id: 'n', block: 'up', qty: 1, itemId: null }, idx, S).warnings, ['Не выбрана позиция прайса']);
});

test('количество умножается один раз (ошибка книги с декором не повторяется)', () => {
  const r = computeRow({ id: 'h', block: 'hw', qty: 18, itemId: 'blum' }, idx, S);
  assert.equal(r.cost, 18 * 450); assert.equal(r.retail, 18 * 450 * 1.8 * 2);
});

test('себестоимость по группам и суммы блоков', () => {
  const r = compute(base([
    { id: '1', block: 'up', qty: 3, itemId: 'w1000' },
    { id: '2', block: 'top', qty: 3.2, itemId: 'bot' },
    { id: '3', block: 'hw', qty: 16, itemId: 'blum' },
  ]), catalog, S);
  near(r.costByGroup['ЛДСП корпус'], 3 * (5100 / 5.796 * 1.2 + 150));
  near(r.costByGroup['Столешницы и панели'], 3.2 * 6828);
  assert.equal(r.costByGroup['Фурнитура'], 16 * 450);
  near(r.blocks.find((b) => b.block === 'hw')!.retail, 16 * 450 * 3.6);
  near(r.retail, r.blocks.reduce((a, b) => a + b.retail, 0));
});

test('отрицательное и пустое количество считаются как 0', () => {
  assert.equal(computeRow({ id: 'n', block: 'hw', qty: -5, itemId: 'blum' }, idx, S).cost, 0);
  assert.equal(computeRow({ id: 'n', block: 'hw', qty: NaN, itemId: 'blum' }, idx, S).cost, 0);
});

test('округление только при выводе, до 100 ₽', () => {
  assert.equal(roundRub(391780), 391800); assert.equal(roundRub(391749), 391700);
});
