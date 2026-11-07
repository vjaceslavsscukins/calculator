// Загрузка прайса группы файлом: сравнение с текущим прайсом (новые, изменилась цена, нет в файле),
// применение с записью для отката, расчёт, как изменятся действующие КП (цены — только из движка compute).
// Файл разбирает браузер; сюда приходят строки «название — цена».
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { compute, indexCatalog, kpItemPrice } from '../../../engine/src/index.ts';
import type { Catalog, CatalogIndex, Settings } from '../../../engine/src/index.ts';
import { tx } from '../lib/db.ts';
import { kpNumber } from './kpdata.ts';
import { HttpError } from '../lib/view.ts';
import type { Role } from '../lib/view.ts';

interface ImportUser { id: string; firstName: string; lastName: string; email: string; role: Role }
export interface PriceImportDeps {
  pool: pg.Pool;
  need(req: FastifyRequest, ...roles: Role[]): ImportUser;
  pricing(): Promise<{ catalog: Catalog; idx: CatalogIndex; settings: Settings }>;
  audit(db: pg.Pool | pg.PoolClient, u: ImportUser, action: string, entity: string, details: unknown): Promise<void>;
  bumpCatalog(c: pg.PoolClient): Promise<unknown>;
}

export const MISSING_STATUS = 'нет в новом прайсе';
const MAX_ROWS = 5000;

/** Ключ для сравнения названий: регистр, ё/е, кавычки и лишние пробелы не важны. */
export const nameKey = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/["«»“”'`]/g, '').replace(/\s+/g, ' ').trim();

export interface ImportRow { name: string; price: number }
export interface ImportDiff {
  added: ImportRow[];
  changed: { id: string; name: string; before: number; after: number; pct: number | null }[];
  missing: { id: string; name: string; price: number }[];
  restored: { id: string; name: string; price: number }[];
  same: number;
  duplicates: string[];
}

/** Строки файла: название и цена > 0; повторы названия — берётся последняя, список повторов отдаём. */
export function cleanRows(raw: unknown): { rows: ImportRow[]; duplicates: string[]; skipped: number } {
  if (!Array.isArray(raw)) throw new HttpError(400, 'Нет строк прайса');
  if (raw.length > MAX_ROWS) throw new HttpError(413, `Слишком много строк: больше ${MAX_ROWS}`);
  const byKey = new Map<string, ImportRow>();
  const duplicates = new Set<string>();
  let skipped = 0;
  for (const r of raw as any[]) {
    const name = typeof r?.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    const price = typeof r?.price === 'number' && Number.isFinite(r.price) && r.price > 0 && r.price < 1e9 ? Math.round(r.price * 100) / 100 : 0;
    if (!name || !price) { skipped++; continue; }
    const k = nameKey(name);
    if (byKey.has(k)) duplicates.add(name);
    byKey.set(k, { name, price });
  }
  if (!byKey.size) throw new HttpError(400, 'В файле не нашли ни одной строки с названием и ценой');
  return { rows: [...byKey.values()], duplicates: [...duplicates], skipped };
}

export function diffGroup(items: { id: string; name: string; price: number; status?: string | null }[], rows: ImportRow[], duplicates: string[] = []): ImportDiff {
  const fileByKey = new Map(rows.map((r) => [nameKey(r.name), r]));
  const itemKeys = new Set(items.map((i) => nameKey(i.name)));
  const d: ImportDiff = { added: [], changed: [], missing: [], restored: [], same: 0, duplicates };
  for (const it of items) {
    const f = fileByKey.get(nameKey(it.name));
    if (!f) { if (!it.status) d.missing.push({ id: it.id, name: it.name, price: it.price }); continue; }
    if (it.status === MISSING_STATUS) d.restored.push({ id: it.id, name: it.name, price: f.price });
    if (Math.abs(f.price - it.price) >= 0.005) d.changed.push({ id: it.id, name: it.name, before: it.price, after: f.price, pct: it.price > 0 ? Math.round(((f.price - it.price) / it.price) * 1000) / 10 : null });
    else if (it.status !== MISSING_STATUS) d.same++;
  }
  for (const r of rows) if (!itemKeys.has(nameKey(r.name))) d.added.push(r);
  return d;
}

export async function registerPriceImport(app: FastifyInstance, d: PriceImportDeps): Promise<void> {
  const { pool } = d;

  const groupOf = async (db: pg.Pool | pg.PoolClient, id: unknown, lock = false) => {
    const { rows: [g] } = await db.query(`select * from catalog_groups where id = $1 ${lock ? 'for update' : ''}`, [typeof id === 'string' ? id.slice(0, 100) : '']);
    if (!g) throw new HttpError(404, 'Группа прайса не найдена');
    const { rows: items } = await db.query('select id, name, price, status, sort from catalog_items where group_id = $1 order by sort, id', [g.id]);
    return { g, items };
  };

  /**
   * Как изменятся действующие КП (последняя версия, срок не истёк, не утверждено), если цены станут newPrices:
   * пересчёт расчётов этих КП по текущему и по новому прайсу — разница только от цен (правки расчёта после КП не мешают).
   */
  async function impactOf(groupItemIds: Set<string>, newPrices: Map<string, number>) {
    const { catalog, settings, idx } = await d.pricing();
    const next: Catalog = { ...catalog, groups: catalog.groups.map((g) => ({ ...g, items: g.items.map((it) => (newPrices.has(it.id) ? { ...it, price: newPrices.get(it.id)! } : it)) })) };
    const nextIdx = indexCatalog(next);
    const { rows: kps } = await pool.query(
      `select k.id, k.number, k.version, k.total, k.valid_until, k.snapshot->'items' as items, cl.name as client_name, cl.manager_id
         from kps k join clients cl on cl.id = k.client_id
        where k.version = (select max(k2.version) from kps k2 where k2.number = k.number)
          and k.valid_until >= current_date and k.approved_at is null`);
    const out: { kpId: string; number: string; client: string; managerId: string; validUntil: string; total: number; delta: number; pct: number }[] = [];
    for (const k of kps) {
      const ids: string[] = (k.items ?? []).map((it: any) => it.calculationId).filter(Boolean);
      if (!ids.length) continue;
      const { rows: calcs } = await pool.query('select id, input from calculations where id = any($1::uuid[])', [ids]);
      let delta = 0, touched = false;
      for (const c of calcs) {
        if (!(c.input?.rows ?? []).some((r: any) => r.itemId && groupItemIds.has(r.itemId))) continue;
        touched = true;
        const before = kpItemPrice(compute(c.input, idx, settings), c.input).total;
        const after = kpItemPrice(compute(c.input, nextIdx, settings), c.input).total;
        delta += after - before;
      }
      if (touched && Math.abs(delta) >= 1) {
        out.push({ kpId: k.id, number: `${kpNumber(k.number)}${k.version > 1 ? ` (версия ${k.version})` : ''}`, client: k.client_name, managerId: k.manager_id,
          validUntil: String(k.valid_until).slice(0, 10), total: k.total, delta, pct: k.total > 0 ? Math.round((delta / k.total) * 1000) / 10 : 0 });
      }
    }
    return out.sort((a, b) => b.delta - a.delta);
  }

  const pricesAfter = (diff: ImportDiff) => new Map(diff.changed.map((c) => [c.id, c.after] as [string, number]));

  // большой прайс (до 5000 строк) — до 5 МБ
  app.post('/api/catalog/groups/:id/import/preview', { bodyLimit: 5 * 1024 * 1024 }, async (req: any) => {
    d.need(req, 'owner', 'head');
    const { g, items } = await groupOf(pool, req.params.id);
    const { rows, duplicates, skipped } = cleanRows(req.body?.rows);
    const diff = diffGroup(items, rows, duplicates);
    const impact = await impactOf(new Set(items.map((i) => i.id)), pricesAfter(diff));
    return { group: { id: g.id, name: g.name, unit: g.unit, rule: g.rule }, diff, skipped, impact: impact.map(({ managerId, ...x }) => x) };
  });

  app.post('/api/catalog/groups/:id/import/apply', { bodyLimit: 5 * 1024 * 1024 }, async (req: any) => {
    const u = d.need(req, 'owner', 'head');
    const markMissing = req.body?.markMissing !== false;
    const { rows, duplicates } = cleanRows(req.body?.rows);
    const result = await tx(pool, async (c) => {
      const { g, items } = await groupOf(c, req.params.id, true);
      const diff = diffGroup(items, rows, duplicates);
      const byKey = new Map(rows.map((r) => [nameKey(r.name), r]));
      for (const ch of diff.changed) await c.query('update catalog_items set price = $1 where id = $2', [ch.after, ch.id]);
      for (const r of diff.restored) await c.query('update catalog_items set status = null where id = $1', [r.id]);
      if (markMissing) for (const m of diff.missing) await c.query('update catalog_items set status = $1 where id = $2', [MISSING_STATUS, m.id]);
      const added: string[] = [];
      let { rows: [{ sort }] } = await c.query('select coalesce(max(sort), -1) + 1 as sort from catalog_items where group_id = $1', [g.id]);
      for (const a of diff.added) {
        const id = `${g.id}-${crypto.randomUUID().slice(0, 8)}`;
        await c.query('insert into catalog_items (id, group_id, name, price, sort) values ($1,$2,$3,$4,$5)', [id, g.id, byKey.get(nameKey(a.name))!.name, a.price, sort++]);
        added.push(id);
      }
      const summary = { added: diff.added.length, changed: diff.changed.length, missing: markMissing ? diff.missing.length : 0, restored: diff.restored.length, same: diff.same };
      const { rows: [imp] } = await c.query(
        `insert into price_imports (group_id, user_id, before, added_ids, summary) values ($1,$2,$3,$4,$5) returning id, created_at`,
        [g.id, u.id, JSON.stringify(items), added, JSON.stringify(summary)]);
      await d.bumpCatalog(c);
      await d.audit(c, u, 'Загрузка прайса файлом', 'Прайс', { group: g.name, ...summary, changes: diff.changed.slice(0, 50).map((x) => ({ item: x.name, before: x.before, after: x.after })) });
      return { importId: imp.id as number, createdAt: imp.created_at, summary, diff, groupName: g.name as string, itemIds: new Set(items.map((i) => i.id as string)) };
    });
    // как подорожают / подешевеют действующие КП: по «до загрузки» → «после» — уведомление менеджеру
    const impact = await impactBetween(result.diff, result.itemIds);
    for (const x of impact) {
      const sign = x.delta > 0 ? 'подорожает' : 'подешевеет';
      await pool.query('insert into notifications (user_id, kp_id, type, text) values ($1,$2,$3,$4)', [x.managerId, x.kpId, 'price_change',
        `Прайс «${result.groupName}» обновлён: ${x.number} (${x.client}) при перерасчёте ${sign} на ${Math.abs(Math.round(x.delta)).toLocaleString('ru-RU')} ₽ (${x.pct > 0 ? '+' : ''}${String(x.pct).replace('.', ',')} %). Цена в КП зафиксирована до ${x.validUntil.split('-').reverse().join('.')}`]);
    }
    return { importId: result.importId, summary: result.summary, impact: impact.map(({ managerId, ...x }) => x) };
  });

  /** После применения прайс уже новый: считаем «до» по старым ценам из diff. */
  async function impactBetween(diff: ImportDiff, itemIds: Set<string>) {
    const old = new Map(diff.changed.map((c) => [c.id, c.before] as [string, number]));
    const raw = await impactOf(itemIds, old); // «после» здесь — старые цены
    return raw.map((x) => ({ ...x, delta: -x.delta, pct: -x.pct })).filter((x) => Math.abs(x.delta) >= 1).sort((a, b) => b.delta - a.delta);
  }

  app.get('/api/catalog/groups/:id/imports', async (req: any) => {
    d.need(req, 'owner', 'head');
    const { rows } = await pool.query(
      `select p.id, p.created_at, p.summary, p.rolled_back_at, u.first_name, u.last_name from price_imports p left join users u on u.id = p.user_id
        where p.group_id = $1 order by p.id desc limit 20`, [String(req.params.id).slice(0, 100)]);
    const lastLive = rows.find((r) => !r.rolled_back_at)?.id;
    return { imports: rows.map((r) => ({ id: r.id, createdAt: r.created_at, summary: r.summary, by: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(), rolledBackAt: r.rolled_back_at, canRollback: r.id === lastLive })) };
  });

  /** Откат последней загрузки группы: цены и пометки как были; добавленные позиции — «нет в новом прайсе» (на них могут ссылаться расчёты). */
  app.post('/api/catalog/imports/:id/rollback', async (req: any) => {
    const u = d.need(req, 'owner', 'head');
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(404, 'Загрузка не найдена');
    return tx(pool, async (c) => {
      const { rows: [p] } = await c.query('select * from price_imports where id = $1 for update', [id]);
      if (!p) throw new HttpError(404, 'Загрузка не найдена');
      if (p.rolled_back_at) throw new HttpError(409, 'Эту загрузку уже откатили');
      const { rows: [last] } = await c.query('select id from price_imports where group_id = $1 and rolled_back_at is null order by id desc limit 1', [p.group_id]);
      if (last?.id !== p.id) throw new HttpError(409, 'Откатить можно только последнюю загрузку группы');
      for (const it of p.before as any[]) await c.query('update catalog_items set price = $1, status = $2 where id = $3', [it.price, it.status ?? null, it.id]);
      if (p.added_ids?.length) await c.query('update catalog_items set status = $1 where id = any($2::text[])', [MISSING_STATUS, p.added_ids]);
      await c.query('update price_imports set rolled_back_at = now() where id = $1', [p.id]);
      await d.bumpCatalog(c);
      const { rows: [g] } = await c.query('select name from catalog_groups where id = $1', [p.group_id]);
      await d.audit(c, u, 'Откат загрузки прайса', 'Прайс', { group: g?.name, importId: p.id });
      return { ok: true };
    });
  });
}
