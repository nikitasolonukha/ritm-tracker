alter table public.telegram_links
  add column if not exists delivery_status text not null default 'connected',
  add column if not exists last_delivery_error text,
  add column if not exists last_delivery_error_at timestamptz;

alter table public.telegram_links
  drop constraint if exists telegram_links_delivery_status_check;
alter table public.telegram_links
  add constraint telegram_links_delivery_status_check
  check (delivery_status in ('connected', 'error'));

update public.telegram_links
   set delivery_status = case when revoked_at is null and telegram_user_id is not null and confirmed_at is not null then 'connected' else 'connected' end
 where delivery_status is null;
