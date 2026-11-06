// Справочники: виды изделий, блоки, города, подключены ли нейросети; настройки расчёта (коэффициенты).
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

export async function registerReference(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { pool, opts, pricing, audit, me, need, startSession, loadUser, sessionUser, cities, cityExists, visibleClient, calcList, visibleCalc, computeView, totalsOf, calcResponse, bumpCatalog } = ctx;

  // ========== Справочники ==========
  app.get('/api/meta', async () => ({
    kinds: KINDS.map((id) => ({ id, title: KIND_TITLES[id] })),
    blocks: BLOCKS,
    cities: await cities(),
    // подключены ли нейросети: без ключа кнопка рендера неактивна, текст «Об изделии» — по шаблону
    ai: { render: renderConfigured(opts.env ?? process.env), text: textConfigured(opts.env ?? process.env) },
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
}
