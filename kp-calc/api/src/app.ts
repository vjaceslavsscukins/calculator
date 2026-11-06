// HTTP-слой портала «Калькулятор КП». Договорённость — kp-calc/docs/api.md.
// Цена считается только в engine (compute); здесь — доступ по ролям и городам, хранение и вырезание себестоимости для менеджера.
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type pg from 'pg';
import { BLOCKS, KIND_TITLES, applyPro100, compute, discountOverLimit, indexCatalog, mergePro100, normalizeSettings, parsePro100 } from '../../engine/src/index.ts';
import type { CalcInput, Catalog, CatalogIndex, ProductKind, Settings } from '../../engine/src/index.ts';
import { tx } from './lib/db.ts';
import { registerKp } from './modules/kp.ts';
import { renderConfigured, textConfigured } from './lib/ai.ts';
import { registerSpec } from './modules/spec.ts';
import { registerBoard } from './modules/board.ts';
import { registerPriceImport } from './modules/priceimport.ts';
import type { KpDeps } from './modules/kp.ts';
import { hashPassword, newToken, tokenHash, verifyPassword } from './lib/security.ts';
import {
  HttpError, KINDS, STATUSES, catalogFor, cleanInput, cleanSettings, cleanUnparsed, emptyInput, keepNoMarkup, parseKind, settingsFor, viewFor,
} from './lib/view.ts';
import type { Role } from './lib/view.ts';
import { COOKIE, SESSION_DAYS, UUID, fullName, userJson, text, notFound, forbid, idParam, USER_SQL, CLIENT_SQL, CALC_SQL, scope, calcSummary, calcJson } from './core/shared.ts';
import type { User } from './core/shared.ts';
import type { AppContext } from './core/context.ts';
import { registerAuth } from './modules/auth.ts';
import { registerReference } from './modules/reference.ts';
import { registerUsers } from './modules/users.ts';
import { registerClients } from './modules/clients.ts';
import { registerCalculations } from './modules/calculations.ts';
import { registerCatalog } from './modules/catalog.ts';
import { registerAudit } from './modules/audit.ts';

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

  app.get('/healthz', async (req, reply) => reply.type('text/plain').send('ok'));

  // --- общие помощники модулей: видимость клиента и расчёта по роли, пересчёт, версия прайса ---
  const cities = async () => (await pool.query('select id, name from cities order by id')).rows;

  async function cityExists(db: pg.Pool | pg.PoolClient, id: unknown): Promise<number> {
    if (!Number.isInteger(id) || !(await db.query('select 1 from cities where id = $1', [id])).rowCount) throw new HttpError(400, 'Неизвестный город');
    return id as number;
  }
  async function visibleClient(u: User, id: string, db: pg.Pool | pg.PoolClient = pool) {
    const params: unknown[] = [id];
    const { rows: [r] } = await db.query(`${CLIENT_SQL} where cl.id = $1 and ${scope(u, params)}`, params);
    if (!r) throw notFound();
    return r;
  }
  async function calcList(u: User, extra: string, extraParams: unknown[] = []) {
    const params: unknown[] = [...extraParams];
    const { rows } = await pool.query(`${CALC_SQL} where ${scope(u, params)} ${extra} order by k.updated_at desc limit 1000`, params);
    return rows.map(calcSummary);
  }
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
  const bumpCatalog = (c: pg.PoolClient) =>
    c.query(`insert into meta (key, value) values ('catalog_version', '1') on conflict (key) do update set value = to_jsonb((meta.value)::int + 1)`);

  const ctx: AppContext = { pool, opts, pricing, audit, me, need, startSession, loadUser, sessionUser, cities, cityExists, visibleClient, calcList, visibleCalc, computeView, totalsOf, calcResponse, bumpCatalog };
  // ========== Разделы портала (kp-calc/api/src/modules) ==========
  await registerAuth(app, ctx);
  await registerReference(app, ctx);
  await registerUsers(app, ctx);
  await registerClients(app, ctx);
  await registerCalculations(app, ctx);
  await registerCatalog(app, ctx);
  await registerAudit(app, ctx);

  // ========== Этап 2: картинки, рендер, ссылки с сайтов, КП, страница по ссылке, уведомления ==========
  await registerKp(app, {
    pool, publicUrl: opts.publicUrl, env: opts.env ?? process.env, pricing, me, need, visibleCalc, visibleClient, scope,
  });
  // ========== Спецификация к договору ==========
  await registerSpec(app, { pool, pricing, me, visibleCalc });
  // ========== Реестр КП и приборная панель ==========
  await registerBoard(app, { pool, me, need, scope });
  // ========== Загрузка прайса файлом ==========
  await registerPriceImport(app, { pool, need, pricing, audit, bumpCatalog });

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
