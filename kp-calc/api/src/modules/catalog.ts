// Прайс: группы и позиции, правка цены, новая позиция (загрузка файлом — priceimport.ts).
// Подключается из app.ts; общие помощники (вход, видимость по роли, прайс) приходят в ctx.
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

export async function registerCatalog(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, opts, pricing, audit, me, need, startSession, loadUser, sessionUser, cities, cityExists, visibleClient, calcList, visibleCalc, computeView, totalsOf, calcResponse, bumpCatalog } = ctx;

  // ========== Прайс ==========
  app.get('/api/catalog', async (req) => catalogFor(me(req).role, (await pricing()).catalog));

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
}
