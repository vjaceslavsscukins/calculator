import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLight, compute, normalizeSettings, DEFAULT_SETTINGS, SWITCH_NONE_NAME } from '../src/index.ts';

const S = DEFAULT_SETTINGS;

test('4,2 м ленты 14,4 Вт/м: 60,5 Вт, с запасом 78,6 Вт → блок 100 Вт', () => {
  const r = computeLight({ enabled: true, profileId: 'inset', segments: [{ name: 'Под верхними', lengthM: 3, switchId: 'wave' }, { name: 'Пенал', lengthM: 1.2, switchId: 'door' }] }, S);
  assert.equal(r.lengthM, 4.2); assert.ok(Math.abs(r.watt - 60.48) < 1e-9); assert.equal(r.psuWatt, 100); assert.equal(r.psuCount, 1);
  assert.deepEqual(r.rows.map((x) => x.id), ['light-tape', 'light-profile-inset', 'light-psu', 'light-sw-wave', 'light-sw-door']);
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

test('профиль у каждой зоны свой: одна строка на тип профиля с суммой длин; без своего — общий профиль расчёта', () => {
  const r = computeLight({ enabled: true, profileId: 'inset', segments: [
    { name: 'Под верхними', lengthM: 3, switchId: 'wave', profileId: 'surface' },
    { name: 'Пенал', lengthM: 1.2, switchId: 'door' },
    { name: 'Полка', lengthM: 0.8, switchId: 'door', profileId: 'surface' },
  ] }, S);
  const prof = r.rows.filter((x) => x.id.startsWith('light-profile-'));
  assert.deepEqual(prof.map((x) => [x.id, x.qty]), [['light-profile-surface', 3.8], ['light-profile-inset', 1.2]]);
  assert.equal(prof[0].cost, 3.8 * 780); assert.equal(prof[1].cost, 1.2 * 1350);
});

test('зона «Нет (напрямую к слаботочке)»: без выключателя и блока питания; лента и профиль считаются', () => {
  const r = computeLight({ enabled: true, profileId: 'inset', segments: [
    { name: 'Под верхними', lengthM: 3, switchId: 'wave', profileId: 'inset' },
    { name: 'Витрина', lengthM: 2, switchId: 'none', profileId: 'surface' },
  ] }, S);
  assert.equal(r.lengthM, 5); assert.equal(r.directM, 2);
  assert.ok(Math.abs(r.watt - 3 * 14.4) < 1e-9, 'мощность — только зоны с выключателем');
  assert.equal(r.psuWatt, 60); assert.equal(r.psuCount, 1);
  assert.deepEqual(r.rows.map((x) => [x.id, x.qty]), [['light-tape', 5], ['light-profile-inset', 3], ['light-profile-surface', 2], ['light-psu', 1], ['light-sw-wave', 1]]);
});

test('все зоны «Нет»: нет ни блока питания, ни выключателей', () => {
  const r = computeLight({ enabled: true, profileId: 'inset', segments: [{ name: 'a', lengthM: 4, switchId: 'none' }] }, S);
  assert.equal(r.psuCount, 0); assert.equal(r.psuWatt, 0); assert.equal(r.watt, 0);
  assert.deepEqual(r.rows.map((x) => x.id), ['light-tape', 'light-profile-inset']);
});

test('«Нет» есть в настройках по умолчанию и добавляется нормализацией старых настроек', () => {
  assert.deepEqual(S.light.switches[0], { id: 'none', name: SWITCH_NONE_NAME, price: 0 });
  const old: any = { ...S, light: { ...S.light, switches: S.light.switches.filter((w) => w.id !== 'none') } };
  delete old.montagePct; delete old.deliveryDefaultRub; old.deliveryPct = 12;
  const n = normalizeSettings(old);
  assert.equal(n.light.switches[0].id, 'none'); assert.equal(n.light.switches.filter((w) => w.id === 'none').length, 1);
  assert.equal(n.montagePct, 12); assert.equal(n.deliveryDefaultRub, 0); assert.ok(!('deliveryPct' in n));
  // «Нет» нельзя переименовать или задать ему цену
  const edited = normalizeSettings({ ...S, light: { ...S.light, switches: [{ id: 'none', name: 'Другое', price: 500 }, ...S.light.switches.slice(1)] } });
  assert.deepEqual(edited.light.switches[0], { id: 'none', name: SWITCH_NONE_NAME, price: 0 });
});
