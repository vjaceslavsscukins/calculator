import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute, indexCatalog, kpBenefits, kpItemPrice, kpMaterials, kpTotals, DEFAULT_SETTINGS } from '../src/index.ts';
import type { Catalog, CalcInput } from '../src/index.ts';

const S = { ...DEFAULT_SETTINGS };
const catalog: Catalog = {
  groups: [
    { id: 'g1', category: 'ЛДСП корпус', name: 'ЛДСП Egger', unit: 'м²', rule: 'sheet', items: [{ id: 'w', name: 'W1000 Белый', price: 5100 }, { id: 'u', name: 'U702 Кашемир', price: 6000 }] },
    { id: 'g2', category: 'Фасады', name: 'AGT Supramat', unit: 'м²', rule: 'sheet', sheetArea: 3.416, items: [{ id: 'agt', name: '3010 Белый', price: 15950 }] },
    { id: 'g3', category: 'Фурнитура', name: 'Петли', unit: 'шт', rule: 'unit', items: [{ id: 'blum', name: 'Blum CLIP top BLUMOTION (с доводчиком)', price: 450 }] },
    { id: 'g4', category: 'Фурнитура', name: 'ХДФ (задняя стенка)', unit: 'м²', rule: 'unit', items: [{ id: 'hdf', name: 'ХДФ белый', price: 300 }] },
    { id: 'g5', category: 'Фурнитура', name: 'Навесы для подвесных шкафов', unit: 'шт', rule: 'unit', items: [{ id: 'nav', name: 'Комплект крабов', price: 100 }] },
    { id: 'g6', category: 'Фурнитура', name: 'Профиль Gola', unit: 'м.п.', rule: 'unit', items: [{ id: 'gola', name: 'Gola чёрный', price: 900 }] },
  ],
};
const idx = indexCatalog(catalog);
const input = (rows: CalcInput['rows'], extra: Partial<CalcInput> = {}): CalcInput => ({ kind: 'kitchen', rows, light: { enabled: false, profileId: 'inset', segments: [] }, discountPct: 0, ...extra });

test('итог КП = сумма изделий; скидка «было → стало», монтаж и доставка отдельно', () => {
  const a = input([{ id: 'a', block: 'free', qty: 1, own: { name: 'x', unit: 'шт', price: 100000 } }], { discountPct: 10, deliveryRub: 5000 });
  const b = input([{ id: 'b', block: 'free', qty: 1, own: { name: 'y', unit: 'шт', price: 50000 } }], { discountPct: 10 });
  const pa = kpItemPrice(compute(a, idx, S), a), pb = kpItemPrice(compute(b, idx, S), b);
  assert.equal(pa.retail, 360000); assert.equal(pa.price, 324000); assert.equal(pa.montage, 36000); assert.equal(pa.delivery, 5000);
  assert.equal(pa.total, 324000 + 36000 + 5000);
  const t = kpTotals([pa, pb]);
  assert.equal(t.goods, 360000 + 180000);
  assert.equal(t.discount, 36000 + 18000);
  assert.equal(t.discountPct, 10);
  assert.equal(t.furniture, t.goods - t.discount);
  assert.equal(t.total, pa.total + pb.total);
  assert.equal(t.total, t.furniture + t.montage + t.delivery);
  const c = input([{ id: 'c', block: 'free', qty: 1, own: { name: 'z', unit: 'шт', price: 1000 } }], { discountPct: 5 });
  assert.equal(kpTotals([pa, kpItemPrice(compute(c, idx, S), c)]).discountPct, null, 'разные скидки — без единого процента');
  assert.equal(kpTotals([]).total, 0);
});

test('материалы: роль → реальный материал или позиция; верх и низ кухни раздельно, если разные; навесы не показываем', () => {
  const inp = input([
    { id: 'u1', block: 'up', qty: 3, itemId: 'w' },
    { id: 'l1', block: 'low', qty: 4, itemId: 'u' },
    { id: 'f1', block: 'up', qty: 2, itemId: 'agt' },
    { id: 'f2', block: 'low', qty: 2, itemId: 'agt', realMaterial: 'AGT Supramat, «Белый», кромка в цвет' },
    { id: 'h', block: 'low', qty: 2, linkTo: 'l1' },
    { id: 'p', block: 'hw', qty: 12, itemId: 'blum' },
    { id: 'n', block: 'hw', qty: 6, itemId: 'nav' },
    { id: 'g', block: 'hw', qty: 3, itemId: 'gola' },
    { id: 'o', block: 'free', qty: 1, own: { name: 'Мойка Blanco', unit: 'шт', price: 1 } },
    { id: 'z', block: 'hw', qty: 0, itemId: 'hdf' },
  ], { light: { enabled: true, profileId: 'inset', segments: [{ name: 'Низ', lengthM: 2, switchId: 'wave' }] } });
  const m = kpMaterials(inp, idx, S);
  const get = (role: string) => m.find((x) => x.role === role)?.value;
  assert.equal(get('Корпус верхних шкафов'), 'ЛДСП Egger, W1000 Белый');
  assert.equal(get('Корпус нижних шкафов'), 'ЛДСП Egger, U702 Кашемир');
  assert.equal(get('Фасады верхние'), 'AGT Supramat, 3010 Белый');
  assert.equal(get('Фасады нижние'), 'AGT Supramat, «Белый», кромка в цвет');
  assert.equal(get('Задняя стенка'), 'ЛДСП в цвет корпуса (ЛДСП Egger, U702 Кашемир)');
  assert.equal(get('Петли'), 'Blum CLIP top BLUMOTION (с доводчиком)');
  assert.equal(get('Открывание'), 'Gola чёрный');
  assert.equal(get('Дополнительно'), 'Мойка Blanco');
  assert.match(get('Подсветка') ?? '', /^Лента 24 В/);
  assert.ok(!m.some((x) => /краб/i.test(x.value)), 'навесы в КП не показываем');
  assert.ok(!m.some((x) => /ХДФ белый/.test(x.value)), 'строка с нулевым количеством не попадает');
  assert.deepEqual(m.slice(0, 2).map((x) => x.role), ['Корпус верхних шкафов', 'Корпус нижних шкафов']);
  const b = kpBenefits(m);
  assert.ok(b.includes('Плавное закрывание с доводчиками'));
  assert.ok(b.includes('Без ручек — профиль Gola'));
  assert.ok(b.includes('Подсветка с сенсором'));
});

test('материалы: одинаковый корпус верха и низа — одной строкой', () => {
  const m = kpMaterials(input([{ id: 'a', block: 'up', qty: 1, itemId: 'w' }, { id: 'b', block: 'low', qty: 1, itemId: 'w' }]), idx, S);
  assert.deepEqual(m, [{ role: 'Корпус', value: 'ЛДСП Egger, W1000 Белый' }]);
});
