// Обращения к серверу kp-calc/api. Договорённость — kp-calc/docs/api.md.
// Интерфейс цену не считает: все суммы приходят с сервера в view (CalcResult движка).
import type { CalcInput, CalcResult, RowResult, LightResult, Settings, ProductKind, Row } from '../../engine/src/types.ts';
import type { BlockDef } from '../../engine/src/blocks.ts';
import type { Pro100Line } from '../../engine/src/pro100.ts';

export type { CalcInput, Settings, ProductKind, Row, BlockDef, Pro100Line };

export type Role = 'owner' | 'head' | 'manager';

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  /** У владельца города может не быть. */
  cityId: number | null;
  cityName: string | null;
}

export interface UserAdmin extends User { disabled: boolean; invited: boolean }

export interface City { id: number; name: string }

export interface Meta {
  kinds: { id: ProductKind; title: string }[];
  blocks: Record<ProductKind, BlockDef[]>;
  cities: City[];
}

/** Для менеджера сервер вырезает себестоимость, поэтому эти поля необязательны. */
export type ViewRow = Omit<RowResult, 'unitCost' | 'cost' | 'prod' | 'costNote' | 'costGroup' | 'warnings' | 'id' | 'block'> &
  Partial<Pick<RowResult, 'unitCost' | 'cost' | 'prod' | 'costNote' | 'costGroup' | 'warnings' | 'id' | 'block'>>;

export interface View extends Omit<CalcResult, 'rows' | 'light' | 'cost' | 'prod' | 'margin' | 'costByGroup'> {
  rows: ViewRow[];
  light: (Omit<LightResult, 'rows'> & { rows: ViewRow[] }) | null;
  cost?: number;
  prod?: number;
  margin?: number;
  costByGroup?: Record<string, number>;
}

export type Status = 'draft' | 'saved' | 'in_kp' | 'kp_sent' | 'contract' | 'archived';

export interface CalcSummary {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  kind: ProductKind;
  status: Status;
  total: number;
  managerName: string;
  cityName: string;
  updatedAt: string;
}

export interface Calculation {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  kind: ProductKind;
  status: Status;
  rev: number;
  input: CalcInput;
  unparsed: Pro100Line[];
  updatedAt: string;
  updatedBy?: string;
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  cityId: number;
  cityName: string;
  managerId: number;
  managerName: string;
  calcCount?: number;
  updatedAt?: string;
}

export interface CatalogItemView { id: string; name: string; status?: string; price?: number }
export interface CatalogGroupView {
  id: string;
  category: string;
  name: string;
  unit: string;
  rule: 'sheet' | 'unit';
  sheetArea?: number;
  source?: string;
  items: CatalogItemView[];
}
export interface CatalogView { version?: number; groups: CatalogGroupView[] }

/** Настройки для менеджера: без цен и наценок. */
export interface SettingsPublic {
  /** Монтаж, % от розницы мебели. */
  montagePct: number;
  /** Доставка по умолчанию, ₽. */
  deliveryDefaultRub: number;
  roundTo: number;
  kProd?: number;
  kShop?: number;
  light: {
    tape: { name: string; price?: number; wattPerM?: number; voltage?: number; maxRunM?: number };
    profiles: { id: string; name: string; price?: number }[];
    switches: { id: string; name: string; price?: number }[];
    psus?: { watt: number; price: number }[];
  };
}

export interface AuditEntry { at: string; userName: string; action: string; entity: string; details: unknown }

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, message: string, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

async function request<T>(method: string, url: string, body?: unknown, opts: { quiet401?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Сервер не отвечает. Проверьте подключение и повторите.', {});
  }
  let data: Record<string, unknown> = {};
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = {}; }
  }
  if (!res.ok) {
    if (res.status === 401 && !opts.quiet401 && onUnauthorized) onUnauthorized();
    const msg = typeof data.error === 'string' && data.error
      ? data.error
      : res.status === 403 ? 'Нет доступа к этому разделу.'
      : res.status === 404 ? 'Не найдено.'
      : 'Что-то пошло не так на сервере. Повторите через минуту.';
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

const enc = encodeURIComponent;
const qs = (p: Record<string, string | undefined>) => {
  const s = Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${k}=${enc(v!)}`).join('&');
  return s ? `?${s}` : '';
};

export const api = {
  // вход
  me: () => request<{ user: User }>('GET', '/api/auth/me', undefined, { quiet401: true }),
  login: (email: string, password: string) => request<{ user: User }>('POST', '/api/auth/login', { email, password }, { quiet401: true }),
  logout: () => request<object>('POST', '/api/auth/logout'),
  invite: (token: string) => request<{ email: string; firstName: string }>('GET', `/api/auth/invite/${enc(token)}`, undefined, { quiet401: true }),
  acceptInvite: (token: string, password: string) => request<{ user: User }>('POST', '/api/auth/invite/accept', { token, password }, { quiet401: true }),

  // справочники
  meta: () => request<Meta>('GET', '/api/meta'),
  settings: () => request<(Settings & { rev: number }) | SettingsPublic>('GET', '/api/settings'),
  saveSettings: (rev: number, settings: Settings) => request<{ settings: Settings; rev: number }>('PUT', '/api/settings', { rev, settings }),

  // пользователи
  users: () => request<{ users: UserAdmin[] }>('GET', '/api/users'),
  createUser: (u: { firstName: string; lastName: string; email: string; role: Role; cityId: number }) =>
    request<{ user: UserAdmin; inviteUrl: string }>('POST', '/api/users', u),
  patchUser: (id: string, patch: Partial<{ firstName: string; lastName: string; role: Role; cityId: number; disabled: boolean }>) =>
    request<{ user: UserAdmin }>('PATCH', `/api/users/${enc(id)}`, patch),
  newInvite: (id: string) => request<{ inviteUrl: string }>('POST', `/api/users/${enc(id)}/invite`),

  // клиенты
  clients: (q?: string) => request<{ clients: Client[] }>('GET', `/api/clients${qs({ q })}`),
  createClient: (c: { name: string; phone: string; cityId?: number }) => request<{ client: Client }>('POST', '/api/clients', c),
  client: (id: string) => request<{ client: Client; calculations: CalcSummary[] }>('GET', `/api/clients/${enc(id)}`),
  patchClient: (id: string, patch: Partial<{ name: string; phone: string; cityId: number; managerId: number }>) =>
    request<{ client: Client }>('PATCH', `/api/clients/${enc(id)}`, patch),

  // расчёты
  calculations: (status?: string, q?: string) => request<{ calculations: CalcSummary[] }>('GET', `/api/calculations${qs({ status, q })}`),
  createCalculation: (clientId: string, title: string, kind: ProductKind) =>
    request<{ calculation: Calculation; view: View }>('POST', '/api/calculations', { clientId, title, kind }),
  calculation: (id: string) => request<{ calculation: Calculation; view: View }>('GET', `/api/calculations/${enc(id)}`),
  saveCalculation: (id: string, body: { rev: number; title?: string; status?: Status; input: CalcInput; unparsed: Pro100Line[] }) =>
    request<{ calculation: Calculation; view: View }>('PUT', `/api/calculations/${enc(id)}`, body),
  copyCalculation: (id: string) => request<{ calculation: Calculation; view: View }>('POST', `/api/calculations/${enc(id)}/copy`),
  compute: (input: CalcInput) => request<{ view: View }>('POST', '/api/compute', { input }),
  parsePro100: (kind: ProductKind, text: string, rows: Row[]) =>
    request<{ rows: Row[]; unparsed: Pro100Line[]; skipped: string[] }>('POST', '/api/pro100/parse', { kind, text, rows }),

  // прайс
  catalog: () => request<CatalogView>('GET', '/api/catalog'),
  patchItem: (id: string, patch: { price?: number; name?: string; status?: string | null }) =>
    request<{ item: CatalogItemView }>('PATCH', `/api/catalog/items/${enc(id)}`, patch),
  addItem: (groupId: string, name: string, price: number) =>
    request<{ item: CatalogItemView }>('POST', `/api/catalog/groups/${enc(groupId)}/items`, { name, price }),

  // журнал
  audit: (limit = 200) => request<{ entries: AuditEntry[] }>('GET', `/api/audit?limit=${limit}`),
};

export const STATUS_TITLES: Record<Status, string> = {
  draft: 'Черновик',
  saved: 'Сохранён',
  in_kp: 'В КП',
  kp_sent: 'КП отправлено',
  contract: 'Договор',
  archived: 'В архиве',
};

export const ROLE_TITLES: Record<Role, string> = { owner: 'Владелец', head: 'Руководитель', manager: 'Менеджер' };

export const seesCost = (u: User | null) => u?.role === 'owner' || u?.role === 'head';
