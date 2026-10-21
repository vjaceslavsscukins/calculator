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
  const person = async name => { const r = await admin('POST', '/users', { name }); const u = await r.json(); return { ...u, call: as(u.code) }; };
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
  assert.deepEqual(await (await a.call('GET', '/me')).json(), { name: 'Маша Иванова', role: 'user' });
  assert.deepEqual(await (await s.admin('GET', '/me')).json(), { name: 'Администратор', role: 'admin' });
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
  // у администратора проектов нет, чужие он тоже не читает
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

test('короткий или пустой главный код не работает', async () => {
  const s = await start({ adminToken: 'short' });
  assert.equal((await s.as('short')('GET', '/users')).status, 401);
  s.close();
});

test('файловое хранилище переживает перезапуск вместе с людьми и их проектами', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'proj-')), 'projects.json');
  const a = await start({ store: new MemoryStore({ file }) });
  const masha = await a.person('Маша');
  const p = await (await masha.call('POST', '/projects', { name: 'остаётся', data: data(4) })).json();
  a.close();
  const b = await start({ store: new MemoryStore({ file }) });
  const g = await (await b.as(masha.code)('GET', `/projects/${p.id}`)).json();
  assert.equal(g.name, 'остаётся'); assert.equal(g.data.modules.length, 4);
  b.close();
});
