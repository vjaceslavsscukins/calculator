// Напоминания менеджеру: открыто, но не утверждено; срок КП заканчивается. Каждое — один раз.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runReminders } from '../src/reminders.ts';
import { OWNER, SKIP, agent, makeUser, setup } from './helpers.ts';
import type { Agent, Ctx } from './helpers.ts';

describe('напоминания по КП', { skip: SKIP }, () => {
  let ctx: Ctx, m: Agent, kpId: string, token: string;
  const notes = async () => (await m.get('/api/notifications')).body.items.filter((n: any) => n.type === 'remind_open' || n.type === 'expiring');

  before(async () => {
    ctx = await setup();
    const owner = agent(ctx.app);
    await owner.login(OWNER.email, OWNER.password);
    const msk = (await owner.get('/api/meta')).body.cities.find((c: any) => c.name === 'Москва').id;
    m = (await makeUser(ctx.app, owner, { firstName: 'Мария', email: 'rm@kp.local', role: 'manager', cityId: msk })).agent;
    const client = (await m.post('/api/clients', { name: 'Анна Смирнова', phone: '+7 900 1' })).body.client.id;
    const c = (await m.post('/api/calculations', { clientId: client, title: 'Кухня', kind: 'kitchen' })).body.calculation;
    await m.put(`/api/calculations/${c.id}`, { rev: c.rev, input: { ...c.input, rows: [{ id: 'o', block: 'free', qty: 1, own: { name: 'x', unit: 'шт', price: 1000 } }] } });
    const kp = (await m.post('/api/kp', { clientId: client, theme: 'light', items: [{ calculationId: c.id }] })).body.kp;
    kpId = kp.id; token = kp.url.split('/p/')[1];
    await m.post(`/api/kp/${kpId}/sent`, { channel: 'whatsapp' });
    await agent(ctx.app).post(`/p/${token}/open`);
  });
  after(async () => { await ctx?.close(); });

  test('открыто недавно и срок не близко — напоминаний нет', async () => {
    assert.equal(await runReminders(ctx.pool), 0);
  });

  test('открыто 3 дня назад, не утверждено — одно напоминание, повтор не дублирует', async () => {
    await ctx.pool.query(`update kps set first_viewed_at = now() - interval '3 days' where id = $1`, [kpId]);
    assert.equal(await runReminders(ctx.pool), 1);
    assert.equal(await runReminders(ctx.pool), 0);
    const n = await notes();
    assert.equal(n.length, 1);
    assert.match(n[0].text, /не утвердил — позвоните/);
    assert.equal(n[0].kpId, kpId);
  });

  test('срок заканчивается завтра — напоминание; утверждённое — нет', async () => {
    await ctx.pool.query(`update kps set valid_until = current_date + 1 where id = $1`, [kpId]);
    assert.equal(await runReminders(ctx.pool), 1);
    assert.ok((await notes()).some((x: any) => x.type === 'expiring' && /заканчивается/.test(x.text)));
    await ctx.pool.query(`delete from notifications where kp_id = $1 and type in ('remind_open','expiring')`, [kpId]);
    await agent(ctx.app).post(`/p/${token}/action`, { type: 'approve' });
    assert.equal(await runReminders(ctx.pool), 0);
  });
});
