create table if not exists public.tracker_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.tracker_state enable row level security;
revoke all on table public.tracker_state from anon;
grant select, insert, update on table public.tracker_state to authenticated;
drop policy if exists "owner can manage tracker state" on public.tracker_state;
create policy "owner can manage tracker state" on public.tracker_state for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
