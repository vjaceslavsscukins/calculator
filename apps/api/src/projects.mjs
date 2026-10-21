// Общая база проектов для тестирования. У каждого человека личный код доступа, проекты видны только владельцу.
// Хранилище подключается снаружи: PostgreSQL (DATABASE_URL), файл JSON (PROJECTS_FILE) или память (тесты).
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';

export class ProjectError extends Error { constructor(status, code, extra = {}) { super(code); this.status = status; this.code = code; this.extra = extra; } }

const MAX_NAME = 200;
export const hashCode = code => createHash('sha256').update(String(code)).digest('hex');
export const newCode = () => randomBytes(15).toString('base64url');   // 20 знаков, 120 бит

// Поля, по которым строится список: берём из присланных данных, лишнее отбрасываем.
export function cleanMeta(p) {
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const total = Number.isFinite(+p.total) ? Math.round(+p.total) : 0;
  return { name: str(p.name, MAX_NAME), client: str(p.client, MAX_NAME), order: str(p.order, 40), total };
}
export function checkData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.modules)) throw new ProjectError(400, 'bad_project');
}
const cleanUserName = v => { const n = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 60) : ''; if (!n) throw new ProjectError(400, 'name_required'); return n; };

const brief = r => ({ id: r.id, name: r.name, client: r.client, order: r.order, total: r.total, rev: r.rev, createdAt: r.createdAt, updatedAt: r.updatedAt, updatedBy: r.updatedBy });
const userBrief = u => ({ id: u.id, name: u.name, createdAt: u.createdAt, disabled: !!u.disabledAt });

// Хранилище в памяти; с путём к файлу сохраняется на диск (на бесплатном Render диск стирается при перезапуске, для общей базы нужен PostgreSQL).
export class MemoryStore {
  constructor({ file } = {}) {
    this.file = file; this.rows = new Map(); this.users = new Map();
    if (file && fs.existsSync(file)) {
      try {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const r of Array.isArray(j) ? j : j.projects || []) this.rows.set(r.id, r);
        for (const u of Array.isArray(j) ? [] : j.users || []) this.users.set(u.id, u);
      } catch { /* пустая база */ }
    }
  }
  save() { if (this.file) { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ projects: [...this.rows.values()], users: [...this.users.values()] })); fs.renameSync(tmp, this.file); } }
  // пользователи
  async createUser(name, codeHash) {
    const u = { id: randomUUID(), name, codeHash, createdAt: new Date().toISOString(), disabledAt: null };
    this.users.set(u.id, u); this.save(); return userBrief(u);
  }
  async findUser(codeHash) { for (const u of this.users.values()) if (!u.disabledAt && u.codeHash === codeHash) return { id: u.id, name: u.name }; return null; }
  async listUsers() { return [...this.users.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(userBrief); }
  async setCode(id, codeHash) { const u = this.users.get(id); if (!u) throw new ProjectError(404, 'not_found'); u.codeHash = codeHash; u.disabledAt = null; this.save(); return userBrief(u); }
  async disableUser(id) { const u = this.users.get(id); if (!u) throw new ProjectError(404, 'not_found'); u.disabledAt = new Date().toISOString(); this.save(); }
  // проекты: всё только в пределах владельца, чужой проект выглядит как несуществующий
  mine(id, owner) { const r = this.rows.get(id); return r && !r.deletedAt && r.ownerId === owner ? r : null; }
  async list(owner) { return [...this.rows.values()].filter(r => !r.deletedAt && r.ownerId === owner).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(brief); }
  async get(id, owner) { const r = this.mine(id, owner); return r ? { ...brief(r), data: r.data } : null; }
  async create(meta, data, owner, by) {
    const now = new Date().toISOString(), r = { id: randomUUID(), ...meta, data, rev: 1, createdAt: now, updatedAt: now, updatedBy: by, ownerId: owner };
    this.rows.set(r.id, r); this.save(); return { ...brief(r), data };
  }
  async update(id, owner, rev, meta, data, by) {
    const r = this.mine(id, owner); if (!r) throw new ProjectError(404, 'not_found');
    if (r.rev !== rev) throw new ProjectError(409, 'conflict', { rev: r.rev, updatedAt: r.updatedAt, updatedBy: r.updatedBy });
    Object.assign(r, meta, { data, rev: r.rev + 1, updatedAt: new Date().toISOString(), updatedBy: by }); this.save(); return { ...brief(r), data };
  }
  async remove(id, owner) { const r = this.mine(id, owner); if (!r) throw new ProjectError(404, 'not_found'); r.deletedAt = new Date().toISOString(); this.save(); }
}

// PostgreSQL. Библиотека pg подключается только здесь, чтобы тесты и локальный запуск обходились без неё.
export async function createPgStore(url, { ssl = true } = {}) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 4, ssl: ssl ? { rejectUnauthorized: false } : false });
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY, name text NOT NULL, code_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), disabled_at timestamptz)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY, name text NOT NULL DEFAULT '', client text NOT NULL DEFAULT '', "order" text NOT NULL DEFAULT '', total bigint NOT NULL DEFAULT 0,
    data jsonb NOT NULL, rev integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL DEFAULT '', deleted_at timestamptz, owner_id uuid)`);
  await pool.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id uuid');
  await pool.query('CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects (owner_id, updated_at DESC)');
  const row = r => ({ id: r.id, name: r.name, client: r.client, order: r.order, total: Number(r.total), rev: r.rev, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(), updatedBy: r.updated_by });
  const urow = r => ({ id: r.id, name: r.name, createdAt: r.created_at.toISOString(), disabled: !!r.disabled_at });
  const cols = 'id, name, client, "order", total, rev, created_at, updated_at, updated_by';
  return {
    async createUser(name, codeHash) { const { rows } = await pool.query('INSERT INTO users (id, name, code_hash) VALUES ($1,$2,$3) RETURNING id, name, created_at, disabled_at', [randomUUID(), name, codeHash]); return urow(rows[0]); },
    async findUser(codeHash) { const { rows } = await pool.query('SELECT id, name FROM users WHERE code_hash = $1 AND disabled_at IS NULL', [codeHash]); return rows[0] || null; },
    async listUsers() { return (await pool.query('SELECT id, name, created_at, disabled_at FROM users ORDER BY created_at')).rows.map(urow); },
    async setCode(id, codeHash) { const { rows } = await pool.query('UPDATE users SET code_hash = $2, disabled_at = NULL WHERE id = $1 RETURNING id, name, created_at, disabled_at', [id, codeHash]); if (!rows[0]) throw new ProjectError(404, 'not_found'); return urow(rows[0]); },
    async disableUser(id) { const r = await pool.query('UPDATE users SET disabled_at = now() WHERE id = $1', [id]); if (!r.rowCount) throw new ProjectError(404, 'not_found'); },
    async list(owner) { return (await pool.query(`SELECT ${cols} FROM projects WHERE deleted_at IS NULL AND owner_id = $1 ORDER BY updated_at DESC LIMIT 500`, [owner])).rows.map(row); },
    async get(id, owner) { const { rows } = await pool.query(`SELECT ${cols}, data FROM projects WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`, [id, owner]); return rows[0] ? { ...row(rows[0]), data: rows[0].data } : null; },
    async create(meta, data, owner, by) {
      const { rows } = await pool.query(`INSERT INTO projects (id, name, client, "order", total, data, updated_by, owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${cols}`,
        [randomUUID(), meta.name, meta.client, meta.order, meta.total, JSON.stringify(data), by, owner]);
      return { ...row(rows[0]), data };
    },
    async update(id, owner, rev, meta, data, by) {
      const { rows } = await pool.query(`UPDATE projects SET name=$4, client=$5, "order"=$6, total=$7, data=$8, rev=rev+1, updated_at=now(), updated_by=$9
        WHERE id=$1 AND owner_id=$2 AND rev=$3 AND deleted_at IS NULL RETURNING ${cols}`, [id, owner, rev, meta.name, meta.client, meta.order, meta.total, JSON.stringify(data), by]);
      if (rows[0]) return { ...row(rows[0]), data };
      const cur = await pool.query(`SELECT ${cols} FROM projects WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL`, [id, owner]);
      if (!cur.rows[0]) throw new ProjectError(404, 'not_found');
      const c = row(cur.rows[0]); throw new ProjectError(409, 'conflict', { rev: c.rev, updatedAt: c.updatedAt, updatedBy: c.updatedBy });
    },
    async remove(id, owner) { const r = await pool.query('UPDATE projects SET deleted_at=now() WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL', [id, owner]); if (!r.rowCount) throw new ProjectError(404, 'not_found'); },
  };
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Обработчик маршрутов /projects, /users, /me. Возвращает true, если запрос его.
// adminToken — главный код (переменная PROJECTS_TOKEN): им заводят людей, проектов у него нет.
export function createProjects({ store, adminToken = '', origins = [], maxBody = 2 * 1024 * 1024 }) {
  const adminHash = adminToken && adminToken.length >= 16 ? createHash('sha256').update(adminToken).digest() : null;
  const isAdmin = code => { if (!adminHash) return false; const h = createHash('sha256').update(code).digest(); return timingSafeEqual(h, adminHash); };
  const allowed = origin => !!origin && origins.includes(origin);
  const cors = req => allowed(req.headers.origin)
    ? { 'access-control-allow-origin': req.headers.origin, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-max-age': '600', vary: 'Origin' }
    : { vary: 'Origin' };
  async function readJson(req) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > maxBody) throw new ProjectError(413, 'too_large'); chunks.push(c); }
    if (!n) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ProjectError(400, 'bad_json'); }
  }
  // Кто пришёл: { role: 'admin' } или { role: 'user', id, name }
  async function who(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); if (!m) throw new ProjectError(401, 'unauthorized');
    if (isAdmin(m[1])) return { role: 'admin', name: 'Администратор' };
    const u = await store.findUser(hashCode(m[1])); if (!u) throw new ProjectError(401, 'unauthorized');
    return { role: 'user', id: u.id, name: u.name };
  }

  return async function handle(req, res, url, reply, take) {
    const m = url.pathname.match(/^\/(projects|users|me)(?:\/([^/]+))?(?:\/(code))?$/);
    if (!m) return false;
    const head = cors(req), [, area, id, sub] = m;
    try {
      if (req.method === 'OPTIONS') { reply(res, 204, '', head); return true; }
      if (!store) throw new ProjectError(503, 'projects_not_configured');
      const me = await who(req);
      if (!take()) throw new ProjectError(429, 'rate_limited');
      if (id !== undefined && !ID.test(id)) throw new ProjectError(404, 'not_found');
      let out, code = 200;
      if (area === 'me') { if (id || req.method !== 'GET') throw new ProjectError(405, 'method_not_allowed'); out = { name: me.name, role: me.role }; }
      else if (area === 'users') {
        if (me.role !== 'admin') throw new ProjectError(403, 'admin_only');
        if (!id && req.method === 'GET') out = { users: await store.listUsers() };
        else if (!id && req.method === 'POST') {
          const name = cleanUserName((await readJson(req)).name), plain = newCode(), u = await store.createUser(name, hashCode(plain));
          out = { ...u, code: plain }; code = 201;          // код показывается один раз, в базе только его отпечаток
        } else if (id && sub === 'code' && req.method === 'POST') { const plain = newCode(); out = { ...(await store.setCode(id, hashCode(plain))), code: plain }; }
        else if (id && !sub && req.method === 'DELETE') { await store.disableUser(id); out = { ok: true }; }
        else throw new ProjectError(405, 'method_not_allowed');
      } else {
        if (me.role !== 'user') throw new ProjectError(403, 'admin_has_no_projects');
        if (sub) throw new ProjectError(404, 'not_found');
        if (!id && req.method === 'GET') out = { projects: await store.list(me.id) };
        else if (!id && req.method === 'POST') { const b = await readJson(req); checkData(b.data); out = await store.create(cleanMeta(b), b.data, me.id, me.name); code = 201; }
        else if (id && req.method === 'GET') { out = await store.get(id, me.id); if (!out) throw new ProjectError(404, 'not_found'); }
        else if (id && req.method === 'PUT') {
          const b = await readJson(req); checkData(b.data); if (!Number.isInteger(b.rev)) throw new ProjectError(400, 'rev_required');
          out = await store.update(id, me.id, b.rev, cleanMeta(b), b.data, me.name);
        } else if (id && req.method === 'DELETE') { await store.remove(id, me.id); out = { ok: true }; }
        else throw new ProjectError(405, 'method_not_allowed');
      }
      reply(res, code, out, head);
    } catch (e) {
      if (!(e instanceof ProjectError)) throw e;
      reply(res, e.status, { error: e.code, ...e.extra }, head);
    }
    return true;
  };
}
