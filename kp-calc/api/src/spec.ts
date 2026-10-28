// Спецификация к договору: черновик из расчёта (specDraft движка), сохранение снимком, стоимость — только из compute.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { compute, specDraft, specMissing } from '../../engine/src/index.ts';
import type { CatalogIndex, Settings, SpecData, SpecHeader } from '../../engine/src/index.ts';
import { HttpError } from './view.ts';

export interface SpecDeps {
  pool: pg.Pool;
  pricing(): Promise<{ idx: CatalogIndex; settings: Settings }>;
  me(req: FastifyRequest): { id: string };
  visibleCalc(u: any, id: string, db?: pg.Pool | pg.PoolClient): Promise<any>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const HEADER_KEYS: (keyof SpecHeader)[] = ['contractNo', 'contractDate', 'clientName', 'clientPhone', 'address', 'designer'];

/** Данные спецификации от клиента: только известные поля, ограничения по длине и количеству. */
export function cleanSpec(v: any): SpecData {
  if (!v || typeof v !== 'object') throw new HttpError(400, 'Нет данных спецификации');
  const h = v.header ?? {};
  const header = Object.fromEntries(HEADER_KEYS.map((k) => [k, str(h[k], 300)])) as unknown as SpecHeader;
  const sections = (Array.isArray(v.sections) ? v.sections : []).slice(0, 30).map((s: any) => ({
    title: str(s?.title, 200),
    fields: (Array.isArray(s?.fields) ? s.fields : []).slice(0, 80).map((f: any) => ({ label: str(f?.label, 300), value: str(f?.value, 2000) })),
  }));
  return { header, title: str(v.title, 200), sections, terms: str(v.terms, 3000), note: str(v.note, 5000) };
}

export async function registerSpec(app: FastifyInstance, d: SpecDeps): Promise<void> {
  const { pool } = d;

  async function current(c: any) {
    const p = await d.pricing();
    const total = compute(c.input, p.idx, p.settings).total;
    const { rows: [cl] } = await pool.query('select phone from clients where id = $1', [c.client_id]);
    const draft = specDraft(c.input, p.idx, p.settings, {
      title: c.title,
      header: { clientName: c.client_name, clientPhone: cl?.phone ?? '', designer: `${c.m_first ?? ''} ${c.m_last ?? ''}`.trim() },
    });
    return { draft, total };
  }

  async function response(c: any) {
    const { rows: [s] } = await pool.query(
      `select s.*, u.first_name, u.last_name from specs s left join users u on u.id = s.updated_by where s.calculation_id = $1`, [c.id]);
    const cur = await current(c);
    return {
      calculation: { id: c.id, title: c.title, kind: c.kind, clientId: c.client_id, clientName: c.client_name },
      spec: s ? {
        data: s.data as SpecData, total: s.total, rev: s.rev, updatedAt: s.updated_at,
        updatedBy: `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim(), missing: specMissing(s.data.header ?? {}),
      } : null,
      draft: cur.draft,
      calcTotal: cur.total,
    };
  }

  const calcOf = (req: any) => {
    const id = req.params.id;
    if (typeof id !== 'string' || !UUID.test(id)) throw new HttpError(404, 'Не найдено');
    return d.visibleCalc(d.me(req), id);
  };

  app.get('/api/calculations/:id/spec', async (req: any) => response(await calcOf(req)));

  /** Сохранить. rev — версия, которую правили (0 — новая); refreshTotal — взять стоимость из расчёта сейчас. */
  app.put('/api/calculations/:id/spec', async (req: any) => {
    const u = d.me(req);
    const c = await calcOf(req);
    const data = cleanSpec(req.body?.data);
    const rev = Number(req.body?.rev) || 0;
    const { rows: [s] } = await pool.query('select rev, total from specs where calculation_id = $1', [c.id]);
    if ((s?.rev ?? 0) !== rev) throw new HttpError(409, 'Спецификацию уже изменили в другом окне. Обновите страницу.');
    const total = !s || req.body?.refreshTotal ? (await current(c)).total : s.total;
    if (!s) {
      await pool.query('insert into specs (calculation_id, data, total, created_by, updated_by) values ($1,$2,$3,$4,$4) on conflict do nothing',
        [c.id, JSON.stringify(data), total, u.id]);
    } else {
      const r = await pool.query('update specs set data = $2, total = $3, rev = rev + 1, updated_by = $4, updated_at = now() where calculation_id = $1 and rev = $5',
        [c.id, JSON.stringify(data), total, u.id, rev]);
      if (!r.rowCount) throw new HttpError(409, 'Спецификацию уже изменили в другом окне. Обновите страницу.');
    }
    return response(c);
  });
}
