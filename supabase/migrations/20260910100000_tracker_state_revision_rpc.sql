create or replace function public.save_tracker_state(
  p_expected_revision integer,
  p_payload jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  current_revision integer;
  next_revision integer;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_expected_revision < 0 or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid tracker state' using errcode = '22023';
  end if;

  select version into current_revision
    from public.tracker_state
   where user_id = (select auth.uid())
   for update;

  if current_revision is null then
    if p_expected_revision <> 0 then raise exception 'tracker revision conflict' using errcode = '40001'; end if;
    insert into public.tracker_state(user_id, payload, version)
      values ((select auth.uid()), p_payload, 1);
    return jsonb_build_object('saved', true, 'revision', 1);
  end if;

  if current_revision <> p_expected_revision then
    raise exception 'tracker revision conflict' using errcode = '40001', detail = current_revision::text;
  end if;

  next_revision := current_revision + 1;
  update public.tracker_state
     set payload = p_payload, version = next_revision, updated_at = now()
   where user_id = (select auth.uid());
  return jsonb_build_object('saved', true, 'revision', next_revision);
end;
$$;

revoke all on function public.save_tracker_state(integer, jsonb) from public, anon;
grant execute on function public.save_tracker_state(integer, jsonb) to authenticated;
