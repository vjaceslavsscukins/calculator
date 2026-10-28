-- Спецификация к договору (Приложение №2): одна на расчёт (пробная версия). data — шапка, разделы, условия (SpecData движка);
-- total — стоимость на момент формирования: снимок, при изменении расчёта сам не меняется (кнопка «Обновить из расчёта»).
create table specs (
  calculation_id uuid primary key references calculations(id),
  data jsonb not null,
  total double precision not null,
  rev int not null default 1,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
