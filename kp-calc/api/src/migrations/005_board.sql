-- Реестр КП, приборная панель и очередь событий для Битрикс24.
-- Очередь: утверждение КП и вопрос клиента записываются сразу; когда появится вебхук с правом записи в CRM,
-- отправщик заберёт неотправленные (sent_at is null) и поставит комментарий / стадию в сделку. Ничего не теряется.
create table bitrix_outbox (
  id bigserial primary key,
  kind text not null check (kind in ('kp_approve', 'kp_question')),
  kp_id uuid references kps(id) on delete set null,
  client_id uuid references clients(id),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text
);
create index bitrix_outbox_pending_idx on bitrix_outbox (created_at) where sent_at is null;
create index kps_created_idx on kps (created_at);
create index calculations_created_idx on calculations (created_at);
