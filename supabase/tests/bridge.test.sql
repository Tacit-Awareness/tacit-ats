-- The staff bridge's database half (20261106010000_staff_bridge): the client
-- side of a Tacit teammate's submission, which tacit-internal's
-- tacit_submit_to_client / tacit_submit_application did on the shared
-- project. Rolled back; every check raises on failure.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bridge.test.sql

begin;

create function pg_temp.as_role(r text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', r)::text, true);
  execute format('set local role %I', r);
end $$;

create function pg_temp.as_member(sub text, org_claim text) returns void language plpgsql as $$
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

create function pg_temp.expect(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', what; end if;
end $$;

create function pg_temp.raises(q text, code text) returns boolean language plpgsql as $$
begin
  execute q;
  return false;
exception when others then
  if sqlstate = code then return true; end if;
  raise exception 'expected %, got % (%)', code, sqlstate, sqlerrm;
end $$;

grant execute on all functions in schema pg_temp to anon, authenticated, service_role, tacit_internal;

-- Acme, a client whose company on tacit is c0..a1, with an open job, a
-- confidential one and a candidate it already has.
insert into orgs (id, name, slug, kind, workos_org_id, company_id) values
  ('a0000000-0000-4000-8000-00000000000a', 'Acme', 'acme', 'client', 'org_acme', 'c0000000-0000-4000-8000-0000000000a1'),
  ('b0000000-0000-4000-8000-00000000000b', 'Globex', 'globex', 'client', 'org_globex', 'c0000000-0000-4000-8000-0000000000b1');
insert into actors (id, slug, display_name, email, org_id, access_level, auth_subject) values
  ('a1000000-0000-4000-8000-000000000001', 'acme-admin', 'Acme Admin', 'admin@acme.test', 'a0000000-0000-4000-8000-00000000000a', 'admin', 'user_acme'),
  ('a1000000-0000-4000-8000-000000000002', 'acme-gone', 'Gone Member', 'gone@tacitawareness.com', 'a0000000-0000-4000-8000-00000000000a', 'limited', 'user_gone');
update actors set archived_at = now() where id = 'a1000000-0000-4000-8000-000000000002';
insert into companies (id, name, org_id) values ('ac000000-0000-4000-8000-000000000001', 'Acme', 'a0000000-0000-4000-8000-00000000000a');
insert into roles (id, company_id, title, location, org_id, status, confidential) values
  ('ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001', 'Engineer', 'NYC', 'a0000000-0000-4000-8000-00000000000a', 'open', false),
  ('ac100000-0000-4000-8000-000000000002', 'ac000000-0000-4000-8000-000000000001', 'Secret', 'NYC', 'a0000000-0000-4000-8000-00000000000a', 'open', true);
insert into people (id, display_name, email, org_id) values
  ('ac200000-0000-4000-8000-000000000001', 'Bea As Acme Has Her', 'bea@example.com', 'a0000000-0000-4000-8000-00000000000a');

-- 1. Only the service role reaches the bridge.
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select * from bridge_client_jobs()$q$, '42501'), 'a member cannot list the bridge''s jobs');
select pg_temp.expect(pg_temp.raises($q$select * from bridge_submit_candidate('ac100000-0000-4000-8000-000000000001', 'm@t.com', 'M',
  '70000000-0000-4000-8000-000000000001', '{"email":"x@y.z","display_name":"X"}', null, 'dashboard')$q$, '42501'), 'nor submit');
select pg_temp.as_owner();
select pg_temp.as_role('anon');
select pg_temp.expect(pg_temp.raises($q$select * from bridge_submission_report(array[]::uuid[])$q$, '42501'), 'nor can the public key');
select pg_temp.as_owner();
select pg_temp.as_role('tacit_internal');
select pg_temp.expect(pg_temp.raises($q$select * from bridge_job_for_role('c0000000-0000-4000-8000-0000000000a1',
  '7e000000-0000-4000-8000-000000000001', 'T', null, null, null)$q$, '42501'), 'nor tacit_internal');
select pg_temp.as_owner();

select pg_temp.as_role('service_role');

-- 2. Jobs: open and not confidential, in client orgs.
-- Scoped to the fixtures' orgs, so the suite also runs on a project holding real client orgs.
select pg_temp.expect((select count(*) from bridge_client_jobs() where org_id in ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b')) = 1, 'one job Tacit may submit to');
select pg_temp.expect((select company_id = 'c0000000-0000-4000-8000-0000000000a1' and title = 'Engineer' from bridge_client_jobs() where org_id in ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b')),
  'named with the client''s company on tacit');
select pg_temp.expect((select count(*) from bridge_client_jobs('b0000000-0000-4000-8000-00000000000b')) = 0, 'none at Globex');
select pg_temp.expect(not exists (select 1 from bridge_client_jobs() where org_id = tacit_org_id()), 'nor in Tacit''s own org');

-- 3. A job for Tacit's role at the company: made once, then the same one.
select pg_temp.expect(not exists (select 1 from bridge_job_for_role('c0000000-0000-4000-8000-00000000ffff',
  '7e000000-0000-4000-8000-000000000001', 'Founding engineer', 'NYC', 'Senior', 'Build it')), 'no client is that company: nothing');
select set_config('tacit_test.job', (select role_id::text from bridge_job_for_role('c0000000-0000-4000-8000-0000000000a1',
  '7e000000-0000-4000-8000-000000000001', ' Founding engineer ', 'NYC', 'Senior', 'Build it')), true);
select pg_temp.expect((select r.org_id = 'a0000000-0000-4000-8000-00000000000a' and r.company_id = 'ac000000-0000-4000-8000-000000000001'
    and r.title = 'Founding engineer' and r.seniority = 'Senior' and r.status = 'open' and r.staff_role_id = '7e000000-0000-4000-8000-000000000001'
  from roles r where r.id = current_setting('tacit_test.job')::uuid), 'the job is Acme''s, under its own company, linked to Tacit''s role');
select pg_temp.expect((select count(*) from openings where role_id = current_setting('tacit_test.job')::uuid and status = 'open') = 1, 'with one opening');
select pg_temp.expect((select role_id::text from bridge_job_for_role('c0000000-0000-4000-8000-0000000000a1',
  '7e000000-0000-4000-8000-000000000001', 'Renamed', null, null, null)) = current_setting('tacit_test.job'), 'asked again: the same job');
select pg_temp.expect((select count(*) from roles where staff_role_id = '7e000000-0000-4000-8000-000000000001') = 1, 'never two');

-- 4. Submitting a new person: the teammate's actor, their access, the person
--    with Tacit's id, the application at Tacit's stage, the note, the audit row.
select pg_temp.expect(pg_temp.raises($q$select * from bridge_submit_candidate('ac100000-0000-4000-8000-000000000002', 'mate@tacitawareness.com', 'Mate',
  '70000000-0000-4000-8000-000000000001', '{"email":"tia@example.com","display_name":"Tia"}', null, 'dashboard')$q$, 'P0002'),
  'a confidential job is not found');
select pg_temp.expect(pg_temp.raises($q$select * from bridge_submit_candidate('ac100000-0000-4000-8000-000000000001', 'mate@tacitawareness.com', 'Mate',
  '70000000-0000-4000-8000-000000000001', '{"email":"tia@example.com","display_name":"Tia"}', null, 'slack')$q$, '22023'), 'an unknown source');
select pg_temp.expect(pg_temp.raises($q$select * from bridge_submit_candidate('ac100000-0000-4000-8000-000000000001', 'mate@tacitawareness.com', 'Mate',
  '70000000-0000-4000-8000-000000000001', '{"email":"tia@example.com","display_name":"Tia"}', null, 'dashboard', 'hired')$q$, '22023'),
  'a submission never starts at hired');
select pg_temp.expect(pg_temp.raises($q$select * from bridge_submit_candidate('ac100000-0000-4000-8000-000000000001', 'mate@tacitawareness.com', 'Mate',
  '70000000-0000-4000-8000-000000000001', '{"display_name":"Tia"}', null, 'dashboard')$q$, '22023'), 'a person needs an email');

create temp table sub as
select * from bridge_submit_candidate('ac100000-0000-4000-8000-000000000001', ' Mate@TacitAwareness.com ', 'Mate',
  '70000000-0000-4000-8000-000000000001',
  '{"email":"Tia@Example.com","display_name":"Tia Tacit","phone":"+1 555 0100","current_title":"Staff engineer","unique_about":"private"}',
  ' She is great ', 'claude', 'screening');
select pg_temp.expect((select status = 'submitted' and org_id = 'a0000000-0000-4000-8000-00000000000a' from sub), 'submitted');
select pg_temp.expect((select a.display_name = 'Mate (Tacit)' and a.email = 'mate@tacitawareness.com' and a.tacit_agency and a.access_level = 'elevated'
  from actors a join sub on sub.actor_id = a.id), 'the teammate is Acme''s "(Tacit)" agency actor, raised by their job access');
select pg_temp.expect((select ar.name = 'External Recruiter' from job_access ja join access_roles ar on ar.id = ja.access_role_id join sub on sub.actor_id = ja.actor_id
  where ja.role_id = 'ac100000-0000-4000-8000-000000000001'), 'with External Recruiter access to the job');
select pg_temp.expect((select p.display_name = 'Tia Tacit' and p.email = 'tia@example.com' and p.phone = '+1 555 0100' and p.current_title = 'Staff engineer'
    and p.prospect_source = 'agency' and p.staff_person_id = '70000000-0000-4000-8000-000000000001'
  from people p join sub on sub.person_id = p.id), 'the person, with Tacit''s id');
select pg_temp.expect((select a.stage = 'screening' and a.source = 'agency' and a.source_detail = 'Tacit · Mate'
  from applications a join sub on sub.application_id = a.id), 'the application at Tacit''s stage');
select pg_temp.expect((select string_agg(e.kind || ':' || e.to_stage, ',' order by e.created_at, e.kind) from application_events e join sub on sub.application_id = e.application_id)
  in ('added:sourced,stage_changed:screening', 'added:sourced,stage_changed:screening'), 'added, then moved to screening');
select pg_temp.expect((select n.text = 'She is great' and not n.private from person_notes n join sub on sub.person_id = n.person_id), 'the note, shared');
select pg_temp.expect((select l.source = 'claude' and l.action = 'application.agency_submit' and l.after ->> 'agency' = 'Tacit'
  and not (l.after ? 'note') from audit_log l join sub on sub.application_id = l.entity_id), 'audited with ids only');

-- 5. Again: already in the job. Someone Acme already has is left as Acme has
--    them; a second teammate gets their own actor.
select pg_temp.expect((select status from bridge_submit_candidate('ac100000-0000-4000-8000-000000000001', 'mate@tacitawareness.com', 'Mate',
  '70000000-0000-4000-8000-000000000001', '{"email":"tia@example.com","display_name":"Tia"}', null, 'dashboard')) = 'already_in_job', 'twice is once');
select pg_temp.expect((select application_id from bridge_submit_candidate('ac100000-0000-4000-8000-000000000001', 'mate@tacitawareness.com', 'Mate',
  '70000000-0000-4000-8000-000000000001', '{"email":"tia@example.com","display_name":"Tia"}', null, 'dashboard')) = (select application_id from sub),
  'and answers with the application they have');
select pg_temp.expect((select count(*) from applications where role_id = 'ac100000-0000-4000-8000-000000000001') = 1, 'one application');
create temp table bea as
select * from bridge_submit_candidate('ac100000-0000-4000-8000-000000000001', 'pal@tacitawareness.com', 'Pal',
  '70000000-0000-4000-8000-000000000002', '{"email":"BEA@example.com","display_name":"Bea Tacit"}', null, 'dashboard');
select pg_temp.expect((select person_id = 'ac200000-0000-4000-8000-000000000001' from bea), 'Acme''s Bea is found by email');
select pg_temp.expect((select display_name = 'Bea As Acme Has Her' and staff_person_id is null from people where id = 'ac200000-0000-4000-8000-000000000001'),
  'and left exactly as Acme has her');
select pg_temp.as_owner();
insert into applications (id, person_id, role_id, org_id, stage, source)
values ('ac300000-0000-4000-8000-0000000000b1', 'ac200000-0000-4000-8000-000000000001', current_setting('tacit_test.job')::uuid,
        'a0000000-0000-4000-8000-00000000000a', 'screening', 'referral');
select pg_temp.as_role('service_role');
select pg_temp.expect((select status = 'already_in_job' and application_id is null from bridge_submit_candidate(current_setting('tacit_test.job')::uuid,
  'pal@tacitawareness.com', 'Pal', '70000000-0000-4000-8000-000000000002', '{"email":"bea@example.com","display_name":"Bea"}', null, 'dashboard')),
  'someone Acme put in a job themselves: already in it, and no application to count as Tacit''s');
select pg_temp.expect((select count(*) from actors where tacit_agency and org_id = 'a0000000-0000-4000-8000-00000000000a') = 2, 'two teammates, two actors');

-- 6. A removed real member with the teammate's email is refused; a Tacit
--    actor archived before is brought back.
select pg_temp.expect(pg_temp.raises($q$select * from bridge_submit_candidate('ac100000-0000-4000-8000-000000000001', 'gone@tacitawareness.com', 'Gone',
  '70000000-0000-4000-8000-000000000003', '{"email":"cy@example.com","display_name":"Cy"}', null, 'dashboard')$q$, '42501'),
  'a member the client removed cannot submit');
select pg_temp.as_owner();
update actors set archived_at = now() where email = 'pal@tacitawareness.com';
select pg_temp.as_role('service_role');
select pg_temp.expect((select status from bridge_submit_candidate(current_setting('tacit_test.job')::uuid, 'pal@tacitawareness.com', 'Pal',
  '70000000-0000-4000-8000-000000000003', '{"email":"cy@example.com","display_name":"Cy"}', null, 'dashboard')) = 'submitted', 'an archived Tacit actor submits again');
select pg_temp.expect((select archived_at is null from actors where email = 'pal@tacitawareness.com'), 'and is back');

-- 7. The report: the live stage, the merged-into one's after a merge.
select pg_temp.expect((select stage = 'screening' and job_title = 'Engineer' and company_id = 'c0000000-0000-4000-8000-0000000000a1'
  from bridge_submission_report((select array_agg(application_id) from sub))), 'Tacit reads the stage it submitted at');
select pg_temp.as_owner();
insert into applications (id, person_id, role_id, org_id, stage, source)
values ('ac300000-0000-4000-8000-000000000001', (select person_id from sub), current_setting('tacit_test.job')::uuid,
        'a0000000-0000-4000-8000-00000000000a', 'offer', 'sourced');
update applications set merged_into_id = 'ac300000-0000-4000-8000-000000000001' where id = (select application_id from sub);
select pg_temp.as_role('service_role');
select pg_temp.expect((select stage = 'offer' and job_title = 'Founding engineer'
  from bridge_submission_report((select array_agg(application_id) from sub))), 'after a merge, the application it was merged into');
select pg_temp.expect((select count(*) from bridge_submission_report(array['ac300000-0000-4000-8000-0000000000ff']::uuid[])) = 0, 'an unknown id: nothing');

select pg_temp.as_owner();
select 'bridge: all checks passed';
rollback;
