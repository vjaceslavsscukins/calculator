-- Этап 2: картинки расчёта, КП (снимок), просмотры и действия клиента, уведомления, данные компании для обложки.

-- менеджер в КП: телефон и должность из профиля
alter table users add column phone text not null default '';
alter table users add column position text not null default '';

-- данные КП, которые менеджер ввёл в прошлый раз (габариты, текст «Об изделии», плашки): умолчание для следующей версии
alter table calculations add column kp_info jsonb not null default '{}';

-- картинки: эскизы и рендеры расчёта, фото обложки КП. Содержимое — в S3 (storage = 's3') или в image_blobs (storage = 'db').
-- Картинка не меняется после загрузки; «удаление» только скрывает её из расчёта (deleted_at), чтобы отправленные КП не теряли картинку.
create table images (
  id uuid primary key default gen_random_uuid(),
  calculation_id uuid references calculations(id),
  kind text not null check (kind in ('sketch', 'render', 'cover')),
  title text not null default '',
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  size int not null,
  storage text not null check (storage in ('db', 's3')),
  in_kp boolean not null default false,
  source_id uuid references images(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index images_calc_idx on images (calculation_id);

create table image_blobs (
  image_id uuid primary key references images(id) on delete cascade,
  data bytea not null
);

-- КП: номер КП-0001 по порядку, версия внутри номера, снимок (цены, тексты, картинки) — не меняется после формирования
create sequence kp_number_seq;
create table kps (
  id uuid primary key default gen_random_uuid(),
  number int not null,
  version int not null default 1,
  client_id uuid not null references clients(id),
  token text not null unique,
  snapshot jsonb not null,
  total double precision not null,
  theme text not null check (theme in ('dark', 'light')),
  valid_until date not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  views int not null default 0,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  approved_at timestamptz,
  unique (number, version)
);
create index kps_client_idx on kps (client_id);

-- что делал клиент на странице КП: открыл, утвердил, задал вопрос. Без IP и других персональных данных.
create table kp_events (
  id bigserial primary key,
  kp_id uuid not null references kps(id) on delete cascade,
  type text not null check (type in ('open', 'approve', 'question', 'sent')),
  message text not null default '',
  created_at timestamptz not null default now()
);
create index kp_events_kp_idx on kp_events (kp_id, created_at desc);

-- уведомления в портале (колокольчик)
create table notifications (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  kp_id uuid references kps(id) on delete cascade,
  type text not null,
  text text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on notifications (user_id, created_at desc);

-- постоянная часть КП (обложка, адреса, факты, условия): одна запись, правит владелец
create table company (
  id int primary key check (id = 1),
  data jsonb not null,
  rev int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);
