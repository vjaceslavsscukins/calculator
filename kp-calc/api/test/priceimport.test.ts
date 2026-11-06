// Загрузка прайса файлом: сравнение, применение, оповещение по действующим КП, откат.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Catalog } from '../../engine/src/index.ts';
import { CATALOG_FILE } from '../src/db.ts';
import { cleanRows, diffGroup, nameKey } from '../src/priceimport.ts';
import { OWNER, SKIP, agent, makeUser, setup } from './helpers.ts';
import type { Agent, Ctx } from './helpers.ts';

describe('прайс файлом: разбор без базы', () => {
  test('названия сравниваются без регистра, кавычек и лишних пробелов; повторы и пустые строки', () => {
    assert.equal(nameKey('Петля  "Blum"  (с доводчиком)'), nameKey('петля blum (с доводчиком)'));
    const r = cleanRows([{ name: 'A', price: 10 }, { name: 'a ', price: 12 }, { name: '', price: 5 }, { name: 'B', price: 0 }, { name: 'C', price: 7.555 }]);
    assert.deepEqual(r.rows, [{ name: 'a', price: 12 }, { name: 'C', price: 7.56 }]);
    assert.deepEqual(r.duplicates, ['a']);
    assert.equal(r.skipped, 2);
    assert.throws(() => cleanRows([{ name: 'x', price: 0 }]), /ни одной строки/);
  });
  test('новые, изменилась цена, нет в файле, вернулись, без изменений', () => {
    const d = diffGroup([
      { id: '1', name: 'Петля A', price: 100 }, { id: '2', name: 'Петля B', price: 200 }, { id: '3', name: 'Петля C', price: 300 },
      { id: '4', name: 'Петля D', price: 50, status: 'нет в новом прайсе' },
    ], [{ name: 'петля a', price: 100 }, { name: 'Петля B', price: 250 }, { name: 'Петля D', price: 60 }, { name: 'Петля E', price: 70 }]);
    assert.equal(d.same, 1);
    assert.deepEqual(d.changed.map((c) => [c.id, c.before, c.after, c.pct]), [['2', 200, 250, 25], ['4', 50, 60, 20]]);
    assert.deepEqual(d.missing.map((m) => m.id), ['3']);
    assert.deepEqual(d.restored.map((m) => m.id), ['4']);
    assert.deepEqual(d.added, [{ name: 'Петля E', price: 70 }]);
  });
});

describe('прайс файлом: сервер', { skip: SKIP }, () => {
  let ctx: Ctx, owner: Agent, m: Agent, groupId: string, item: { id: string; name: string; price: number }, kpId: string;
  before(async () => {
    ctx = await setup();
    owner = agent(ctx.app);
    await owner.login(OWNER.email, OWNER.password);
    const msk = (await owner.get('/api/meta')).body.cities.find((c: any) => c.name === 'Москва').id;
    m = (await makeUser(ctx.app, owner, { firstName: 'Мария', email: 'pi@kp.local', role: 'manager', cityId: msk })).agent;
    const cat = JSON.parse(await readFile(CATALOG_FILE, 'utf8')) as Catalog;
    const g = cat.groups.find((x) => x.name === 'Петли')!;
    groupId = g.id; item = g.items.find((i) => !i.status && i.price > 0)! as any;
    const client = (await m.post('/api/clients', { name: 'Анна', phone: '+7 900 1' })).body.client.id;
    const c = (await m.post('/api/calculations', { clientId: client, title: 'Кухня', kind: 'kitchen' })).body.calculation;
    await m.put(`/api/calculations/${c.id}`, { rev: c.rev, input: { ...c.input, rows: [{ id: 'p', block: 'hw', qty: 10, itemId: item.id }] } });
    kpId = (await m.post('/api/kp', { clientId: client, theme: 'light', items: [{ calculationId: c.id }] })).body.kp.id;
  });
  after(async () => { await ctx?.close(); });

  const fileRows = async () => {
    const g = (await owner.get('/api/catalog')).body.groups.find((x: any) => x.id === groupId);
    return g.items.filter((i: any) => !i.status).map((i: any) => ({ name: i.name, price: i.id === item.id ? i.price * 2 : i.price }));
  };

  test('менеджер не загружает прайс', async () => {
    assert.equal((await m.post(`/api/catalog/groups/${groupId}/import/preview`, { rows: [{ name: 'x', price: 1 }] })).status, 403);
  });

  test('предпросмотр: подорожала одна позиция, новая позиция, действующее КП подорожает', async () => {
    const rows = [...await fileRows(), { name: 'Петля новая тестовая', price: 999 }];
    const r = await owner.post(`/api/catalog/groups/${groupId}/import/preview`, { rows });
    assert.equal(r.status, 200, r.raw);
    assert.equal(r.body.diff.changed.length, 1);
    assert.equal(r.body.diff.changed[0].pct, 100);
    assert.equal(r.body.diff.added.length, 1);
    assert.equal(r.body.impact.length, 1);
    assert.equal(r.body.impact[0].kpId, kpId);
    assert.ok(r.body.impact[0].delta > 0);
    // прайс ещё не изменился
    const g = (await owner.get('/api/catalog')).body.groups.find((x: any) => x.id === groupId);
    assert.equal(g.items.find((i: any) => i.id === item.id).price, item.price);
  });

  test('применение: цена новая, менеджеру уведомление, КП не меняется; откат возвращает как было', async () => {
    const kpBefore = (await m.get(`/api/kp/${kpId}`)).body.kp.total;
    const rows = [...await fileRows(), { name: 'Петля новая тестовая', price: 999 }];
    const r = await owner.post(`/api/catalog/groups/${groupId}/import/apply`, { rows, markMissing: true });
    assert.equal(r.status, 200, r.raw);
    assert.equal(r.body.summary.changed, 1);
    assert.equal(r.body.summary.added, 1);
    assert.equal(r.body.impact.length, 1);
    const g = (await owner.get('/api/catalog')).body.groups.find((x: any) => x.id === groupId);
    assert.equal(g.items.find((i: any) => i.id === item.id).price, item.price * 2);
    assert.ok(g.items.some((i: any) => i.name === 'Петля новая тестовая' && !i.status));
    const n = (await m.get('/api/notifications')).body.items.find((x: any) => x.type === 'price_change');
    assert.match(n.text, /при перерасчёте подорожает на/);
    assert.equal((await m.get(`/api/kp/${kpId}`)).body.kp.total, kpBefore, 'снимок КП не меняется');

    const list = (await owner.get(`/api/catalog/groups/${groupId}/imports`)).body.imports;
    assert.equal(list[0].canRollback, true);
    assert.equal((await owner.post(`/api/catalog/imports/${list[0].id}/rollback`)).status, 200);
    const g2 = (await owner.get('/api/catalog')).body.groups.find((x: any) => x.id === groupId);
    assert.equal(g2.items.find((i: any) => i.id === item.id).price, item.price);
    assert.equal(g2.items.find((i: any) => i.name === 'Петля новая тестовая').status, 'нет в новом прайсе');
    assert.equal((await owner.post(`/api/catalog/imports/${list[0].id}/rollback`)).status, 409);
    const audit = (await owner.get('/api/audit')).body.entries.map((e: any) => e.action);
    assert.ok(audit.includes('Загрузка прайса файлом') && audit.includes('Откат загрузки прайса'));
  });
});
