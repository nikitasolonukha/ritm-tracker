\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_timer(value boolean,label text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'FAILED: %',label; end if; raise notice 'PASS: %',label; end; $$;
insert into auth.users(id,email) values('d2000000-0000-4000-8000-000000000001','timer-fixture@example.test');
insert into public.telegram_links(user_id,token_hash,expires_at,token_expires_at,telegram_user_id,confirmed_at,connected_at)
  values('d2000000-0000-4000-8000-000000000001',repeat('d',64),now(),now(),1234567801,now(),now());
set local role authenticated;
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000001',true);
select public.save_tracker_state(0,jsonb_build_object('version',1,'habits','[]'::jsonb,'completions','[]'::jsonb,
  'workouts',jsonb_build_array(jsonb_build_object('id','wt','exercises',jsonb_build_array(jsonb_build_object('id','et','sets',jsonb_build_array(jsonb_build_object('id','st','completed',true)))))),
  'activeTimer',jsonb_build_object('sourceId','wt:et:st','version',1,'status','running','startedAt',now()-interval '3 minutes','endsAt',now()-interval '1 second','durationSec',180),
  'outbox',jsonb_build_array(jsonb_build_object('id','timer-fact','type','workout.set.completed','entityId','wt:et:st','status','pending','version',1,
  'payload',jsonb_build_object('dueAt',now()-interval '1 second','expiresAt',now()+interval '2 minutes','message','Fixture rest')))));
do $$ begin perform public.accept_telegram_timer_command(1234567801,'forged','wt:et:st','{}',1,'reschedule'); raise exception 'client timer callback accepted'; exception when insufficient_privilege then raise notice 'PASS: client cannot impersonate Telegram callback'; end; $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.notification_jobs set status='sent' where user_id='d2000000-0000-4000-8000-000000000001';
select pg_temp.assert_timer((public.accept_telegram_timer_command(999999999,'other-chat','wt:et:st','{}',1,'reschedule')->>'status')='unlinked','foreign chat rejected');
select pg_temp.assert_timer((public.accept_telegram_timer_command(1234567801,'extend','wt:et:st','{}',1,'reschedule')->>'status')='applied','extend callback applied');
select pg_temp.assert_timer((select version=2 and (payload->'activeTimer'->>'version')::integer=2
  and (payload->'activeTimer'->>'endsAt')::timestamptz=now()+interval '30 seconds' from public.tracker_state where user_id='d2000000-0000-4000-8000-000000000001'),'timer and snapshot revision saved atomically');
select pg_temp.assert_timer((select count(*)=1 from public.notification_jobs where user_id='d2000000-0000-4000-8000-000000000001' and source_version=2 and status='pending' and expires_at=due_at+interval '2 minutes'),'new queue version and short expiry saved');
select pg_temp.assert_timer((public.accept_telegram_timer_command(1234567801,'extend','wt:et:st','{}',1,'reschedule')->>'status')='duplicate','same callback id is idempotent');
select pg_temp.assert_timer((public.accept_telegram_timer_command(1234567801,'old-message','wt:et:st','{}',1,'reschedule')->>'status')='stale','old message cannot extend a newer rest');
select pg_temp.assert_timer((public.accept_telegram_timer_command(1234567801,'cancel','wt:et:st','{}',2,'cancel')->>'status')='applied','cancel callback applied');
select pg_temp.assert_timer((select version=3 and payload->'activeTimer'='null'::jsonb from public.tracker_state where user_id='d2000000-0000-4000-8000-000000000001'),'cancel clears timer in server snapshot');
select pg_temp.assert_timer((select count(*)=0 from public.notification_jobs where user_id='d2000000-0000-4000-8000-000000000001' and status='pending'),'cancel invalidates scheduled replacement');
select pg_temp.assert_timer((public.accept_telegram_timer_command(1234567801,'after-finish','wt:et:st','{}',2,'reschedule')->>'status')='stale','closed rest cannot be revived');
rollback;
