import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePro100, applyPro100, mergePro100 } from '../src/index.ts';

const TEXT = `ЛДСП_верх\t5,87\tм²
Фасад_верх\t3.48\tм²
ЛДСП_низ;6,2;м²
Петли 12 шт
Евровинт\t64\tшт
Полкодержатель\t16\tшт
просто текст без чисел`;

test('разбор: табуляция, «;», пробелы, десятичная запятая', () => {
  const p = parsePro100(TEXT);
  assert.deepEqual(p.lines.slice(0, 4), [
    { name: 'ЛДСП_верх', qty: 5.87, unit: 'м²' }, { name: 'Фасад_верх', qty: 3.48, unit: 'м²' },
    { name: 'ЛДСП_низ', qty: 6.2, unit: 'м²' }, { name: 'Петли', qty: 12, unit: 'шт' },
  ]);
  assert.deepEqual(p.skipped, ['просто текст без чисел']);
});

test('строки попадают в блоки по виду изделия, неизвестные — в «Не разобрано»', () => {
  let n = 0; const id = () => `r${++n}`;
  const k = applyPro100('kitchen', parsePro100(TEXT).lines, { 'Петли': 'blum' }, id);
  assert.deepEqual(k.rows.map((r) => [r.pro100, r.block, r.qty]), [['ЛДСП_верх', 'up', 5.87], ['Фасад_верх', 'up', 3.48], ['ЛДСП_низ', 'low', 6.2], ['Петли', 'hw', 12]]);
  assert.equal(k.rows[3].itemId, 'blum');
  assert.deepEqual(k.unparsed.map((u) => u.name), ['Евровинт', 'Полкодержатель']);
  const c = applyPro100('cabinet', parsePro100(TEXT).lines, {}, id);
  assert.deepEqual(c.rows.map((r) => r.block), ['body', 'facade', 'body', 'hw']);
});

test('одинаковые строки суммируются, названия без учёта регистра и пробелов', () => {
  const r = applyPro100('kitchen', [{ name: 'петли', qty: 4, unit: 'шт' }, { name: 'Петли', qty: 8, unit: 'шт' }]);
  assert.equal(r.rows.length, 1); assert.equal(r.rows[0].qty, 12); assert.equal(r.rows[0].pro100, 'Петли');
});

test('повторная вставка: исправленное вручную количество и выбранный материал сохраняются', () => {
  const old = [
    { id: 'a', block: 'hw', pro100: 'Петли', qtyPro100: 12, qty: 16, itemId: 'blum' },
    { id: 'b', block: 'up', pro100: 'ЛДСП_верх', qtyPro100: 5.87, qty: 5.87, itemId: 'w1000' },
  ];
  const inc = applyPro100('kitchen', [{ name: 'Петли', qty: 14, unit: 'шт' }, { name: 'ЛДСП_верх', qty: 6, unit: 'м²' }, { name: 'Сушка', qty: 1, unit: 'шт' }]).rows;
  const m = mergePro100(old, inc);
  assert.deepEqual(m.map((r) => [r.pro100, r.qty, r.qtyPro100, r.itemId ?? null]), [['Петли', 16, 14, 'blum'], ['ЛДСП_верх', 6, 6, 'w1000'], ['Сушка', 1, 1, null]]);
});
