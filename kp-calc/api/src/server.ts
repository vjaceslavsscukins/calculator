// Точка входа: миграции, стартовое наполнение, HTTP-сервер. Ключи и пароли — только из переменных окружения.
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { createPool, migrate, seed } from './db.ts';

const env = process.env;
// Подключение к базе: либо одной строкой DATABASE_URL, либо по частям DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME —
// так пароль со спецсимволами (@ : / # ?) не нужно кодировать вручную.
if (!env.DATABASE_URL && env.DB_HOST) {
  const enc = encodeURIComponent;
  env.DATABASE_URL = `postgresql://${enc(env.DB_USER ?? '')}:${enc(env.DB_PASSWORD ?? '')}@${env.DB_HOST.trim()}:${env.DB_PORT || 5432}/${enc(env.DB_NAME || 'default_db')}`;
}
if (!env.DATABASE_URL) {
  console.error('Не задано подключение к базе: DATABASE_URL или DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
  process.exit(1);
}
const production = env.NODE_ENV === 'production';
const pool = createPool(env.DATABASE_URL, { connectionTimeoutMillis: 15000 });

// Пишем в журнал каждый шаг запуска: если база недоступна, причина видна в логах платформы, а не «зависший» старт.
let dbHost = '?';
try { dbHost = new URL(env.DATABASE_URL).host || '?'; } catch { dbHost = 'строка DATABASE_URL не разбирается — проверьте её или задайте DB_HOST, DB_USER, DB_PASSWORD, DB_NAME'; }
console.log(`Подключение к базе ${dbHost}…`);
try {
  await pool.query('select 1');
  console.log('База доступна, применяю миграции…');
  const applied = await migrate(pool);
  if (applied.length) console.log(`Миграции применены: ${applied.join(', ')}`);
  await seed(pool, env, (m) => console.log(m));
} catch (e) {
  const err = e as Error & { code?: string };
  console.error(`Не удалось подготовить базу (${dbHost}): ${err.code ? err.code + ' ' : ''}${err.message}`);
  console.error('Проверьте DATABASE_URL (пользователь, пароль, хост, имя базы), DATABASE_SSL и доступ к базе из интернета.');
  process.exit(1);
}

const app = await buildApp({
  pool,
  production,
  publicUrl: env.PUBLIC_URL,
  webDist: env.WEB_DIST || fileURLToPath(new URL('../../web/dist', import.meta.url)),
  logger: true,
});

const port = Number(env.PORT) || 8787;
await app.listen({ port, host: env.HOST || '0.0.0.0' });

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, async () => {
    await app.close().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  });
}
