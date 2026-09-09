begin;
select plan(4);
select has_table('public', 'workout_sessions', 'sessions table exists');
select has_table('public', 'commands', 'commands table exists');
select row_security_active('public.workout_sessions');
select row_security_active('public.commands');
select * from finish();
rollback;
