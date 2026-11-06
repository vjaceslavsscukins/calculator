// Общее для модулей сервера: пользователь, константы входа, SQL-запросы с проверкой видимости по роли, JSON-ответы.
import type { Role } from '../lib/view.ts';
import { HttpError } from '../lib/view.ts';

export interface User {
  id: string; firstName: string; lastName: string; email: string; role: Role; cityId: number | null; cityName: string | null;
  /** Для КП: телефон и должность менеджера. */
  phone: string; position: string;
}

declare module 'fastify' {
  interface FastifyRequest { user: User | null }
}

export const COOKIE = 'kp_session';
export const SESSION_DAYS = 30;
export const INVITE_DAYS = 7;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ROLES: Role[] = ['owner', 'head', 'manager'];

export const fullName = (first: string, last: string) => `${first ?? ''} ${last ?? ''}`.trim();
export const userJson = (r: any): User => ({
  id: r.id, firstName: r.first_name, lastName: r.last_name, email: r.email, role: r.role, cityId: r.city_id ?? null, cityName: r.city_name ?? null,
  phone: r.phone ?? '', position: r.position ?? '',
});
export const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const likeArg = (q: string) => '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
export const notFound = () => new HttpError(404, 'Не найдено');
export const forbid = () => new HttpError(403, 'Недостаточно прав');

export function idParam(v: unknown): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw notFound();
  return v;
}

export const USER_SQL = `select u.*, ci.name as city_name from users u left join cities ci on ci.id = u.city_id`;

export const CLIENT_SQL = `
  select cl.*, ci.name as city_name, m.first_name as m_first, m.last_name as m_last,
         (select count(*)::int from calculations k where k.client_id = cl.id) as calc_count
    from clients cl join cities ci on ci.id = cl.city_id join users m on m.id = cl.manager_id`;

export const CALC_SQL = `
  select k.*, cl.name as client_name, cl.manager_id, cl.city_id, ci.name as city_name,
         m.first_name as m_first, m.last_name as m_last, ub.first_name as ub_first, ub.last_name as ub_last,
         (select s.updated_at from specs s where s.calculation_id = k.id) as spec_at
    from calculations k join clients cl on cl.id = k.client_id join cities ci on ci.id = cl.city_id
    join users m on m.id = cl.manager_id left join users ub on ub.id = k.updated_by`;

/** Видимость клиентов (и их расчётов) по роли: менеджер — свои, руководитель — свой город, владелец — все. */
export function scope(u: Pick<User, 'id' | 'role' | 'cityId'>, params: unknown[]): string {
  if (u.role === 'owner') return 'true';
  if (u.role === 'head') { params.push(u.cityId); return `cl.city_id = $${params.length}`; }
  params.push(u.id); return `cl.manager_id = $${params.length}`;
}

export const clientJson = (r: any) => ({
  id: r.id, name: r.name, phone: r.phone, cityId: r.city_id, cityName: r.city_name, managerId: r.manager_id,
  managerName: fullName(r.m_first, r.m_last), calcCount: r.calc_count ?? 0, createdAt: r.created_at, updatedAt: r.updated_at,
});
export const calcSummary = (r: any) => ({
  id: r.id, clientId: r.client_id, clientName: r.client_name, title: r.title, kind: r.kind, status: r.status, total: r.total,
  managerName: fullName(r.m_first, r.m_last), cityName: r.city_name, updatedAt: r.updated_at, specAt: r.spec_at ?? null,
});
export const calcJson = (r: any) => ({
  id: r.id, clientId: r.client_id, clientName: r.client_name, title: r.title, kind: r.kind, status: r.status, rev: r.rev,
  input: r.input, unparsed: r.unparsed, updatedAt: r.updated_at, updatedBy: r.ub_first != null ? fullName(r.ub_first, r.ub_last) : null,
});
