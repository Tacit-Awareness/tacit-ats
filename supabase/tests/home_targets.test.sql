-- home_targets checks for 20261030223000_home_targets: an admin writes their own
-- org's targets, whoever sees Home reads them, an interviewer reads none, no one
-- crosses an org, and no target exists until someone sets one.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/home_targets.test.sql
--
-- One rolled-back transaction; every check raises on failure.

begin;

create function pg_temp.as_member(sub text, org_claim text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', sub, 'role', 'authenticated', 'org_id', org_claim)::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;

create function pg_temp.as_tacit_internal() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"tacit_internal"}', true);
  execute 'set local role tacit_internal';
end $$;

create function pg_temp.expect(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', what; end if;
end $$;

-- The statement must fail with exactly this sqlstate.
create function pg_temp.refuses(stmt text, code text, what text) returns void language plpgsql as $$
declare
  ran boolean := false;
begin
  begin
    execute stmt;
    ran := true;
  exception when others then
    if sqlstate <> code then
      raise exception 'FAILED: % (wanted %, got %: %)', what, code, sqlstate, sqlerrm;
    end if;
  end;
  if ran then raise exception 'FAILED: % (it succeeded)', what; end if;
end $$;

-- How many rows this statement changed.
create function pg_temp.changed(stmt text) returns integer language plpgsql as $$
declare
  n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on all functions in schema pg_temp to anon, authenticated, service_role, tacit_internal;

-- Fixtures: Acme with a member at each level, plus an admin who has left and an
-- external recruiter; Globex with its own admin and manager.
insert into orgs (id, name, slug, workos_org_id) values
  ('a0000000-0000-4000-8000-00000000000a', 'Acme', 'acme-ht', 'org_acme_ht'),
  ('b0000000-0000-4000-8000-00000000000b', 'Globex', 'globex-ht', 'org_globex_ht');
insert into actors (id, slug, display_name, org_id, access_level, auth_subject, archived_at) values
  ('a1000000-0000-4000-8000-000000000001', 'acme-admin', 'Acme Admin', 'a0000000-0000-4000-8000-00000000000a', 'admin', 'ht_admin', null),
  ('a1000000-0000-4000-8000-000000000002', 'acme-hm', 'Acme Manager', 'a0000000-0000-4000-8000-00000000000a', 'elevated', 'ht_hm', null),
  ('a1000000-0000-4000-8000-000000000003', 'acme-int', 'Acme Interviewer', 'a0000000-0000-4000-8000-00000000000a', 'limited', 'ht_int', null),
  ('a1000000-0000-4000-8000-000000000004', 'acme-gone', 'Acme Gone', 'a0000000-0000-4000-8000-00000000000a', 'admin', 'ht_gone', now()),
  ('a1000000-0000-4000-8000-000000000005', 'acme-ext', 'Acme External Recruiter', 'a0000000-0000-4000-8000-00000000000a', 'limited', 'ht_ext', null),
  ('b1000000-0000-4000-8000-000000000001', 'globex-admin', 'Globex Admin', 'b0000000-0000-4000-8000-00000000000b', 'admin', 'ht_globex', null),
  ('b1000000-0000-4000-8000-000000000002', 'globex-hm', 'Globex Manager', 'b0000000-0000-4000-8000-00000000000b', 'elevated', 'ht_globex_hm', null);
-- An external recruiter is an elevated member: any job access raises the level.
insert into companies (id, name, org_id) values
  ('a2000000-0000-4000-8000-000000000001', 'Acme', 'a0000000-0000-4000-8000-00000000000a');
insert into roles (id, company_id, title, org_id) values
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Engineer', 'a0000000-0000-4000-8000-00000000000a');
insert into job_access (actor_id, role_id, access_role_id)
select 'a1000000-0000-4000-8000-000000000005', 'a3000000-0000-4000-8000-000000000001', ar.id
from access_roles ar
where ar.org_id = 'a0000000-0000-4000-8000-00000000000a' and ar.name = 'External Recruiter';

-- 1. None is assumed: a new org has no target and an admin reads none.
select pg_temp.expect((select count(*) from home_targets where org_id in (
  'a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b')) = 0, 'a new org starts with no targets');
select pg_temp.as_member('ht_admin', 'org_acme_ht');
select pg_temp.expect(not exists (select 1 from home_targets), 'an admin reads no target until one is set');

-- 2. An admin sets one, naming no org: the org comes from their token.
insert into home_targets (metric, value) values ('review', 48);
select pg_temp.expect((select org_id = 'a0000000-0000-4000-8000-00000000000a' and value = 48 from home_targets),
  'an insert takes the org from the token');
select pg_temp.expect(pg_temp.changed($$insert into home_targets (metric, value) values ('new_applications', 20), ('schedule', 24.5), ('feedback', 12), ('workload', 40)$$) = 4,
  'an admin sets the other four');
select pg_temp.expect((select count(*) from home_targets) = 5, 'one row per metric');

-- 3. An admin changes one in place, the way PostgREST's upsert does, and clears
-- one by deleting it. Clearing leaves the others.
select pg_temp.expect(pg_temp.changed($$update home_targets set value = 36 where metric = 'review'$$) = 1, 'an admin updates a target');
select pg_temp.expect((select value from home_targets where metric = 'review') = 36, 'the update landed');
insert into home_targets (metric, value) values ('review', 30)
  on conflict (org_id, metric) do update set metric = excluded.metric, value = excluded.value;
select pg_temp.expect((select count(*) from home_targets where metric = 'review') = 1 and (select value from home_targets where metric = 'review') = 30,
  'an upsert replaces the org''s row');
select pg_temp.expect(pg_temp.changed($$delete from home_targets where metric = 'workload'$$) = 1, 'an admin clears a target');
select pg_temp.expect((select count(*) from home_targets) = 4, 'clearing one leaves the rest');
reset role;

-- 4. Timestamps are the database's.
update home_targets set updated_at = '2020-01-01', created_at = '2020-01-01'
  where org_id = 'a0000000-0000-4000-8000-00000000000a' and metric = 'schedule';
select pg_temp.expect((select updated_at > '2021-01-01' and created_at = '2020-01-01' from home_targets
  where org_id = 'a0000000-0000-4000-8000-00000000000a' and metric = 'schedule'), 'the trigger sets updated_at, whatever is sent');

-- 5. Whoever sees Home reads the org's targets: a hiring manager and an external
-- recruiter, elevated both.
select pg_temp.as_member('ht_hm', 'org_acme_ht');
select pg_temp.expect((select count(*) from home_targets) = 4, 'a hiring manager reads the org''s targets');
select pg_temp.as_member('ht_ext', 'org_acme_ht');
select pg_temp.expect((select count(*) from home_targets) = 4, 'an external recruiter reads the targets on the cards they see');

-- 6. An interviewer has no such Home and reads none, by the policy, without an
-- error, so a shared read needs no special case. Nor does someone who has left.
select pg_temp.as_member('ht_int', 'org_acme_ht');
select pg_temp.expect(not exists (select 1 from home_targets), 'an interviewer reads no target');
select pg_temp.as_member('ht_gone', 'org_acme_ht');
select pg_temp.expect(not exists (select 1 from home_targets), 'an archived admin reads no target');
select pg_temp.as_member('nobody', 'org_acme_ht');
select pg_temp.expect(not exists (select 1 from home_targets), 'an unknown subject reads no target');
select pg_temp.as_member('ht_admin', 'org_globex_ht');
select pg_temp.expect(not exists (select 1 from home_targets), 'a token for another org reads no target');

-- 7. Only an admin writes: at every other level an insert is refused, an update
-- or delete touches nothing, and an upsert is refused.
create function pg_temp.writes_nothing(sub text, what text) returns void language plpgsql as $$
begin
  perform pg_temp.as_member(sub, 'org_acme_ht');
  perform pg_temp.refuses($q$insert into home_targets (metric, value) values ('workload', 1)$q$, '42501', what || ' inserts no target');
  perform pg_temp.refuses($q$insert into home_targets (metric, value) values ('review', 1)
    on conflict (org_id, metric) do update set value = excluded.value$q$, '42501', what || ' upserts no target');
  perform pg_temp.expect(pg_temp.changed($q$update home_targets set value = 1$q$) = 0, what || ' updates no target');
  perform pg_temp.expect(pg_temp.changed($q$delete from home_targets$q$) = 0, what || ' deletes no target');
end $$;
grant execute on function pg_temp.writes_nothing(text, text) to authenticated;
select pg_temp.writes_nothing('ht_hm', 'a hiring manager');
select pg_temp.writes_nothing('ht_ext', 'an external recruiter');
select pg_temp.writes_nothing('ht_int', 'an interviewer');
select pg_temp.writes_nothing('ht_gone', 'an archived admin');
reset role;
select pg_temp.expect((select count(*) from home_targets where org_id = 'a0000000-0000-4000-8000-00000000000a') = 4
  and (select value from home_targets where org_id = 'a0000000-0000-4000-8000-00000000000a' and metric = 'review') = 30,
  'no refused write changed a row');

-- 8. Nothing crosses an org. Globex's admin sees none of Acme's targets, cannot
-- reach them, and writes only their own. Naming an org is refused by the grant,
-- their own included: the token decides.
select pg_temp.as_member('ht_globex', 'org_globex_ht');
select pg_temp.expect(not exists (select 1 from home_targets), 'another org''s admin reads nothing');
select pg_temp.expect(pg_temp.changed($$update home_targets set value = 1$$) = 0, 'another org''s admin updates nothing');
select pg_temp.expect(pg_temp.changed($$delete from home_targets$$) = 0, 'another org''s admin deletes nothing');
select pg_temp.refuses($$insert into home_targets (org_id, metric, value) values ('a0000000-0000-4000-8000-00000000000a', 'review', 1)$$,
  '42501', 'an admin cannot name another org on insert');
select pg_temp.refuses($$insert into home_targets (org_id, metric, value) values ('b0000000-0000-4000-8000-00000000000b', 'review', 1)$$,
  '42501', 'an admin cannot name even their own org');
select pg_temp.refuses($$update home_targets set org_id = 'a0000000-0000-4000-8000-00000000000a'$$,
  '42501', 'an admin cannot move a target to another org');
insert into home_targets (metric, value) values ('review', 72);
select pg_temp.expect((select org_id = 'b0000000-0000-4000-8000-00000000000b' and value = 72 from home_targets),
  'each org has its own row for a metric');
select pg_temp.as_member('ht_globex_hm', 'org_globex_ht');
select pg_temp.expect((select count(*) from home_targets) = 1, 'a member reads only their own org''s target');
reset role;
select pg_temp.expect((select value from home_targets where org_id = 'a0000000-0000-4000-8000-00000000000a' and metric = 'review') = 30,
  'Acme''s target did not move');

-- 9. What a value can be. Zero is a target; two decimal places are kept; the rest
-- is refused, NaN and infinity included.
select pg_temp.as_member('ht_admin', 'org_acme_ht');
select pg_temp.expect(pg_temp.changed($$update home_targets set value = 0 where metric = 'schedule'$$) = 1, '0 is a target');
select pg_temp.expect((select value from home_targets where metric = 'schedule') = 0, 'a target of 0 stays 0');
select pg_temp.expect(pg_temp.changed($$update home_targets set value = 1000000 where metric = 'schedule'$$) = 1, 'the top of the range is allowed');
update home_targets set value = 1.005 where metric = 'schedule';
select pg_temp.expect((select value from home_targets where metric = 'schedule') = 1.01, 'two decimal places are kept');
select pg_temp.refuses($$insert into home_targets (metric, value) values ('workload', -1)$$, '23514', 'a negative target');
select pg_temp.refuses($$insert into home_targets (metric, value) values ('workload', 1000000.01)$$, '23514', 'a target past the range');
select pg_temp.refuses($$insert into home_targets (metric, value) values ('workload', 'NaN')$$, '23514', 'NaN');
select pg_temp.refuses($$insert into home_targets (metric, value) values ('workload', 'Infinity')$$, '22003', 'infinity');
select pg_temp.refuses($$insert into home_targets (metric, value) values ('workload', '-Infinity')$$, '22003', 'minus infinity');
select pg_temp.refuses($$insert into home_targets (metric, value) values ('workload', 1e30)$$, '22003', 'a number too long for the column');
select pg_temp.refuses($$insert into home_targets (metric, value) values ('workload', null)$$, '23502', 'no number');
select pg_temp.refuses($$insert into home_targets (metric) values ('workload')$$, '23502', 'a target with no value');
select pg_temp.refuses($$insert into home_targets (value) values (1)$$, '23502', 'a target with no metric');

-- 10. The metrics are the five cards. "Candidates in process" takes no target.
select pg_temp.refuses(format($$insert into home_targets (metric, value) values (%L, 1)$$, m), '23514', format('metric %s', m))
from unnest(array['in_process', 'active', 'apps', 'sched', 'cards', 'load', 'REVIEW', 'review ', '']) m;
select pg_temp.expect(pg_temp.changed(format($$insert into home_targets (metric, value) values (%L, 1) on conflict (org_id, metric) do update set value = excluded.value$$, m)) = 1,
  format('metric %s', m))
from unnest(array['new_applications', 'review', 'schedule', 'feedback', 'workload']) m;
select pg_temp.refuses($$insert into home_targets (metric, value) values ('review', 2)$$, '23505', 'a second row for a metric');

-- 11. A target stays on its metric: an update naming another metric would turn
-- hours into a count.
select pg_temp.refuses($$update home_targets set metric = 'workload' where metric = 'review'$$, '22023', 'a target stays on its metric');
reset role;

-- 12. The columns a member may not send.
select pg_temp.as_member('ht_admin', 'org_acme_ht');
select pg_temp.refuses($$insert into home_targets (metric, value, created_at) values ('workload', 1, now())$$, '42501', 'no one sends created_at');
select pg_temp.refuses($$insert into home_targets (metric, value, updated_at) values ('workload', 1, now())$$, '42501', 'no one sends updated_at');
select pg_temp.refuses($$update home_targets set updated_at = now()$$, '42501', 'no one sends updated_at on update');
select pg_temp.refuses($$truncate home_targets$$, '42501', 'a member truncates nothing');
reset role;

-- 13. Anon has nothing.
select pg_temp.as_anon();
select pg_temp.refuses($$select * from home_targets$$, '42501', 'anon reads no target');
select pg_temp.refuses($$insert into home_targets (metric, value) values ('review', 1)$$, '42501', 'anon writes no target');
select pg_temp.refuses($$delete from home_targets$$, '42501', 'anon deletes no target');
reset role;

-- 14. tacit_internal reads Tacit's own and writes nothing. Truncate ignores RLS,
-- so it would reach every org.
insert into home_targets (org_id, metric, value) values (tacit_org_id(), 'review', 24);
select pg_temp.as_tacit_internal();
select pg_temp.expect((select count(*) from home_targets where org_id = tacit_org_id()) = 1, 'tacit_internal reads Tacit''s');
select pg_temp.expect((select count(*) from home_targets where org_id <> tacit_org_id()) = 0, 'tacit_internal reads no client''s');
select pg_temp.refuses($$insert into home_targets (org_id, metric, value) values (tacit_org_id(), 'schedule', 1)$$, '42501', 'tacit_internal inserts no target');
select pg_temp.refuses($$update home_targets set value = 1$$, '42501', 'tacit_internal updates no target');
select pg_temp.refuses($$delete from home_targets$$, '42501', 'tacit_internal deletes no target');
select pg_temp.refuses($$truncate home_targets$$, '42501', 'tacit_internal truncates nothing');
reset role;

-- 15. The service role sees every org, and the trigger still holds a row to its
-- metric and org there.
select pg_temp.as_service();
select pg_temp.expect((select count(distinct org_id) from home_targets) >= 3, 'the service role reads every org');
select pg_temp.refuses($$update home_targets set org_id = 'b0000000-0000-4000-8000-00000000000b' where org_id = 'a0000000-0000-4000-8000-00000000000a' and metric = 'review'$$,
  '22023', 'a target stays with its org');
reset role;

-- 16. RLS is on, and the trigger function is no one's to call.
select pg_temp.expect((select relrowsecurity from pg_class where oid = 'public.home_targets'::regclass), 'RLS is on');
select pg_temp.expect(not has_function_privilege('authenticated', 'public.home_targets_validate()', 'execute'), 'authenticated cannot call the trigger function');
select pg_temp.expect(not has_function_privilege('anon', 'public.home_targets_validate()', 'execute'), 'anon cannot call the trigger function');

-- 17. A target goes with its org.
delete from actors where org_id = 'b0000000-0000-4000-8000-00000000000b';
delete from orgs where id = 'b0000000-0000-4000-8000-00000000000b';
select pg_temp.expect(not exists (select 1 from home_targets where org_id = 'b0000000-0000-4000-8000-00000000000b'), 'deleting an org removes its targets');

\echo 'home targets: all checks passed'
rollback;
