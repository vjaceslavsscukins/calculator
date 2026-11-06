// Клиенты: список по роли и городу, карточка, изменение, передача менеджеру.
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

export async function registerClients(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, opts, pricing, audit, me, need, startSession, loadUser, sessionUser, cities, cityExists, visibleClient, calcList, visibleCalc, computeView, totalsOf, calcResponse, bumpCatalog } = ctx;

  // ========== Клиенты ==========

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
}
