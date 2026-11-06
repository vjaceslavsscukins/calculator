// Журнал изменений: владелец — всё, руководитель — прайс, коэффициенты, рендеры своего города.
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

export async function registerAudit(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, opts, pricing, audit, me, need, startSession, loadUser, sessionUser, cities, cityExists, visibleClient, calcList, visibleCalc, computeView, totalsOf, calcResponse, bumpCatalog } = ctx;

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
}
