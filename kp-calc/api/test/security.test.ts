// Безопасность: обход входа закодированным адресом, подделка запроса с чужого сайта, перебор паролей, журнал руководителя.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { OWNER, SKIP, agent, makeUser, setup } from './helpers.ts';
import type { Agent, Ctx } from './helpers.ts';

describe('безопасность', { skip: SKIP }, () => {
  let ctx: Ctx, owner: Agent, head: Agent;

  before(async () => {
    ctx = await setup();
    owner = agent(ctx.app);
    await owner.login(OWNER.email, OWNER.password);
    const krd = (await owner.get('/api/meta')).body.cities.find((c: any) => c.name === 'Краснодар').id;
    head = (await makeUser(ctx.app, owner, { firstName: 'Олег', email: 'sh@kp.local', role: 'head', cityId: krd })).agent;
  });
  after(async () => { await ctx?.close(); });

  test('закодированный адрес не обходит вход', async () => {
    for (const url of ['/%61pi/meta', '/ap%69/company', '/%61pi/settings', '/%61pi/clients']) {
      const r = await ctx.app.inject({ method: 'GET', url });
      assert.equal(r.statusCode, 401, url);
    }
    const lp = await ctx.app.inject({ method: 'POST', url: '/%61pi/link-preview', payload: { url: 'https://example.com/' } });
    assert.equal(lp.statusCode, 401);
  });

  test('запрос с чужого сайта отклоняется, свой — проходит', async () => {
    const cookie = await (async () => {
      const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: OWNER.email, password: OWNER.password } });
      return `kp_session=${r.cookies.find((c) => c.name === 'kp_session')!.value}`;
    })();
    const evil = await ctx.app.inject({ method: 'POST', url: '/api/notifications/read', headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/json' }, payload: {} });
    assert.equal(evil.statusCode, 403);
    const cross = await ctx.app.inject({ method: 'POST', url: '/api/notifications/read', headers: { cookie, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, payload: {} });
    assert.equal(cross.statusCode, 403);
    const plain = await ctx.app.inject({ method: 'POST', url: '/api/notifications/read', headers: { cookie, 'content-type': 'text/plain' }, payload: 'x' });
    assert.equal(plain.statusCode, 415);
    const sub = await ctx.app.inject({ method: 'POST', url: '/api/notifications/read', headers: { cookie, 'sec-fetch-site': 'same-site', origin: 'https://culturagroup.ru', 'content-type': 'application/json' }, payload: {} });
    assert.equal(sub.statusCode, 403, 'соседний поддомен — тоже чужой');
    const own = await ctx.app.inject({ method: 'POST', url: '/api/notifications/read', headers: { cookie, origin: 'http://localhost:80', host: 'localhost:80', 'content-type': 'application/json' }, payload: {} });
    assert.equal(own.statusCode, 200, 'без Sec-Fetch-Site: Origin совпадает с адресом');
    const proxied = await ctx.app.inject({ method: 'POST', url: '/api/notifications/read', headers: { cookie, 'sec-fetch-site': 'same-origin', origin: 'https://kp.example', host: 'internal:8787', 'content-type': 'application/json' }, payload: {} });
    assert.equal(proxied.statusCode, 200, 'прокси подменил Host — браузер всё равно говорит same-origin');
  });

  test('перебор пароля: параллельные попытки тоже упираются в предел 10', async () => {
    const r = await Promise.all(Array.from({ length: 25 }, () => agent(ctx.app).post('/api/auth/login', { email: 'victim@kp.local', password: 'wrong-pass' })));
    assert.equal(r.filter((x) => x.status === 401).length, 10);
    assert.equal(r.filter((x) => x.status === 429).length, 15);
  });

  test('журнал: руководитель не видит пользователей (почты, телефоны)', async () => {
    const all = (await owner.get('/api/audit')).body.entries;
    assert.ok(all.some((e: any) => e.entity === 'Пользователи'));
    const mine = (await head.get('/api/audit')).body.entries;
    assert.ok(mine.every((e: any) => e.entity !== 'Пользователи'));
  });
});
