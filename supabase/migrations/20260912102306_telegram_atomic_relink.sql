create or replace function public.confirm_telegram_link(p_token_hash text, p_telegram_user_id bigint)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare target_user uuid;
begin
  if p_telegram_user_id <= 0 or length(p_token_hash) <> 64 then return false; end if;
  perform pg_advisory_xact_lock(p_telegram_user_id);
  select user_id into target_user from public.telegram_links
    where token_hash = p_token_hash and token_expires_at > now() for update;
  if target_user is null then return false; end if;
  -- The private /start message proves possession of this Telegram account and the fresh link.
  update public.telegram_links set telegram_user_id = null, confirmed_at = null,
    revoked_at = now(), token_expires_at = now(), expires_at = now()
    where telegram_user_id = p_telegram_user_id and user_id <> target_user;
  update public.telegram_links set telegram_user_id = p_telegram_user_id,
    confirmed_at = now(), connected_at = now(), revoked_at = null,
    token_expires_at = now(), expires_at = now(), delivery_status = 'connected',
    last_delivery_error = null, last_delivery_error_at = null
    where user_id = target_user and token_hash = p_token_hash;
  return true;
end;
$$;
revoke all on function public.confirm_telegram_link(text, bigint) from public, anon, authenticated;
grant execute on function public.confirm_telegram_link(text, bigint) to service_role;
