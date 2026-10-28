import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexCatalog, specDraft, specMissing, DEFAULT_SETTINGS } from '../src/index.ts';
import type { Catalog, CalcInput, SpecData } from '../src/index.ts';

const S = { ...DEFAULT_SETTINGS };
const catalog: Catalog = {
  groups: [
    { id: 'g1', category: 'ЛДСП корпус', name: 'ЛДСП Egger', unit: 'м²', rule: 'sheet', items: [{ id: 'w', name: 'W1000 Белый', price: 5100 }, { id: 'u', name: 'U702 Кашемир', price: 6000 }] },
    { id: 'g2', category: 'Фасады', name: 'AGT Supramat', unit: 'м²', rule: 'sheet', sheetArea: 3.416, items: [{ id: 'agt', name: '3010 Белый', price: 15950 }] },
    { id: 'g3', category: 'Фурнитура', name: 'Петли', unit: 'шт', rule: 'unit', items: [{ id: 'blum', name: 'Blum CLIP top BLUMOTION', price: 450 }] },
    { id: 'g4', category: 'Фурнитура', name: 'ХДФ (задняя стенка)', unit: 'м²', rule: 'unit', items: [{ id: 'hdf', name: 'ХДФ белый', price: 300 }] },
    { id: 'g6', category: 'Фурнитура', name: 'Профиль Gola', unit: 'м.п.', rule: 'unit', items: [{ id: 'gola', name: 'Gola чёрный', price: 900 }] },
    { id: 'g7', category: 'Фурнитура', name: 'Цоколь', unit: 'м.п.', rule: 'unit', items: [{ id: 'cok', name: 'Цоколь алюминий 100 мм', price: 900 }] },
    { id: 'g8', category: 'Столешницы', name: 'Ботаника ДСП 38', unit: 'м.п.', rule: 'unit', items: [{ id: 'st', name: 'Дуб Галифакс', price: 4000 }] },
  ],
};
const idx = indexCatalog(catalog);
const input = (rows: CalcInput['rows'], extra: Partial<CalcInput> = {}): CalcInput => ({ kind: 'kitchen', rows, light: { enabled: false, profileId: 'inset', segments: [] }, discountPct: 0, ...extra });
const field = (d: SpecData, section: string, label: string) => d.sections.find((s) => s.title === section)?.fields.find((f) => f.label.startsWith(label))?.value;

test('спецификация кухни: верх и низ по частям, задняя стенка, столешница, фурнитура с количеством, подсветка, цоколь', () => {
  const inp = input([
    { id: 'u1', block: 'up', qty: 3, itemId: 'w' },
    { id: 'f1', block: 'up', qty: 2, itemId: 'agt' },
    { id: 'h1', block: 'up', qty: 2, itemId: 'hdf' },
    { id: 'l1', block: 'low', qty: 4, itemId: 'u' },
    { id: 'f2', block: 'low', qty: 2, itemId: 'agt', realMaterial: 'AGT Supramat «Белый», кромка в цвет' },
    { id: 'h2', block: 'low', qty: 2, linkTo: 'l1' },
    { id: 't', block: 'top', qty: 3, itemId: 'st' },
    { id: 'p', block: 'hw', qty: 12, itemId: 'blum' },
    { id: 'g', block: 'hw', qty: 3.5, itemId: 'gola' },
    { id: 'c', block: 'hw', qty: 4, itemId: 'cok' },
    { id: 'o', block: 'free', qty: 1, own: { name: 'Мойка Blanco', unit: 'шт', price: 1 } },
    { id: 'z', block: 'hw', qty: 0, itemId: 'blum' },
  ], { light: { enabled: true, profileId: 'inset', segments: [{ name: 'Низ', lengthM: 2.4, switchId: 'none' }] } });
  const d = specDraft(inp, idx, S, { title: 'Кухня угловая', header: { clientName: 'Анна', designer: 'Мария' } });
  assert.equal(d.title, 'Кухня угловая');
  assert.equal(d.header.clientName, 'Анна');
  assert.equal(d.header.contractNo, '');
  assert.equal(field(d, 'Верхние модули', 'Корпус'), 'ЛДСП Egger, W1000 Белый');
  assert.equal(field(d, 'Верхние модули', 'Фасад'), 'AGT Supramat, 3010 Белый');
  assert.equal(field(d, 'Верхние модули', 'Задняя стенка'), 'ХДФ белый');
  assert.equal(field(d, 'Верхние модули', 'Ручки'), 'Gola чёрный');
  assert.equal(field(d, 'Верхние модули', 'Отделка'), '');
  assert.equal(field(d, 'Нижние модули', 'Корпус'), 'ЛДСП Egger, U702 Кашемир');
  assert.equal(field(d, 'Нижние модули', 'Фасад'), 'AGT Supramat «Белый», кромка в цвет');
  assert.equal(field(d, 'Нижние модули', 'Задняя стенка'), 'ЛДСП в цвет корпуса (ЛДСП Egger, U702 Кашемир)');
  assert.equal(field(d, 'Столешница, стеновая панель, плинтус', 'Столешница'), 'Ботаника ДСП 38, Дуб Галифакс');
  const fit = d.sections.find((s) => s.title === 'Фурнитура и комплектующие')!.fields;
  assert.deepEqual(fit, [
    { label: 'Петли', value: 'Blum CLIP top BLUMOTION — 12 шт' },
    { label: 'Профиль Gola', value: 'Gola чёрный — 3,5 м.п.' },
    { label: 'Дополнительно', value: 'Мойка Blanco — 1 шт' },
  ]);
  assert.match(field(d, 'Подсветка и прочее', 'Подсветка')!, /Низ: 2,4 м\.п\./);
  assert.equal(field(d, 'Подсветка и прочее', 'Цоколь'), 'Цоколь алюминий 100 мм');
});

test('спецификация шкафа: одна часть «Изделие» из блоков корпуса и фасадов', () => {
  const d = specDraft({ ...input([{ id: 'b', block: 'body', qty: 5, itemId: 'w' }, { id: 'f', block: 'facade', qty: 2, itemId: 'agt' }]), kind: 'cabinet' }, idx, S, { title: 'Шкаф' });
  assert.deepEqual(d.sections.map((s) => s.title), ['Изделие', 'Фурнитура и комплектующие', 'Подсветка и прочее']);
  assert.equal(field(d, 'Изделие', 'Корпус'), 'ЛДСП Egger, W1000 Белый');
  assert.equal(field(d, 'Изделие', 'Фасад'), 'AGT Supramat, 3010 Белый');
});

test('обязательные поля шапки', () => {
  assert.deepEqual(specMissing({ contractNo: 'К-1', clientName: ' ' }), ['Дата договора', 'ФИО клиента', 'Адрес объекта']);
  assert.deepEqual(specMissing({ contractNo: 'К-1', contractDate: '2026-10-29', clientName: 'Анна', address: 'Москва' }), []);
});
