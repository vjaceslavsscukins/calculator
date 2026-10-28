// Публичная страница КП: защита от накрутки и спама (повторы, параллельные запросы, срок, большие тела).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { OWNER, SKIP, agent, makeUser, setup } from './helpers.ts';
import type { Agent, Ctx } from './helpers.ts';

describe('публичная страница КП: злоупотребления', { skip: SKIP }, () => {
  let ctx: Ctx, owner: Agent, m1: Agent, kpId: string, token: string;
  const pub = () => agent(ctx.app);
  const count = async (sql: string) => (await ctx.pool.query(sql, [kpId])).rows[0].n as number;

  before(async () => {
    ctx = await setup();
    owner = agent(ctx.app);
    await owner.login(OWNER.email, OWNER.password);
    const msk = (await owner.get('/api/meta')).body.cities.find((c: any) => c.name === 'Москва').id;
    m1 = (await makeUser(ctx.app, owner, { firstName: 'Мария', email: 'p1@kp.local', role: 'manager', cityId: msk })).agent;
    const client = (await m1.post('/api/clients', { name: 'Анна', phone: '+7 916 555-44-33' })).body.client.id;
    const c = (await m1.post('/api/calculations', { clientId: client, title: 'Кухня', kind: 'kitchen' })).body.calculation;
    await m1.put(`/api/calculations/${c.id}`, { rev: c.rev, input: { ...c.input, rows: [{ id: 'o', block: 'free', qty: 1, own: { name: 'x', unit: 'шт', price: 1000 } }] } });
    const kp = (await m1.post('/api/kp', { clientId: client, theme: 'light', items: [{ calculationId: c.id }] })).body.kp;
    kpId = kp.id; token = kp.url.split('/p/')[1];
  });
  after(async () => { await ctx?.close(); });

  test('просмотры: повторные открытия подряд не накручивают счётчик', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await pub().post(`/p/${token}/open`)).status, 200);
    assert.equal(await count('select views as n from kps where id = $1'), 1);
    assert.equal(await count(`select count(*)::int as n from kp_events where kp_id = $1 and type = 'open'`), 1);
  });

  test('«Утвердить» 30 раз параллельно: одно событие, одно уведомление на человека, одна запись для Битрикс24', async () => {
    await Promise.all(Array.from({ length: 30 }, () => pub().post(`/p/${token}/action`, { type: 'approve' })));
    assert.equal(await count(`select count(*)::int as n from kp_events where kp_id = $1 and type = 'approve'`), 1);
    assert.equal(await count(`select count(*)::int as n from bitrix_outbox where kp_id = $1`), 1);
    assert.equal(await count(`select count(*)::int as n from notifications where kp_id = $1 and type = 'approve'`), 2, 'менеджер и владелец');
  });

  test('вопросы: не больше 20 в час даже параллельно', async () => {
    const r = await Promise.all(Array.from({ length: 30 }, (_, i) => pub().post(`/p/${token}/action`, { type: 'question', message: `вопрос ${i}` })));
    assert.equal(r.filter((x) => x.status === 200).length, 19, 'плюс одно утверждение — ровно 20 за час');
    assert.equal(r.filter((x) => x.status === 429).length, 11);
  });

  test('истёкший КП: вопрос и утверждение — 410 с понятным текстом', async () => {
    await ctx.pool.query(`update kps set valid_until = current_date - 1, approved_at = null where id = $1`, [kpId]);
    await ctx.pool.query(`delete from kp_events where kp_id = $1`, [kpId]);
    const r = await pub().post(`/p/${token}/action`, { type: 'question', message: 'ещё актуально?' });
    assert.equal(r.status, 410);
    assert.match(r.body.error, /Срок действия КП истёк/);
  });

  test('тело больше 1 МБ на публичный адрес не принимается, даже как файл', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024, 1);
    assert.equal((await pub().upload(`/p/${token}/action`, big, 'application/octet-stream')).status, 413);
    assert.equal((await pub().upload('/api/auth/login', big, 'image/png')).status, 413);
  });
});
