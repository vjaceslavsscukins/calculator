// Общая база проектов для тестирования: список, создание, чтение, сохранение с проверкой версии, удаление.
// Хранилище подключается снаружи: PostgreSQL (DATABASE_URL), файл JSON (PROJECTS_FILE) или память (тесты).
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';

export class ProjectError extends Error { constructor(status, code, extra = {}) { super(code); this.status = status; this.code = code; this.extra = extra; } }

const MAX_NAME = 200;
// Поля, по которым строится список: берём из присланных данных, лишнее отбрасываем.
export function cleanMeta(p) {
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const total = Number.isFinite(+p.total) ? Math.round(+p.total) : 0;
  return { name: str(p.name, MAX_NAME), client: str(p.client, MAX_NAME), order: str(p.order, 40), total };
}
export function checkData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.modules)) throw new ProjectError(400, 'bad_project');
}

const brief = r => ({ id: r.id, name: r.name, client: r.client, order: r.order, total: r.total, rev: r.rev, createdAt: r.createdAt, updatedAt: r.updatedAt, updatedBy: r.updatedBy });

// Хранилище в памяти; с путём к файлу сохраняется на диск (на бесплатном Render диск стирается при перезапуске, для общей базы нужен PostgreSQL).
export class MemoryStore {
  constructor({ file } = {}) {
    this.file = file; this.rows = new Map();
    if (file && fs.existsSync(file)) { try { for (const r of JSON.parse(fs.readFileSync(file, 'utf8'))) this.rows.set(r.id, r); } catch { /* пустая база */ } }
  }
  save() { if (this.file) { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify([...this.rows.values()])); fs.renameSync(tmp, this.file); } }
  async list() { return [...this.rows.values()].filter(r => !r.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(brief); }
  async get(id) { const r = this.rows.get(id); return r && !r.deletedAt ? { ...brief(r), data: r.data } : null; }
  async create(meta, data, by) {
    const now = new Date().toISOString(), r = { id: randomUUID(), ...meta, data, rev: 1, createdAt: now, updatedAt: now, updatedBy: by };
    this.rows.set(r.id, r); this.save(); return { ...brief(r), data };
  }
  async update(id, rev, meta, data, by) {
    const r = this.rows.get(id); if (!r || r.deletedAt) throw new ProjectError(404, 'not_found');
    if (r.rev !== rev) throw new ProjectError(409, 'conflict', { rev: r.rev, updatedAt: r.updatedAt, updatedBy: r.updatedBy });
    Object.assign(r, meta, { data, rev: r.rev + 1, updatedAt: new Date().toISOString(), updatedBy: by }); this.save(); return { ...brief(r), data };
  }
  async remove(id) { const r = this.rows.get(id); if (!r || r.deletedAt) throw new ProjectError(404, 'not_found'); r.deletedAt = new Date().toISOString(); this.save(); }
}

// PostgreSQL. Библиотека pg подключается только здесь, чтобы тесты и локальный запуск обходились без неё.
export async function createPgStore(url, { ssl = true } = {}) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 4, ssl: ssl ? { rejectUnauthorized: false } : false });
  await pool.query(`CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY, name text NOT NULL DEFAULT '', client text NOT NULL DEFAULT '', "order" text NOT NULL DEFAULT '', total bigint NOT NULL DEFAULT 0,
    data jsonb NOT NULL, rev integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL DEFAULT '', deleted_at timestamptz)`);
  const row = r => ({ id: r.id, name: r.name, client: r.client, order: r.order, total: Number(r.total), rev: r.rev, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(), updatedBy: r.updated_by });
  const cols = 'id, name, client, "order", total, rev, created_at, updated_at, updated_by';
  return {
    async list() { return (await pool.query(`SELECT ${cols} FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500`)).rows.map(row); },
    async get(id) { const { rows } = await pool.query(`SELECT ${cols}, data FROM projects WHERE id = $1 AND deleted_at IS NULL`, [id]); return rows[0] ? { ...row(rows[0]), data: rows[0].data } : null; },
    async create(meta, data, by) {
      const { rows } = await pool.query(`INSERT INTO projects (id, name, client, "order", total, data, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${cols}`,
        [randomUUID(), meta.name, meta.client, meta.order, meta.total, JSON.stringify(data), by]);
      return { ...row(rows[0]), data };
    },
    async update(id, rev, meta, data, by) {
      const { rows } = await pool.query(`UPDATE projects SET name=$3, client=$4, "order"=$5, total=$6, data=$7, rev=rev+1, updated_at=now(), updated_by=$8
        WHERE id=$1 AND rev=$2 AND deleted_at IS NULL RETURNING ${cols}`, [id, rev, meta.name, meta.client, meta.order, meta.total, JSON.stringify(data), by]);
      if (rows[0]) return { ...row(rows[0]), data };
      const cur = await pool.query(`SELECT ${cols} FROM projects WHERE id=$1 AND deleted_at IS NULL`, [id]);
      if (!cur.rows[0]) throw new ProjectError(404, 'not_found');
      const c = row(cur.rows[0]); throw new ProjectError(409, 'conflict', { rev: c.rev, updatedAt: c.updatedAt, updatedBy: c.updatedBy });
    },
    async remove(id) { const r = await pool.query('UPDATE projects SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL', [id]); if (!r.rowCount) throw new ProjectError(404, 'not_found'); },
  };
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Обработчик маршрутов /projects. Возвращает true, если запрос его.
export function createProjects({ store, tokens = [], origins = [], maxBody = 2 * 1024 * 1024 }) {
  const hashes = tokens.filter(Boolean).map(t => createHash('sha256').update(t).digest());
  const okToken = req => { const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); if (!m) return false; const h = createHash('sha256').update(m[1]).digest(); return hashes.some(x => timingSafeEqual(h, x)); };
  const allowed = origin => !!origin && origins.includes(origin);
  const cors = req => allowed(req.headers.origin)
    ? { 'access-control-allow-origin': req.headers.origin, 'access-control-allow-headers': 'authorization, content-type, x-author', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-max-age': '600', vary: 'Origin' }
    : { vary: 'Origin' };
  async function readJson(req) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > maxBody) throw new ProjectError(413, 'too_large'); chunks.push(c); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ProjectError(400, 'bad_json'); }
  }
  const author = req => { try { return decodeURIComponent(String(req.headers['x-author'] || '')).slice(0, 60); } catch { return ''; } };

  // ctx.reply(res, code, body, headers) — функция ответа сервера
  return async function handle(req, res, url, reply, take) {
    const m = url.pathname.match(/^\/projects(?:\/([^/]+))?$/);
    if (!m) return false;
    const head = cors(req);
    try {
      if (req.method === 'OPTIONS') { reply(res, 204, '', head); return true; }
      if (!store) throw new ProjectError(503, 'projects_not_configured');
      if (!okToken(req)) throw new ProjectError(401, 'unauthorized');
      if (!take()) throw new ProjectError(429, 'rate_limited');
      const id = m[1];
      if (id !== undefined && !ID.test(id)) throw new ProjectError(404, 'not_found');
      let out;
      if (!id && req.method === 'GET') out = { projects: await store.list() };
      else if (!id && req.method === 'POST') {
        const b = await readJson(req); checkData(b.data);
        out = await store.create(cleanMeta(b), b.data, author(req));
      } else if (id && req.method === 'GET') { out = await store.get(id); if (!out) throw new ProjectError(404, 'not_found'); }
      else if (id && req.method === 'PUT') {
        const b = await readJson(req); checkData(b.data); if (!Number.isInteger(b.rev)) throw new ProjectError(400, 'rev_required');
        out = await store.update(id, b.rev, cleanMeta(b), b.data, author(req));
      } else if (id && req.method === 'DELETE') { await store.remove(id); out = { ok: true }; }
      else throw new ProjectError(405, 'method_not_allowed');
      reply(res, req.method === 'POST' ? 201 : 200, out, head);
    } catch (e) {
      if (!(e instanceof ProjectError)) throw e;
      reply(res, e.status, { error: e.code, ...e.extra }, head);
    }
    return true;
  };
}
