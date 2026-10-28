import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLight, compute, DEFAULT_SETTINGS } from '../src/index.ts';

const S = DEFAULT_SETTINGS;

test('4,2 м ленты 14,4 Вт/м: 60,5 Вт, с запасом 78,6 Вт → блок 100 Вт', () => {
  const r = computeLight({ enabled: true, profileId: 'inset', segments: [{ name: 'Под верхними', lengthM: 3, switchId: 'wave' }, { name: 'Пенал', lengthM: 1.2, switchId: 'door' }] }, S);
  assert.equal(r.lengthM, 4.2); assert.ok(Math.abs(r.watt - 60.48) < 1e-9); assert.equal(r.psuWatt, 100); assert.equal(r.psuCount, 1);
  assert.deepEqual(r.rows.map((x) => x.id), ['light-tape', 'light-profile', 'light-psu', 'light-sw-wave', 'light-sw-door']);
  assert.equal(r.warnings.length, 0);
});

test('мощности не хватает одного блока — несколько самых мощных', () => {
  const r = computeLight({ enabled: true, profileId: 'surface', segments: [{ name: 'Длинный', lengthM: 9, switchId: 'button' }, { name: 'Ещё', lengthM: 9, switchId: 'button' }] }, S);
  assert.equal(r.psuWatt, 300); assert.equal(r.psuCount, Math.ceil(18 * 14.4 * 1.3 / 300));
  assert.equal(r.rows.find((x) => x.id === 'light-sw-button')!.qty, 2);
});

test('участок длиннее допустимого — предупреждение', () => {
  const r = computeLight({ enabled: true, profileId: 'inset', segments: [{ name: 'Остров', lengthM: 12, switchId: 'button' }] }, S);
  assert.equal(r.warnings.length, 1);
});

test('подсветка идёт в итог с обеими наценками', () => {
  const r = compute({ kind: 'kitchen', rows: [], discountPct: 0, light: { enabled: true, profileId: 'inset', segments: [{ name: 'a', lengthM: 1, switchId: 'button' }] } }, { groups: [] }, S);
  const cost = 890 + 1350 + 1500 + 650;
  assert.equal(r.cost, cost); assert.ok(Math.abs(r.retail - cost * 3.6) < 1e-6); assert.equal(r.costByGroup['Подсветка'], cost);
});
