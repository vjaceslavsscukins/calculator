// Вход: логин, выход, текущий пользователь, приглашения; защита от перебора паролей.
// Подключается из app.ts; общие помощники (вход, видимость по роли, прайс) приходят в ctx.
/* eslint-disable @typescript-eslint/no-unused-vars */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { BLOCKS, KIND_TITLES, applyPro100, compute, discountOverLimit, indexCatalog, mergePro100, normalizeSettings, parsePro100 } from '../../../engine/src/index.ts';
import type { CalcInput, Catalog, CatalogIndex, ProductKind, Settings } from '../../../engine/src/index.ts';
import { tx } from '../lib/db.ts';
import { renderConfigured, textConfigured } from '../lib/ai.ts';
import { hashPassword, newToken, tokenHash, verifyPassword } from '../lib/security.ts';
import {
  HttpError, KINDS, STATUSES, catalogFor, cleanInput, cleanSettings, cleanUnparsed, emptyInput, keepNoMarkup, parseKind, settingsFor, viewFor,
} from '../lib/view.ts';
import type { Role } from '../lib/view.ts';
import { COOKIE, SESSION_DAYS, INVITE_DAYS, UUID, ROLES, fullName, userJson, text, likeArg, notFound, forbid, idParam, USER_SQL, CLIENT_SQL, CALC_SQL, scope, clientJson, calcSummary, calcJson } from '../core/shared.ts';
import type { User } from '../core/shared.ts';
import type { AppContext } from '../core/context.ts';

export async function registerAuth(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, opts, pricing, audit, me, need, startSession, loadUser, sessionUser, cities, cityExists, visibleClient, calcList, visibleCalc, computeView, totalsOf, calcResponse, bumpCatalog } = ctx;

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
}
