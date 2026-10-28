# Калькулятор КП: API (договорённость между `api/` и `web/`)

Версия 2, 28.10.2026 (изменения — в конце, разделы «Версия 2» и «Этап 2»). Расчёт цены — только в `engine/` (`compute`), сервер вызывает его и отдаёт результат с учётом роли. Интерфейс сам цену не считает.

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
- `GET /api/settings` → owner/head: весь `Settings` (из engine) + `rev`; manager: `{montagePct, deliveryDefaultRub, roundTo, light: {tape: {name}, profiles: [{id,name}], switches: [{id,name}]}}`. Старые настройки сервер приводит к новой форме (`normalizeSettings` движка): `deliveryPct` → `montagePct`, `deliveryDefaultRub` = 0, выключатель `none` первым.
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
- `POST /api/calculations` `{clientId, title, kind}` → `{calculation, view}` (пустой расчёт: `rows: []`, подсветка выключена, скидка 0, доставка по умолчанию).
- `GET /api/calculations/:id` → `{calculation, view}`.
- `PUT /api/calculations/:id` `{rev, title?, status?, input, unparsed}` → `{calculation, view}`; 409 `{error, rev, updatedAt, updatedBy}`, если расчёт уже изменили (не затирать). Сервер пересчитывает `view` и хранит итог для реестра.
- `POST /api/calculations/:id/copy` → `{calculation, view}` (новый расчёт «… (копия)» у того же клиента).
- `POST /api/compute` `{input}` → `{view}` — пересчёт без сохранения (для мгновенного отклика при наборе).
- `POST /api/pro100/parse` `{kind, text, rows?}` → `{rows, unparsed, skipped}`: `parsePro100` + `applyPro100` (по умолчанию — последняя позиция, выбранная этим пользователем для такой строки PRO100) + `mergePro100` с существующими `rows`.

`calculation` = `{id, clientId, clientName, title, kind, status, rev, input: CalcInput, unparsed: Pro100Line[], updatedAt, updatedBy}`.

`view` = `CalcResult` из engine (в т. ч. `montage` — монтаж, `delivery` — доставка, `total` = мебель со скидкой + монтаж + доставка; `margin` — без монтажа и доставки); для manager из него удалены: у строк `unitCost`, `cost`, `prod`, `costNote`; на верхнем уровне `cost`, `prod`, `margin`, `costByGroup`. У строк подсветки для manager остаются только `name`, `unit`, `qty`, `retail`.

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
- Переменные окружения: `DATABASE_URL`, `OWNER_EMAIL`, `OWNER_PASSWORD`, `PUBLIC_URL` (для ссылок-приглашений), `PORT` (по умолчанию 8787), `NODE_ENV`, `DATABASE_SSL` (1/true — TLS к PostgreSQL).

## Уточнения сервера

Дописано при реализации `api/` (28.10.2026). Где договорённость молчала — решено так:

- **Ошибки.** 401 «Войдите в систему» на любой `/api/*` без сессии (кроме входа и приглашений); 403 «Недостаточно прав» — роль не та; 429 — больше 10 неудачных входов на одну почту за 15 минут. Тело запроса — JSON до 1 МБ; пустое тело с `Content-Type: application/json` считается `{}`.
- **Сессия** живёт 30 дней. Отключение пользователя и установка пароля по приглашению закрывают все его сессии.
- **`user.cityId` владельца** может быть `null`. Клиента владелец без города заводит в первом городе (Москва), если не передал `cityId`. Менеджер и руководитель всегда заводят клиента в своём городе (`cityId` из тела для них игнорируется).
- **`POST /api/users`**: для `head` и `manager` город обязателен, для `owner` — нет; почта уникальна без учёта регистра (409). Новая ссылка (`/invite`) гасит прежние. В ответах `GET/POST/PATCH /api/users` у пользователя есть `disabled` и `invited`.
- **`PATCH /api/clients/:id`**: менеджер меняет только имя и телефон (смена `cityId`/`managerId` → 403). Руководитель — только в пределах своего города и только на пользователя своего города. Назначить отключённого нельзя (400). После передачи клиента ответ возвращается, даже если автор правки его больше не видит.
- **Клиент в ответах** — как в списке, плюс `createdAt`.
- **`GET /api/calculations`** без `status` отдаёт всё, кроме `archived`; `status=all` — всё; поиск `q` — по названию расчёта и имени клиента. Видимость расчёта — по его клиенту (менеджер клиента, город клиента).
- **`calculation.updatedBy`** и `updatedBy` в 409 — имя и фамилия пользователя строкой (или `null`).
- **`PUT /api/calculations/:id`**: `rev` обязателен (целое). `input`, `unparsed`, `title`, `status` — необязательны, не переданное остаётся как было. `input.kind` всегда берётся из расчёта (вид изделия не меняется). Строки и подсветка приводятся к типам engine (не больше 500 строк). При сохранении сервер запоминает для пользователя позицию прайса у каждой строки с `pro100` и `itemId` — это умолчание для следующей вставки.
- **Итог для реестра** (`total`, а также себестоимость, маржа и суммы по группам для будущей сводки) сохраняется при создании, сохранении и копировании. `GET /api/calculations/:id` пересчитывает `view` по текущему прайсу; итог в реестре обновится при следующем сохранении. Снимок цен для КП — следующая итерация (КП).
- **Копия** — статус `draft`, тот же клиент, те же `input` и `unparsed`.
- **`POST /api/compute`**: вид изделия — `input.kind` (обязателен).
- **`POST /api/pro100/parse`**: умолчание не подставляется, если позиция снята с прайса (`status`) или удалена. Текст вставки — до 200 000 символов.
- **Вырезание для менеджера**: у строк подсветки остаются `id`, `block`, `name`, `unit`, `qty`, `retail` (`id` и `block` нужны интерфейсу для ключей и группировки). Те же правила применяются к `view.light.rows`. `calculation.input` отдаётся как есть: цена в свободной строке (`own.price`, цена закупки) — это ввод самого менеджера, без неё он не сможет пересохранить расчёт.
- **`GET /api/catalog`**: `version` растёт на 1 при каждой правке прайса — интерфейс может по ней сбрасывать кэш. Новая позиция получает `id` вида `<группа>-<8 символов>`.
- **`PATCH /api/catalog/items/:id`**: `price` — число ≥ 0; `status: null` или пустая строка возвращают позицию в выбор.
- **`PUT /api/settings`**: передаётся весь `Settings`; все числа ≥ 0, наценки, отходы, площадь листа, шаг округления и напряжение ленты — больше 0. В журнал пишутся изменённые ключи «было → стало».
- **Журнал** пишет: изменения цен и позиций прайса, новые позиции, настройки (коэффициенты и подсветка), добавление, изменение и отключение пользователей, новые ссылки-приглашения. Правки расчётов в журнал пока не пишутся. Руководитель видит весь журнал.
- **Неизвестный `/api/...`** → 404 `{error}` (после входа). Неизвестный путь без расширения в production → `index.html`.

## Запросы интерфейса к серверу

От `web/` (28.10.2026). Новых эндпоинтов интерфейс не придумывал; в интерфейсе стоят заглушки.

- **Собрать КП** — сделано на этапе 2 (раздел «Этап 2»).
- **Загрузка Excel-прайса** — кнопка «Загрузить Excel» на экране «Прайсы» неактивна с подписью «скоро» (по этому документу это следующая итерация).
- **Уточнить в документе:** `id` пользователей, клиентов и городов — числа, а не строки (интерфейс шлёт `cityId` числом). У владельца, созданного из `OWNER_EMAIL`, `cityId` и `cityName` равны `null`: интерфейс в этом случае подставляет первый город из `/api/meta`.
- **Желательно:** снятие позиции с продажи (`status`) в интерфейсе прайса пока не выведено: показывается только текст пометки. PATCH для этого уже есть, сделаем кнопку по запросу владельца.

## Версия 2 (правки владельца, 28.10.2026)

Расчёт по-прежнему только в `engine/`. Новые поля:

- **Задняя стенка «в цвет корпуса».** `Row.linkTo` — `id` строки расчёта, где выбран ЛДСП корпуса (группа категории «ЛДСП корпус»). Цена за м², единица и название (`В цвет корпуса: <группа>: <позиция>`) берутся от позиции той строки, количество — своё; `costGroup` = «ЛДСП корпус». Источник не найден или в нём не ЛДСП → предупреждение и себестоимость 0. `linkTo` важнее `itemId`. Интерфейс предлагает это в строке ХДФ (PRO100 `ХДФ` или группа «ХДФ (задняя стенка)»).
- **Блок «Ссылки с сайтов»** (`id: 'web'`, кухня и шкаф, после «Свободные строки»). Строка: `Row.web = {url, name, price, unit: 'шт'}` (`price` — цена закупки за штуку), `qty`. Наценки обычные, `costGroup` = «Покупное по ссылкам». `url` — только `http(s)://`, иначе сервер сохраняет пустую строку. `web.price` в `calculation.input` менеджер видит (это его ввод), себестоимость в `view` — по правилам роли.
- **Без наценки.** `Row.noMarkup?: boolean` у свободной строки (`own`) и ссылки (`web`): `prod = retail = cost`. У строк прайса флаг не действует. Менять может только head/owner: при `PUT` от менеджера сервер берёт прежнее значение у строк с тем же `id` и `false` у новых. В `calculation.input` признак отдаётся всем (это не цена).
- **Подсветка.** `LightSegment.profileId?` — профиль зоны; без него — `LightInput.profileId` (профиль по умолчанию для новых зон и старых расчётов). Строки профиля: одна на тип, `id` = `light-profile-<id>`, количество — сумма длин. Выключатель `none` — «Нет (подключение напрямую к слаботочке)»: есть в настройках всегда, цена 0, `PUT /api/settings` не даёт его удалить или изменить. Зоны с `none` не дают ни выключателя, ни мощности для блока питания; лента и профиль считаются по всем зонам. `LightResult.directM` — длина зон «напрямую», `watt` — мощность только зон с выключателем.
- **Монтаж и доставка раздельно.** `Settings.montagePct` (по умолчанию 10, % от розницы мебели) и `Settings.deliveryDefaultRub` (по умолчанию 0) вместо `deliveryPct`. `CalcInput.deliveryRub?: number | null` — доставка суммой в расчёте (`null`/нет — `deliveryDefaultRub`; 0 — без доставки). Скидка на монтаж и доставку не действует. В реестре (`totals`) сохраняются `montage` и `delivery`.
- **PRO100: мелкий крепёж молча пропускается** (`PRO100_IGNORED` в `engine/src/pro100.ts`: Евровинт, Полкодержатель, Ножка, Саморез, Конфирмат, Шкант, Стяжка, Заглушка, Минификс, Эксцентрик, Дюбель, Шуруп, Гвоздь — по началу названия, без учёта регистра, пробелов и подчёркиваний): не попадает ни в строки, ни в `unparsed`.
- **Прайс.** Группа «Крепёж (крабы)» переименована в «Навесы для подвесных шкафов» (шт), добавлена позиция «Усиленный навес» 800 ₽ (миграция `002_…sql` для существующей базы, `data/catalog.json` для новой). Строка PRO100 `Комплект_крабов` по-прежнему идёт в «Фурнитуру».
- **Миграция `002`** переводит сохранённые настройки: `deliveryPct` → `montagePct`, `deliveryDefaultRub` = 0, выключатель `none` первым.
- **TLS к PostgreSQL:** `DATABASE_SSL=1` (или `sslmode=require` в `DATABASE_URL`) → `ssl: {rejectUnauthorized: false}`; по умолчанию выключено.

## Этап 2: картинки, рендер, ссылки с сайтов, КП, страница по ссылке, уведомления (28.10.2026)

Цены КП — только из `engine/` (`kpItemPrice`, `kpTotals`, `engine/src/kp.ts`); там же `kpMaterials` (список «Материалы и комплектация» по строкам расчёта) и `kpBenefits` (плашки). КП хранит **снимок** (цены, тексты, картинки, данные компании и менеджера) и после формирования не меняется; правка — новая версия. Миграция `003_kp.sql`.

### Пользователь
`user` дополнен полями `phone` и `position` (для блока «Ваш персональный менеджер» в КП). `POST /api/users` и `PATCH /api/users/:id` (владелец) принимают `phone`, `position`.

### Настройки
`Settings.renderPrompt` — базовый промт рендера (правит владелец в «Коэффициенты → Рендер по эскизу»; пусто → промт по умолчанию из движка). Менеджеру не отдаётся.

### Картинки расчёта
`image` = `{id, kind: 'sketch'|'render'|'cover', title, mime, size, inKp, createdAt, url}`.
- `GET /api/calculations/:id/images` → `{images, renderEnabled}`.
- `POST /api/calculations/:id/images` — тело запроса = файл (`Content-Type: image/png|image/jpeg|image/webp`, до 10 МБ, тип проверяется по первым байтам), имя — заголовок `X-File-Name` (urlencoded) → `{image}`. 400 — не картинка, 413 — больше 10 МБ.
- `GET /api/images/:id` → байты (доступ — по видимости клиента расчёта; фото обложки — всем вошедшим).
- `PATCH /api/images/:id` `{inKp?, title?}` → `{image}`; `DELETE /api/images/:id` — скрыть из расчёта (в сформированных КП картинка остаётся).
- Хранилище: если заданы `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (+ `S3_REGION`, `S3_PREFIX`) — S3-совместимое (Timeweb, `@aws-sdk/client-s3`, path-style), иначе таблица `image_blobs` (bytea). У картинки запоминается, где она лежит.

### Рендер по эскизу
- `POST /api/calculations/:id/render` `{imageId, previousId?, comment?}` → `{image}` («Рендер N», `inKp: false` — какую взять в КП, отмечает менеджер). Промт: `Settings.renderPrompt` + изделие + «Материалы и комплектация» + «Что поправить: comment». `previousId` (перегенерация) — предыдущий рендер прикладывается вторым изображением. В журнал: «Рендер по эскизу» / «Перегенерация рендера» (кто, расчёт, клиент, комментарий).
- Провайдер: `RENDER_PROVIDER=openai-compatible` (по умолчанию), `RENDER_API_URL` (база шлюза `…/v1` или полный `…/chat/completions`), `RENDER_API_KEY`, `RENDER_MODEL`. Запрос — `chat/completions` с `modalities: ['image','text']`, картинки во входе — `image_url` с data:URL. Ответ разбирается: `choices[0].message.images[].image_url.url`, `content` строкой с data:URL или ссылкой, `content` массивом частей, `data[].b64_json`/`url`, `candidates[].content.parts[].inline_data`.
- Без ключа — **503** `{error: "Рендер не подключён: нужен ключ нейросети в настройках сервера"}`. Ошибки шлюза — 502/504 с понятным текстом (неверный ключ, нет денег, перегрузка, не вернула картинку).

### Ссылки с сайтов
- `POST /api/link-preview` `{url}` → `{name, price?, currency?, image?}`. Сервер скачивает страницу: только http/https, без логина в ссылке, таймаут 8 с, до 2 МБ (в т. ч. после распаковки), до 4 перенаправлений. **SSRF:** имя хоста резолвится, любой частный/локальный/служебный адрес (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 0/8, ::1, fc00::/7, fe80::/10, IPv4 внутри IPv6 и т. п.) — 400 «Адрес запрещён»; соединение идёт ровно на проверенный адрес; каждое перенаправление проверяется заново. Разбор: JSON-LD `Product` (`name`, `offers.price`/`lowPrice`, `priceCurrency`, `image`), `og:title`, `og:image`, `product:price:amount`, `itemprop=price`, `<title>`; кодировка из заголовка или `<meta charset>`.
- `LINK_PREVIEW_ALLOW_PRIVATE=1` — разрешить локальные адреса. **Только для тестов**, на сервере не задавать.
- Интерфейс: при вставке ссылки (или уходе из поля) подставляет название и цену в рублях, если поля пустые; менеджер правит.

### Сборка КП
- `GET /api/clients/:id/kp-draft?base=<kpId>` → `{client, items: [{calculationId, kind, calcTitle, status, title, dims, about, materials, benefits, images, imageId, price}], base, validUntil (+14 дней), aiText}`. Умолчания — из `calculations.kp_info` (тексты прошлого КП) или из расчёта; с `base` — тексты из снимка того КП.
- `POST /api/calculations/:id/kp-text` `{title, dims, materials, benefits}` → `{text, source: 'ai'|'template', note?}`. Нейросеть — если заданы `AI_TEXT_API_URL`, `AI_TEXT_API_KEY`, `AI_TEXT_MODEL` (стиль DESIGN.md §8); иначе или при ошибке — шаблон по материалам.
- `POST /api/kp/preview` `{clientId, calculationIds}` → `{items: [{calculationId, price}], totals}` (по текущему прайсу).
- `POST /api/kp` `{clientId, baseKpId?, theme: 'dark'|'light', validUntil: 'ГГГГ-ММ-ДД', items: [{calculationId, title, dims, about, materials: [{role, value}], benefits, imageId|null}]}` → `{kp}`. 1–20 изделий одного клиента, порядок — как в `items`. Номер `КП-0001` по порядку (`kp_number_seq`); с `baseKpId` — тот же номер, версия +1. Токен ссылки — 32 случайных байта (43 символа base64url). Статусы расчётов `draft`/`saved` → `in_kp`.
- `KpSummary` = `{id, number, version, clientId, clientName, url, total, theme, validUntil, createdAt, createdBy, sentAt, views, firstViewedAt, lastViewedAt, approvedAt, items: [{calculationId, title}]}`.
- `GET /api/clients/:id/kps` → `{kps}` (новые сверху); `GET /api/kp/:id` → `{kp, snapshot, clientPhone, events, versions}`.
- `POST /api/kp/:id/sent` `{channel: 'link'|'whatsapp'|'telegram'|'pdf'}` → `{kp}`: `sentAt` (первый раз), событие, статусы расчётов → `kp_sent`.
- Снимок цен: `price` изделия = `{retail, discountPct, discount, price, montage, delivery, total}`, `totals` = `{goods, discount, discountPct|null, furniture, montage, delivery, total}`. Себестоимости и наценок в снимке нет.

### Страница КП по ссылке (без входа)
- `GET /p/:token` — HTML по утверждённому макету `mockups/kp-example.html` (обложка, «Почему Культура Групп», изделия, стоимость, гарантии, следующий шаг). `?theme=light|dark` — вид (по умолчанию из КП), `?preview=1` — просмотр менеджера (открытия не считаются, кнопки ничего не шлют), `?print=1` — сразу печать. Печать: A4 альбомная, светлый вид, страница на лист. На странице только имя и город клиента. Заголовки: CSP с nonce, `noindex`, `no-store`, запрет фреймов. Неизвестный токен — 404 «Предложение не найдено».
- `GET /p/:token/img/:imageId` — картинка, только если она есть в снимке этого КП.
- `POST /p/:token/open` — открытие: `views + 1`, время первого и последнего; первое открытие → уведомление менеджеру. IP и прочее не пишем.
- `POST /p/:token/action` `{type: 'approve'|'question', message?}` — «Утвердить проект» / «Задать вопрос менеджеру» (вопрос до 1000 символов) → событие и уведомление менеджеру клиента. Не больше 20 действий в час на КП (429).

### Уведомления
- `GET /api/notifications` → `{items: [{id, type: 'open'|'approve'|'question', text, kpId, clientId, createdAt, read}], unread}` (последние 30, свои).
- `POST /api/notifications/read` `{ids?}` → `{}` (без `ids` — все).

### Компания (постоянная часть КП)
- `GET /api/company` → `{company, rev, coverUrl}`; `PUT /api/company` (владелец) `{rev, company}` → то же, 409 при чужой правке.
- `POST /api/company/cover` (владелец, тело — картинка) / `DELETE /api/company/cover` — фото обложки.
- `company` = `{name, coverTitle, addresses: [{city, lines}], phone, lead, facts: [{big, text}], boxes: [{title, text}], includes, extra, notIncluded, warrantyBig, warrantyText, terms, payment, fix, steps, coverImageId}`. По умолчанию — факты из `docs/kp-format.md` (гарантия 10 лет, 55 рабочих дней, 60 % / 40 %). Изменения действуют только на новые КП.

### Интерфейс
- Расчёт: блок «Эскизы и рендеры» (загрузка, «в КП», «Сделать рендер» / «Перегенерировать» с полем «Что поправить»), подтягивание по ссылке, кнопка «Собрать КП». Подсветка: профиль выбирается только у участка (общий «профиль для новых участков» убран; `LightInput.profileId` остаётся в данных для старых расчётов).
- Клиент: список КП с версиями и открытиями, «Собрать КП» → `/clients/:id/kp/new` (`?calc=`, `?base=` — новая версия).
- КП `/kp/:id`: «Скопировать ссылку», «Отправить в WhatsApp» (`wa.me/<телефон клиента цифрами>?text=…`), «Отправить в Telegram» (`t.me/share/url?url=…&text=…`), «Открыть как клиент», «Скачать PDF» (печать браузера), «Новая версия», события и версии.
- Колокольчик в шапке (обновление раз в 30 с); владелец: «Настройки → Компания в КП», должность и телефон в «Пользователях».
