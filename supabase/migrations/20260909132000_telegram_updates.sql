create table if not exists public.telegram_updates (
  update_id bigint primary key check (update_id >= 0),
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);

alter table public.telegram_updates enable row level security;
revoke all on table public.telegram_updates from anon, authenticated;
