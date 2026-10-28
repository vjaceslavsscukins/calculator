// Общая подготовка тестов: отдельная схема в базе из DATABASE_URL (чужие данные не трогаем), приложение через inject.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { createPool, migrate, seed } from '../src/db.ts';

export const DB = process.env.DATABASE_URL;
export const SKIP = DB ? false : 'нет DATABASE_URL: тесты сервера идут против настоящего PostgreSQL (см. README)';
if (!DB) console.log('# Пропуск тестов сервера: задайте DATABASE_URL, например postgres://postgres@127.0.0.1:54329/kp_test');

export const OWNER = { email: 'owner@test.local', password: 'owner-pass-1' };

export interface Ctx { app: FastifyInstance; pool: pg.Pool; schema: string; close(): Promise<void> }

export async function setup(): Promise<Ctx> {
  const schema = 'test_' + randomBytes(6).toString('hex');
  const admin = new pg.Client({ connectionString: DB });
  await admin.connect();
  await admin.query(`create schema ${schema}`);
  await admin.end();
  const pool = createPool(DB as string, { options: `-c search_path=${schema}` });
  await migrate(pool);
  await seed(pool, { OWNER_EMAIL: OWNER.email, OWNER_PASSWORD: OWNER.password });
  const app = await buildApp({ pool, publicUrl: 'https://kp.test' });
  return {
    app, pool, schema,
    async close() {
      await app.close();
      await pool.query(`drop schema ${schema} cascade`);
      await pool.end();
    },
  };
}

export interface Res { status: number; body: any; raw: string }

/** Клиент с cookie-сессией. */
export function agent(app: FastifyInstance) {
  let cookie = '';
  const call = async (method: string, url: string, payload?: unknown): Promise<Res> => {
    const r = await app.inject({ method: method as any, url, payload: payload as any, headers: cookie ? { cookie } : {} });
    const set = r.cookies.find((c) => c.name === 'kp_session');
    if (set) cookie = set.value ? `kp_session=${set.value}` : '';
    let body: any = r.body;
    try { body = JSON.parse(r.body); } catch { /* не JSON */ }
    return { status: r.statusCode, body, raw: r.body };
  };
  return {
    get: (u: string) => call('GET', u),
    post: (u: string, b: unknown = {}) => call('POST', u, b),
    put: (u: string, b: unknown) => call('PUT', u, b),
    patch: (u: string, b: unknown) => call('PATCH', u, b),
    async login(email: string, password: string) {
      const r = await call('POST', '/api/auth/login', { email, password });
      if (r.status !== 200) throw new Error(`вход ${email}: ${r.status} ${r.raw}`);
      return r.body.user;
    },
  };
}
export type Agent = ReturnType<typeof agent>;

/** Создаёт пользователя через приглашение владельца и входит им. */
export async function makeUser(app: FastifyInstance, owner: Agent, data: { firstName: string; lastName?: string; email: string; role: string; cityId: number | null }) {
  const r = await owner.post('/api/users', { lastName: '', ...data });
  if (r.status !== 200) throw new Error(`создание ${data.email}: ${r.status} ${r.raw}`);
  const token = r.body.inviteUrl.split('/invite/')[1];
  const a = agent(app);
  const acc = await a.post('/api/auth/invite/accept', { token, password: 'password-123' });
  if (acc.status !== 200) throw new Error(`приглашение ${data.email}: ${acc.status} ${acc.raw}`);
  return { agent: a, user: acc.body.user };
}

/** Все ключи объекта на любой глубине. */
export function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
  return out;
}
