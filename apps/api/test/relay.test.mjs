import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRelay } from '../src/server.mjs';
import { isAllowedMethod, normalizeWebhook } from '../src/policy.mjs';

const TOKEN = 'relay-token-0123456789-abcdefghij';
const SECRET = 'q1w2e3r4t5y6u7i8';

// поддельный Битрикс: запоминает запросы, отдаёт заготовленные ответы
function fakeBitrix() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    if (req.url.startsWith(`/rest/1/${SECRET}/crm.deal.list.json`)) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ result: [{ ID: '1', TITLE: 'Кухня' }], total: 1 })); }
    if (req.url.startsWith(`/rest/1/${SECRET}/lists.get.json`)) { res.statusCode = 401; return res.end(JSON.stringify({ error: 'INVALID_CREDENTIALS', error_description: `bad http://127.0.0.1/rest/1/${SECRET} ${SECRET}` })); }
    if (req.url.startsWith(`/rest/1/${SECRET}/disk.file.get.json?id=7`)) { const port = server.address().port; return res.end(JSON.stringify({ result: { NAME: 'смета.xlsx', DOWNLOAD_URL: `http://127.0.0.1:${port}/dl/7` } })); }
    if (req.url.startsWith(`/rest/1/${SECRET}/disk.file.get.json?id=8`)) { return res.end(JSON.stringify({ result: { NAME: 'x.bin', DOWNLOAD_URL: 'http://evil.example/dl/8' } })); }
    if (req.url.startsWith(`/rest/1/${SECRET}/disk.file.get.json?id=9`)) { const port = server.address().port; return res.end(JSON.stringify({ result: { NAME: 'login', DOWNLOAD_URL: `http://127.0.0.1:${port}/login` } })); }
    if (req.url === '/dl/7') { res.setHeader('content-type', 'application/octet-stream'); return res.end(Buffer.alloc(2048, 1)); }
    if (req.url === '/login') { res.setHeader('content-type', 'text/html'); return res.end('<html>login</html>'); }
    res.statusCode = 404; res.end('{}');
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, seen, port: server.address().port })));
}
async function start(opts = {}) {
  const b = await fakeBitrix();
  const relay = createRelay({ webhook: `http://127.0.0.1:${b.port}/rest/1/${SECRET}/`, token: TOKEN, allowInsecure: true, ...opts });
  await new Promise(r => relay.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${relay.address().port}`;
  return { b, relay, base, close: () => { relay.close(); b.server.close(); } };
}
const auth = { authorization: `Bearer ${TOKEN}` };

test('здоровье открыто, всё остальное требует токен', async () => {
  const s = await start();
  assert.equal((await fetch(`${s.base}/healthz`)).status, 200);
  assert.equal((await fetch(`${s.base}/bitrix/crm.deal.list`)).status, 401);
  assert.equal((await fetch(`${s.base}/bitrix/crm.deal.list`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal(s.b.seen.length, 0, 'без токена в Битрикс не ходили');
  s.close();
});

test('разрешённый метод проходит, параметры сохраняются, auth/token отбрасываются', async () => {
  const s = await start();
  const r = await fetch(`${s.base}/bitrix/crm.deal.list?filter[STAGE_ID]=C1:WON&select[]=ID&auth=hack&token=hack`, { headers: auth });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).result[0].TITLE, 'Кухня');
  const q = decodeURIComponent(s.b.seen[0]);
  assert.ok(q.includes('filter[STAGE_ID]=C1:WON') && q.includes('select[]=ID'));
  assert.ok(!/auth=|token=/.test(q), q);
  s.close();
});

test('методы записи и лишние разделы запрещены', async () => {
  const s = await start();
  for (const m of ['crm.deal.add', 'crm.deal.update', 'crm.deal.delete', 'disk.file.getExternalLink', 'user.get', 'disk.folder.uploadfile', '..%2F..%2Fcrm.deal.list', 'crm', 'crm.deal.list.json', 'im.message.add']) {
    const r = await fetch(`${s.base}/bitrix/${m}`, { headers: auth });
    assert.equal(r.status, 403, m);
  }
  assert.equal(s.b.seen.length, 0);
  assert.equal((await fetch(`${s.base}/bitrix/crm.deal.list`, { method: 'POST', headers: auth })).status, 405);
  s.close();
});

test('ключ вебхука не попадает в ответы, ошибки Битрикса не маскируются под ошибку токена', async () => {
  const s = await start();
  const r = await fetch(`${s.base}/bitrix/lists.get`, { headers: auth });
  const text = await r.text();
  assert.equal(r.status, 502);
  assert.ok(text.includes('INVALID_CREDENTIALS'));
  assert.ok(!text.includes(SECRET), text);
  s.close();
});

test('скачивание файла: только с хоста портала, не страницы входа, с лимитом размера', async () => {
  const s = await start();
  const ok = await fetch(`${s.base}/bitrix-file/7`, { headers: auth });
  assert.equal(ok.status, 200);
  assert.equal((await ok.arrayBuffer()).byteLength, 2048);
  assert.match(ok.headers.get('content-disposition'), /filename\*=UTF-8''%D1%81/);
  assert.equal((await fetch(`${s.base}/bitrix-file/8`, { headers: auth })).status, 502, 'чужой хост');
  assert.equal((await fetch(`${s.base}/bitrix-file/9`, { headers: auth })).status, 502, 'страница входа');
  assert.equal((await fetch(`${s.base}/bitrix-file/abc`, { headers: auth })).status, 404);
  s.close();
  const small = await start({ maxFile: 1000 });
  assert.equal((await fetch(`${small.base}/bitrix-file/7`, { headers: auth })).status, 413);
  small.close();
});

test('ограничение частоты', async () => {
  const s = await start({ ratePerSec: 2 });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await fetch(`${s.base}/bitrix/crm.deal.list`, { headers: auth })).status);
  assert.ok(codes.includes(429), codes.join());
  s.close();
});

test('настройки проверяются при старте', () => {
  assert.throws(() => createRelay({ webhook: 'https://a.bitrix24.ru/rest/1/abc/', token: 'short' }), /24/);
  assert.throws(() => normalizeWebhook('https://a.bitrix24.ru/other/'), /rest/);
  assert.throws(() => normalizeWebhook('http://a.bitrix24.ru/rest/1/abc/'), /https/);
  assert.equal(normalizeWebhook('https://sofiya.bitrix24.ru/rest/1/abc123/').host, 'sofiya.bitrix24.ru');
  assert.ok(isAllowedMethod('disk.folder.getchildren') && isAllowedMethod('crm.item.list') && !isAllowedMethod('crm.item.add'));
  assert.ok(isAllowedMethod('im.dialog.messages.get') && isAllowedMethod('im.dialog.get'));
  assert.ok(!isAllowedMethod('im.message.add') && !isAllowedMethod('im.dialog.messages.add') && !isAllowedMethod('im.chat.list') && !isAllowedMethod('im.chat.add') && !isAllowedMethod('im.disk.file.commit') && !isAllowedMethod('im.dialog.messages.get.json'));
});
