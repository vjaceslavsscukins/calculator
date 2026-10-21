import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRelay } from '../src/server.mjs';
import { createProjects, MemoryStore } from '../src/projects.mjs';

const RELAY = 'relay-token-0123456789-abcdefghij';
const PROJ = 'projects-token-0123456789-abcdef';
const ORIGIN = 'https://kitchen-prototype.onrender.com';
const data = (n = 1) => ({ layout: 'L', modules: Array.from({ length: n }, (_, i) => ({ id: 'm' + i, type: 'base_door' })) });

async function start({ store = new MemoryStore(), ...rest } = {}) {
  const projects = createProjects({ store, tokens: [PROJ, RELAY], origins: [ORIGIN], ...rest });
  const relay = createRelay({ webhook: 'http://127.0.0.1:1/rest/1/abc123/', token: RELAY, allowInsecure: true, projects });
  await new Promise(r => relay.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${relay.address().port}`;
  const call = (method, p, body, headers = {}) => fetch(base + p, { method, headers: { authorization: `Bearer ${PROJ}`, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { base, call, close: () => relay.close() };
}

test('проекты: без токена и с чужим токеном отказ, без хранилища 503', async () => {
  const s = await start();
  assert.equal((await fetch(`${s.base}/projects`)).status, 401);
  assert.equal((await fetch(`${s.base}/projects`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  s.close();
  const off = await start({ store: null });
  assert.equal((await off.call('GET', '/projects')).status, 503);
  off.close();
});

test('проекты: создать, прочитать, сохранить, список, удалить', async () => {
  const s = await start();
  const c = await s.call('POST', '/projects', { name: 'К-1 Тест', client: 'Тестовый', order: 'К-1', total: 123456.7, data: data(2) }, { 'x-author': encodeURIComponent('Маша') });
  assert.equal(c.status, 201);
  const p = await c.json();
  assert.match(p.id, /^[0-9a-f-]{36}$/); assert.equal(p.rev, 1); assert.equal(p.total, 123457); assert.equal(p.updatedBy, 'Маша');

  const g = await (await s.call('GET', `/projects/${p.id}`)).json();
  assert.equal(g.data.modules.length, 2);

  const u = await s.call('PUT', `/projects/${p.id}`, { rev: 1, name: 'К-1 Тест 2', client: 'Тестовый', order: 'К-1', total: 200000, data: data(3) });
  assert.equal(u.status, 200);
  const up = await u.json(); assert.equal(up.rev, 2); assert.equal(up.data.modules.length, 3);

  const l = await (await s.call('GET', '/projects')).json();
  assert.equal(l.projects.length, 1); assert.equal(l.projects[0].name, 'К-1 Тест 2'); assert.ok(!('data' in l.projects[0]), 'в списке данных проекта нет');

  assert.equal((await s.call('DELETE', `/projects/${p.id}`)).status, 200);
  assert.equal((await s.call('GET', `/projects/${p.id}`)).status, 404);
  assert.equal((await (await s.call('GET', '/projects')).json()).projects.length, 0);
  s.close();
});

test('проекты: устаревшая версия даёт 409, чужие данные не затираются', async () => {
  const s = await start();
  const p = await (await s.call('POST', '/projects', { name: 'А', data: data() })).json();
  const a = await s.call('PUT', `/projects/${p.id}`, { rev: 1, name: 'от первого', data: data(2) }, { 'x-author': encodeURIComponent('Первый') });
  assert.equal(a.status, 200);
  const b = await s.call('PUT', `/projects/${p.id}`, { rev: 1, name: 'от второго', data: data(5) });
  assert.equal(b.status, 409);
  const j = await b.json(); assert.equal(j.error, 'conflict'); assert.equal(j.rev, 2); assert.equal(j.updatedBy, 'Первый');
  const cur = await (await s.call('GET', `/projects/${p.id}`)).json();
  assert.equal(cur.name, 'от первого'); assert.equal(cur.data.modules.length, 2);
  s.close();
});

test('проекты: плохие данные отклоняются', async () => {
  const s = await start({ maxBody: 2000 });
  assert.equal((await s.call('POST', '/projects', { name: 'x' })).status, 400, 'нет данных');
  assert.equal((await s.call('POST', '/projects', { name: 'x', data: { layout: 'L' } })).status, 400, 'нет модулей');
  assert.equal((await fetch(`${s.base}/projects`, { method: 'POST', headers: { authorization: `Bearer ${PROJ}` }, body: '{' })).status, 400, 'не JSON');
  assert.equal((await s.call('POST', '/projects', { name: 'x', data: { modules: [], pad: 'я'.repeat(3000) } })).status, 413, 'слишком большой');
  const p = await (await s.call('POST', '/projects', { name: 'x', data: data() })).json();
  assert.equal((await s.call('PUT', `/projects/${p.id}`, { name: 'x', data: data() })).status, 400, 'нужна версия rev');
  assert.equal((await s.call('GET', '/projects/not-an-id')).status, 404);
  assert.equal((await s.call('PUT', '/projects/00000000-0000-4000-8000-000000000000', { rev: 1, data: data() })).status, 404);
  s.close();
});

test('проекты: доступ из браузера только с разрешённого адреса', async () => {
  const s = await start();
  const ok = await fetch(`${s.base}/projects`, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'PUT' } });
  assert.equal(ok.status, 204); assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(ok.headers.get('access-control-allow-headers'), /authorization/);
  const bad = await fetch(`${s.base}/projects`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const get = await fetch(`${s.base}/projects`, { headers: { authorization: `Bearer ${PROJ}`, origin: ORIGIN } });
  assert.equal(get.headers.get('access-control-allow-origin'), ORIGIN);
  s.close();
});

test('проекты: токен Битрикс-сервиса тоже подходит, Битрикс-маршруты не открываются токеном проектов', async () => {
  const s = await start();
  assert.equal((await fetch(`${s.base}/projects`, { headers: { authorization: `Bearer ${RELAY}` } })).status, 200);
  assert.equal((await fetch(`${s.base}/bitrix/crm.deal.list`, { headers: { authorization: `Bearer ${PROJ}` } })).status, 401);
  s.close();
});

test('проекты: файловое хранилище переживает перезапуск', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'proj-')), 'projects.json');
  const a = await start({ store: new MemoryStore({ file }) });
  const p = await (await a.call('POST', '/projects', { name: 'остаётся', data: data(4) })).json();
  a.close();
  const b = await start({ store: new MemoryStore({ file }) });
  const g = await (await b.call('GET', `/projects/${p.id}`)).json();
  assert.equal(g.name, 'остаётся'); assert.equal(g.data.modules.length, 4);
  b.close();
});
