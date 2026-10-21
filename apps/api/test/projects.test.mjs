import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRelay } from '../src/server.mjs';
import { createProjects, MemoryStore, hashCode } from '../src/projects.mjs';

const RELAY = 'relay-token-0123456789-abcdefghij';
const ADMIN = 'admin-token-0123456789-abcdefghij';
const ORIGIN = 'https://kitchen-prototype.onrender.com';
const data = (n = 1) => ({ layout: 'L', modules: Array.from({ length: n }, (_, i) => ({ id: 'm' + i, type: 'base_door' })) });

async function start({ store = new MemoryStore(), ...rest } = {}) {
  const projects = createProjects({ store, adminToken: ADMIN, origins: [ORIGIN], ...rest });
  const relay = createRelay({ webhook: 'http://127.0.0.1:1/rest/1/abc123/', token: RELAY, allowInsecure: true, ratePerSec: 1000, projects });
  await new Promise(r => relay.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${relay.address().port}`;
  const as = code => (method, p, body, headers = {}) => fetch(base + p, { method, headers: { authorization: `Bearer ${code}`, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const admin = as(ADMIN);
  // заводит человека и возвращает запросы от его имени
  const person = async (name, role) => { const r = await admin('POST', '/users', { name, role }); const u = await r.json(); return { ...u, call: as(u.code) }; };
  return { base, store, admin, as, person, close: () => relay.close() };
}

test('без кода и с чужим кодом отказ, без хранилища 503', async () => {
  const s = await start();
  assert.equal((await fetch(`${s.base}/projects`)).status, 401);
  assert.equal((await s.as('wrong')('GET', '/projects')).status, 401);
  assert.equal((await s.as(RELAY)('GET', '/projects')).status, 401, 'токен Битрикс-сервиса проекты не открывает');
  s.close();
  const off = await start({ store: null });
  assert.equal((await off.as(ADMIN)('GET', '/projects')).status, 503);
  off.close();
});

test('администратор заводит людей: код виден один раз, в базе только отпечаток', async () => {
  const s = await start();
  const a = await s.person('Маша Иванова');
  assert.equal(a.name, 'Маша Иванова'); assert.ok(a.code && a.code.length >= 20);
  const list = await (await s.admin('GET', '/users')).json();
  assert.equal(list.users.length, 1); assert.ok(!('code' in list.users[0]) && !('codeHash' in list.users[0]));
  assert.deepEqual(await (await a.call('GET', '/me')).json(), { name: 'Маша Иванова', role: 'manager' });
  assert.deepEqual(await (await s.admin('GET', '/me')).json(), { name: 'Владелец', role: 'owner' });
  const u = [...s.store.users.values()][0];
  assert.notEqual(u.codeHash, a.code); assert.equal(u.codeHash, hashCode(a.code));
  assert.equal((await s.admin('POST', '/users', { name: '  ' })).status, 400);
  assert.equal((await a.call('GET', '/users')).status, 403, 'обычный человек список людей не видит');
  assert.equal((await a.call('POST', '/users', { name: 'X' })).status, 403);
  s.close();
});

test('чужие проекты не видны: ни в списке, ни по номеру, ни для правки и удаления', async () => {
  const s = await start();
  const masha = await s.person('Маша'), petya = await s.person('Петя');
  const p = await (await masha.call('POST', '/projects', { name: 'Секрет Маши', client: 'Клиент', data: data(3) })).json();
  assert.equal((await (await petya.call('GET', '/projects')).json()).projects.length, 0);
  assert.equal((await petya.call('GET', `/projects/${p.id}`)).status, 404);
  assert.equal((await petya.call('PUT', `/projects/${p.id}`, { rev: 1, name: 'взлом', data: data(1) })).status, 404);
  assert.equal((await petya.call('DELETE', `/projects/${p.id}`)).status, 404);
  const own = await (await masha.call('GET', `/projects/${p.id}`)).json();
  assert.equal(own.name, 'Секрет Маши'); assert.equal(own.data.modules.length, 3);
  assert.equal((await (await masha.call('GET', '/projects')).json()).projects.length, 1);
  // у владельца (главного кода) проектов нет, чужие он тоже не читает
  assert.equal((await s.admin('GET', '/projects')).status, 403);
  assert.equal((await s.admin('GET', `/projects/${p.id}`)).status, 403);
  s.close();
});

test('проекты: создать, прочитать, сохранить, список, удалить; имя автора берётся с сервера', async () => {
  const s = await start();
  const a = await s.person('Маша');
  const c = await a.call('POST', '/projects', { name: 'К-1 Тест', client: 'Тестовый', order: 'К-1', total: 123456.7, data: data(2) }, { 'x-author': 'Fake' });
  assert.equal(c.status, 201);
  const p = await c.json();
  assert.match(p.id, /^[0-9a-f-]{36}$/); assert.equal(p.rev, 1); assert.equal(p.total, 123457); assert.equal(p.updatedBy, 'Маша');
  const u = await (await a.call('PUT', `/projects/${p.id}`, { rev: 1, name: 'К-1 Тест 2', client: 'Тестовый', order: 'К-1', total: 200000, data: data(3) })).json();
  assert.equal(u.rev, 2); assert.equal(u.data.modules.length, 3);
  const l = await (await a.call('GET', '/projects')).json();
  assert.equal(l.projects.length, 1); assert.equal(l.projects[0].name, 'К-1 Тест 2'); assert.ok(!('data' in l.projects[0]));
  assert.equal((await a.call('DELETE', `/projects/${p.id}`)).status, 200);
  assert.equal((await a.call('GET', `/projects/${p.id}`)).status, 404);
  s.close();
});

test('устаревшая версия даёт 409, данные не затираются (например, открыто на двух компьютерах)', async () => {
  const s = await start();
  const a = await s.person('Маша');
  const p = await (await a.call('POST', '/projects', { name: 'А', data: data() })).json();
  assert.equal((await a.call('PUT', `/projects/${p.id}`, { rev: 1, name: 'с первого компьютера', data: data(2) })).status, 200);
  const b = await a.call('PUT', `/projects/${p.id}`, { rev: 1, name: 'со второго', data: data(5) });
  assert.equal(b.status, 409);
  const j = await b.json(); assert.equal(j.error, 'conflict'); assert.equal(j.rev, 2); assert.equal(j.updatedBy, 'Маша');
  assert.equal((await (await a.call('GET', `/projects/${p.id}`)).json()).name, 'с первого компьютера');
  s.close();
});

test('плохие данные отклоняются', async () => {
  const s = await start({ maxBody: 2000 });
  const a = await s.person('Маша');
  assert.equal((await a.call('POST', '/projects', { name: 'x' })).status, 400, 'нет данных');
  assert.equal((await a.call('POST', '/projects', { name: 'x', data: { layout: 'L' } })).status, 400, 'нет модулей');
  assert.equal((await fetch(`${s.base}/projects`, { method: 'POST', headers: { authorization: `Bearer ${a.code}` }, body: '{' })).status, 400, 'не JSON');
  assert.equal((await a.call('POST', '/projects', { name: 'x', data: { modules: [], pad: 'я'.repeat(3000) } })).status, 413, 'слишком большой');
  const p = await (await a.call('POST', '/projects', { name: 'x', data: data() })).json();
  assert.equal((await a.call('PUT', `/projects/${p.id}`, { name: 'x', data: data() })).status, 400, 'нужна версия rev');
  assert.equal((await a.call('GET', '/projects/not-an-id')).status, 404);
  s.close();
});

test('отключить человека или выдать новый код: старый код перестаёт работать', async () => {
  const s = await start();
  const a = await s.person('Маша'), old = a.code;
  const p = await (await a.call('POST', '/projects', { name: 'моё', data: data() })).json();
  const nu = await (await s.admin('POST', `/users/${a.id}/code`)).json();
  assert.notEqual(nu.code, old);
  assert.equal((await s.as(old)('GET', '/projects')).status, 401);
  assert.equal((await (await s.as(nu.code)('GET', `/projects/${p.id}`)).json()).name, 'моё', 'проекты остаются у человека');
  assert.equal((await s.admin('DELETE', `/users/${a.id}`)).status, 200);
  assert.equal((await s.as(nu.code)('GET', '/projects')).status, 401);
  assert.equal((await s.admin('POST', '/users/00000000-0000-4000-8000-000000000000/code')).status, 404);
  s.close();
});

test('доступ из браузера только с разрешённого адреса', async () => {
  const s = await start();
  const ok = await fetch(`${s.base}/projects`, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'PUT' } });
  assert.equal(ok.status, 204); assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(ok.headers.get('access-control-allow-headers'), /authorization/);
  const bad = await fetch(`${s.base}/projects`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const a = await s.person('Маша');
  const get = await fetch(`${s.base}/me`, { headers: { authorization: `Bearer ${a.code}`, origin: ORIGIN } });
  assert.equal(get.headers.get('access-control-allow-origin'), ORIGIN);
  s.close();
});

test('роли: администратор ведёт людей и прайсы, менеджер только читает прайсы', async () => {
  const s = await start();
  const boss = await s.person('Шеф', 'admin'), man = await s.person('Менеджер');
  assert.deepEqual(await (await boss.call('GET', '/me')).json(), { name: 'Шеф', role: 'admin' });
  assert.equal((await s.admin('POST', '/users', { name: 'X', role: 'king' })).status, 400, 'неизвестная роль');
  // прайсы: сначала пусто, правит администратор, менеджер читает, но не пишет
  assert.deepEqual((await (await man.call('GET', '/settings')).json()).settings, {});
  const price = { rev: 0, value: { lifts: { hk: 100 } } };
  assert.equal((await man.call('PUT', '/settings/prices', price)).status, 403, 'менеджер прайсы не правит');
  assert.equal((await man.call('GET', '/settings')).status, 200);
  const put = await boss.call('PUT', '/settings/prices', price);
  assert.equal(put.status, 200); const r1 = await put.json(); assert.equal(r1.rev, 1); assert.equal(r1.updatedBy, 'Шеф');
  assert.equal((await s.admin('PUT', '/settings/catalogs', { rev: 0, value: { a: 1 } })).status, 200, 'владелец тоже правит');
  const got = (await (await man.call('GET', '/settings')).json()).settings;
  assert.deepEqual(got.prices.value, { lifts: { hk: 100 } }); assert.equal(got.prices.rev, 1); assert.equal(got.catalogs.rev, 1);
  // правка со старой версии не затирает чужую
  const old = await boss.call('PUT', '/settings/prices', { rev: 0, value: { lifts: { hk: 1 } } });
  assert.equal(old.status, 409); assert.equal((await old.json()).rev, 1);
  assert.equal((await boss.call('PUT', '/settings/prices', { rev: 1, value: { lifts: { hk: 200 } } })).status, 200);
  assert.equal((await boss.call('PUT', '/settings/prices', { value: {} })).status, 400, 'нужна версия');
  assert.equal((await boss.call('PUT', '/settings/prices', { rev: 2, value: [] })).status, 400, 'нужен объект');
  assert.equal((await boss.call('PUT', '/settings/other', { rev: 0, value: {} })).status, 404, 'неизвестный раздел');
  // люди: менеджеру нельзя; администратор может, но не может понизить или отключить сам себя
  assert.equal((await man.call('GET', '/users')).status, 403);
  assert.equal((await man.call('PATCH', `/users/${boss.id}`, { role: 'manager' })).status, 403);
  assert.equal((await boss.call('GET', '/users')).status, 200);
  const nu = await (await boss.call('POST', '/users', { name: 'Второй админ', role: 'admin' })).json(); assert.equal(nu.role, 'admin');
  assert.equal((await boss.call('PATCH', `/users/${boss.id}`, { role: 'manager' })).status, 400);
  assert.equal((await boss.call('DELETE', `/users/${boss.id}`)).status, 400);
  const ch = await (await boss.call('PATCH', `/users/${man.id}`, { role: 'admin' })).json(); assert.equal(ch.role, 'admin');
  assert.equal((await man.call('PUT', '/settings/prices', { rev: 2, value: {} })).status, 200, 'после повышения менеджер правит прайсы');
  assert.equal((await boss.call('PATCH', `/users/${man.id}`, { role: 'bad' })).status, 400);
  // проекты есть и у администратора, и у менеджера
  assert.equal((await boss.call('POST', '/projects', { name: 'П', data: data() })).status, 201);
  s.close();
});

test('прайсы без кода недоступны, большой прайс проходит, слишком большой нет', async () => {
  const s = await start({ maxSettings: 3000 });
  assert.equal((await fetch(`${s.base}/settings`)).status, 401);
  const boss = await s.person('Шеф', 'admin');
  assert.equal((await boss.call('PUT', '/settings/prices', { rev: 0, value: { pad: 'я'.repeat(100) } })).status, 200);
  assert.equal((await boss.call('PUT', '/settings/prices', { rev: 1, value: { pad: 'я'.repeat(3000) } })).status, 413);
  s.close();
});

test('короткий или пустой главный код не работает', async () => {
  const s = await start({ adminToken: 'short' });
  assert.equal((await s.as('short')('GET', '/users')).status, 401);
  s.close();
});

test('файловое хранилище переживает перезапуск вместе с людьми и их проектами', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'proj-')), 'projects.json');
  const a = await start({ store: new MemoryStore({ file }) });
  const masha = await a.person('Маша', 'admin');
  const p = await (await masha.call('POST', '/projects', { name: 'остаётся', data: data(4) })).json();
  assert.equal((await masha.call('PUT', '/settings/prices', { rev: 0, value: { x: 1 } })).status, 200);
  a.close();
  const b = await start({ store: new MemoryStore({ file }) });
  const g = await (await b.as(masha.code)('GET', `/projects/${p.id}`)).json();
  assert.equal(g.name, 'остаётся'); assert.equal(g.data.modules.length, 4);
  const st = (await (await b.as(masha.code)('GET', '/settings')).json()).settings;
  assert.deepEqual(st.prices.value, { x: 1 }); assert.equal((await (await b.as(masha.code)('GET', '/me')).json()).role, 'admin');
  b.close();
});
