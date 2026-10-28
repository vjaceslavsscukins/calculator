# Калькулятор КП: API (договорённость между `api/` и `web/`)

Версия 1, 28.10.2026. Расчёт цены — только в `engine/` (`compute`), сервер вызывает его и отдаёт результат с учётом роли. Интерфейс сам цену не считает.

Все ответы JSON. Ошибки: `{ "error": "текст для человека на русском" }` с кодом 400/401/403/404/409. Деньги — числа в рублях без округления (округляет интерфейс до `settings.roundTo` только при выводе).

## Роли

- `owner` — владелец: всё во всех городах, пользователи, коэффициенты, прайсы.
- `head` — руководитель: всё по своему городу (клиенты и расчёты всех менеджеров города, правит их), прайсы (просмотр и правка цен), журнал. Коэффициенты и пользователей не меняет.
- `manager` — менеджер: свои клиенты и расчёты. **Не получает** себестоимость, производственную цену, маржу, цены прайса и цены подсветки — сервер вырезает их из ответов.

Города: `Москва`, `Краснодар` (таблица, можно добавить). У пользователя и клиента есть `cityId`.

## Вход

Сессия — httpOnly-cookie `kp_session` (SameSite=Lax, Secure в production). Пароли — `crypto.scrypt` с солью. Токен сессии в базе хранится хешем.

- `POST /api/auth/login` `{email, password}` → `{user}`; 401 «Неверная почта или пароль».
- `POST /api/auth/logout` → `{}`.
- `GET /api/auth/me` → `{user}` или 401.
- `GET /api/auth/invite/:token` → `{email, firstName}` (проверка приглашения) или 404.
- `POST /api/auth/invite/accept` `{token, password}` → `{user}` (пароль не короче 8 символов; входит сразу).

`user` = `{id, firstName, lastName, email, role, cityId, cityName}`.

Первый владелец создаётся при старте из `OWNER_EMAIL` и `OWNER_PASSWORD`, если в базе нет ни одного владельца.

## Справочники

- `GET /api/meta` → `{kinds: [{id:'kitchen', title}, {id:'cabinet', title}], blocks: BLOCKS (из engine), cities: [{id, name}]}`.
- `GET /api/settings` → owner/head: весь `Settings` (из engine) + `rev`; manager: `{deliveryPct, roundTo, light: {tape: {name}, profiles: [{id,name}], switches: [{id,name}]}}`.
- `PUT /api/settings` (owner) `{rev, settings}` → `{settings, rev}`; 409 при чужой правке. Запись в журнал.

## Пользователи (owner)

- `GET /api/users` → `{users: [{...user, disabled, invited}]}` (`invited` — пароль ещё не задан).
- `POST /api/users` `{firstName, lastName, email, role, cityId}` → `{user, inviteUrl}`. Письма пока не отправляем: владелец копирует ссылку `/invite/<token>` и пересылает человеку. Срок приглашения 7 дней.
- `PATCH /api/users/:id` `{firstName?, lastName?, role?, cityId?, disabled?}` → `{user}`. Себя нельзя отключить или лишить роли владельца.
- `POST /api/users/:id/invite` → `{inviteUrl}` — новая ссылка (сброс пароля).

## Клиенты

Видимость: manager — где `managerId = он`; head — где `cityId` его города; owner — все. Чужой клиент выглядит как несуществующий (404).

- `GET /api/clients?q=` → `{clients: [{id, name, phone, cityId, cityName, managerId, managerName, calcCount, updatedAt}]}` (поиск по имени и телефону, новые сверху).
- `POST /api/clients` `{name, phone, cityId?}` → `{client}`; менеджер = текущий пользователь, город по умолчанию — его. Имя и телефон обязательны.
- `GET /api/clients/:id` → `{client, calculations: [CalcSummary]}`.
- `PATCH /api/clients/:id` `{name?, phone?, cityId?, managerId?}` (managerId и cityId — head/owner).

## Расчёты

`CalcSummary` = `{id, clientId, clientName, title, kind, status, total, managerName, cityName, updatedAt}`; `total` — итог клиенту.
Статусы: `draft` (черновик), `saved` (сохранён), `in_kp` (в КП), `kp_sent` (КП отправлено), `contract` (договор), `archived`.

- `GET /api/calculations?status=&q=` → `{calculations: [CalcSummary]}` (видимость как у клиентов).
- `POST /api/calculations` `{clientId, title, kind}` → `{calculation, view}` (пустой расчёт: `rows: []`, подсветка выключена, скидка 0).
- `GET /api/calculations/:id` → `{calculation, view}`.
- `PUT /api/calculations/:id` `{rev, title?, status?, input, unparsed}` → `{calculation, view}`; 409 `{error, rev, updatedAt, updatedBy}`, если расчёт уже изменили (не затирать). Сервер пересчитывает `view` и хранит итог для реестра.
- `POST /api/calculations/:id/copy` → `{calculation, view}` (новый расчёт «… (копия)» у того же клиента).
- `POST /api/compute` `{input}` → `{view}` — пересчёт без сохранения (для мгновенного отклика при наборе).
- `POST /api/pro100/parse` `{kind, text, rows?}` → `{rows, unparsed, skipped}`: `parsePro100` + `applyPro100` (по умолчанию — последняя позиция, выбранная этим пользователем для такой строки PRO100) + `mergePro100` с существующими `rows`.

`calculation` = `{id, clientId, clientName, title, kind, status, rev, input: CalcInput, unparsed: Pro100Line[], updatedAt, updatedBy}`.

`view` = `CalcResult` из engine; для manager из него удалены: у строк `unitCost`, `cost`, `prod`, `costNote`; на верхнем уровне `cost`, `prod`, `margin`, `costByGroup`. У строк подсветки для manager остаются только `name`, `unit`, `qty`, `retail`.

## Прайс

- `GET /api/catalog` → `{version, groups: [{id, category, name, unit, rule, sheetArea?, source?, items: [{id, name, status?, price?}]}]}`; `price` только для head/owner. Позиции со `status` видны в списке, но интерфейс не предлагает их для новых строк.
- `PATCH /api/catalog/items/:id` (head/owner) `{price?, name?, status?: string|null}` → `{item}`; запись в журнал (было → стало).
- `POST /api/catalog/groups/:id/items` (head/owner) `{name, price}` → `{item}`.
- Загрузка Excel-прайса с экраном проверки — следующая итерация (`kp-calc/data/import_egger.py` — образец логики).
- Стартовое наполнение: при пустой базе сервер загружает `kp-calc/data/catalog.json`.

## Журнал (owner, head)

- `GET /api/audit?limit=200` → `{entries: [{at, userName, action, entity, details}]}` — изменения цен, коэффициентов, пользователей.

## Прочее

- `GET /healthz` → `ok`.
- В production сервер отдаёт собранный интерфейс из `web/dist` (SPA: неизвестные пути → `index.html`).
- Переменные окружения: `DATABASE_URL`, `OWNER_EMAIL`, `OWNER_PASSWORD`, `PUBLIC_URL` (для ссылок-приглашений), `PORT` (по умолчанию 8787), `NODE_ENV`.
