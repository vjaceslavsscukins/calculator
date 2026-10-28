// Владелец из переменных окружения: пробелы и кавычки в значениях, аварийный сброс пароля OWNER_RESET=1.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/db.ts';
import { OWNER, SKIP, agent, setup } from './helpers.ts';
import type { Ctx } from './helpers.ts';

describe('владелец из окружения', { skip: SKIP }, () => {
  let ctx: Ctx;
  before(async () => { ctx = await setup(); });
  after(async () => { await ctx?.close(); });

  test('без OWNER_RESET существующий владелец не меняется', async () => {
    const logs: string[] = [];
    await seed(ctx.pool, { OWNER_EMAIL: OWNER.email, OWNER_PASSWORD: 'new-pass-123' }, (m) => logs.push(m));
    assert.ok(logs.some((m) => m.startsWith('Владелец уже есть')));
    await agent(ctx.app).login(OWNER.email, OWNER.password);
  });

  test('OWNER_RESET=1: новый пароль, пробелы и кавычки вокруг значений срезаются, старые сессии сброшены', async () => {
    const old = agent(ctx.app);
    await old.login(OWNER.email, OWNER.password);
    await seed(ctx.pool, { OWNER_EMAIL: ` ${OWNER.email.toUpperCase()} `, OWNER_PASSWORD: '"new-pass-123" ', OWNER_RESET: '1' });
    assert.equal((await old.get('/api/auth/me')).status, 401);
    assert.equal((await agent(ctx.app).post('/api/auth/login', { email: OWNER.email, password: OWNER.password })).status, 401);
    await agent(ctx.app).login(OWNER.email, 'new-pass-123');
  });

  test('OWNER_RESET=1 с новой почтой добавляет владельца', async () => {
    await seed(ctx.pool, { OWNER_EMAIL: 'boss@test.local', OWNER_PASSWORD: 'boss-pass-1', OWNER_RESET: 'true' });
    await agent(ctx.app).login('boss@test.local', 'boss-pass-1');
    const { rows } = await ctx.pool.query(`select email from users where role = 'owner' order by created_at`);
    assert.deepEqual(rows.map((r) => r.email), [OWNER.email, 'boss@test.local']);
  });
});
