// Спецификация: черновик из расчёта, сохранение снимком (стоимость не меняется вместе с расчётом), версии, доступ.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Catalog } from '../../engine/src/index.ts';
import { CATALOG_FILE } from '../src/db.ts';
import { OWNER, SKIP, agent, makeUser, setup } from './helpers.ts';
import type { Agent, Ctx } from './helpers.ts';

describe('спецификация', { skip: SKIP }, () => {
  let ctx: Ctx, owner: Agent, m1: Agent, m2: Agent, calc: string, rev: number, ldsp: string;
  const input = (qty: number) => ({ kind: 'kitchen', rows: [{ id: 'u1', block: 'up', qty, itemId: ldsp }], light: { enabled: false, profileId: 'inset', segments: [] }, discountPct: 0, deliveryRub: 0 });

  before(async () => {
    ctx = await setup();
    owner = agent(ctx.app);
    await owner.login(OWNER.email, OWNER.password);
    const msk = (await owner.get('/api/meta')).body.cities.find((c: any) => c.name === 'Москва').id;
    const cat = JSON.parse(await readFile(CATALOG_FILE, 'utf8')) as Catalog;
    ldsp = cat.groups.find((g) => g.category === 'ЛДСП корпус')!.items.find((i) => !i.status && i.price > 0)!.id;
    m1 = (await makeUser(ctx.app, owner, { firstName: 'Мария', lastName: 'Петрова', email: 's1@kp.local', role: 'manager', cityId: msk })).agent;
    m2 = (await makeUser(ctx.app, owner, { firstName: 'Михаил', email: 's2@kp.local', role: 'manager', cityId: msk })).agent;
    const client = (await m1.post('/api/clients', { name: 'Анна Смирнова', phone: '+7 916 555-44-33' })).body.client.id;
    const c = (await m1.post('/api/calculations', { clientId: client, title: 'Кухня угловая', kind: 'kitchen' })).body.calculation;
    calc = c.id; rev = c.rev;
    assert.equal((await m1.put(`/api/calculations/${calc}`, { rev, input: input(3) })).status, 200);
  });
  after(async () => { await ctx?.close(); });

  test('черновик: клиент, телефон, менеджер и материалы из расчёта; спецификации ещё нет', async () => {
    const r = await m1.get(`/api/calculations/${calc}/spec`);
    assert.equal(r.status, 200, r.raw);
    assert.equal(r.body.spec, null);
    assert.equal(r.body.draft.title, 'Кухня угловая');
    assert.deepEqual(r.body.draft.header, { contractNo: '', contractDate: '', clientName: 'Анна Смирнова', clientPhone: '+7 916 555-44-33', address: '', designer: 'Мария Петрова' });
    const up = r.body.draft.sections.find((s: any) => s.title === 'Верхние модули');
    assert.match(up.fields.find((f: any) => f.label.startsWith('Корпус')).value, /^ЛДСП /);
    assert.ok(r.body.calcTotal > 0);
    assert.equal((await m2.get(`/api/calculations/${calc}/spec`)).status, 404, 'чужой менеджер не видит');
  });

  test('сохранение снимком: стоимость не меняется вместе с расчётом, пока не нажали «Обновить из расчёта»', async () => {
    const draft = (await m1.get(`/api/calculations/${calc}/spec`)).body.draft;
    const data = { ...draft, header: { ...draft.header, contractNo: 'К-0012', contractDate: '2026-10-29', address: 'Москва, ул. Лесная, 5' }, extra: 'лишнее', total: 1 };
    const s1 = await m1.put(`/api/calculations/${calc}/spec`, { rev: 0, data });
    assert.equal(s1.status, 200, s1.raw);
    assert.equal(s1.body.spec.rev, 1);
    assert.deepEqual(s1.body.spec.missing, []);
    assert.equal(s1.body.spec.data.header.contractNo, 'К-0012');
    assert.equal('extra' in s1.body.spec.data, false);
    const t1 = s1.body.spec.total;
    assert.equal(t1, s1.body.calcTotal);

    const c = (await m1.get(`/api/calculations/${calc}`)).body.calculation;
    assert.equal((await m1.put(`/api/calculations/${calc}`, { rev: c.rev, input: input(6) })).status, 200);
    const s2 = await m1.put(`/api/calculations/${calc}/spec`, { rev: 1, data: { ...s1.body.spec.data, note: 'Ручки выбирает клиент' } });
    assert.equal(s2.body.spec.total, t1, 'снимок: стоимость прежняя');
    assert.ok(s2.body.calcTotal > t1);
    assert.equal(s2.body.spec.data.note, 'Ручки выбирает клиент');
    assert.equal((await m1.put(`/api/calculations/${calc}/spec`, { rev: 1, data })).status, 409, 'старая версия');
    const s3 = await m1.put(`/api/calculations/${calc}/spec`, { rev: 2, data: s2.body.spec.data, refreshTotal: true });
    assert.equal(s3.body.spec.total, s3.body.calcTotal);
    assert.equal(s3.body.spec.rev, 3);
    assert.equal(s3.body.spec.updatedBy, 'Мария Петрова');
    assert.equal((await m2.put(`/api/calculations/${calc}/spec`, { rev: 3, data })).status, 404);
  });
});
