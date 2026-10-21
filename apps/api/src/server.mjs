// Сервис «только чтение» между нами и Битрикс24. Ключ вебхука живёт только здесь, в переменной окружения.
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { cleanQuery, isAllowedMethod, normalizeWebhook, scrub } from './policy.mjs';
import { createPgStore, createProjects, MemoryStore } from './projects.mjs';

class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

export function createRelay({ webhook, token, projects = createProjects({ store: null }), allowInsecure = false, fetchImpl = fetch, maxJson = 5 * 1024 * 1024, maxFile = 25 * 1024 * 1024, ratePerSec = 10, timeoutMs = 20000 }) {
  if (!token || token.length < 24) throw new Error('RELAY_TOKEN должен быть не короче 24 символов');
  const wh = normalizeWebhook(webhook, { allowInsecure });
  const tokenHash = createHash('sha256').update(token).digest();
  let bucket = ratePerSec, last = Date.now();
  const take = () => { const now = Date.now(); bucket = Math.min(ratePerSec, bucket + (now - last) / 1000 * ratePerSec); last = now; if (bucket < 1) return false; bucket -= 1; return true; };

  const reply = (res, code, body, headers = {}) => {
    const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
    res.writeHead(code, { 'content-type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
    res.end(isJson ? JSON.stringify(body) : body);
  };
  const authorized = req => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    return !!m && timingSafeEqual(createHash('sha256').update(m[1]).digest(), tokenHash);
  };
  async function readLimited(r, max) {
    if (Number(r.headers.get('content-length') || 0) > max) throw new HttpError(413, 'too_large');
    const chunks = []; let n = 0;
    for await (const c of r.body) { n += c.length; if (n > max) throw new HttpError(413, 'too_large'); chunks.push(c); }
    return Buffer.concat(chunks);
  }
  const upstream = url => fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { accept: '*/*' } });

  async function callMethod(res, rawMethod, search) {
    const method = decodeURIComponent(rawMethod).toLowerCase();
    if (!isAllowedMethod(method)) throw new HttpError(403, 'method_not_allowed');
    const qs = cleanQuery(search);
    const r = await upstream(`${wh.base}${method}.json${qs ? '?' + qs : ''}`);
    const body = scrub((await readLimited(r, maxJson)).toString('utf8'), wh.secrets);
    reply(res, [401, 403].includes(r.status) ? 502 : r.status, body, { 'content-type': 'application/json; charset=utf-8' });
  }

  async function download(res, id) {
    const info = await upstream(`${wh.base}disk.file.get.json?id=${id}`);
    const j = JSON.parse((await readLimited(info, maxJson)).toString('utf8'));
    const dl = j && j.result && j.result.DOWNLOAD_URL;
    if (!dl) throw new HttpError(404, 'file_not_found');
    const u = new URL(dl);
    if (u.host !== wh.host || u.protocol !== wh.protocol) throw new HttpError(502, 'foreign_download_host');
    const f = await upstream(u.toString());
    if (f.status !== 200) throw new HttpError(502, 'file_not_downloadable');
    const type = f.headers.get('content-type') || 'application/octet-stream';
    if (/text\/html/i.test(type)) throw new HttpError(502, 'file_not_downloadable');
    const buf = await readLimited(f, maxFile);
    const name = String(j.result.NAME || `file-${id}`).replace(/[\r\n"\\/]/g, '_');
    reply(res, 200, buf, { 'content-type': type, 'content-length': buf.length, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` });
  }

  return http.createServer(async (req, res) => {
    const t0 = Date.now(); let path = '-', code = 500;
    try {
      const url = new URL(req.url, 'http://relay');
      path = url.pathname.replace(/\/\d{3,}$/, '/<id>').replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/g, '/<id>');
      if (url.pathname === '/healthz') { code = 200; return reply(res, 200, 'ok'); }
      // общая база проектов: своя проверка токена и доступа из браузера (CORS); Битрикс эти маршруты не затрагивают
      if (await projects(req, res, url, reply, take)) { code = res.statusCode; return; }
      if (req.method !== 'GET') throw new HttpError(405, 'method_not_allowed');
      if (!authorized(req)) throw new HttpError(401, 'unauthorized');
      if (!take()) throw new HttpError(429, 'rate_limited');
      let m;
      if ((m = url.pathname.match(/^\/bitrix\/([^/]+)$/))) { await callMethod(res, m[1], url.searchParams); code = res.statusCode; return; }
      if ((m = url.pathname.match(/^\/bitrix-file\/(\d{1,12})$/))) { await download(res, m[1]); code = 200; return; }
      throw new HttpError(404, 'not_found');
    } catch (e) {
      const he = e instanceof HttpError ? e : new HttpError(e && e.name === 'TimeoutError' ? 504 : 502, e && e.name === 'TimeoutError' ? 'upstream_timeout' : 'upstream_error');
      code = he.status;
      if (!res.headersSent) reply(res, he.status, { error: he.code }, he.status === 401 ? { 'www-authenticate': 'Bearer' } : he.status === 405 ? { allow: 'GET' } : he.status === 429 ? { 'retry-after': '1' } : {});
      else res.end();
    } finally {
      // в журнал — только путь без строки запроса: в фильтрах бывают имена клиентов
      console.log(JSON.stringify({ at: new Date().toISOString(), method: req.method, path, status: code, ms: Date.now() - t0 }));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { BITRIX24_WEBHOOK_URL, RELAY_TOKEN, PORT = '3000', DATABASE_URL, DATABASE_SSL, PROJECTS_FILE, PROJECTS_TOKEN, ALLOWED_ORIGINS } = process.env;
  let server;
  try {
    // PostgreSQL, если задан DATABASE_URL; иначе файл (на бесплатном Render он стирается при перезапуске) или ничего
    // Ошибка базы не должна ронять чтение из Битрикса: проекты тогда отвечают 503, остальное работает
    let store = null;
    if (DATABASE_URL) {
      if (!/^postgres(ql)?:\/\//.test(DATABASE_URL)) console.error('Проекты: DATABASE_URL должен начинаться с postgresql:// (строка подключения из Render → PostgreSQL → Internal Database URL). Проекты отключены.');
      else { try { store = await createPgStore(DATABASE_URL, { ssl: DATABASE_SSL !== '0' }); } catch (e) { console.error('Проекты: не удалось подключиться к базе (' + String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '***') + '). Проекты отключены.'); } }
    } else if (PROJECTS_FILE) store = new MemoryStore({ file: PROJECTS_FILE });
    if (!store) console.log('Проекты: хранилище не работает или не задано (DATABASE_URL), маршруты /projects отвечают 503');
    else if (!DATABASE_URL) console.log('Проекты: хранятся в файле, при перезапуске на бесплатном Render они пропадут. Для общей базы задайте DATABASE_URL');
    const origins = (ALLOWED_ORIGINS || 'https://kitchen-prototype.onrender.com').split(',').map(x => x.trim()).filter(Boolean);
    if (store && (!PROJECTS_TOKEN || PROJECTS_TOKEN.length < 16)) console.log('Проекты: PROJECTS_TOKEN не задан или короче 16 знаков, завести пользователей нельзя');
    const projects = createProjects({ store, adminToken: PROJECTS_TOKEN || '', origins });
    server = createRelay({ webhook: BITRIX24_WEBHOOK_URL || '', token: RELAY_TOKEN || '', projects });
  } catch (e) { console.error('Не запустились:', e.message); process.exit(1); }
  server.listen(Number(PORT), '0.0.0.0', () => console.log(`kitchen-api слушает порт ${PORT}`));
}
