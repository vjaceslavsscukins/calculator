// Что app.ts передаёт каждому модулю раздела (modules/*.ts): база, вход, видимость по роли, прайс и пересчёт.
// Цена считается только в engine (compute) — модули берут её через computeView / calcResponse.
import type { FastifyRequest, FastifyReply } from 'fastify';
import type pg from 'pg';
import type { CalcInput, Catalog, CatalogIndex, Settings, compute } from '../../../engine/src/index.ts';
import type { Role } from '../lib/view.ts';
import type { AppOptions } from '../app.ts';
import type { User } from './shared.ts';

type Db = pg.Pool | pg.PoolClient;

export interface AppContext {
  pool: pg.Pool;
  opts: AppOptions;
  /** Прайс и настройки из базы (кэш по версии прайса и rev настроек). */
  pricing(): Promise<{ catalog: Catalog; idx: CatalogIndex; settings: Settings; v: number; rev: number }>;
  /** Запись в журнал изменений. */
  audit(db: Db, u: User, action: string, entity: string, details: unknown): Promise<void>;
  /** Текущий пользователь (401, если не вошёл). */
  me(req: FastifyRequest): User;
  /** Пользователь с одной из ролей (403 иначе). */
  need(req: FastifyRequest, ...roles: Role[]): User;
  startSession(reply: FastifyReply, userId: string): Promise<void>;
  loadUser(id: string): Promise<User | null>;
  sessionUser(req: FastifyRequest): Promise<User | null>;
  cities(): Promise<{ id: number; name: string }[]>;
  cityExists(db: Db, id: unknown): Promise<number>;
  /** Клиент и расчёт — только если пользователь их видит (менеджер — свои, руководитель — свой город), иначе 404. */
  visibleClient(u: User, id: string, db?: Db): Promise<any>;
  calcList(u: User, extra: string, extraParams?: unknown[]): Promise<any[]>;
  visibleCalc(u: User, id: string, db?: Db): Promise<any>;
  computeView(input: CalcInput): Promise<{ result: ReturnType<typeof compute>; settings: Settings }>;
  totalsOf(v: ReturnType<typeof compute>): Record<string, unknown>;
  calcResponse(u: User, r: any): Promise<unknown>;
  bumpCatalog(c: pg.PoolClient): Promise<unknown>;
}
