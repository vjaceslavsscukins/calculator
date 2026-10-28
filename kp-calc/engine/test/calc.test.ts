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

test('скидка не действует на монтаж и доставку; маржа без них', () => {
  const r = compute(base([{ id: 'a', block: 'free', qty: 1, own: { name: 'x', unit: 'шт', price: 100000 } }], { discountPct: 10 }), catalog, S);
  assert.equal(r.retail, 360000); assert.equal(r.discount, 36000); assert.equal(r.montage, 36000); assert.equal(r.delivery, 0);
  assert.equal(r.total, 360000 - 36000 + 36000); assert.equal(r.margin, 324000 - 100000);
});

test('доставка суммой: своя в расчёте, иначе по умолчанию из настроек; монтаж — % из настроек', () => {
  const rows = [{ id: 'a', block: 'free', qty: 1, own: { name: 'x', unit: 'шт', price: 100000 } }];
  const s2 = { ...S, montagePct: 5, deliveryDefaultRub: 3000 };
  const def = compute(base(rows), catalog, s2);
  assert.equal(def.montage, 18000); assert.equal(def.delivery, 3000); assert.equal(def.total, 360000 + 18000 + 3000);
  assert.equal(compute(base(rows, { deliveryRub: null }), catalog, s2).delivery, 3000);
  const own = compute(base(rows, { deliveryRub: 5000, discountPct: 50 }), catalog, s2);
  assert.equal(own.delivery, 5000); assert.equal(own.total, 180000 + 18000 + 5000); assert.equal(own.margin, 180000 - 100000);
  assert.equal(compute(base(rows, { deliveryRub: 0 }), catalog, s2).delivery, 0, '0 — доставки нет, а не «по умолчанию»');
  assert.equal(compute(base(rows, { deliveryRub: -10 }), catalog, s2).delivery, 0);
});

test('задняя стенка «ЛДСП в цвет корпуса»: цена, единица и название — от позиции строки-источника, количество своё', () => {
  const ldsp = { id: 'up1', block: 'up', qty: 5, itemId: 'w1000' };
  const back = { id: 'hdf', block: 'low', pro100: 'ХДФ', qty: 2.5, linkTo: 'up1', itemId: 'blum' };
  const r = compute(base([ldsp, back]), catalog, S);
  const b = r.rows.find((x) => x.id === 'hdf')!;
  near(b.unitCost, 5100 / 5.796 * 1.2 + 150); assert.equal(b.unit, 'м²'); assert.equal(b.qty, 2.5);
  assert.equal(b.name, 'В цвет корпуса: ЛДСП Egger: W1000 Белый Премиум ST9'); assert.equal(b.costGroup, 'ЛДСП корпус');
  assert.deepEqual(b.warnings, []); near(b.retail, b.cost * 3.6);
});

test('«в цвет корпуса»: источник не найден или в нём не ЛДСП — предупреждение и ноль', () => {
  const lost = compute(base([{ id: 'hdf', block: 'low', qty: 2, linkTo: 'nope' }]), catalog, S).rows[0];
  assert.equal(lost.cost, 0); assert.match(lost.warnings[0], /не найдена/);
  const facade = compute(base([{ id: 'f', block: 'up', qty: 1, itemId: 'pst' }, { id: 'hdf', block: 'low', qty: 2, linkTo: 'f' }]), catalog, S).rows[1];
  assert.equal(facade.cost, 0); assert.match(facade.warnings[0], /не выбран ЛДСП/);
  const chain = compute(base([{ id: 'a', block: 'up', qty: 1, linkTo: 'b' }, { id: 'b', block: 'low', qty: 1, linkTo: 'a' }]), catalog, S);
  assert.ok(chain.rows.every((x) => x.cost === 0 && x.warnings.length === 1), 'ссылка на ссылку — не ЛДСП, без зацикливания');
  assert.equal(chain.warnings.length, 2);
});

test('без наценки: у свободной строки и ссылки с сайта розница = себестоимость; у строки прайса флаг не действует', () => {
  const r = compute(base([
    { id: 'o', block: 'free', qty: 2, own: { name: 'Мойка', unit: 'шт', price: 10000 }, noMarkup: true },
    { id: 'w', block: 'web', qty: 1, web: { url: 'https://example.com/x', name: 'Смеситель', price: 7000, unit: 'шт' }, noMarkup: true },
    { id: 'h', block: 'hw', qty: 1, itemId: 'blum', noMarkup: true },
  ]), catalog, S);
  const [o, w, h] = r.rows;
  assert.equal(o.cost, 20000); assert.equal(o.prod, 20000); assert.equal(o.retail, 20000);
  assert.equal(w.retail, 7000); assert.equal(h.retail, 450 * 3.6);
  assert.equal(r.margin, r.retail - r.cost);
});

test('ссылка с сайта: цена закупки за штуку × количество, наценки обычные, группа «Покупное по ссылкам»', () => {
  const r = compute(base([{ id: 'w', block: 'web', qty: 3, web: { url: 'https://example.com/lamp', name: 'Светильник', price: 2000, unit: 'шт' } }]), catalog, S);
  const w = r.rows[0];
  assert.equal(w.name, 'Светильник'); assert.equal(w.unit, 'шт'); assert.equal(w.cost, 6000); assert.equal(w.retail, 6000 * 3.6);
  assert.equal(r.costByGroup['Покупное по ссылкам'], 6000);
  assert.equal(r.blocks.find((b) => b.block === 'web')!.retail, 6000 * 3.6);
  assert.deepEqual(compute(base([{ id: 'w', block: 'web', qty: 1, web: { url: '', name: 'x', price: 0, unit: 'шт' } }]), catalog, S).rows[0].warnings, ['Нет цены']);
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
