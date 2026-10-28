// База: миграции при старте и стартовое наполнение (города, прайс, настройки, первый владелец).
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DEFAULT_SETTINGS } from '../../engine/src/index.ts';
import type { Catalog } from '../../engine/src/index.ts';
import { hashPassword } from './security.ts';
import { DEFAULT_COMPANY } from './kpdata.ts';

export type Pool = pg.Pool;
export type Db = pg.Pool | pg.PoolClient;

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
export const CATALOG_FILE = fileURLToPath(new URL('../../data/catalog.json', import.meta.url));
export const CITIES = ['Москва', 'Краснодар'];

// Любое число из базы приходит числом (int8 — счётчики, их хватает).
pg.types.setTypeParser(20, (v: string) => Number(v));
// Дата (date) — строкой ГГГГ-ММ-ДД, без сдвига часового пояса.
pg.types.setTypeParser(1082, (v: string) => v);

/**
 * TLS к PostgreSQL (облачная база Timeweb и т. п.): DATABASE_SSL=1/true или sslmode=require (prefer, verify-ca, verify-full)
 * в строке подключения → ssl { rejectUnauthorized: false }. По умолчанию TLS выключен (локальная база, docker compose).
 * sslmode убирается из строки: иначе pg подставит свою проверку сертификата поверх нашей.
 */
export function pgConnection(url: string, sslFlag: string | undefined = process.env.DATABASE_SSL, caPem: string | undefined = process.env.DATABASE_CA): pg.PoolConfig {
  const flag = /^(1|true|yes|on)$/i.test((sslFlag ?? '').trim());
  let connectionString = url, mode = '';
  try {
    const u = new URL(url);
    mode = (u.searchParams.get('sslmode') ?? '').toLowerCase();
    if (mode && mode !== 'disable') {
      u.searchParams.delete('sslmode');
      connectionString = u.toString();
    }
  } catch { /* не URL (например, key=value) — оставляем как есть */ }
  const ssl = flag || ['require', 'prefer', 'verify-ca', 'verify-full'].includes(mode);
  // DATABASE_CA — корневой сертификат базы (PEM, можно с \n вместо переносов): тогда сертификат и имя сервера проверяются,
  // подменить базу «посередине» нельзя. Без него соединение шифруется, но сертификат не проверяется.
  const ca = (caPem ?? '').trim().replace(/\\n/g, '\n');
  if (ssl && ca.startsWith('-----BEGIN')) return { connectionString, ssl: { ca, rejectUnauthorized: true } };
  return ssl ? { connectionString, ssl: { rejectUnauthorized: false } } : { connectionString };
}

export function createPool(connectionString: string, options: pg.PoolConfig = {}): pg.Pool {
  return new pg.Pool({ ...pgConnection(connectionString), max: 10, ...options });
}

/** Транзакция: fn получает клиента, при ошибке — откат. */
export async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Простые SQL-миграции по порядку имён файлов; под advisory-lock, чтобы два экземпляра не применили одно и то же. */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  await tx(pool, async (c) => {
    await c.query('select pg_advisory_xact_lock(482017)');
    await c.query('create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await c.query('select version from schema_migrations')).rows.map((r) => r.version));
    for (const f of files) {
      if (done.has(f)) continue;
      await c.query(await readFile(MIGRATIONS_DIR + f, 'utf8'));
      await c.query('insert into schema_migrations (version) values ($1)', [f]);
      applied.push(f);
    }
  });
  return applied;
}

/** Загружает прайс в пустые таблицы. */
export async function loadCatalog(c: Db, catalog: Catalog): Promise<void> {
  let gi = 0;
  for (const g of catalog.groups) {
    await c.query('insert into catalog_groups (id, category, name, unit, rule, sheet_area, source, sort) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [g.id, g.category, g.name, g.unit, g.rule, g.sheetArea ?? null, g.source ?? null, gi++]);
    let ii = 0;
    for (const it of g.items) {
      await c.query('insert into catalog_items (id, group_id, name, price, status, sort) values ($1,$2,$3,$4,$5,$6)',
        [it.id, g.id, it.name, Number(it.price) || 0, it.status ?? null, ii++]);
    }
  }
  await c.query(`insert into meta (key, value) values ('catalog_version', $1) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify(catalog.version ?? 1)]);
}

export interface SeedEnv { OWNER_EMAIL?: string; OWNER_PASSWORD?: string; OWNER_RESET?: string }

/** Значение переменной без пробелов и обрамляющих кавычек: в панели хостинга их легко вставить вместе со значением. */
const envValue = (v?: string) => (v ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');

export async function seed(pool: pg.Pool, env: SeedEnv, log: (m: string) => void = () => {}): Promise<void> {
  await tx(pool, async (c) => {
    await c.query('select pg_advisory_xact_lock(482018)');
    for (const name of CITIES) await c.query('insert into cities (name) values ($1) on conflict (name) do nothing', [name]);

    const { rows: [{ n }] } = await c.query('select count(*)::int as n from catalog_groups');
    if (n === 0) {
      const catalog = JSON.parse(await readFile(CATALOG_FILE, 'utf8')) as Catalog;
      await loadCatalog(c, catalog);
      log(`Прайс загружен из catalog.json: групп ${catalog.groups.length}`);
    }

    await c.query('insert into settings (id, data) values (1, $1) on conflict (id) do nothing', [JSON.stringify(DEFAULT_SETTINGS)]);
    await c.query('insert into company (id, data) values (1, $1) on conflict (id) do nothing', [JSON.stringify(DEFAULT_COMPANY)]);

    const email = envValue(env.OWNER_EMAIL).toLowerCase();
    const password = envValue(env.OWNER_PASSWORD);
    const valid = !!email && password.length >= 8;
    const owners = await c.query(`select email from users where role = 'owner' order by created_at`);
    // OWNER_RESET=1: аварийный вход — пароль из OWNER_PASSWORD для OWNER_EMAIL (пользователь становится владельцем, старые сессии сбрасываются).
    if (/^(1|true|yes|on)$/i.test(envValue(env.OWNER_RESET)) && owners.rowCount) {
      if (!valid) { log('OWNER_RESET: задайте OWNER_EMAIL и OWNER_PASSWORD (не короче 8 символов).'); return; }
      const hash = await hashPassword(password);
      const { rows: [u] } = await c.query(
        `update users set password_hash = $2, role = 'owner', disabled = false where lower(email) = $1 returning id`, [email, hash]);
      if (u) await c.query('delete from sessions where user_id = $1', [u.id]);
      else await c.query(`insert into users (email, first_name, last_name, role, password_hash) values ($1, 'Владелец', '', 'owner', $2)`, [email, hash]);
      log(`OWNER_RESET: пароль владельца ${email} задан из OWNER_PASSWORD. Уберите OWNER_RESET из переменных.`);
      return;
    }
    if (!owners.rowCount) {
      if (!valid) {
        log('Владельца нет: задайте OWNER_EMAIL и OWNER_PASSWORD (не короче 8 символов) и перезапустите сервер.');
        return;
      }
      await c.query(`insert into users (email, first_name, last_name, role, password_hash) values ($1, 'Владелец', '', 'owner', $2)`,
        [email, await hashPassword(password)]);
      log(`Создан владелец ${email}`);
    } else {
      log(`Владелец уже есть: ${owners.rows.map((r) => r.email).join(', ')} (OWNER_EMAIL и OWNER_PASSWORD больше не применяются; сброс пароля — OWNER_RESET=1)`);
    }
  });
}
