// Точка входа: миграции, стартовое наполнение, HTTP-сервер. Ключи и пароли — только из переменных окружения.
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { createPool, migrate, seed } from './db.ts';

const env = process.env;
if (!env.DATABASE_URL) {
  console.error('Не задан DATABASE_URL (строка подключения к PostgreSQL)');
  process.exit(1);
}
const production = env.NODE_ENV === 'production';
const pool = createPool(env.DATABASE_URL);

const applied = await migrate(pool);
if (applied.length) console.log(`Миграции применены: ${applied.join(', ')}`);
await seed(pool, env, (m) => console.log(m));

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
