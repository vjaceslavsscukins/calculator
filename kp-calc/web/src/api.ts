// Обращения к серверу kp-calc/api. Договорённость — kp-calc/docs/api.md.
// Интерфейс цену не считает: все суммы приходят с сервера в view (CalcResult движка).
import type { CalcInput, CalcResult, RowResult, LightResult, Settings, ProductKind, Row } from '../../engine/src/types.ts';
import type { BlockDef } from '../../engine/src/blocks.ts';
import type { Pro100Line } from '../../engine/src/pro100.ts';
import type { KpItemPrice, KpTotals, KpMaterial } from '../../engine/src/kp.ts';

export type { CalcInput, Settings, ProductKind, Row, BlockDef, Pro100Line, KpItemPrice, KpTotals, KpMaterial };

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
  /** Для КП: телефон и должность (видит клиент на странице КП). */
  phone: string;
  position: string;
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

export interface ImageInfo { id: string; kind: 'sketch' | 'render' | 'cover'; title: string; mime: string; size: number; inKp: boolean; createdAt: string; url: string }

export interface KpDraftItem {
  calculationId: string; kind: ProductKind; calcTitle: string; status: Status;
  title: string; dims: string; about: string; materials: KpMaterial[]; benefits: string[];
  images: ImageInfo[]; imageId: string | null; price: KpItemPrice;
}
export interface KpDraft {
  client: { id: string; name: string; cityName: string };
  items: KpDraftItem[];
  base: { id: string; number: string; version: number; theme: 'dark' | 'light'; items: { calculationId: string; title: string; dims: string; about: string; materials: KpMaterial[]; benefits: string[]; imageId: string | null }[] } | null;
  validUntil: string;
  aiText: boolean;
}
export interface KpSummary {
  id: string; number: string; version: number; clientId: string; clientName: string; url: string; total: number; theme: 'dark' | 'light';
  validUntil: string; createdAt: string; createdBy: string | null; sentAt: string | null; views: number;
  firstViewedAt: string | null; lastViewedAt: string | null; approvedAt: string | null; items: { calculationId: string; title: string }[];
}
export interface KpSnapshotView {
  number: string; version: number; validUntil: string; roundTo: number; client: { name: string; city: string };
  items: { calculationId: string; title: string; dims: string; price: KpItemPrice; image: { id: string; kind: string } | null }[];
  totals: KpTotals;
}
export interface KpDetail { kp: KpSummary; snapshot: KpSnapshotView; clientPhone: string; events: { type: string; message: string; at: string }[]; versions: KpSummary[] }
export interface KpItemBody { calculationId: string; title: string; dims: string; about: string; materials: KpMaterial[]; benefits: string[]; imageId: string | null }
export interface Notice { id: number; type: string; text: string; kpId: string | null; clientId: string | null; createdAt: string; read: boolean }
export interface Company {
  name: string; coverTitle: string; addresses: { city: string; lines: string }[]; phone: string; lead: string;
  facts: { big: string; text: string }[]; boxes: { title: string; text: string }[]; includes: string[]; extra: string[]; notIncluded: string;
  warrantyBig: string; warrantyText: string; terms: string[]; payment: string[]; fix: string; steps: string[]; coverImageId: string | null;
}
export interface LinkInfo { name: string; price?: number; currency?: string; image?: string }

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

/** Загрузка картинки телом запроса (PNG, JPG, WebP до 10 МБ). */
async function uploadFile<T>(url: string, file: File): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
  } catch {
    throw new ApiError(0, 'Сервер не отвечает. Проверьте подключение и повторите.', {});
  }
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(await res.text()); } catch { /* не JSON */ }
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, typeof data.error === 'string' ? data.error : res.status === 413 ? 'Картинка больше 10 МБ.' : 'Не удалось загрузить картинку.', data);
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
  createUser: (u: { firstName: string; lastName: string; email: string; role: Role; cityId: number; phone?: string; position?: string }) =>
    request<{ user: UserAdmin; inviteUrl: string }>('POST', '/api/users', u),
  patchUser: (id: string, patch: Partial<{ firstName: string; lastName: string; role: Role; cityId: number; disabled: boolean; phone: string; position: string }>) =>
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

  // картинки и рендер
  images: (calcId: string) => request<{ images: ImageInfo[]; renderEnabled: boolean }>('GET', `/api/calculations/${enc(calcId)}/images`),
  uploadImage: (calcId: string, file: File) => uploadFile<{ image: ImageInfo }>(`/api/calculations/${enc(calcId)}/images`, file),
  patchImage: (id: string, patch: { inKp?: boolean; title?: string }) => request<{ image: ImageInfo }>('PATCH', `/api/images/${enc(id)}`, patch),
  deleteImage: (id: string) => request<object>('DELETE', `/api/images/${enc(id)}`),
  render: (calcId: string, body: { imageId: string; previousId?: string; comment?: string }) =>
    request<{ image: ImageInfo }>('POST', `/api/calculations/${enc(calcId)}/render`, body),
  linkPreview: (url: string) => request<LinkInfo>('POST', '/api/link-preview', { url }),

  // КП
  kpDraft: (clientId: string, base?: string) => request<KpDraft>('GET', `/api/clients/${enc(clientId)}/kp-draft${qs({ base })}`),
  kpText: (calcId: string, body: { title: string; dims: string; materials: KpMaterial[]; benefits: string[] }) =>
    request<{ text: string; source: 'ai' | 'template'; note?: string }>('POST', `/api/calculations/${enc(calcId)}/kp-text`, body),
  kpPreview: (clientId: string, calculationIds: string[]) =>
    request<{ items: { calculationId: string; price: KpItemPrice }[]; totals: KpTotals }>('POST', '/api/kp/preview', { clientId, calculationIds }),
  createKp: (body: { clientId: string; baseKpId?: string; theme: 'dark' | 'light'; validUntil: string; items: KpItemBody[] }) =>
    request<{ kp: KpSummary }>('POST', '/api/kp', body),
  clientKps: (clientId: string) => request<{ kps: KpSummary[] }>('GET', `/api/clients/${enc(clientId)}/kps`),
  kp: (id: string) => request<KpDetail>('GET', `/api/kp/${enc(id)}`),
  kpSent: (id: string, channel: 'link' | 'whatsapp' | 'telegram' | 'pdf') => request<{ kp: KpSummary }>('POST', `/api/kp/${enc(id)}/sent`, { channel }),

  // уведомления
  notifications: () => request<{ items: Notice[]; unread: number }>('GET', '/api/notifications'),
  readNotifications: (ids?: number[]) => request<object>('POST', '/api/notifications/read', ids ? { ids } : {}),

  // компания (постоянная часть КП)
  company: () => request<{ company: Company; rev: number; coverUrl: string | null }>('GET', '/api/company'),
  saveCompany: (rev: number, company: Company) => request<{ company: Company; rev: number; coverUrl: string | null }>('PUT', '/api/company', { rev, company }),
  uploadCover: (file: File) => uploadFile<{ company: Company; rev: number; coverUrl: string | null }>('/api/company/cover', file),
  deleteCover: () => request<{ company: Company; rev: number; coverUrl: string | null }>('DELETE', '/api/company/cover'),

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
