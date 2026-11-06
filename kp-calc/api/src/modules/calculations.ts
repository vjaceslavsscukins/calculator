// Расчёты: создание, сохранение (rev, 409), лимит скидки, копия, пересчёт, разбор вставки PRO100.
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

export async function registerCalculations(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, opts, pricing, audit, me, need, startSession, loadUser, sessionUser, cities, cityExists, visibleClient, calcList, visibleCalc, computeView, totalsOf, calcResponse, bumpCatalog } = ctx;

  // ========== Расчёты ==========

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
    // скидка: менеджер — до 5 %, руководитель — до 15 % (настройки), владелец — любая; уже согласованную скидку можно оставить
    const over = discountOverLimit(u.role, input.discountPct, settings);
    if (over && input.discountPct !== (cur.input?.discountPct ?? 0)) throw new HttpError(403, over);
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
}
