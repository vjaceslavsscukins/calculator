-- Начальная схема портала «Калькулятор КП». Деньги — double precision в рублях без округления.

create table cities (
  id serial primary key,
  name text not null unique
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  first_name text not null,
  last_name text not null default '',
  role text not null check (role in ('owner', 'head', 'manager')),
  city_id int references cities(id),
  password_hash text,
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index users_email_uq on users (lower(email));

-- токены хранятся только хешем sha256
create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_idx on sessions (user_id);

create table invites (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index invites_user_idx on invites (user_id);

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  city_id int not null references cities(id),
  manager_id uuid not null references users(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_manager_idx on clients (manager_id);
create index clients_city_idx on clients (city_id);

create table calculations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  title text not null,
  kind text not null check (kind in ('kitchen', 'cabinet')),
  status text not null default 'draft' check (status in ('draft', 'saved', 'in_kp', 'kp_sent', 'contract', 'archived')),
  input jsonb not null,
  unparsed jsonb not null default '[]',
  totals jsonb not null default '{}',
  total double precision not null default 0,
  rev int not null default 1,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index calculations_client_idx on calculations (client_id);

create table catalog_groups (
  id text primary key,
  category text not null,
  name text not null,
  unit text not null,
  rule text not null check (rule in ('sheet', 'unit')),
  sheet_area double precision,
  source text,
  sort int not null default 0
);

create table catalog_items (
  id text primary key,
  group_id text not null references catalog_groups(id),
  name text not null,
  price double precision not null default 0,
  status text,
  sort int not null default 0
);
create index catalog_items_group_idx on catalog_items (group_id);

-- служебные значения: версия прайса и т. п.
create table meta (
  key text primary key,
  value jsonb not null
);

-- одна запись: коэффициенты и цены подсветки (Settings из engine)
create table settings (
  id int primary key check (id = 1),
  data jsonb not null,
  rev int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);

-- последняя позиция прайса, выбранная пользователем для строки PRO100
create table pro100_defaults (
  user_id uuid not null references users(id) on delete cascade,
  pro100_name text not null,
  item_id text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, pro100_name)
);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid references users(id),
  user_name text not null,
  action text not null,
  entity text not null,
  details jsonb not null default '{}'
);
create index audit_log_at_idx on audit_log (at desc);
