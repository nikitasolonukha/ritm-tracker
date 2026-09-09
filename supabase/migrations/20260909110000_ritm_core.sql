create extension if not exists pgcrypto;

create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  title text not null,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  source text not null default 'web' check (source in ('web', 'telegram', 'import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id text not null,
  exercise_name text not null,
  category text not null default 'working' check (category in ('warmup', 'working', 'finisher')),
  component text check (component is null or component in ('single', 'compound-a', 'compound-b')),
  set_number integer not null check (set_number > 0),
  weight_kg numeric(8, 3) check (weight_kg is null or weight_kg >= 0),
  reps integer check (reps is null or reps >= 0),
  weight_mode text not null default 'total' check (weight_mode in ('total', 'per-hand')),
  weight_factor numeric(5, 2) not null default 1 check (weight_factor > 0),
  completed_at timestamptz,
  note text,
  unique (session_id, exercise_id, set_number)
);

create table if not exists public.habit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id text not null,
  local_date date not null,
  completed_at timestamptz not null default now(),
  source text not null default 'web' check (source in ('web', 'telegram')),
  unique (user_id, habit_id, local_date)
);

create table if not exists public.commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  command_key text not null,
  command_type text not null,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  result text not null default 'applied' check (result in ('applied', 'duplicate', 'rejected')),
  created_at timestamptz not null default now(),
  unique (user_id, command_key)
);

create table if not exists public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_entity_id text not null,
  source_version integer not null default 1,
  due_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'leased', 'sent', 'cancelled', 'failed', 'unknown')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  lease_until timestamptz,
  last_error text,
  unique (user_id, source_entity_id, source_version)
);

create table if not exists public.telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  telegram_user_id bigint unique,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['workout_sessions', 'workout_sets', 'habit_events', 'commands', 'notification_jobs', 'telegram_links'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
  end loop;
end $$;

create policy "owner can manage workout sessions" on public.workout_sessions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "owner can manage workout sets" on public.workout_sets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "owner can manage habit events" on public.habit_events for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "owner can manage commands" on public.commands for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "owner can manage notification jobs" on public.notification_jobs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "owner can manage telegram links" on public.telegram_links for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function public.complete_workout_set(
  p_command_key text,
  p_session_id uuid,
  p_set_id uuid,
  p_source_version integer default 1
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  existing public.commands;
begin
  if current_user_id is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into existing from public.commands where user_id = current_user_id and command_key = p_command_key for update;
  if existing.id is not null then return jsonb_build_object('status', 'duplicate', 'command_id', existing.id); end if;

  update public.workout_sets
    set completed_at = coalesce(completed_at, now())
    where id = p_set_id and session_id = p_session_id and user_id = current_user_id;
  if not found then raise exception 'set does not belong to owner session' using errcode = 'P0002'; end if;

  insert into public.commands(user_id, command_key, command_type, entity_id, payload, version)
    values (current_user_id, p_command_key, 'workout.set.completed', p_set_id::text, jsonb_build_object('session_id', p_session_id, 'set_id', p_set_id), p_source_version)
    returning * into existing;
  return jsonb_build_object('status', 'applied', 'command_id', existing.id);
end;
$$;

revoke all on function public.complete_workout_set(text, uuid, uuid, integer) from public, anon;
grant execute on function public.complete_workout_set(text, uuid, uuid, integer) to authenticated;
