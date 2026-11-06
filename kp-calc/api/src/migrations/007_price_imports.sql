-- Загрузки прайса файлом: что было до загрузки (для отката), какие позиции добавлены, итог.
create table price_imports (
  id serial primary key,
  group_id text not null references catalog_groups(id),
  user_id uuid references users(id),
  before jsonb not null,
  added_ids text[] not null default '{}',
  summary jsonb not null,
  created_at timestamptz not null default now(),
  rolled_back_at timestamptz
);
create index price_imports_group_idx on price_imports (group_id, id desc);
