// HTTP-слой портала «Калькулятор КП». Договорённость — kp-calc/docs/api.md.
// Цена считается только в engine (compute); здесь — доступ по ролям и городам, хранение и вырезание себестоимости для менеджера.
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type pg from 'pg';
import { BLOCKS, KIND_TITLES, applyPro100, compute, indexCatalog, mergePro100, normalizeSettings, parsePro100 } from '../../engine/src/index.ts';
import type { CalcInput, Catalog, CatalogIndex, ProductKind, Settings } from '../../engine/src/index.ts';
import { tx } from './db.ts';
import { registerKp } from './kp.ts';
import { registerSpec } from './spec.ts';
import { registerBoard } from './board.ts';
import type { KpDeps } from './kp.ts';
import { hashPassword, newToken, tokenHash, verifyPassword } from './security.ts';
import {
  HttpError, KINDS, STATUSES, catalogFor, cleanInput, cleanSettings, cleanUnparsed, emptyInput, keepNoMarkup, parseKind, settingsFor, viewFor,
} from './view.ts';
import type { Role } from './view.ts';

export interface AppOptions {
  pool: pg.Pool;
  /** Для ссылок-приглашений; без него берётся адрес запроса. */
  publicUrl?: string;
  production?: boolean;
  /** Собранный интерфейс (web/dist) — отдаётся как SPA, если папка есть. */
  webDist?: string;
  logger?: boolean;
  /** Ключи нейросетей, S3, LINK_PREVIEW_ALLOW_PRIVATE; по умолчанию process.env. */
  env?: KpDeps['env'];
}

export interface User {
  id: string; firstName: string; lastName: string; email: string; role: Role; cityId: number | null; cityName: string | null;
  /** Для КП: телефон и должность менеджера. */
  phone: string; position: string;
}

declare module 'fastify' {
  interface FastifyRequest { user: User | null }
}

const COOKIE = 'kp_session';
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: Role[] = ['owner', 'head', 'manager'];

const fullName = (first: string, last: string) => `${first ?? ''} ${last ?? ''}`.trim();
const userJson = (r: any): User => ({
  id: r.id, firstName: r.first_name, lastName: r.last_name, email: r.email, role: r.role, cityId: r.city_id ?? null, cityName: r.city_name ?? null,
  phone: r.phone ?? '', position: r.position ?? '',
});
const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const likeArg = (q: string) => '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const notFound = () => new HttpError(404, 'Не найдено');
const forbid = () => new HttpError(403, 'Недостаточно прав');

function idParam(v: unknown): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw notFound();
  return v;
}

const USER_SQL = `select u.*, ci.name as city_name from users u left join cities ci on ci.id = u.city_id`;

const CLIENT_SQL = `
  select cl.*, ci.name as city_name, m.first_name as m_first, m.last_name as m_last,
         (select count(*)::int from calculations k where k.client_id = cl.id) as calc_count
    from clients cl join cities ci on ci.id = cl.city_id join users m on m.id = cl.manager_id`;

const CALC_SQL = `
  select k.*, cl.name as client_name, cl.manager_id, cl.city_id, ci.name as city_name,
         m.first_name as m_first, m.last_name as m_last, ub.first_name as ub_first, ub.last_name as ub_last,
         (select s.updated_at from specs s where s.calculation_id = k.id) as spec_at
    from calculations k join clients cl on cl.id = k.client_id join cities ci on ci.id = cl.city_id
    join users m on m.id = cl.manager_id left join users ub on ub.id = k.updated_by`;

/** Видимость клиентов (и их расчётов) по роли: менеджер — свои, руководитель — свой город, владелец — все. */
export function scope(u: Pick<User, 'id' | 'role' | 'cityId'>, params: unknown[]): string {
  if (u.role === 'owner') return 'true';
  if (u.role === 'head') { params.push(u.cityId); return `cl.city_id = $${params.length}`; }
  params.push(u.id); return `cl.manager_id = $${params.length}`;
}

const clientJson = (r: any) => ({
  id: r.id, name: r.name, phone: r.phone, cityId: r.city_id, cityName: r.city_name, managerId: r.manager_id,
  managerName: fullName(r.m_first, r.m_last), calcCount: r.calc_count ?? 0, createdAt: r.created_at, updatedAt: r.updated_at,
});
const calcSummary = (r: any) => ({
  id: r.id, clientId: r.client_id, clientName: r.client_name, title: r.title, kind: r.kind, status: r.status, total: r.total,
  managerName: fullName(r.m_first, r.m_last), cityName: r.city_name, updatedAt: r.updated_at, specAt: r.spec_at ?? null,
});
const calcJson = (r: any) => ({
  id: r.id, clientId: r.client_id, clientName: r.client_name, title: r.title, kind: r.kind, status: r.status, rev: r.rev,
  input: r.input, unparsed: r.unparsed, updatedAt: r.updated_at, updatedBy: r.ub_first != null ? fullName(r.ub_first, r.ub_last) : null,
});

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { pool } = opts;
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    trustProxy: true,
    logger: opts.logger ? {
      // в журнал — только путь: в строке запроса бывают имя и телефон клиента (152-ФЗ)
      // ссылка КП /p/<токен> — ключ доступа к КП, в журнал её не пишем
      serializers: { req: (req: any) => ({ method: req.method, url: String(req.url).split('?')[0].replace(/^\/p\/[^/]+/, '/p/***').replace(/\/invite\/[^/]+/, '/invite/***') }) },
    } : false,
  });
  await app.register(cookie);
  // пустое тело с Content-Type: application/json считаем {}
  app.removeContentTypeParser('application/json');
  // text/plain не принимаем: «простой» запрос с чужого сайта не дойдёт до обработчиков
  app.removeContentTypeParser('text/plain');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (!body || !String(body).trim()) return done(null, {});
    try { done(null, JSON.parse(String(body))); } catch { done(Object.assign(new Error('bad json'), { statusCode: 400 }), undefined); }
  });
  app.decorateRequest('user', null);

  // --- цены: прайс и настройки из базы, кэш по версии прайса и rev настроек ---
  let cache: { v: number; rev: number; catalog: Catalog & { version: number }; idx: CatalogIndex; settings: Settings } | null = null;
  async function pricing() {
    const { rows: [m] } = await pool.query(`select (select value from meta where key = 'catalog_version')::int as v, rev from settings where id = 1`);
    if (!m) throw new HttpError(500, 'Нет настроек расчёта');
    if (cache && cache.v === m.v && cache.rev === m.rev) return cache;
    const [{ rows: groups }, { rows: items }, { rows: [s] }] = await Promise.all([
      pool.query('select * from catalog_groups order by sort, id'),
      pool.query('select * from catalog_items order by sort, id'),
      pool.query('select data from settings where id = 1'),
    ]);
    const byGroup = new Map<string, any[]>();
    for (const it of items) {
      const list = byGroup.get(it.group_id) ?? [];
      list.push(it.status ? { id: it.id, name: it.name, price: it.price, status: it.status } : { id: it.id, name: it.name, price: it.price });
      byGroup.set(it.group_id, list);
    }
    const catalog = {
      version: m.v ?? 1,
      groups: groups.map((g) => ({
        id: g.id, category: g.category, name: g.name, unit: g.unit, rule: g.rule,
        ...(g.sheet_area != null ? { sheetArea: g.sheet_area } : {}), ...(g.source ? { source: g.source } : {}),
        items: byGroup.get(g.id) ?? [],
      })),
    };
    cache = { v: m.v, rev: m.rev, catalog, idx: indexCatalog(catalog), settings: normalizeSettings(s.data) };
    return cache;
  }

  async function audit(db: pg.Pool | pg.PoolClient, u: User, action: string, entity: string, details: unknown) {
    await db.query('insert into audit_log (user_id, user_name, action, entity, details) values ($1,$2,$3,$4,$5)',
      [u.id, fullName(u.firstName, u.lastName) || u.email, action, entity, JSON.stringify(details)]);
  }

  // --- ошибки и заголовки ---
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, ...err.extra });
    if (err.statusCode && err.statusCode < 500) {
      const msg = err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ? 'Нужен JSON (Content-Type: application/json)'
        : err.statusCode === 413 ? 'Слишком большой запрос' : 'Неверный запрос';
      return reply.code(err.statusCode).send({ error: msg });
    }
    req.log.error({ err: { message: err.message, code: err.code } }, 'ошибка сервера');
    if (process.env.KP_DEBUG) console.error(err);
    return reply.code(500).send({ error: 'Ошибка сервера, попробуйте ещё раз' });
  });
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    if (req.url.startsWith('/api/') && !reply.getHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });

  // --- сессия ---
  async function sessionUser(req: FastifyRequest): Promise<User | null> {
    const token = req.cookies[COOKIE];
    if (!token) return null;
    const { rows: [r] } = await pool.query(
      `select u.*, ci.name as city_name from sessions s join users u on u.id = s.user_id left join cities ci on ci.id = u.city_id
        where s.token_hash = $1 and s.expires_at > now() and not u.disabled`, [tokenHash(token)]);
    return r ? userJson(r) : null;
  }
  // Проверка по найденному маршруту, а не по строке адреса: «/%61pi/…» роутер раскодирует в «/api/…»
  const PUBLIC = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/invite/accept', '/api/auth/invite/:token']);
  const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const hostOf = (v: string) => { try { return new URL(v).host; } catch { return ''; } };
  const sameOrigin = (req: FastifyRequest, origin: string) => {
    const h = hostOf(origin);
    return !!h && [hostOf(`${req.protocol}://${req.host}`), opts.publicUrl ? hostOf(opts.publicUrl) : ''].includes(h);
  };
  app.addHook('preHandler', async (req) => {
    const route = req.routeOptions?.url ?? '';
    if (!route.startsWith('/api/')) return;
    // защита от подделки запроса с чужого сайта. Браузер сам ставит Sec-Fetch-Site (сайт не может его подделать):
    // принимаем только «same-origin» (и «none» — ввод адреса). Старые браузеры без него — сверяем Origin с адресом портала.
    if (WRITE.has(req.method)) {
      const site = req.headers['sec-fetch-site'];
      if (site ? site !== 'same-origin' && site !== 'none' : !!req.headers.origin && !sameOrigin(req, String(req.headers.origin))) {
        throw new HttpError(403, 'Запрос с чужого сайта отклонён');
      }
    }
    if (PUBLIC.has(route)) return;
    req.user = await sessionUser(req);
    if (!req.user) throw new HttpError(401, 'Войдите в систему');
  });
  const me = (req: FastifyRequest): User => {
    if (!req.user) throw new HttpError(401, 'Войдите в систему');
    return req.user as User;
  };
  const need = (req: FastifyRequest, ...roles: Role[]) => { if (!roles.includes(me(req).role)) throw forbid(); return me(req); };

  async function startSession(reply: FastifyReply, userId: string) {
    const token = newToken();
    await pool.query(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`, [tokenHash(token), userId]);
    // secure — в production и всегда, если запрос пришёл по https (даже без NODE_ENV)
    reply.setCookie(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: !!opts.production || reply.request.protocol === 'https', maxAge: SESSION_DAYS * 86400 });
    await pool.query('delete from sessions where expires_at < now()');
  }
  const loadUser = async (id: string) => {
    const { rows: [r] } = await pool.query(`${USER_SQL} where u.id = $1`, [id]);
    return r ? userJson(r) : null;
  };

  // защита от перебора паролей: 10 попыток за 15 минут на почту и 50 — с одного адреса.
  // Попытка засчитывается ДО проверки пароля (параллельные запросы не проскочат); при переполнении удаляются самые старые записи.
  const fails = new Map<string, { n: number; until: number }>();
  const ipFails = new Map<string, { n: number; until: number }>();
  const WINDOW = 15 * 60 * 1000;
  const take = (map: Map<string, { n: number; until: number }>, key: string, limit: number) => {
    const now = Date.now();
    let f = map.get(key);
    if (!f || f.until <= now) f = { n: 0, until: now + WINDOW };
    if (f.n >= limit) return false;
    f.n++;
    map.delete(key); map.set(key, f);
    while (map.size > 20000) map.delete(map.keys().next().value as string);
    return true;
  };

  app.get('/healthz', async (req, reply) => reply.type('text/plain').send('ok'));

  // ========== Вход ==========
  app.post('/api/auth/login', async (req: any, reply) => {
    const email = text(req.body?.email, 200).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 500) : '';
    if (!take(ipFails, req.ip, 50) || !take(fails, email, 10)) throw new HttpError(429, 'Слишком много попыток входа. Попробуйте через 15 минут');
    const { rows: [r] } = await pool.query(`${USER_SQL} where lower(u.email) = $1`, [email]);
    const ok = await verifyPassword(password, r?.password_hash);
    if (!ok || !r || r.disabled) throw new HttpError(401, 'Неверная почта или пароль');
    fails.delete(email);
    await startSession(reply, r.id);
    return { user: userJson(r) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await pool.query('delete from sessions where token_hash = $1', [tokenHash(token)]);
    reply.clearCookie(COOKIE, { path: '/' });
    return {};
  });

  app.get('/api/auth/me', async (req) => ({ user: me(req) }));

  const inviteRow = async (db: pg.Pool | pg.PoolClient, token: unknown, lock = false) => {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const { rows: [r] } = await db.query(
      `select i.user_id, u.email, u.first_name from invites i join users u on u.id = i.user_id
        where i.token_hash = $1 and i.used_at is null and i.expires_at > now() and not u.disabled ${lock ? 'for update of i' : ''}`, [tokenHash(token)]);
    return r ?? null;
  };

  app.get('/api/auth/invite/:token', async (req: any) => {
    const r = await inviteRow(pool, req.params.token);
    if (!r) throw new HttpError(404, 'Приглашение не найдено или устарело');
    return { email: r.email, firstName: r.first_name };
  });

  app.post('/api/auth/invite/accept', async (req: any, reply) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length < 8) throw new HttpError(400, 'Пароль должен быть не короче 8 символов');
    if (password.length > 200) throw new HttpError(400, 'Слишком длинный пароль');
    const hash = await hashPassword(password);
    const userId = await tx(pool, async (c) => {
      const r = await inviteRow(c, req.body?.token, true);
      if (!r) throw new HttpError(404, 'Приглашение не найдено или устарело');
      await c.query('update invites set used_at = now() where user_id = $1 and used_at is null', [r.user_id]);
      await c.query('update users set password_hash = $1 where id = $2', [hash, r.user_id]);
      await c.query('delete from sessions where user_id = $1', [r.user_id]);
      return r.user_id as string;
    });
    await startSession(reply, userId);
    return { user: await loadUser(userId) };
  });

  // ========== Справочники ==========
  const cities = async () => (await pool.query('select id, name from cities order by id')).rows;

  app.get('/api/meta', async () => ({
    kinds: KINDS.map((id) => ({ id, title: KIND_TITLES[id] })),
    blocks: BLOCKS,
    cities: await cities(),
  }));

  app.get('/api/settings', async (req) => {
    const { rows: [s] } = await pool.query('select data, rev from settings where id = 1');
    return settingsFor(me(req).role, normalizeSettings(s.data), s.rev);
  });

  app.put('/api/settings', async (req: any) => {
    const u = need(req, 'owner');
    const rev = req.body?.rev;
    if (!Number.isInteger(rev)) throw new HttpError(400, 'Нет версии настроек (rev)');
    const next = cleanSettings(req.body?.settings);
    return tx(pool, async (c) => {
      const { rows: [cur] } = await c.query('select data, rev from settings where id = 1 for update');
      if (cur.rev !== rev) throw new HttpError(409, 'Настройки уже изменил кто-то другой. Обновите страницу', { rev: cur.rev });
      const { rows: [s] } = await c.query('update settings set data = $1, rev = rev + 1, updated_at = now(), updated_by = $2 where id = 1 returning data, rev',
        [JSON.stringify(next), u.id]);
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      const was = normalizeSettings(cur.data);
      for (const k of Object.keys(next) as (keyof Settings)[]) {
        if (JSON.stringify(was[k]) !== JSON.stringify(next[k])) changes[k] = { before: was[k], after: next[k] };
      }
      await audit(c, u, 'Изменение настроек', 'Коэффициенты', changes);
      return { settings: s.data, rev: s.rev };
    });
  });

  // ========== Пользователи (владелец) ==========
  const inviteUrl = (req: FastifyRequest, token: string) => `${(opts.publicUrl || `${req.protocol}://${req.host}`).replace(/\/$/, '')}/invite/${token}`;
  async function issueInvite(c: pg.PoolClient, userId: string): Promise<string> {
    const token = newToken();
    await c.query('update invites set used_at = now() where user_id = $1 and used_at is null', [userId]);
    await c.query(`insert into invites (token_hash, user_id, expires_at) values ($1, $2, now() + interval '${INVITE_DAYS} days')`, [tokenHash(token), userId]);
    return token;
  }
  async function cityExists(db: pg.Pool | pg.PoolClient, id: unknown): Promise<number> {
    if (!Number.isInteger(id) || !(await db.query('select 1 from cities where id = $1', [id])).rowCount) throw new HttpError(400, 'Неизвестный город');
    return id as number;
  }
  const adminUserJson = (r: any) => ({ ...userJson(r), disabled: r.disabled, invited: r.password_hash == null });

  app.get('/api/users', async (req) => {
    need(req, 'owner');
    const { rows } = await pool.query(`${USER_SQL} order by u.disabled, u.last_name, u.first_name`);
    return { users: rows.map(adminUserJson) };
  });

  app.post('/api/users', async (req: any) => {
    const u = need(req, 'owner');
    const b = req.body ?? {};
    const firstName = text(b.firstName, 100), lastName = text(b.lastName, 100), email = text(b.email, 200).toLowerCase();
    if (!firstName) throw new HttpError(400, 'Укажите имя');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Неверная почта');
    if (!ROLES.includes(b.role)) throw new HttpError(400, 'Неизвестная роль');
    return tx(pool, async (c) => {
      const cityId = b.cityId == null && b.role === 'owner' ? null : await cityExists(c, b.cityId);
      if ((await c.query('select 1 from users where lower(email) = $1', [email])).rowCount) throw new HttpError(409, 'Пользователь с такой почтой уже есть');
      const { rows: [r] } = await c.query('insert into users (email, first_name, last_name, role, city_id, phone, position) values ($1,$2,$3,$4,$5,$6,$7) returning id',
        [email, firstName, lastName, b.role, cityId, text(b.phone, 40), text(b.position, 100)]);
      const token = await issueInvite(c, r.id);
      const { rows: [full] } = await c.query(`${USER_SQL} where u.id = $1`, [r.id]);
      await audit(c, u, 'Добавлен пользователь', 'Пользователи', { email, role: b.role, cityId });
      return { user: adminUserJson(full), inviteUrl: inviteUrl(req, token) };
    });
  });

  app.patch('/api/users/:id', async (req: any) => {
    const u = need(req, 'owner');
    const id = idParam(req.params.id);
    const b = req.body ?? {};
    return tx(pool, async (c) => {
      const { rows: [cur] } = await c.query('select * from users where id = $1 for update', [id]);
      if (!cur) throw notFound();
      const next = { first_name: cur.first_name, last_name: cur.last_name, role: cur.role, city_id: cur.city_id, disabled: cur.disabled, phone: cur.phone, position: cur.position };
      if (b.phone !== undefined) next.phone = text(b.phone, 40);
      if (b.position !== undefined) next.position = text(b.position, 100);
      if (b.firstName !== undefined) { next.first_name = text(b.firstName, 100); if (!next.first_name) throw new HttpError(400, 'Укажите имя'); }
      if (b.lastName !== undefined) next.last_name = text(b.lastName, 100);
      if (b.role !== undefined) { if (!ROLES.includes(b.role)) throw new HttpError(400, 'Неизвестная роль'); next.role = b.role; }
      if (b.cityId !== undefined) next.city_id = b.cityId === null ? null : await cityExists(c, b.cityId);
      if (b.disabled !== undefined) next.disabled = b.disabled === true;
      if (id === u.id && (next.disabled || next.role !== 'owner')) throw new HttpError(400, 'Нельзя отключить себя или снять с себя роль владельца');
      if (next.role !== 'owner' && next.city_id == null) throw new HttpError(400, 'Укажите город');
      await c.query('update users set first_name = $1, last_name = $2, role = $3, city_id = $4, disabled = $5, phone = $6, position = $7 where id = $8',
        [next.first_name, next.last_name, next.role, next.city_id, next.disabled, next.phone, next.position, id]);
      if (next.disabled) await c.query('delete from sessions where user_id = $1', [id]);
      const changes: Record<string, unknown> = {};
      for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] !== cur[k]) changes[k] = { before: cur[k], after: next[k] };
      if (Object.keys(changes).length) await audit(c, u, next.disabled && !cur.disabled ? 'Пользователь отключён' : 'Изменён пользователь', 'Пользователи', { email: cur.email, ...changes });
      const { rows: [full] } = await c.query(`${USER_SQL} where u.id = $1`, [id]);
      return { user: adminUserJson(full) };
    });
  });

  app.post('/api/users/:id/invite', async (req: any) => {
    const u = need(req, 'owner');
    const id = idParam(req.params.id);
    return tx(pool, async (c) => {
      const { rows: [cur] } = await c.query('select email from users where id = $1', [id]);
      if (!cur) throw notFound();
      const token = await issueInvite(c, id);
      await audit(c, u, 'Новая ссылка-приглашение', 'Пользователи', { email: cur.email });
      return { inviteUrl: inviteUrl(req, token) };
    });
  });

  // ========== Клиенты ==========
  async function visibleClient(u: User, id: string, db: pg.Pool | pg.PoolClient = pool) {
    const params: unknown[] = [id];
    const { rows: [r] } = await db.query(`${CLIENT_SQL} where cl.id = $1 and ${scope(u, params)}`, params);
    if (!r) throw notFound();
    return r;
  }

  app.get('/api/clients', async (req: any) => {
    const u = me(req);
    const params: unknown[] = [];
    let where = scope(u, params);
    const q = text(req.query?.q, 100);
    if (q) {
      params.push(likeArg(q));
      let cond = `cl.name ilike $${params.length}`;
      const digits = q.replace(/\D/g, '');
      if (digits.length >= 3) { params.push(likeArg(digits)); cond += ` or regexp_replace(cl.phone, '\\D', '', 'g') like $${params.length}`; }
      where += ` and (${cond})`;
    }
    const { rows } = await pool.query(`${CLIENT_SQL} where ${where} order by cl.updated_at desc limit 500`, params);
    return { clients: rows.map(clientJson) };
  });

  app.post('/api/clients', async (req: any) => {
    const u = me(req);
    const name = text(req.body?.name, 200), phone = text(req.body?.phone, 50);
    if (!name || !phone) throw new HttpError(400, 'Укажите имя и телефон клиента');
    let cityId = u.cityId;
    if (u.role === 'owner' && req.body?.cityId != null) cityId = await cityExists(pool, req.body.cityId);
    if (cityId == null) cityId = (await pool.query('select id from cities order by id limit 1')).rows[0].id;
    const { rows: [r] } = await pool.query('insert into clients (name, phone, city_id, manager_id, created_by) values ($1,$2,$3,$4,$4) returning id',
      [name, phone, cityId, u.id]);
    return { client: clientJson(await visibleClient(u, r.id)) };
  });

  async function calcList(u: User, extra: string, extraParams: unknown[] = []) {
    const params: unknown[] = [...extraParams];
    const { rows } = await pool.query(`${CALC_SQL} where ${scope(u, params)} ${extra} order by k.updated_at desc limit 1000`, params);
    return rows.map(calcSummary);
  }

  app.get('/api/clients/:id', async (req: any) => {
    const u = me(req);
    const r = await visibleClient(u, idParam(req.params.id));
    return { client: clientJson(r), calculations: await calcList(u, 'and k.client_id = $1', [r.id]) };
  });

  app.patch('/api/clients/:id', async (req: any) => {
    const u = me(req);
    const b = req.body ?? {};
    const cur = await visibleClient(u, idParam(req.params.id));
    const next = { name: cur.name, phone: cur.phone, city_id: cur.city_id, manager_id: cur.manager_id };
    if (b.name !== undefined) { next.name = text(b.name, 200); if (!next.name) throw new HttpError(400, 'Укажите имя клиента'); }
    if (b.phone !== undefined) { next.phone = text(b.phone, 50); if (!next.phone) throw new HttpError(400, 'Укажите телефон клиента'); }
    if ((b.cityId !== undefined && b.cityId !== cur.city_id) || (b.managerId !== undefined && b.managerId !== cur.manager_id)) {
      if (u.role === 'manager') throw new HttpError(403, 'Город и менеджера клиента меняет руководитель');
      if (b.cityId !== undefined) {
        next.city_id = await cityExists(pool, b.cityId);
        if (u.role === 'head' && next.city_id !== u.cityId) throw new HttpError(403, 'Руководитель не может перевести клиента в другой город');
      }
      if (b.managerId !== undefined) {
        const mid = typeof b.managerId === 'string' && UUID.test(b.managerId) ? b.managerId : '';
        const { rows: [m] } = mid ? await pool.query('select id, city_id, disabled from users where id = $1', [mid]) : { rows: [] as any[] };
        if (!m || m.disabled) throw new HttpError(400, 'Неизвестный или отключённый менеджер');
        if (u.role === 'head' && m.city_id !== u.cityId) throw new HttpError(403, 'Можно назначить только менеджера своего города');
        next.manager_id = m.id;
      }
    }
    await pool.query('update clients set name = $1, phone = $2, city_id = $3, manager_id = $4, updated_at = now() where id = $5',
      [next.name, next.phone, next.city_id, next.manager_id, cur.id]);
    // после передачи клиента он может стать невидимым для автора правки — отдаём без повторной проверки видимости
    const { rows: [r] } = await pool.query(`${CLIENT_SQL} where cl.id = $1`, [cur.id]);
    return { client: clientJson(r) };
  });

  // ========== Расчёты ==========
  async function visibleCalc(u: User, id: string, db: pg.Pool | pg.PoolClient = pool) {
    const params: unknown[] = [id];
    const { rows: [r] } = await db.query(`${CALC_SQL} where k.id = $1 and ${scope(u, params)}`, params);
    if (!r) throw notFound();
    return r;
  }
  async function computeView(input: CalcInput) {
    const p = await pricing();
    return { result: compute(input, p.idx, p.settings), settings: p.settings };
  }
  const totalsOf = (v: ReturnType<typeof compute>) => ({
    cost: v.cost, prod: v.prod, retail: v.retail, discount: v.discount, furnitureAfterDiscount: v.furnitureAfterDiscount,
    montage: v.montage, delivery: v.delivery, total: v.total, margin: v.margin, costByGroup: v.costByGroup,
  });
  async function calcResponse(u: User, r: any) {
    const { result } = await computeView(r.input);
    return { calculation: calcJson(r), view: viewFor(u.role, result) };
  }

  app.get('/api/calculations', async (req: any) => {
    const u = me(req);
    const status = text(req.query?.status, 20), q = text(req.query?.q, 100);
    const params: unknown[] = [];
    let extra = '';
    if (status && status !== 'all') {
      if (!STATUSES.includes(status)) throw new HttpError(400, 'Неизвестный статус');
      params.push(status); extra += ` and k.status = $${params.length}`;
    } else if (!status) extra += ` and k.status <> 'archived'`;
    if (q) { params.push(likeArg(q)); extra += ` and (k.title ilike $${params.length} or cl.name ilike $${params.length})`; }
    return { calculations: await calcList(u, extra, params) };
  });

  app.post('/api/calculations', async (req: any) => {
    const u = me(req);
    const b = req.body ?? {};
    const kind = parseKind(b.kind);
    if (typeof b.clientId !== 'string' || !UUID.test(b.clientId)) throw new HttpError(400, 'Не выбран клиент');
    const client = await visibleClient(u, b.clientId);
    const title = text(b.title, 200) || KIND_TITLES[kind];
    const { settings } = await pricing();
    const input = emptyInput(kind, settings);
    const { result } = await computeView(input);
    const { rows: [r] } = await pool.query(
      `insert into calculations (client_id, title, kind, input, totals, total, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$7) returning id`,
      [client.id, title, kind, JSON.stringify(input), JSON.stringify(totalsOf(result)), result.total, u.id]);
    await pool.query('update clients set updated_at = now() where id = $1', [client.id]);
    return calcResponse(u, await visibleCalc(u, r.id));
  });

  app.get('/api/calculations/:id', async (req: any) => {
    const u = me(req);
    return calcResponse(u, await visibleCalc(u, idParam(req.params.id)));
  });

  app.put('/api/calculations/:id', async (req: any) => {
    const u = me(req);
    const b = req.body ?? {};
    if (!Number.isInteger(b.rev)) throw new HttpError(400, 'Нет версии расчёта (rev)');
    const cur = await visibleCalc(u, idParam(req.params.id));
    const { settings } = await pricing();
    const title = b.title !== undefined ? text(b.title, 200) || cur.title : cur.title;
    let status = cur.status;
    if (b.status !== undefined) { if (!STATUSES.includes(b.status)) throw new HttpError(400, 'Неизвестный статус'); status = b.status; }
    let input: CalcInput = b.input !== undefined ? cleanInput(b.input, cur.kind as ProductKind, settings) : cur.input;
    // «без наценки» меняют только руководитель и владелец
    if (u.role === 'manager' && b.input !== undefined) input = { ...input, rows: keepNoMarkup(input.rows, cur.input?.rows ?? []) };
    const unparsed = b.unparsed !== undefined ? cleanUnparsed(b.unparsed) : cur.unparsed;
    const { result } = await computeView(input);
    const saved = await tx(pool, async (c) => {
      const { rowCount } = await c.query(
        `update calculations set title = $1, status = $2, input = $3, unparsed = $4, totals = $5, total = $6, rev = rev + 1, updated_by = $7, updated_at = now()
          where id = $8 and rev = $9`,
        [title, status, JSON.stringify(input), JSON.stringify(unparsed), JSON.stringify(totalsOf(result)), result.total, u.id, cur.id, b.rev]);
      if (!rowCount) return false;
      await c.query('update clients set updated_at = now() where id = $1', [cur.client_id]);
      // запоминаем выбор позиции для строк PRO100 — умолчание для следующей вставки этого пользователя
      for (const row of input.rows) {
        if (!row.pro100 || !row.itemId) continue;
        await c.query(`insert into pro100_defaults (user_id, pro100_name, item_id) select $1, $2, id from catalog_items where id = $3
          on conflict (user_id, pro100_name) do update set item_id = excluded.item_id, updated_at = now()`, [u.id, row.pro100, row.itemId]);
      }
      return true;
    });
    const fresh = await visibleCalc(u, cur.id).catch(() => null);
    if (!saved) {
      const now = fresh ?? cur;
      throw new HttpError(409, 'Расчёт уже изменили. Обновите страницу, чтобы не затереть чужие правки', {
        rev: now.rev, updatedAt: now.updated_at, updatedBy: now.ub_first != null ? fullName(now.ub_first, now.ub_last) : null,
      });
    }
    return { calculation: calcJson(fresh), view: viewFor(u.role, result) };
  });

  app.post('/api/calculations/:id/copy', async (req: any) => {
    const u = me(req);
    const cur = await visibleCalc(u, idParam(req.params.id));
    const { result } = await computeView(cur.input);
    const { rows: [r] } = await pool.query(
      `insert into calculations (client_id, title, kind, input, unparsed, totals, total, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$8) returning id`,
      [cur.client_id, `${cur.title} (копия)`.slice(0, 220), cur.kind, JSON.stringify(cur.input), JSON.stringify(cur.unparsed),
        JSON.stringify(totalsOf(result)), result.total, u.id]);
    return calcResponse(u, await visibleCalc(u, r.id));
  });

  app.post('/api/compute', async (req: any) => {
    const u = me(req);
    const raw = req.body?.input;
    const { settings } = await pricing();
    const input = cleanInput(raw, parseKind(raw?.kind), settings);
    const { result } = await computeView(input);
    return { view: viewFor(u.role, result) };
  });

  app.post('/api/pro100/parse', async (req: any) => {
    const u = me(req);
    const b = req.body ?? {};
    const kind = parseKind(b.kind);
    if (typeof b.text !== 'string') throw new HttpError(400, 'Нет текста вставки');
    if (b.text.length > 200_000) throw new HttpError(400, 'Слишком длинная вставка');
    const { settings } = await pricing();
    const existing = b.rows !== undefined ? cleanInput({ rows: b.rows }, kind, settings).rows : [];
    // умолчание: последняя позиция, выбранная этим пользователем; снятые с прайса позиции не предлагаем
    const { rows: defs } = await pool.query(
      `select d.pro100_name, d.item_id from pro100_defaults d join catalog_items i on i.id = d.item_id where d.user_id = $1 and i.status is null`, [u.id]);
    const defaults = Object.fromEntries(defs.map((d) => [d.pro100_name, d.item_id]));
    const parsed = parsePro100(b.text);
    const applied = applyPro100(kind, parsed.lines, defaults);
    return { rows: mergePro100(existing, applied.rows), unparsed: applied.unparsed, skipped: parsed.skipped };
  });

  // ========== Прайс ==========
  app.get('/api/catalog', async (req) => catalogFor(me(req).role, (await pricing()).catalog));

  const bumpCatalog = (c: pg.PoolClient) =>
    c.query(`insert into meta (key, value) values ('catalog_version', '1') on conflict (key) do update set value = to_jsonb((meta.value)::int + 1)`);
  const itemJson = (r: any) => (r.status ? { id: r.id, name: r.name, price: r.price, status: r.status } : { id: r.id, name: r.name, price: r.price });
  const priceOf = (v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new HttpError(400, 'Неверная цена');
    return v;
  };

  app.patch('/api/catalog/items/:id', async (req: any) => {
    const u = need(req, 'owner', 'head');
    const b = req.body ?? {};
    const id = text(req.params.id, 100);
    return tx(pool, async (c) => {
      const { rows: [cur] } = await c.query('select i.*, g.name as group_name from catalog_items i join catalog_groups g on g.id = i.group_id where i.id = $1 for update of i', [id]);
      if (!cur) throw notFound();
      const next = { name: cur.name, price: cur.price, status: cur.status };
      if (b.name !== undefined) { next.name = text(b.name); if (!next.name) throw new HttpError(400, 'Укажите название позиции'); }
      if (b.price !== undefined) next.price = priceOf(b.price);
      if (b.status !== undefined) next.status = b.status === null ? null : text(b.status, 100) || null;
      const { rows: [r] } = await c.query('update catalog_items set name = $1, price = $2, status = $3 where id = $4 returning *', [next.name, next.price, next.status, id]);
      const changes: Record<string, unknown> = {};
      for (const k of ['name', 'price', 'status'] as const) if (next[k] !== cur[k]) changes[k] = { before: cur[k], after: next[k] };
      if (Object.keys(changes).length) {
        await bumpCatalog(c);
        await audit(c, u, changes.price ? 'Изменение цены' : 'Изменение позиции прайса', 'Прайс', { itemId: id, group: cur.group_name, item: cur.name, ...changes });
      }
      return { item: itemJson(r) };
    });
  });

  app.post('/api/catalog/groups/:id/items', async (req: any) => {
    const u = need(req, 'owner', 'head');
    const b = req.body ?? {};
    const name = text(b.name);
    if (!name) throw new HttpError(400, 'Укажите название позиции');
    const price = priceOf(b.price);
    return tx(pool, async (c) => {
      const { rows: [g] } = await c.query('select id, name from catalog_groups where id = $1 for update', [text(req.params.id, 100)]);
      if (!g) throw notFound();
      const { rows: [{ sort }] } = await c.query('select coalesce(max(sort), -1) + 1 as sort from catalog_items where group_id = $1', [g.id]);
      const id = `${g.id}-${crypto.randomUUID().slice(0, 8)}`;
      const { rows: [r] } = await c.query('insert into catalog_items (id, group_id, name, price, sort) values ($1,$2,$3,$4,$5) returning *', [id, g.id, name, price, sort]);
      await bumpCatalog(c);
      await audit(c, u, 'Новая позиция прайса', 'Прайс', { itemId: id, group: g.name, item: name, price });
      return { item: itemJson(r) };
    });
  });

  // ========== Журнал ==========
  app.get('/api/audit', async (req: any) => {
    const u = need(req, 'owner', 'head');
    const limit = Math.min(1000, Math.max(1, parseInt(req.query?.limit, 10) || 200));
    // руководитель: прайс и коэффициенты; рендеры — только по клиентам своего города; пользователи (почты, телефоны) — только владельцу
    const { rows } = await pool.query(
      `select a.at, a.user_name, a.action, a.entity, a.details from audit_log a
        where $2 = 'owner' or a.entity in ('Прайс', 'Коэффициенты')
           or (a.entity = 'Рендер' and exists (select 1 from calculations k join clients cl on cl.id = k.client_id
                                                where k.id::text = a.details->>'calculationId' and cl.city_id = $3))
        order by a.at desc, a.id desc limit $1`, [limit, u.role, u.cityId]);
    return { entries: rows.map((r) => ({ at: r.at, userName: r.user_name, action: r.action, entity: r.entity, details: r.details })) };
  });

  // ========== Этап 2: картинки, рендер, ссылки с сайтов, КП, страница по ссылке, уведомления ==========
  await registerKp(app, {
    pool, publicUrl: opts.publicUrl, env: opts.env ?? process.env, pricing, me, need, visibleCalc, visibleClient, scope,
  });
  // ========== Спецификация к договору ==========
  await registerSpec(app, { pool, pricing, me, visibleCalc });
  // ========== Реестр КП и приборная панель ==========
  await registerBoard(app, { pool, me, need, scope });

  // ========== Интерфейс (SPA) ==========
  const spa = opts.production && opts.webDist && existsSync(opts.webDist);
  if (spa) await app.register(fastifyStatic, { root: opts.webDist as string, wildcard: false, index: false });
  app.setNotFoundHandler((req, reply) => {
    if (spa && req.method === 'GET' && !req.url.startsWith('/api/')) {
      // файлы сборки отдаёт static; путь с расширением, которого нет, — 404, остальное — index.html (маршруты SPA)
      if (!/\.[a-z0-9]+$/i.test(req.url.split('?')[0])) return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Не найдено' });
  });

  return app;
}
