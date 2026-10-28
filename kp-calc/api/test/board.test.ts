// Реестр КП, уведомления руководителю и владельцу, очередь Битрикс24, приборная панель.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Catalog } from '../../engine/src/index.ts';
import { CATALOG_FILE } from '../src/db.ts';
import { OWNER, SKIP, agent, makeUser, setup } from './helpers.ts';
import type { Agent, Ctx } from './helpers.ts';

describe('реестр КП и панель', { skip: SKIP }, () => {
  let ctx: Ctx, owner: Agent, head: Agent, headKrd: Agent, m1: Agent, kpId: string, token: string, calcTotal: number;

  before(async () => {
    ctx = await setup();
    owner = agent(ctx.app);
    await owner.login(OWNER.email, OWNER.password);
    const cities = (await owner.get('/api/meta')).body.cities;
    const msk = cities.find((c: any) => c.name === 'Москва').id, krd = cities.find((c: any) => c.name === 'Краснодар').id;
    const cat = JSON.parse(await readFile(CATALOG_FILE, 'utf8')) as Catalog;
    const ldsp = cat.groups.find((g) => g.category === 'ЛДСП корпус')!.items.find((i) => !i.status && i.price > 0)!.id;
    m1 = (await makeUser(ctx.app, owner, { firstName: 'Мария', lastName: 'Петрова', email: 'b1@kp.local', role: 'manager', cityId: msk })).agent;
    head = (await makeUser(ctx.app, owner, { firstName: 'Елена', email: 'bh@kp.local', role: 'head', cityId: msk })).agent;
    headKrd = (await makeUser(ctx.app, owner, { firstName: 'Олег', email: 'bk@kp.local', role: 'head', cityId: krd })).agent;
    const client = (await m1.post('/api/clients', { name: 'Анна Смирнова', phone: '+7 916 555-44-33' })).body.client.id;
    const c = (await m1.post('/api/calculations', { clientId: client, title: 'Кухня', kind: 'kitchen' })).body.calculation;
    const saved = await m1.put(`/api/calculations/${c.id}`, { rev: c.rev, input: { ...c.input, rows: [{ id: 'a', block: 'up', qty: 5, itemId: ldsp }] } });
    calcTotal = saved.body.view.total;
    const kp = await m1.post('/api/kp', { clientId: client, theme: 'light', items: [{ calculationId: c.id }] });
    assert.equal(kp.status, 200, kp.raw);
    kpId = kp.body.kp.id; token = kp.body.kp.url.split('/p/')[1];
  });
  after(async () => { await ctx?.close(); });

  test('статусы КП: собрано → отправлено (Max) → открыто → вопрос → утверждено', async () => {
    const st = async () => (await owner.get('/api/kps')).body.kps.find((k: any) => k.id === kpId);
    assert.equal((await st()).state, 'created');
    assert.equal((await m1.post(`/api/kp/${kpId}/sent`, { channel: 'max' })).status, 200);
    const ev = (await m1.get(`/api/kp/${kpId}`)).body.events;
    assert.equal(ev[0].message, 'max');
    assert.equal((await st()).state, 'sent');
    await agent(ctx.app).post(`/p/${token}/open`);
    assert.equal((await st()).state, 'opened');
    await agent(ctx.app).post(`/p/${token}/action`, { type: 'question', message: 'Можно ли ручки чёрные?' });
    const q = await st();
    assert.equal(q.state, 'question');
    assert.equal(q.questions, 1);
    assert.equal(q.lastQuestion, 'Можно ли ручки чёрные?');
    assert.equal(q.managerName, 'Мария Петрова');
    assert.equal((await owner.get('/api/kps?state=question')).body.kps.length, 1);
    assert.equal((await owner.get('/api/kps?q=смирнова')).body.kps.length, 1);
    await agent(ctx.app).post(`/p/${token}/action`, { type: 'approve' });
    assert.equal((await st()).state, 'approved');
  });

  test('уведомления: вопрос и утверждение видят менеджер, владелец и руководитель города; чужой город — нет', async () => {
    const texts = async (a: Agent) => (await a.get('/api/notifications')).body.items.map((n: any) => n.type);
    assert.deepEqual((await texts(m1)).sort(), ['approve', 'open', 'question']);
    assert.deepEqual((await texts(owner)).sort(), ['approve', 'question']);
    assert.deepEqual((await texts(head)).sort(), ['approve', 'question']);
    assert.deepEqual(await texts(headKrd), []);
    const n = (await head.get('/api/notifications')).body.items.find((x: any) => x.type === 'question');
    assert.match(n.text, /менеджер Мария Петрова/);
    assert.equal((await headKrd.get('/api/kps')).body.kps.length, 0, 'руководитель другого города не видит КП');
  });

  test('очередь Битрикс24: утверждение и вопрос записаны и ждут отправки', async () => {
    const { rows } = await ctx.pool.query('select kind, payload, sent_at from bitrix_outbox order by id');
    assert.deepEqual(rows.map((r) => r.kind), ['kp_question', 'kp_approve']);
    assert.equal(rows[0].payload.message, 'Можно ли ручки чёрные?');
    assert.equal(rows[0].payload.phone, '+7 916 555-44-33');
    assert.ok(rows.every((r) => r.sent_at === null));
  });

  test('панель: только владелец и руководитель; воронка, суммы, менеджеры', async () => {
    assert.equal((await m1.get('/api/dashboard')).status, 403);
    const r = await head.get('/api/dashboard');
    assert.equal(r.status, 200, r.raw);
    const t = r.body.totals;
    assert.equal(t.calcs, 1);
    assert.equal(t.kps, 1); assert.equal(t.sent, 1); assert.equal(t.opened, 1); assert.equal(t.approved, 1); assert.equal(t.questions, 1);
    assert.equal(t.approveRate, 100);
    assert.equal(Math.round(t.sentSum), Math.round(calcTotal));
    assert.equal(r.body.managers[0].managerName, 'Мария Петрова');
    assert.equal(r.body.managers[0].approved, 1);
    assert.ok(t.margin > 0);
    assert.equal((await headKrd.get('/api/dashboard')).body.totals.kps, 0);
    assert.equal((await owner.get('/api/dashboard?from=2020-01-01&to=2020-01-31')).body.totals.kps, 0);
    assert.equal((await owner.get('/api/dashboard?from=2026-12-01&to=2026-01-01')).status, 400);
  });
});
