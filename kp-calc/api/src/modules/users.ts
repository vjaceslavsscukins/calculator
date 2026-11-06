// Пользователи (владелец): добавление, роли, города, отключение, ссылки-приглашения.
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

export async function registerUsers(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, opts, pricing, audit, me, need, startSession, loadUser, sessionUser, cities, cityExists, visibleClient, calcList, visibleCalc, computeView, totalsOf, calcResponse, bumpCatalog } = ctx;

  // ========== Пользователи (владелец) ==========
  const inviteUrl = (req: FastifyRequest, token: string) => `${(opts.publicUrl || `${req.protocol}://${req.host}`).replace(/\/$/, '')}/invite/${token}`;
  async function issueInvite(c: pg.PoolClient, userId: string): Promise<string> {
    const token = newToken();
    await c.query('update invites set used_at = now() where user_id = $1 and used_at is null', [userId]);
    await c.query(`insert into invites (token_hash, user_id, expires_at) values ($1, $2, now() + interval '${INVITE_DAYS} days')`, [tokenHash(token), userId]);
    return token;
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
}
