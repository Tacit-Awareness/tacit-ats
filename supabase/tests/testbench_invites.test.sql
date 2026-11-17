-- Checks for 20261116000000_testbench_invites: a member reads but never sets
-- their org's Testbench company; whoever may manage a job sets its Testbench
-- role; an invite row is written by a member who may edit the candidate, as
-- themselves, read by whoever can read the application, and never crosses an
-- org.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/testbench_invites.test.sql
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

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  execute 'reset role';
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

grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- Fixtures: Acme with an admin, a hiring manager on the Engineer job only, an
-- interviewer and a member on no job; Globex with its own admin.
insert into orgs (id, name, slug, workos_org_id) values
  ('a0000000-0000-4000-8000-00000000000a', 'Acme', 'acme-tb', 'org_acme_tb'),
  ('b0000000-0000-4000-8000-00000000000b', 'Globex', 'globex-tb', 'org_globex_tb');
insert into actors (id, slug, display_name, org_id, access_level, auth_subject) values
  ('a1000000-0000-4000-8000-000000000001', 'acme-tb-admin', 'Acme Admin', 'a0000000-0000-4000-8000-00000000000a', 'admin', 'tb_admin'),
  ('a1000000-0000-4000-8000-000000000002', 'acme-tb-hm', 'Acme Manager', 'a0000000-0000-4000-8000-00000000000a', 'limited', 'tb_hm'),
  ('a1000000-0000-4000-8000-000000000003', 'acme-tb-int', 'Acme Interviewer', 'a0000000-0000-4000-8000-00000000000a', 'limited', 'tb_int'),
  ('a1000000-0000-4000-8000-000000000004', 'acme-tb-off', 'Acme Off Team', 'a0000000-0000-4000-8000-00000000000a', 'elevated', 'tb_off'),
  ('b1000000-0000-4000-8000-000000000001', 'globex-tb-admin', 'Globex Admin', 'b0000000-0000-4000-8000-00000000000b', 'admin', 'tb_globex');
insert into companies (id, name, org_id) values
  ('a2000000-0000-4000-8000-000000000001', 'Acme', 'a0000000-0000-4000-8000-00000000000a'),
  ('b2000000-0000-4000-8000-000000000001', 'Globex', 'b0000000-0000-4000-8000-00000000000b');
insert into roles (id, company_id, title, org_id) values
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Engineer', 'a0000000-0000-4000-8000-00000000000a'),
  ('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'Designer', 'a0000000-0000-4000-8000-00000000000a'),
  ('b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'Analyst', 'b0000000-0000-4000-8000-00000000000b');
-- Any job access raises the level, so the manager ends up elevated.
insert into job_access (actor_id, role_id, access_role_id)
select 'a1000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001', ar.id
from access_roles ar where ar.org_id = 'a0000000-0000-4000-8000-00000000000a' and ar.name = 'Hiring Manager';
insert into people (id, org_id, display_name, email) values
  ('a4000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'Nia Engineer', 'nia@example.com'),
  ('a4000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 'Dee Designer', 'dee@example.com'),
  ('b4000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b', 'Gil Analyst', 'gil@example.com');
insert into applications (id, org_id, person_id, role_id, added_by_actor_id) values
  ('a5000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a4000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('a5000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 'a4000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001'),
  ('b5000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b', 'b4000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- 1. orgs.testbench_client_id: staff set it, members only read their own
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
update orgs set testbench_client_id = 'aaaaaaaa-0000-4000-8000-000000000001' where id = 'a0000000-0000-4000-8000-00000000000a';
update orgs set testbench_client_id = 'bbbbbbbb-0000-4000-8000-000000000001' where id = 'b0000000-0000-4000-8000-00000000000b';

select pg_temp.as_member('tb_admin', 'org_acme_tb');
select pg_temp.expect((select testbench_client_id from orgs where id = 'a0000000-0000-4000-8000-00000000000a') = 'aaaaaaaa-0000-4000-8000-000000000001',
  'a member reads their own org''s Testbench company');
select pg_temp.expect((select count(*) from orgs where id = 'b0000000-0000-4000-8000-00000000000b') = 0, 'and never another org''s');
select pg_temp.expect(pg_temp.changed($$update orgs set testbench_client_id = 'bbbbbbbb-0000-4000-8000-000000000001' where id = 'a0000000-0000-4000-8000-00000000000a'$$) = 0,
  'an admin cannot repoint their org at another Testbench company');
select pg_temp.expect(pg_temp.changed($$update orgs set testbench_client_id = null$$) = 0, 'nor clear it');
select pg_temp.as_owner();
select pg_temp.expect((select testbench_client_id from orgs where id = 'a0000000-0000-4000-8000-00000000000a') = 'aaaaaaaa-0000-4000-8000-000000000001',
  'the mapping is as staff left it');

-- ---------------------------------------------------------------------------
-- 2. roles.testbench_role_id: whoever may manage the job
-- ---------------------------------------------------------------------------
select pg_temp.as_member('tb_hm', 'org_acme_tb');
select pg_temp.expect(pg_temp.changed($$update roles set testbench_role_id = 'eeeeeeee-0000-4000-8000-000000000001' where id = 'a3000000-0000-4000-8000-000000000001'$$) = 1,
  'a hiring manager sets the Testbench role on their job');
select pg_temp.expect(pg_temp.changed($$update roles set testbench_role_id = 'eeeeeeee-0000-4000-8000-000000000001' where id = 'a3000000-0000-4000-8000-000000000002'$$) = 0,
  'but not on a job they do not manage');
select pg_temp.as_member('tb_int', 'org_acme_tb');
select pg_temp.expect(pg_temp.changed($$update roles set testbench_role_id = null where id = 'a3000000-0000-4000-8000-000000000001'$$) = 0,
  'an interviewer sets none');
select pg_temp.as_member('tb_globex', 'org_globex_tb');
select pg_temp.expect(pg_temp.changed($$update roles set testbench_role_id = null where id = 'a3000000-0000-4000-8000-000000000001'$$) = 0,
  'another company''s admin sets none');
select pg_temp.as_member('tb_admin', 'org_acme_tb');
select pg_temp.expect((select testbench_role_id from roles where id = 'a3000000-0000-4000-8000-000000000001') = 'eeeeeeee-0000-4000-8000-000000000001',
  'the job keeps the role its manager picked');

-- ---------------------------------------------------------------------------
-- 3. testbench_invites: written as oneself, for a candidate one may edit
-- ---------------------------------------------------------------------------
select pg_temp.as_member('tb_hm', 'org_acme_tb');
insert into testbench_invites (application_id, org_id, testbench_role_id, testbench_application_id, testbench_attempt_id, invited_by_actor_id) values
  ('a5000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'eeeeeeee-0000-4000-8000-000000000001',
   'dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002');
select pg_temp.expect((select count(*) from testbench_invites) = 1, 'the hiring manager reads the invite on their job');
select pg_temp.refuses($$insert into testbench_invites (application_id, org_id, testbench_role_id, testbench_application_id, invited_by_actor_id) values
  ('a5000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 'eeeeeeee-0000-4000-8000-000000000001',
   'dddddddd-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002')$$, '42501', 'no invite on a job they hold nothing on');
select pg_temp.refuses($$insert into testbench_invites (application_id, org_id, testbench_role_id, testbench_application_id, invited_by_actor_id) values
  ('b5000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b', 'eeeeeeee-0000-4000-8000-000000000001',
   'dddddddd-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002')$$, '42501', 'no invite in another org');
select pg_temp.refuses($$insert into testbench_invites (application_id, org_id, testbench_role_id, testbench_application_id, invited_by_actor_id) values
  ('b5000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'eeeeeeee-0000-4000-8000-000000000001',
   'dddddddd-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002')$$, '42501', 'nor another org''s application under their own org');

-- An admin invites again: the upsert replaces the row, as themselves only.
select pg_temp.as_member('tb_admin', 'org_acme_tb');
select pg_temp.refuses($$insert into testbench_invites (application_id, org_id, testbench_role_id, testbench_application_id, invited_by_actor_id) values
  ('a5000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 'eeeeeeee-0000-4000-8000-000000000001',
   'dddddddd-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002')$$, '42501', 'an invite cannot name someone else as the inviter');
insert into testbench_invites (application_id, org_id, testbench_role_id, testbench_application_id, testbench_attempt_id, invited_by_actor_id) values
  ('a5000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'eeeeeeee-0000-4000-8000-000000000002',
   'dddddddd-0000-4000-8000-000000000009', null, 'a1000000-0000-4000-8000-000000000001')
on conflict (application_id) do update set
  testbench_role_id = excluded.testbench_role_id, testbench_application_id = excluded.testbench_application_id,
  testbench_attempt_id = excluded.testbench_attempt_id, invited_by_actor_id = excluded.invited_by_actor_id;
select pg_temp.expect((select count(*) from testbench_invites) = 1, 'one row per application');
select pg_temp.expect((select testbench_application_id from testbench_invites where application_id = 'a5000000-0000-4000-8000-000000000001') = 'dddddddd-0000-4000-8000-000000000009',
  'the second invite replaced the first');
select pg_temp.refuses($$delete from testbench_invites$$, '42501', 'a member deletes none');

-- Readers: whoever can read the application, and nobody else.
select pg_temp.as_member('tb_int', 'org_acme_tb');
select pg_temp.expect((select count(*) from testbench_invites) = 0, 'an interviewer reads no invite');
select pg_temp.refuses($$insert into testbench_invites (application_id, org_id, testbench_role_id, testbench_application_id, invited_by_actor_id) values
  ('a5000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 'eeeeeeee-0000-4000-8000-000000000001',
   'dddddddd-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003')$$, '42501', 'and writes none');
select pg_temp.as_member('tb_off', 'org_acme_tb');
select pg_temp.expect((select count(*) from testbench_invites) = 0, 'a member on no job reads no invite');
select pg_temp.expect(pg_temp.changed($$update testbench_invites set testbench_attempt_id = 'cccccccc-0000-4000-8000-000000000009'$$) = 0, 'and changes none');
select pg_temp.as_member('tb_globex', 'org_globex_tb');
select pg_temp.expect((select count(*) from testbench_invites) = 0, 'another company reads no invite');
select pg_temp.expect(pg_temp.changed($$update testbench_invites set testbench_attempt_id = 'cccccccc-0000-4000-8000-000000000009'$$) = 0, 'and changes none');
select pg_temp.as_anon();
select pg_temp.refuses($$select count(*) from testbench_invites$$, '42501', 'anon has no access at all');

-- The application going takes its invite with it.
select pg_temp.as_owner();
delete from applications where id = 'a5000000-0000-4000-8000-000000000001';
select pg_temp.expect((select count(*) from testbench_invites) = 0, 'an invite goes with its application');

rollback;
