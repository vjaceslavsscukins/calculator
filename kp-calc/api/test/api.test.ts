// Тесты сервера против настоящего PostgreSQL. Без DATABASE_URL — пропуск.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.ts';
import { compute, DEFAULT_SETTINGS } from '../../engine/src/index.ts';
import type { CalcInput, Catalog } from '../../engine/src/index.ts';
import { CATALOG_FILE, seed } from '../src/db.ts';
import { OWNER, SKIP, agent, keysDeep, makeUser, setup } from './helpers.ts';
import type { Agent, Ctx } from './helpers.ts';

const SECRET_KEYS = ['cost', 'prod', 'margin', 'costByGroup', 'price', 'unitCost', 'costNote'];
const assertNoCost = (body: unknown, where: string) => {
  const keys = keysDeep(body);
  for (const k of SECRET_KEYS) assert.ok(!keys.has(k), `${where}: менеджер получил поле ${k}`);
};

describe('сервер калькулятора КП', { skip: SKIP }, () => {
  let ctx: Ctx, owner: Agent;
  let msk: number, krd: number;
  let m1: Agent, m2: Agent, m3: Agent, h1: Agent, h2: Agent;
  let m1User: any;
  let ldsp: string, hw: string, catalogJson: Catalog;

  before(async () => {
    ctx = await setup();
    owner = agent(ctx.app);
    await owner.login(OWNER.email, OWNER.password);
    const cities = (await owner.get('/api/meta')).body.cities;
    msk = cities.find((c: any) => c.name === 'Москва').id;
    krd = cities.find((c: any) => c.name === 'Краснодар').id;
    catalogJson = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
    ldsp = catalogJson.groups.find((g) => g.category === 'ЛДСП корпус')!.items.find((i) => !i.status && i.price > 0)!.id;
    hw = catalogJson.groups.find((g) => g.category === 'Фурнитура')!.items.find((i) => !i.status && i.price > 0)!.id;
    const mk = (firstName: string, email: string, role: string, cityId: number) => makeUser(ctx.app, owner, { firstName, email, role, cityId });
    const r1 = await mk('Мария', 'm1@test.local', 'manager', msk); m1 = r1.agent; m1User = r1.user;
    m2 = (await mk('Михаил', 'm2@test.local', 'manager', msk)).agent;
    m3 = (await mk('Марат', 'm3@test.local', 'manager', krd)).agent;
    h1 = (await mk('Елена', 'h1@test.local', 'head', msk)).agent;
    h2 = (await mk('Олег', 'h2@test.local', 'head', krd)).agent;
  });
  after(async () => { await ctx?.close(); });

  test('сиды: города, прайс из catalog.json, настройки по умолчанию, один владелец; повторный запуск ничего не дублирует', async () => {
    await seed(ctx.pool, { OWNER_EMAIL: 'other@test.local', OWNER_PASSWORD: 'other-pass-1' });
    const { rows: cities } = await ctx.pool.query('select name from cities order by id');
    assert.deepEqual(cities.map((c) => c.name), ['Москва', 'Краснодар']);
    const cat = (await owner.get('/api/catalog')).body;
    assert.equal(cat.version, catalogJson.version);
    assert.equal(cat.groups.length, catalogJson.groups.length);
    assert.deepEqual(cat.groups.map((g: any) => g.items.length), catalogJson.groups.map((g) => g.items.length));
    assert.deepEqual(cat.groups[0].items[0], catalogJson.groups[0].items[0]);
    const s = (await owner.get('/api/settings')).body;
    const { rev, ...settings } = s;
    assert.equal(rev, 1);
    assert.deepEqual(settings, DEFAULT_SETTINGS);
    const { rows: owners } = await ctx.pool.query(`select email from users where role = 'owner'`);
    assert.deepEqual(owners.map((o) => o.email), [OWNER.email]);
  });

  test('вход, me, выход', async () => {
    const a = agent(ctx.app);
    assert.equal((await a.get('/api/auth/me')).status, 401);
    const bad = await a.post('/api/auth/login', { email: OWNER.email, password: 'wrong-password' });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error, 'Неверная почта или пароль');
    const user = await a.login(OWNER.email.toUpperCase(), OWNER.password);
    assert.deepEqual(Object.keys(user).sort(), ['cityId', 'cityName', 'email', 'firstName', 'id', 'lastName', 'role']);
    assert.equal(user.role, 'owner');
    assert.equal((await a.get('/api/auth/me')).body.user.email, OWNER.email);
    const { rows } = await ctx.pool.query('select token_hash from sessions');
    assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash)), 'токен сессии хранится хешем');
    assert.deepEqual((await a.post('/api/auth/logout')).body, {});
    assert.equal((await a.get('/api/auth/me')).status, 401);
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/healthz' })).body, 'ok');
  });

  test('приглашение и установка пароля; отключённый не входит', async () => {
    const r = await owner.post('/api/users', { firstName: 'Иван', lastName: 'Петров', email: 'ivan@test.local', role: 'manager', cityId: krd });
    assert.equal(r.status, 200);
    assert.match(r.body.inviteUrl, /^https:\/\/kp\.test\/invite\/[\w-]{40,}$/);
    assert.equal(r.body.user.invited, true);
    assert.equal(r.body.user.cityName, 'Краснодар');
    const token = r.body.inviteUrl.split('/invite/')[1];
    assert.deepEqual((await agent(ctx.app).get(`/api/auth/invite/${token}`)).body, { email: 'ivan@test.local', firstName: 'Иван' });
    assert.equal((await owner.post('/api/users', { firstName: 'Иван', email: 'IVAN@test.local', role: 'manager', cityId: krd })).status, 409);
    const a = agent(ctx.app);
    assert.equal((await a.post('/api/auth/invite/accept', { token, password: 'short' })).status, 400);
    const ok = await a.post('/api/auth/invite/accept', { token, password: 'ivan-pass-1' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.email, 'ivan@test.local');
    assert.equal((await a.get('/api/auth/me')).body.user.firstName, 'Иван');
    assert.equal((await agent(ctx.app).post('/api/auth/invite/accept', { token, password: 'other-pass-1' })).status, 404, 'приглашение одноразовое');
    assert.equal((await agent(ctx.app).get(`/api/auth/invite/${token}`)).status, 404);
    const list = (await owner.get('/api/users')).body.users;
    assert.equal(list.find((u: any) => u.email === 'ivan@test.local').invited, false);
    assert.equal((await m1.get('/api/users')).status, 403);
    assert.equal((await h1.post('/api/users', { firstName: 'X', email: 'x@test.local', role: 'manager', cityId: msk })).status, 403);
    // отключение: сессия закрыта сразу, вход невозможен; себя отключить нельзя
    const ivan = list.find((u: any) => u.email === 'ivan@test.local');
    assert.equal((await owner.patch(`/api/users/${ivan.id}`, { disabled: true })).body.user.disabled, true);
    assert.equal((await a.get('/api/auth/me')).status, 401);
    assert.equal((await agent(ctx.app).post('/api/auth/login', { email: 'ivan@test.local', password: 'ivan-pass-1' })).status, 401);
    const me = (await owner.get('/api/auth/me')).body.user;
    assert.equal((await owner.patch(`/api/users/${me.id}`, { disabled: true })).status, 400);
    assert.equal((await owner.patch(`/api/users/${me.id}`, { role: 'head', cityId: msk })).status, 400);
    // сброс пароля новой ссылкой
    const again = await owner.post(`/api/users/${ivan.id}/invite`);
    assert.match(again.body.inviteUrl, /\/invite\//);
    const audit = (await owner.get('/api/audit')).body.entries;
    assert.ok(audit.some((e: any) => e.entity === 'Пользователи' && e.action === 'Пользователь отключён'));
  });

  let clientA: string, calcA: string;

  test('клиенты: менеджер — свои, руководитель — свой город, владелец — все; чужое = 404', async () => {
    assert.equal((await m1.post('/api/clients', { name: 'Анна', phone: '' })).status, 400);
    const c = await m1.post('/api/clients', { name: 'Анна Смирнова', phone: '+7 (916) 123-45-67', cityId: krd });
    assert.equal(c.status, 200);
    clientA = c.body.client.id;
    assert.equal(c.body.client.cityName, 'Москва', 'менеджер заводит клиента в своём городе');
    assert.equal(c.body.client.managerId, m1User.id);
    const k = await m3.post('/api/clients', { name: 'Борис', phone: '89001112233' });
    const clientK = k.body.client.id;

    assert.deepEqual((await m1.get('/api/clients')).body.clients.map((x: any) => x.id), [clientA]);
    assert.deepEqual((await m2.get('/api/clients')).body.clients, []);
    assert.equal((await m2.get(`/api/clients/${clientA}`)).status, 404);
    assert.equal((await m2.patch(`/api/clients/${clientA}`, { name: 'Взлом' })).status, 404);
    assert.equal((await m2.post('/api/calculations', { clientId: clientA, title: 'Кухня', kind: 'kitchen' })).status, 404);
    assert.deepEqual((await h1.get('/api/clients')).body.clients.map((x: any) => x.id), [clientA]);
    assert.deepEqual((await h2.get('/api/clients')).body.clients.map((x: any) => x.id), [clientK]);
    assert.equal((await h2.get(`/api/clients/${clientA}`)).status, 404);
    assert.equal((await owner.get('/api/clients')).body.clients.length, 2);
    // поиск по имени и по цифрам телефона
    assert.equal((await h1.get('/api/clients?q=' + encodeURIComponent('смирн'))).body.clients.length, 1);
    assert.equal((await h1.get('/api/clients?q=916123')).body.clients.length, 1);
    assert.equal((await h1.get('/api/clients?q=999999')).body.clients.length, 0);
    assert.equal((await m1.get('/api/clients/not-a-uuid')).status, 404);
    // менеджер не меняет менеджера и город; руководитель — только в своём городе
    assert.equal((await m1.patch(`/api/clients/${clientA}`, { cityId: krd })).status, 403);
    assert.equal((await h1.patch(`/api/clients/${clientA}`, { cityId: krd })).status, 403);
    assert.equal((await m1.patch(`/api/clients/${clientA}`, { phone: '+7 916 123-45-67' })).body.client.phone, '+7 916 123-45-67');
  });

  test('расчёт: создание, сохранение с rev, 409 без затирания, итог в реестре, копия', async () => {
    const c = await m1.post('/api/calculations', { clientId: clientA, title: 'Кухня на Тверской', kind: 'kitchen' });
    assert.equal(c.status, 200);
    calcA = c.body.calculation.id;
    assert.equal(c.body.calculation.rev, 1);
    assert.equal(c.body.calculation.status, 'draft');
    assert.deepEqual(c.body.calculation.input.rows, []);
    assert.equal(c.body.calculation.input.light.enabled, false);
    assert.equal(c.body.calculation.input.discountPct, 0);
    assert.equal(c.body.view.total, 0);

    const input = {
      kind: 'kitchen',
      rows: [
        { id: 'r1', block: 'up', pro100: 'ЛДСП_верх', qtyPro100: 5, qty: 5, itemId: ldsp },
        { id: 'r2', block: 'hw', qty: 10, itemId: hw },
        { id: 'r3', block: 'free', qty: 2, own: { name: 'Ручка', unit: 'шт', price: 1500 } },
      ],
      light: { enabled: true, profileId: 'inset', segments: [{ name: 'Над столешницей', lengthM: 3, switchId: 'wave' }] },
      discountPct: 5,
    };
    const p = await m1.put(`/api/calculations/${calcA}`, { rev: 1, status: 'saved', input, unparsed: [{ name: 'Евровинт', qty: 64, unit: 'шт' }] });
    assert.equal(p.status, 200, p.raw);
    assert.equal(p.body.calculation.rev, 2);
    assert.equal(p.body.calculation.status, 'saved');
    assert.equal(p.body.calculation.updatedBy, 'Мария');
    assert.ok(p.body.view.total > 0);
    const expected = compute(input as CalcInput, catalogJson, DEFAULT_SETTINGS).total;
    assert.equal(p.body.view.total, expected);

    // руководитель правит со старой версией — 409, данные менеджера не затёрты
    const stale = await h1.put(`/api/calculations/${calcA}`, { rev: 1, input: { ...input, rows: [] } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.rev, 2);
    assert.equal(stale.body.updatedBy, 'Мария');
    assert.ok(stale.body.error);
    const got = await m1.get(`/api/calculations/${calcA}`);
    assert.equal(got.body.calculation.input.rows.length, 3);
    assert.equal(got.body.calculation.unparsed[0].name, 'Евровинт');
    // руководитель своего города правит с актуальной версией
    const ok = await h1.put(`/api/calculations/${calcA}`, { rev: 2, title: 'Кухня на Тверской, вариант 1' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.calculation.rev, 3);
    assert.equal(ok.body.calculation.input.rows.length, 3, 'без input данные расчёта сохраняются');
    assert.equal((await m2.put(`/api/calculations/${calcA}`, { rev: 3, input })).status, 404);
    assert.equal((await h2.get(`/api/calculations/${calcA}`)).status, 404);

    // реестр: итог хранится, видимость как у клиентов
    const list = (await m1.get('/api/calculations')).body.calculations;
    assert.equal(list.length, 1);
    assert.deepEqual(Object.keys(list[0]).sort(), ['cityName', 'clientId', 'clientName', 'id', 'kind', 'managerName', 'status', 'title', 'total', 'updatedAt']);
    assert.equal(list[0].total, expected);
    assert.equal(list[0].clientName, 'Анна Смирнова');
    assert.equal((await m2.get('/api/calculations')).body.calculations.length, 0);
    assert.equal((await h2.get('/api/calculations')).body.calculations.length, 0);
    assert.equal((await owner.get('/api/calculations?status=saved')).body.calculations.length, 1);
    assert.equal((await owner.get('/api/calculations?status=draft')).body.calculations.length, 0);

    const copy = await m1.post(`/api/calculations/${calcA}/copy`);
    assert.equal(copy.status, 200);
    assert.equal(copy.body.calculation.title, 'Кухня на Тверской, вариант 1 (копия)');
    assert.equal(copy.body.calculation.status, 'draft');
    assert.deepEqual(copy.body.calculation.input, got.body.calculation.input);
    const card = (await m1.get(`/api/clients/${clientA}`)).body;
    assert.equal(card.calculations.length, 2);
    assert.equal(card.client.calcCount, 2);
  });

  test('менеджер не получает себестоимость, производственную цену, маржу и цены прайса', async () => {
    const calc = await m1.get(`/api/calculations/${calcA}`);
    // в input у свободной строки своя цена закупки — это ввод менеджера, проверяем только view
    assertNoCost(calc.body.view, 'GET расчёта');
    const lightRows = calc.body.view.rows.filter((r: any) => r.block === 'light');
    assert.ok(lightRows.length >= 3);
    for (const r of lightRows) assert.deepEqual(Object.keys(r).sort(), ['block', 'id', 'name', 'qty', 'retail', 'unit']);
    assert.ok(calc.body.view.retail > 0 && calc.body.view.total > 0);

    const input = calc.body.calculation.input;
    const put = await m1.put(`/api/calculations/${calcA}`, { rev: calc.body.calculation.rev, input });
    assertNoCost(put.body.view, 'PUT расчёта');
    assertNoCost((await m1.post('/api/compute', { input })).body, 'compute');
    assertNoCost((await m1.post(`/api/calculations/${calcA}/copy`)).body.view, 'копия');
    const cat = (await m1.get('/api/catalog')).body;
    assert.ok(cat.groups.length > 0 && cat.groups[0].items.length > 0);
    assertNoCost(cat, 'прайс');
    const s = (await m1.get('/api/settings')).body;
    assertNoCost(s, 'настройки');
    assert.deepEqual(Object.keys(s).sort(), ['deliveryPct', 'light', 'roundTo']);
    // pro100 и реестр — тоже без цен
    assertNoCost((await m1.post('/api/pro100/parse', { kind: 'kitchen', text: 'Петли 4 шт' })).body, 'pro100');
    assertNoCost((await m1.get('/api/calculations')).body, 'реестр');
    // прайс, журнал и коэффициенты менеджеру закрыты
    assert.equal((await m1.patch(`/api/catalog/items/${ldsp}`, { price: 1 })).status, 403);
    assert.equal((await m1.get('/api/audit')).status, 403);

    // руководитель и владелец видят себестоимость
    const head = await h1.get(`/api/calculations/${calcA}`);
    for (const k of ['cost', 'prod', 'margin', 'costByGroup']) assert.ok(k in head.body.view, `руководитель: ${k}`);
    assert.ok('unitCost' in head.body.view.rows[0]);
    assert.ok('price' in (await h1.get('/api/catalog')).body.groups[0].items[0]);
    assert.ok('kProd' in (await h1.get('/api/settings')).body);
  });

  test('/api/compute совпадает с engine.compute', async () => {
    const input: CalcInput = {
      kind: 'cabinet',
      rows: [
        { id: 'a', block: 'body', qty: 4.2, itemId: ldsp },
        { id: 'b', block: 'hw', qty: 6, itemId: hw },
        { id: 'c', block: 'free', qty: 1, own: { name: 'Зеркало', unit: 'шт', price: 4000 } },
        { id: 'd', block: 'free', qty: 1, itemId: 'нет-такой' },
      ],
      light: { enabled: true, profileId: 'surface', segments: [{ name: 'В шкафу', lengthM: 11, switchId: 'door' }] },
      discountPct: 7,
    };
    // через JSON, как по сети: поля со значением undefined исчезают
    const expected = JSON.parse(JSON.stringify(compute(input, catalogJson, DEFAULT_SETTINGS)));
    assert.deepEqual((await owner.post('/api/compute', { input })).body.view, expected);
    assert.deepEqual((await h1.post('/api/compute', { input })).body.view, expected);
    const mv = (await m1.post('/api/compute', { input })).body.view;
    assert.equal(mv.total, expected.total);
    assert.equal(mv.retail, expected.retail);
    assert.deepEqual(mv.warnings, expected.warnings);
    assert.equal((await owner.post('/api/compute', { input: { ...input, kind: 'sofa' } })).status, 400);
  });

  test('/api/pro100/parse: разбор, «Не разобрано», умолчание — последний выбор этого пользователя, слияние', async () => {
    // m1 уже сохранил строку «ЛДСП_верх» с позицией ldsp
    const text = 'ЛДСП_верх\t6,5\tм²\nПетли 12 шт\nЕвровинт\t64\tшт\nмусор';
    const r = await m1.post('/api/pro100/parse', { kind: 'kitchen', text });
    assert.equal(r.status, 200);
    const up = r.body.rows.find((x: any) => x.pro100 === 'ЛДСП_верх');
    assert.equal(up.itemId, ldsp);
    assert.equal(up.qty, 6.5);
    assert.equal(up.block, 'up');
    assert.equal(r.body.rows.find((x: any) => x.pro100 === 'Петли').itemId, null);
    assert.deepEqual(r.body.unparsed, [{ name: 'Евровинт', qty: 64, unit: 'шт' }]);
    assert.deepEqual(r.body.skipped, ['мусор']);
    // у другого менеджера своего умолчания нет
    const other = await m2.post('/api/pro100/parse', { kind: 'kitchen', text });
    assert.equal(other.body.rows.find((x: any) => x.pro100 === 'ЛДСП_верх').itemId, null);
    // слияние: выбранный материал и исправленное вручную количество сохраняются
    const rows = [{ id: 'keep', block: 'up', pro100: 'ЛДСП_верх', qtyPro100: 5, qty: 5.5, itemId: hw }];
    const merged = await m2.post('/api/pro100/parse', { kind: 'kitchen', text, rows });
    const m = merged.body.rows.find((x: any) => x.pro100 === 'ЛДСП_верх');
    assert.deepEqual([m.id, m.itemId, m.qty, m.qtyPro100], ['keep', hw, 5.5, 6.5]);
    // снятая с прайса позиция не предлагается по умолчанию
    await h1.patch(`/api/catalog/items/${ldsp}`, { status: 'нет в новом прайсе' });
    assert.equal((await m1.post('/api/pro100/parse', { kind: 'kitchen', text })).body.rows[0].itemId, null);
    await h1.patch(`/api/catalog/items/${ldsp}`, { status: null });
    assert.equal((await m1.post('/api/pro100/parse', { kind: 'kitchen', text })).body.rows[0].itemId, ldsp);
    assert.equal((await m1.post('/api/pro100/parse', { kind: 'kitchen' })).status, 400);
  });

  test('правка цены: журнал «было → стало» и новый пересчёт', async () => {
    const input = { kind: 'kitchen', rows: [{ id: 'x', block: 'hw', qty: 2, itemId: hw }], light: { enabled: false, profileId: 'inset', segments: [] }, discountPct: 0 };
    const before = (await m1.post('/api/compute', { input })).body.view.total;
    const oldPrice = (await h1.get('/api/catalog')).body.groups.flatMap((g: any) => g.items).find((i: any) => i.id === hw).price;
    const r = await h1.patch(`/api/catalog/items/${hw}`, { price: oldPrice * 2 });
    assert.equal(r.status, 200);
    assert.equal(r.body.item.price, oldPrice * 2);
    const after = (await m1.post('/api/compute', { input })).body.view.total;
    assert.ok(Math.abs(after - before * 2) < 1e-6, `итог удвоился: ${before} → ${after}`);
    const entry = (await h1.get('/api/audit?limit=5')).body.entries.find((e: any) => e.action === 'Изменение цены');
    assert.ok(entry);
    assert.equal(entry.userName, 'Елена');
    assert.deepEqual(entry.details.price, { before: oldPrice, after: oldPrice * 2 });
    assert.equal(entry.details.itemId, hw);
    assert.equal((await m1.get('/api/catalog')).body.version, catalogJson.version! + 3, 'версия прайса растёт с каждой правкой');
    // новая позиция в группе
    const g = catalogJson.groups.find((x) => x.category === 'Фурнитура')!;
    const add = await owner.post(`/api/catalog/groups/${g.id}/items`, { name: 'Петля тестовая', price: 321 });
    assert.equal(add.status, 200);
    assert.ok((await m1.get('/api/catalog')).body.groups.find((x: any) => x.id === g.id).items.some((i: any) => i.id === add.body.item.id));
    assert.equal((await owner.patch(`/api/catalog/items/${hw}`, { price: -1 })).status, 400);
  });

  test('настройки: правит только владелец, rev и 409, журнал, пересчёт по новым коэффициентам', async () => {
    const cur = (await owner.get('/api/settings')).body;
    const { rev, ...settings } = cur;
    assert.equal((await h1.put('/api/settings', { rev, settings })).status, 403);
    const r = await owner.put('/api/settings', { rev, settings: { ...settings, kShop: 2.5 } });
    assert.equal(r.status, 200);
    assert.equal(r.body.rev, rev + 1);
    assert.equal(r.body.settings.kShop, 2.5);
    assert.equal((await owner.put('/api/settings', { rev, settings })).status, 409);
    assert.equal((await owner.put('/api/settings', { rev: rev + 1, settings: { ...settings, kProd: -1 } })).status, 400);
    const e = (await owner.get('/api/audit')).body.entries[0];
    assert.equal(e.entity, 'Коэффициенты');
    assert.deepEqual(e.details.kShop, { before: 2, after: 2.5 });
    const input: CalcInput = { kind: 'kitchen', rows: [{ id: 'x', block: 'hw', qty: 1, itemId: hw }], light: { enabled: false, profileId: 'inset', segments: [] }, discountPct: 0 };
    const v = (await owner.post('/api/compute', { input })).body.view;
    assert.ok(Math.abs(v.retail - v.prod * 2.5) < 1e-6);
  });

  test('руководитель передаёт клиента менеджеру своего города', async () => {
    const m2Id = (await owner.get('/api/users')).body.users.find((u: any) => u.email === 'm2@test.local').id;
    const m3Id = (await owner.get('/api/users')).body.users.find((u: any) => u.email === 'm3@test.local').id;
    assert.equal((await h1.patch(`/api/clients/${clientA}`, { managerId: m3Id })).status, 403);
    const r = await h1.patch(`/api/clients/${clientA}`, { managerId: m2Id });
    assert.equal(r.status, 200);
    assert.equal(r.body.client.managerName, 'Михаил');
    assert.equal((await m1.get(`/api/clients/${clientA}`)).status, 404);
    assert.equal((await m1.get(`/api/calculations/${calcA}`)).status, 404);
    assert.equal((await m2.get(`/api/calculations/${calcA}`)).status, 200);
  });

  test('production: web/dist отдаётся как SPA, /api — JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kp-web-'));
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>КП</title>');
    await writeFile(join(dir, 'assets', 'app.js'), 'console.log(1)');
    const app = await buildApp({ pool: ctx.pool, production: true, webDist: dir });
    try {
      const page = await app.inject({ url: '/clients/123' });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /<title>КП<\/title>/);
      assert.equal((await app.inject({ url: '/assets/app.js' })).body, 'console.log(1)');
      assert.equal((await app.inject({ url: '/assets/none.js' })).statusCode, 404);
      const api = await app.inject({ url: '/api/nope' });
      assert.equal(api.statusCode, 401);
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: OWNER.email, password: OWNER.password } });
      assert.match(String(login.headers['set-cookie']), /HttpOnly; Secure; SameSite=Lax/);
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
