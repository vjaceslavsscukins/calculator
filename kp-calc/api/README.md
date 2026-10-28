# Калькулятор КП: сервер

Fastify 5 + PostgreSQL. Договорённость с интерфейсом — `../docs/api.md` (там же раздел «Уточнения сервера»).
Цена считается только в `../engine` (`compute`); сервер хранит данные, проверяет доступ по роли и городу и вырезает себестоимость из ответов менеджеру.

TypeScript запускается напрямую (Node ≥ 22.18, встроенное снятие типов), сборки нет. Синтаксис — только «стираемый»: без `enum`, `namespace`, parameter properties; импорты с расширением `.ts`.

## Запуск локально

```bash
cd kp-calc/api
npm ci
DATABASE_URL=postgres://user:pass@127.0.0.1:5432/kp \
OWNER_EMAIL=owner@example.com OWNER_PASSWORD=owner12345 \
npm start            # http://localhost:8787, /healthz → ok
```

При старте сервер сам:
- применяет миграции `src/migrations/*.sql` (таблица `schema_migrations`);
- заводит города Москва и Краснодар;
- если прайс пуст — загружает `kp-calc/data/catalog.json`;
- если настроек нет — берёт `DEFAULT_SETTINGS` из движка;
- если владельца нет — создаёт его из `OWNER_EMAIL` / `OWNER_PASSWORD`.

Целиком в контейнерах (из папки `kp-calc`): `cp .env.example .env`, заполнить, `docker compose up --build`.

## Переменные окружения

| Переменная | Что это |
|---|---|
| `DATABASE_URL` | строка подключения к PostgreSQL (обязательно) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | подключение к базе по частям вместо `DATABASE_URL` (пароль со спецсимволами кодировать не нужно) |
| `DATABASE_SSL` | `1` или `true` — подключаться к PostgreSQL по TLS (облачная база Timeweb). Сертификат сервера не проверяется (`rejectUnauthorized: false`). По умолчанию выключено. TLS включается и сам, если в `DATABASE_URL` есть `sslmode=require` |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | первый владелец, если в базе нет ни одного (пароль ≥ 8 символов) |
| `PUBLIC_URL` | адрес портала для ссылок-приглашений (`<PUBLIC_URL>/invite/<token>`); без него — адрес запроса |
| `PORT` | порт, по умолчанию 8787; `HOST` — по умолчанию 0.0.0.0 |
| `NODE_ENV` | `production`: cookie с флагом Secure и раздача интерфейса из `kp-calc/web/dist` (SPA) |
| `WEB_DIST` | другой путь к собранному интерфейсу (необязательно) |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_PREFIX` | S3-совместимое хранилище картинок (Timeweb: `https://s3.timeweb.cloud`, регион `ru-1`). Без них картинки хранятся в PostgreSQL (`image_blobs`) |
| `RENDER_PROVIDER`, `RENDER_API_URL`, `RENDER_API_KEY`, `RENDER_MODEL` | рендер по эскизу через OpenAI-совместимый шлюз (AITunnel, OpenRouter): `openai-compatible`, адрес `…/v1`, ключ, модель картинок (например Gemini image / Nano Banana). Без ключа кнопка отвечает «Рендер не подключён» |
| `AI_TEXT_API_URL`, `AI_TEXT_API_KEY`, `AI_TEXT_MODEL` | текст «Об изделии» нейросетью; без них — шаблонный текст по материалам |
| `LINK_PREVIEW_ALLOW_PRIVATE` | `1` — разрешить «подтягивание по ссылке» с локальных адресов. **Только для тестов**, в production не задавать (защита от SSRF) |
| `KP_DEBUG` | `1` — печатать полный текст ошибок 500 в stderr (отладка) |

Секретов в коде и в репозитории нет: всё из окружения (ключи нейросетей и S3 в браузер не попадают). Персональные данные клиентов (имя, телефон) хранятся только в PostgreSQL на сервере в России (152-ФЗ); в журнал запросов пишется путь без строки поиска.

## Тесты

`node:test`, против настоящего PostgreSQL. Каждый запуск создаёт свою схему `test_<случайно>` и удаляет её в конце — данные в базе не трогаются.

```bash
DATABASE_URL=postgres://user:pass@127.0.0.1:5432/kp_test npm test
```

Без `DATABASE_URL` тесты сервера пропускаются с сообщением. Тесты движка: `cd ../engine && npm test`.

## Устройство

- `src/server.ts` — точка входа (env, миграции, сиды, запуск);
- `src/app.ts` — маршруты API, сессии, проверки доступа;
- `src/view.ts` — приведение входа расчёта, вырезание себестоимости для менеджера, проверка настроек;
- `src/db.ts` — пул, миграции, стартовое наполнение;
- `src/security.ts` — пароли (scrypt с солью), токены (в базе — только sha256);
- `src/kp.ts` — этап 2: картинки, рендер, ссылки с сайтов, сборка КП (снимок), страница `/p/:token`, отправка, уведомления, компания;
- `src/kppage.ts` — HTML страницы КП (макет `mockups/kp-example.html`, печать A4 альбомная); `src/kpdata.ts` — данные компании и форма снимка;
- `src/storage.ts` — хранилище картинок (S3 или PostgreSQL); `src/ai.ts` — нейросети (рендер, текст), разбор ответов шлюза;
- `src/linkpreview.ts` — скачивание страницы товара с защитой от SSRF и разбор JSON-LD / og.

Ссылка на КП для клиента — `<PUBLIC_URL>/p/<token>` (токен 43 символа, без входа). Эндпоинты — `../docs/api.md`, раздел «Этап 2».
