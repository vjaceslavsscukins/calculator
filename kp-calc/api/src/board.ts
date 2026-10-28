// Реестр КП (все КП в зоне видимости: статус, просмотры, вопросы клиентов) и приборная панель руководителя.
// Суммы — из сохранённых снимков КП и итогов расчётов (их посчитал движок), здесь только складываются.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { kpNumber } from './kpdata.ts';
import { HttpError } from './view.ts';
import type { Role } from './view.ts';

interface BoardUser { id: string; role: Role; cityId: number | null }
export interface BoardDeps {
  pool: pg.Pool;
  me(req: FastifyRequest): BoardUser;
  need(req: FastifyRequest, ...roles: Role[]): BoardUser;
  scope(u: BoardUser, params: unknown[]): string;
}

export type KpState = 'approved' | 'question' | 'opened' | 'sent' | 'created' | 'expired';
export const KP_STATES: KpState[] = ['approved', 'question', 'opened', 'sent', 'created', 'expired'];

const fullName = (a: string | null, b: string | null) => `${a ?? ''} ${b ?? ''}`.trim();
const day = (v: unknown) => String(v ?? '').slice(0, 10);
const isoDay = (v: unknown, fallback: string) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : fallback);

/** Последняя версия каждого КП с менеджером, городом и вопросами клиента. */
const LIST_SQL = `
  select k.id, k.number, k.version, k.client_id, k.total, k.valid_until, k.created_at, k.sent_at, k.views, k.last_viewed_at, k.approved_at,
         k.snapshot->'items' as items, cl.name as client_name, cl.manager_id, cl.city_id, ci.name as city_name,
         m.first_name as m_first, m.last_name as m_last,
         q.n as questions, q.last_message, q.last_at
    from kps k join clients cl on cl.id = k.client_id join cities ci on ci.id = cl.city_id join users m on m.id = cl.manager_id
    left join lateral (
      select count(*)::int as n, (array_agg(e.message order by e.created_at desc))[1] as last_message, max(e.created_at) as last_at
        from kp_events e where e.kp_id = k.id and e.type = 'question') q on true
   where k.version = (select max(k2.version) from kps k2 where k2.number = k.number)`;

function stateOf(r: any, today: string): KpState {
  if (r.approved_at) return 'approved';
  if (r.questions > 0) return 'question';
  if (day(r.valid_until) < today) return 'expired';
  if (r.views > 0) return 'opened';
  if (r.sent_at) return 'sent';
  return 'created';
}

const kpRow = (r: any, today: string) => ({
  id: r.id, number: kpNumber(r.number), version: r.version, clientId: r.client_id, clientName: r.client_name,
  managerId: r.manager_id, managerName: fullName(r.m_first, r.m_last), cityName: r.city_name,
  items: (r.items ?? []).map((it: any) => it.title), total: r.total, validUntil: day(r.valid_until),
  createdAt: r.created_at, sentAt: r.sent_at, views: r.views, lastViewedAt: r.last_viewed_at, approvedAt: r.approved_at,
  questions: r.questions ?? 0, lastQuestion: r.last_message ?? null, lastQuestionAt: r.last_at ?? null,
  state: stateOf(r, today),
});

export async function registerBoard(app: FastifyInstance, d: BoardDeps): Promise<void> {
  const { pool } = d;
  const today = () => new Date().toISOString().slice(0, 10);

  async function listKps(u: BoardUser, from?: string, to?: string) {
    const params: unknown[] = [];
    let where = ` and ${d.scope(u, params)}`;
    if (from) { params.push(from); where += ` and k.created_at >= $${params.length}::date`; }
    if (to) { params.push(to); where += ` and k.created_at < $${params.length}::date + 1`; }
    const { rows } = await pool.query(`${LIST_SQL}${where} order by k.created_at desc limit 2000`, params);
    const t = today();
    return rows.map((r) => kpRow(r, t));
  }

  // ========== Реестр КП ==========
  app.get('/api/kps', async (req: any) => {
    const u = d.me(req);
    const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase().slice(0, 100) : '';
    const state = KP_STATES.includes(req.query?.state) ? req.query.state as KpState : null;
    const managerId = typeof req.query?.managerId === 'string' ? req.query.managerId : '';
    let list = await listKps(u);
    if (state) list = list.filter((k) => k.state === state);
    if (managerId) list = list.filter((k) => k.managerId === managerId);
    if (q) list = list.filter((k) => `${k.number} ${k.clientName} ${k.items.join(' ')}`.toLowerCase().includes(q));
    return { kps: list.slice(0, 500) };
  });

  // ========== Приборная панель (владелец, руководитель) ==========
  app.get('/api/dashboard', async (req: any) => {
    const u = d.need(req, 'owner', 'head');
    const t = today();
    const from = isoDay(req.query?.from, `${t.slice(0, 7)}-01`);
    const to = isoDay(req.query?.to, t);
    if (from > to) throw new HttpError(400, 'Начало периода позже конца');

    const params: unknown[] = [from, to];
    const { rows: calcs } = await pool.query(
      `select k.id, k.status, k.total, (k.totals->>'margin')::float8 as margin, cl.manager_id, m.first_name as m_first, m.last_name as m_last
         from calculations k join clients cl on cl.id = k.client_id join users m on m.id = cl.manager_id
        where k.created_at >= $1::date and k.created_at < $2::date + 1 and k.status <> 'archived' and ${d.scope(u, params)}`, params);
    const kps = await listKps(u, from, to);

    const sum = (xs: { total: number }[]) => xs.reduce((a, x) => a + (Number(x.total) || 0), 0);
    const sent = kps.filter((k) => k.sentAt), opened = kps.filter((k) => k.views > 0), approved = kps.filter((k) => k.approvedAt);
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

    // по менеджерам
    const byManager = new Map<string, any>();
    const row = (id: string, name: string) => {
      if (!byManager.has(id)) byManager.set(id, { managerId: id, managerName: name, calcs: 0, calcSum: 0, margin: 0, kps: 0, sent: 0, opened: 0, approved: 0, sentSum: 0, approvedSum: 0, questions: 0 });
      return byManager.get(id);
    };
    for (const c of calcs) { const r = row(c.manager_id, fullName(c.m_first, c.m_last)); r.calcs++; r.calcSum += Number(c.total) || 0; r.margin += Number(c.margin) || 0; }
    for (const k of kps) {
      const r = row(k.managerId, k.managerName);
      r.kps++; r.questions += k.questions;
      if (k.sentAt) { r.sent++; r.sentSum += k.total; }
      if (k.views > 0) r.opened++;
      if (k.approvedAt) { r.approved++; r.approvedSum += k.total; }
    }

    // требует внимания (по всем КП, не только за период)
    const all = await listKps(u);
    const ago = (iso: string | null, days: number) => !!iso && Date.now() - Date.parse(iso) > days * 86400_000;
    const soon = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    const attention = [
      ...all.filter((k) => k.state === 'question').map((k) => ({ ...k, reason: 'Вопрос клиента' })),
      ...all.filter((k) => k.state === 'sent' && ago(k.sentAt, 2)).map((k) => ({ ...k, reason: 'Отправлено больше 2 дней назад, клиент не открыл' })),
      ...all.filter((k) => k.state === 'opened' && k.validUntil <= soon).map((k) => ({ ...k, reason: `Срок КП заканчивается ${k.validUntil.split('-').reverse().join('.')}` })),
      ...all.filter((k) => k.state === 'created' && ago(k.createdAt, 1)).map((k) => ({ ...k, reason: 'КП собрано, но не отправлено' })),
    ].slice(0, 30);

    return {
      from, to,
      totals: {
        calcs: calcs.length, calcSum: sum(calcs), margin: calcs.reduce((a, c) => a + (Number(c.margin) || 0), 0),
        kps: kps.length, sent: sent.length, opened: opened.length, approved: approved.length,
        questions: kps.reduce((a, k) => a + k.questions, 0),
        sentSum: sum(sent), approvedSum: sum(approved), avgCheck: sent.length ? sum(sent) / sent.length : null,
        openRate: pct(opened.length, sent.length), approveRate: pct(approved.length, sent.length),
      },
      managers: [...byManager.values()].sort((a, b) => b.sentSum - a.sentSum || b.calcs - a.calcs),
      attention,
    };
  });
}
