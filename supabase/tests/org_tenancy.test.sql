-- Tenancy isolation checks for 20261012200000_add_org_tenancy, and the
-- per-level permission checks for 20261013120000_client_permissions.
--
-- Copied from tacit-internal's packages/db/supabase/tests at the split
-- (scripts/client-track/extract-baseline.mjs), minus the staff-only checks:
-- the /apply portal token, app_secrets and Tacit's submissions.
--
-- Runs against a freshly migrated database (supabase db reset, or any stack
-- with every migration applied), inside one transaction that is rolled back,
-- so it leaves nothing behind:
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/org_tenancy.test.sql
--
-- Every check raises on failure, so ON_ERROR_STOP turns the first failure
-- into a non-zero exit. src/org-tenancy.integration.test.ts runs it in CI.

begin;

-- Helpers: act as a signed-in member, or as the service role / anon.
create function pg_temp.as_member(sub text, org_claim text default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', sub, 'role', 'authenticated', 'org_id', org_claim)::text, true);
  execute 'set local role authenticated';
end $$;

-- The table owner, with no signed-in user: set-local claims outlive a
-- `reset role`, and the actor triggers would otherwise act for the last member.
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

create function pg_temp.as_tacit_internal() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"tacit_internal"}', true);
  execute 'set local role tacit_internal';
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

grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- Fixtures, as the table owner.
-- A member's token must carry its org's WorkOS organization: an org without
-- one answers for no signed-in user.
insert into orgs (id, name, slug, workos_org_id) values
  ('a0000000-0000-4000-8000-00000000000a', 'Acme', 'acme', 'org_acme'),
  ('b0000000-0000-4000-8000-00000000000b', 'Globex', 'globex', 'org_globex');
insert into actors (id, slug, display_name, org_id, access_level, auth_subject) values
  ('a1000000-0000-4000-8000-000000000001', 'acme-admin', 'Acme Admin', 'a0000000-0000-4000-8000-00000000000a', 'admin', 'user_acme'),
  ('a1000000-0000-4000-8000-000000000002', 'acme-int', 'Acme Interviewer', 'a0000000-0000-4000-8000-00000000000a', 'limited', 'user_acme_int'),
  ('b1000000-0000-4000-8000-000000000001', 'globex-rec', 'Globex Recruiter', 'b0000000-0000-4000-8000-00000000000b', 'admin', 'user_globex'),
  ('71000000-0000-4000-8000-000000000001', 'tacit-mate', 'Tacit Teammate', tacit_org_id(), 'admin', null);

-- 1. Service-role writes that predate tenancy still land in Tacit, and a
--    child inherits its parent's org.
select pg_temp.as_service();
insert into people (id, display_name, email) values ('70000000-0000-4000-8000-000000000001', 'Ada Tacit', 'ada@example.com');
insert into person_notes (person_id, text) values ('70000000-0000-4000-8000-000000000001', 'met at a hackathon');
select pg_temp.expect((select org_id from people where id = '70000000-0000-4000-8000-000000000001') = tacit_org_id(), 'service-role person defaults to Tacit');
select pg_temp.expect((select org_id from person_notes where person_id = '70000000-0000-4000-8000-000000000001') = tacit_org_id(), 'note inherits Tacit from its person');
select pg_temp.expect((select count(*) from person_identifiers where person_id = '70000000-0000-4000-8000-000000000001' and org_id = tacit_org_id()) = 1, 'identifier trigger rows inherit the org');
reset role;

-- 2. The anon /apply insert is unchanged and lands in Tacit.
select pg_temp.as_anon();
insert into people (display_name, email, applicant_status) values ('Applicant', 'applicant@example.com', 'received');
reset role;
select pg_temp.expect((select org_id from people where email = 'applicant@example.com') = tacit_org_id(), 'anon /apply insert lands in Tacit');

-- 3. A client admin builds their own ATS without ever naming org_id.
select pg_temp.as_member('user_acme', 'org_acme');
insert into companies (id, name) values ('ac000000-0000-4000-8000-000000000001', 'Acme');
insert into roles (id, company_id, title) values ('ac100000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001', 'Founding engineer');
insert into people (id, display_name, email) values ('ac200000-0000-4000-8000-000000000001', 'Ada Acme', 'ada@example.com');
insert into applications (id, person_id, role_id) values ('ac300000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001');
insert into application_events (application_id, kind) values ('ac300000-0000-4000-8000-000000000001', 'added');
insert into person_notes (person_id, text) values ('ac200000-0000-4000-8000-000000000001', 'strong systems taste');
select pg_temp.expect((select count(*) from people) = 1, 'Acme sees only its own person');
select pg_temp.expect((select org_id from applications where id = 'ac300000-0000-4000-8000-000000000001') = 'a0000000-0000-4000-8000-00000000000a', 'application filed under Acme');
select pg_temp.expect((select count(*) from orgs) = 1, 'Acme sees only its own org');
select pg_temp.expect((select count(*) from org_members) = 2, 'a member reads their own org''s team list');
do $$ begin
  perform count(granola_api_key) from actors;
  raise exception 'FAILED: a member read a token column on actors';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update actors set access_level = 'admin' where slug = 'acme-int';
  raise exception 'FAILED: a member wrote to actors';
exception when insufficient_privilege then null;
end $$;
reset role;
-- The same email in two orgs is two people.
select pg_temp.expect((select count(*) from people where email = 'ada@example.com') = 2, 'one email, two orgs, two rows');

-- 3b. Matching is per org (20261012230000): the address is indexed once in
--     each org, and every lookup answers inside one org.
select pg_temp.expect((select count(*) from person_identifiers where kind = 'email' and value = 'ada@example.com') = 2,
  'the same address is indexed in both orgs');
select pg_temp.expect((select candidate_id from connector_add_person('Ada', 'ada@example.com')) = '70000000-0000-4000-8000-000000000001',
  'connector_add_person defaults to Tacit and finds Tacit''s Ada');
select pg_temp.expect((select candidate_id from connector_add_person('Ada', 'ADA@example.com', null, null, 'a0000000-0000-4000-8000-00000000000a')) = 'ac200000-0000-4000-8000-000000000001',
  'connector_add_person in Acme finds Acme''s Ada');

-- 4. Acme cannot reach Tacit's or Globex's rows, by any route.
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(not exists (select 1 from people where id = '70000000-0000-4000-8000-000000000001'), 'Tacit person invisible to Acme');
select pg_temp.expect(not exists (select 1 from person_notes where org_id = tacit_org_id()), 'Tacit notes invisible to Acme');
update people set display_name = 'hijacked' where id = '70000000-0000-4000-8000-000000000001';
reset role;
select pg_temp.expect((select display_name from people where id = '70000000-0000-4000-8000-000000000001') = 'Ada Tacit', 'Acme cannot update a Tacit person');

do $$ begin
  perform pg_temp.as_member('user_acme', 'org_acme');
  insert into applications (person_id, role_id) values ('70000000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001');
  raise exception 'FAILED: Acme put a Tacit person in its pipeline';
exception when foreign_key_violation then null;
end $$;
reset role;

do $$ begin
  perform pg_temp.as_member('user_acme', 'org_acme');
  insert into people (display_name, org_id) values ('smuggled', tacit_org_id());
  raise exception 'FAILED: Acme wrote a row into Tacit';
exception when insufficient_privilege then null;
end $$;
reset role;

do $$ begin
  perform pg_temp.as_member('user_acme', 'org_acme');
  update people set org_id = 'b0000000-0000-4000-8000-00000000000b' where id = 'ac200000-0000-4000-8000-000000000001';
  raise exception 'FAILED: Acme moved its person into Globex';
exception when insufficient_privilege or foreign_key_violation then null;
end $$;
reset role;

-- History is append-only for members.
select pg_temp.as_member('user_acme', 'org_acme');
update application_events set kind = 'note' where application_id = 'ac300000-0000-4000-8000-000000000001';
delete from application_events where application_id = 'ac300000-0000-4000-8000-000000000001';
reset role;
select pg_temp.expect((select kind from application_events where application_id = 'ac300000-0000-4000-8000-000000000001') = 'added', 'members cannot edit or delete history');

-- 5. Globex sees none of Acme.
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from people) = 0, 'Globex sees no people');
select pg_temp.expect((select count(*) from applications) = 0, 'Globex sees no applications');
reset role;

-- 6. A limited member, strangers, and a token for the wrong or no WorkOS org see nothing.
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from people) = 0, 'a limited member reads no people');
reset role;
select pg_temp.as_member('nobody', 'org_acme');
select pg_temp.expect((select count(*) from people) = 0, 'unknown subject sees nothing');
reset role;
select pg_temp.as_member('user_acme', 'org_somebody_else');
select pg_temp.expect((select count(*) from people) = 0, 'token for another WorkOS org sees nothing');
reset role;
select pg_temp.as_member('user_acme', 'org_globex');
select pg_temp.expect((select count(*) from people) = 0, 'an Acme user holding a Globex token sees nothing');
reset role;
select pg_temp.as_member('user_acme');
select pg_temp.expect((select count(*) from people) = 0, 'token with no org claim sees nothing');
select pg_temp.expect(current_org_id() is null, 'no org claim resolves no org');
reset role;
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select count(*) from people) = 1, 'matching WorkOS org claim sees its rows');
reset role;
select pg_temp.as_anon();
select pg_temp.expect((select count(*) from applications) = 0, 'anon sees nothing');
reset role;

-- 7. Server code writing for a client person follows the person's org, and
--    cannot mislabel it.
select pg_temp.as_service();
insert into person_notes (person_id, text) values ('ac200000-0000-4000-8000-000000000001', 'server-side note');
select pg_temp.expect((select org_id from person_notes where text = 'server-side note') = 'a0000000-0000-4000-8000-00000000000a', 'service-role note inherits the client org');
reset role;
do $$ begin
  perform pg_temp.as_service();
  insert into person_notes (person_id, text, org_id) values ('ac200000-0000-4000-8000-000000000001', 'mislabelled', tacit_org_id());
  raise exception 'FAILED: a note was filed in a different org from its person';
exception when foreign_key_violation then null;
end $$;
reset role;
do $$ begin
  perform pg_temp.as_service();
  -- A Tacit teammate cannot author inside Acme without an Acme actor.
  insert into person_notes (person_id, text, actor_id) values ('ac200000-0000-4000-8000-000000000001', 'cross-org author', '71000000-0000-4000-8000-000000000001');
  raise exception 'FAILED: a Tacit actor authored a note in Acme';
exception when foreign_key_violation then null;
end $$;
reset role;

-- 8. merge_people never crosses orgs, and still works inside one.
select pg_temp.as_service();
do $$ begin
  perform merge_people('70000000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-000000000001');
  raise exception 'FAILED: merged across orgs';
exception when raise_exception then
  if sqlerrm not like '%different orgs%' then raise; end if;
end $$;
insert into people (id, display_name) values ('ac200000-0000-4000-8000-000000000002', 'Ada A.');
update people set org_id = 'a0000000-0000-4000-8000-00000000000a' where id = 'ac200000-0000-4000-8000-000000000002';
select merge_people('ac200000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-000000000002');
select pg_temp.expect((select org_id from people_merges where primary_id = 'ac200000-0000-4000-8000-000000000001') = 'a0000000-0000-4000-8000-00000000000a', 'same-org merge recorded under the org');
reset role;

-- 8b. tacit_internal (20261012240000), the role Tacit's apps use: Tacit's org
--     only, by every route, including the definer merge_people.
select pg_temp.as_tacit_internal();
select pg_temp.expect(exists (select 1 from people where id = '70000000-0000-4000-8000-000000000001'), 'tacit_internal sees Tacit''s people');
select pg_temp.expect(not exists (select 1 from people where org_id <> tacit_org_id()), 'tacit_internal sees no client people');
select pg_temp.expect(not exists (select 1 from applications), 'tacit_internal sees no client pipeline');
select pg_temp.expect((select count(*) from orgs) = 3, 'tacit_internal can list orgs');
insert into person_notes (person_id, text) values ('70000000-0000-4000-8000-000000000001', 'internal note');
select pg_temp.expect((select org_id from person_notes where text = 'internal note') = tacit_org_id(), 'tacit_internal writes land in Tacit');
update people set display_name = 'touched' where id = 'ac200000-0000-4000-8000-000000000001';
reset role;
select pg_temp.expect((select display_name from people where id = 'ac200000-0000-4000-8000-000000000001') = 'Ada Acme', 'tacit_internal cannot update a client person');
do $$ begin
  perform pg_temp.as_tacit_internal();
  insert into people (display_name, org_id) values ('smuggled', 'a0000000-0000-4000-8000-00000000000a');
  raise exception 'FAILED: tacit_internal wrote into a client org';
exception when insufficient_privilege then null;
end $$;
reset role;
select pg_temp.as_tacit_internal();
reset role;
insert into people (id, display_name, org_id) values ('ac200000-0000-4000-8000-000000000003', 'Ada A. again', 'a0000000-0000-4000-8000-00000000000a');
do $$ begin
  perform pg_temp.as_tacit_internal();
  perform merge_people('ac200000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-000000000003');
  raise exception 'FAILED: tacit_internal merged client people';
exception when raise_exception then
  if sqlerrm not like '%not in Tacit''s org%' then raise; end if;
end $$;
reset role;
delete from people where id = 'ac200000-0000-4000-8000-000000000003';

-- 10. Access levels inside one org (20261013120000_client_permissions).
--     Acme: an admin, a hiring manager on one of three jobs, a limited
--     interviewer, an external recruiter, and someone who is also in Globex.
select pg_temp.as_owner();
insert into actors (id, slug, display_name, email, org_id, access_level, auth_subject) values
  ('a1000000-0000-4000-8000-000000000003', 'acme-hm', 'Acme Hiring Manager', 'hm@acme.test', 'a0000000-0000-4000-8000-00000000000a', 'limited', 'user_acme_hm'),
  ('a1000000-0000-4000-8000-000000000004', 'acme-ext', 'Acme Agency', 'ext@agency.test', 'a0000000-0000-4000-8000-00000000000a', 'limited', 'user_acme_ext'),
  ('a1000000-0000-4000-8000-000000000005', 'acme-both', 'Both Orgs', 'both@example.test', 'a0000000-0000-4000-8000-00000000000a', 'admin', 'user_both'),
  -- The same human in Globex: same email, same sign-in subject, a second actor.
  ('b1000000-0000-4000-8000-000000000005', 'globex-both', 'Both Orgs', 'both@example.test', 'b0000000-0000-4000-8000-00000000000b', 'limited', 'user_both');
select pg_temp.expect((select count(*) from access_roles where org_id = 'a0000000-0000-4000-8000-00000000000a' and is_builtin) = 6,
  'a new org is seeded with the six built-in access roles');
select pg_temp.expect((select count(*) from hiring_team_role_access where org_id = 'b0000000-0000-4000-8000-00000000000b') = 5,
  'and with a mapping for each hiring-team role');

insert into roles (id, company_id, title, org_id) values
  ('ac100000-0000-4000-8000-000000000002', 'ac000000-0000-4000-8000-000000000001', 'Designer', 'a0000000-0000-4000-8000-00000000000a');
insert into roles (id, company_id, title, org_id, confidential) values
  ('ac100000-0000-4000-8000-000000000003', 'ac000000-0000-4000-8000-000000000001', 'Chief of staff', 'a0000000-0000-4000-8000-00000000000a', true);
insert into people (id, display_name, email, current_title, org_id) values
  ('ac200000-0000-4000-8000-00000000000b', 'Bob Acme', 'bob@example.com', 'Designer', 'a0000000-0000-4000-8000-00000000000a'),
  ('ac200000-0000-4000-8000-00000000000c', 'Cy Acme', 'cy@example.com', 'Engineer', 'a0000000-0000-4000-8000-00000000000a'),
  ('ac200000-0000-4000-8000-00000000000d', 'Dee Acme', 'dee@example.com', null, 'a0000000-0000-4000-8000-00000000000a'),
  ('ac200000-0000-4000-8000-00000000000e', 'Eve Acme', 'eve@example.com', null, 'a0000000-0000-4000-8000-00000000000a');
insert into applications (id, person_id, role_id, added_by_actor_id) values
  ('ac300000-0000-4000-8000-00000000000b', 'ac200000-0000-4000-8000-00000000000b', 'ac100000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001'),
  ('ac300000-0000-4000-8000-00000000000c', 'ac200000-0000-4000-8000-00000000000c', 'ac100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004'),
  ('ac300000-0000-4000-8000-00000000000e', 'ac200000-0000-4000-8000-00000000000e', 'ac100000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001');
select pg_temp.expect((select added_by_actor_id from applications where id = 'ac300000-0000-4000-8000-000000000001') = 'a1000000-0000-4000-8000-000000000001',
  'an application a member adds is stamped with them');

-- The hiring team grants job access, and job access raises a limited actor.
insert into hiring_team (role_id, actor_id, team_role) values
  ('ac100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'hiring_manager'),
  ('ac100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'interviewer');
select pg_temp.expect((select ar.name from job_access ja join access_roles ar on ar.id = ja.access_role_id
  where ja.actor_id = 'a1000000-0000-4000-8000-000000000003' and ja.role_id = 'ac100000-0000-4000-8000-000000000001') = 'Hiring Manager',
  'a hiring manager on the team gets the Hiring Manager access role');
select pg_temp.expect((select access_level from actors where slug = 'acme-hm') = 'elevated', 'gaining job access raises limited to elevated');
select pg_temp.expect(not exists (select 1 from job_access where actor_id = 'a1000000-0000-4000-8000-000000000002'),
  'an interviewer on the team gets no job access');
select pg_temp.expect((select access_level from actors where slug = 'acme-int') = 'limited', 'and stays limited');
insert into job_access (role_id, actor_id, access_role_id)
select 'ac100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004', id
from access_roles where org_id = 'a0000000-0000-4000-8000-00000000000a' and name = 'External Recruiter';

insert into interviews (id, application_id, starts_at, ends_at, interviewer_actor_ids) values
  ('ac400000-0000-4000-8000-000000000001', 'ac300000-0000-4000-8000-000000000001', now() + interval '1 day', now() + interval '1 day 1 hour',
   array['a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003']::uuid[]);
insert into person_notes (person_id, text, actor_id, private) values
  ('ac200000-0000-4000-8000-000000000001', 'comp expectations', 'a1000000-0000-4000-8000-000000000001', true);
insert into transcript_entries (person_id, source, source_ref, sent_at, from_me, text) values
  ('ac200000-0000-4000-8000-000000000001', 'granola', 'note-acme#t0', now(), false, 'hello'),
  ('ac200000-0000-4000-8000-00000000000c', 'granola', 'note-cy#t0', now(), false, 'hello');
insert into person_files (person_id, kind, storage_path, filename) values
  ('ac200000-0000-4000-8000-000000000001', 'resume', 'a0000000-0000-4000-8000-00000000000a/ada/resume', 'ada.pdf'),
  ('ac200000-0000-4000-8000-000000000001', 'attachment', 'a0000000-0000-4000-8000-00000000000a/ada/portfolio', 'portfolio.pdf');
select pg_temp.expect((select org_id from person_files where kind = 'resume') = 'a0000000-0000-4000-8000-00000000000a', 'a file inherits its person''s org');
-- A tag on Ada and on the external recruiter's candidate, so the per-level
-- loops below see tags (20261015150000_client_sources_tags).
insert into tags (id, name, org_id) values ('ac500000-0000-4000-8000-000000000001', 'Strong', 'a0000000-0000-4000-8000-00000000000a');
insert into person_tags (person_id, tag_id) values
  ('ac200000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000001'),
  ('ac200000-0000-4000-8000-00000000000c', 'ac500000-0000-4000-8000-000000000001');
select pg_temp.expect((select count(*) from person_tags where org_id = 'a0000000-0000-4000-8000-00000000000a') = 2, 'a tag on a person inherits their org');

-- 10a. Admin: the org, minus confidential jobs and private data.
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select count(*) from people) = 5, 'admin reads every person in the org');
select pg_temp.expect((select count(*) from roles) = 2, 'admin does not see a confidential job without the flag');
select pg_temp.expect((select count(*) from applications) = 3, 'nor its applications');
select pg_temp.expect((select count(*) from companies) = 1, 'admin reads companies');
select pg_temp.expect((select count(*) from person_notes where private) = 1, 'an author reads their own private note');
select pg_temp.expect((select count(*) from transcript_entries) = 2, 'admin reads transcripts');
select pg_temp.as_owner();
update actors set can_view_all_confidential = true where slug = 'acme-admin';
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select count(*) from roles) = 3, 'can_view_all_confidential opens confidential jobs to an admin');
select pg_temp.as_member('user_both', 'org_acme');
select pg_temp.expect((select count(*) from person_notes where private) = 0, 'another admin cannot read a private note without can_view_private');
select pg_temp.expect((select count(*) from person_notes) = 2, 'but reads the others');
select pg_temp.as_owner();
update actors set can_view_private = true where slug = 'acme-both';
select pg_temp.as_member('user_both', 'org_acme');
select pg_temp.expect((select count(*) from person_notes where private) = 1, 'can_view_private opens private notes');

-- 10b. One human, two orgs: each token acts in its own org, at that org's level.
select pg_temp.expect(current_org_id() = 'a0000000-0000-4000-8000-00000000000a', 'the Acme token resolves Acme');
select pg_temp.expect((select count(*) from people) = 5, 'and reads Acme as an admin');
select pg_temp.as_member('user_both', 'org_globex');
select pg_temp.expect(current_org_id() = 'b0000000-0000-4000-8000-00000000000b', 'the Globex token resolves Globex');
select pg_temp.expect(current_access_level() = 'limited', 'at Globex''s level, not Acme''s');
select pg_temp.expect((select count(*) from people) = 0, 'and reads no Acme people');
select pg_temp.expect((select count(*) from roles) = 0, 'or jobs');

-- 10c. Hiring manager on one job: that job's pipeline and nothing beside it.
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from roles) = 1, 'hiring manager sees only their job');
select pg_temp.expect((select count(*) from applications) = 2, 'and its two applications');
select pg_temp.expect((select array_agg(display_name order by display_name) from people) = array['Ada Acme', 'Cy Acme', 'Dee Acme'],
  'their candidates, plus the person who is in no pipeline yet');
select pg_temp.expect((select count(*) from person_notes) = 2, 'non-private notes on their candidates');
select pg_temp.expect((select count(*) from person_notes where private) = 0, 'no private notes');
select pg_temp.expect((select count(*) from transcript_entries) = 2, 'their candidates'' transcripts');
select pg_temp.expect((select count(*) from person_files) = 2, 'and files');
select pg_temp.expect((select count(*) from companies) = 0, 'no companies: admin only');
select pg_temp.expect((select count(*) from audit_log) = 0 and (select count(*) from enrichment_records) = 0, 'no audit log or enrichment');
select pg_temp.expect((select count(*) from job_access) = 2, 'they see who has access to their job');
update applications set stage = 'screening' where id = 'ac300000-0000-4000-8000-000000000001';
select pg_temp.expect((select stage from applications where id = 'ac300000-0000-4000-8000-000000000001') = 'screening', 'they can move a stage on their job');
insert into application_events (application_id, kind) values ('ac300000-0000-4000-8000-000000000001', 'stage_changed');
update people set current_title = 'Staff engineer' where id = 'ac200000-0000-4000-8000-000000000001';
select pg_temp.expect((select current_title from people where id = 'ac200000-0000-4000-8000-000000000001') = 'Staff engineer', 'and edit their candidate');
update people set current_title = 'hijacked' where id = 'ac200000-0000-4000-8000-00000000000b';
do $$ begin
  insert into applications (person_id, role_id) values ('ac200000-0000-4000-8000-00000000000d', 'ac100000-0000-4000-8000-000000000002');
  raise exception 'FAILED: a hiring manager added a candidate to a job they are not on';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into job_access (role_id, actor_id, access_role_id)
  select 'ac100000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', id from access_roles where name = 'Admin';
  raise exception 'FAILED: a hiring manager granted themselves access to another job';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into roles (company_id, title) values ('ac000000-0000-4000-8000-000000000001', 'Rogue role');
  raise exception 'FAILED: a non-admin created a job';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update applications set added_by_actor_id = 'a1000000-0000-4000-8000-000000000003' where id = 'ac300000-0000-4000-8000-00000000000c';
  raise exception 'FAILED: a non-admin changed who added an application';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform can_on_role('ac100000-0000-4000-8000-000000000001', 'can_do_anything');
  raise exception 'FAILED: can_on_role accepted an unknown permission';
exception when raise_exception then
  if sqlerrm not like '%unknown permission%' then raise; end if;
end $$;
select pg_temp.as_owner();
select pg_temp.expect((select current_title from people where id = 'ac200000-0000-4000-8000-00000000000b') = 'Designer',
  'a hiring manager cannot edit a candidate on another job');

-- 10d. Limited interviewer: their interviews, the fixed card, the resume.
--      Every table with an org_id is checked, so one nobody thought about fails here.
select pg_temp.as_member('user_acme_int', 'org_acme');
do $$
declare
  t text;
  n bigint;
  allowed jsonb := '{"interviews": 1, "roles": 1, "person_files": 1, "actors": 5, "access_roles": 6,
                     "hiring_team_role_access": 5, "hiring_team": 1}';
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'org_id' and tb.table_type = 'BASE TABLE'
    order by 1
  loop
    if t = 'actors' then
      select count(id) into n from actors;
    else
      execute format('select count(*) from public.%I', t) into n;
    end if;
    if n <> coalesce((allowed ->> t)::bigint, 0) then
      raise exception 'FAILED: a limited interviewer reads % row(s) of %, expected %', n, t, coalesce(allowed ->> t, '0');
    end if;
  end loop;
end $$;
select pg_temp.expect((select kind from person_files) = 'resume', 'the one file a limited interviewer reads is the resume');
select pg_temp.expect((select count(*) from my_interview_candidates()) = 1, 'a limited interviewer gets one candidate card');
select pg_temp.expect(
  (select array_agg(k order by k) from jsonb_object_keys((select to_jsonb(c) from my_interview_candidates() c)) k)
    = array['current_company', 'current_title', 'display_name', 'linkedin_url', 'person_id'],
  'the candidate card is exactly five fields');
insert into person_notes (person_id, text) values ('ac200000-0000-4000-8000-000000000001', 'sharp on systems');
select pg_temp.expect((select count(*) from person_notes) = 1, 'they read their own note and no one else''s');
insert into interview_feedback (interview_id, recommendation, notes) values ('ac400000-0000-4000-8000-000000000001', 'yes', 'solid');
select pg_temp.expect((select interviewer_actor_id from interview_feedback) = 'a1000000-0000-4000-8000-000000000002', 'feedback is filed as its author');
do $$ begin
  insert into interview_feedback (interview_id, interviewer_actor_id, recommendation, notes)
  values ('ac400000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'strong_no', 'forged');
  raise exception 'FAILED: an interviewer filed feedback as someone else';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into person_notes (person_id, text) values ('ac200000-0000-4000-8000-00000000000b', 'never met them');
  raise exception 'FAILED: an interviewer wrote a note on someone they do not interview';
exception when insufficient_privilege then null;
end $$;

-- 10e. Feedback visibility. Default after_submit: the hiring manager is on
--      the interview too and has not filed, so cannot read the other's yet.
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from interview_feedback) = 0, 'after_submit hides others'' feedback until yours is in');
insert into interview_feedback (interview_id, recommendation, notes) values ('ac400000-0000-4000-8000-000000000001', 'strong_yes', 'hire');
select pg_temp.expect((select count(*) from interview_feedback) = 2, 'and shows it once it is');
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from interview_feedback) = 1, 'someone without can_view_feedback only ever reads their own');
select pg_temp.as_owner();
update orgs set feedback_visibility = 'never' where slug = 'acme';
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from interview_feedback) = 1, 'never: only your own');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select count(*) from interview_feedback) = 2, 'an admin reads all feedback in every mode');

-- 10f. External recruiter: the candidates they added, and no detail.
select pg_temp.as_member('user_acme_ext', 'org_acme');
do $$
declare
  t text;
  n bigint;
  allowed jsonb := '{"applications": 1, "people": 1, "roles": 1, "actors": 5, "access_roles": 6,
                     "hiring_team_role_access": 5, "job_access": 1, "rejection_reasons": 14,
                     "tags": 1, "person_tags": 1}';
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'org_id' and tb.table_type = 'BASE TABLE'
    order by 1
  loop
    if t = 'actors' then
      select count(id) into n from actors;
    else
      execute format('select count(*) from public.%I', t) into n;
    end if;
    if n <> coalesce((allowed ->> t)::bigint, 0) then
      raise exception 'FAILED: an external recruiter reads % row(s) of %, expected %', n, t, coalesce(allowed ->> t, '0');
    end if;
  end loop;
end $$;
select pg_temp.expect((select display_name from people) = 'Cy Acme', 'the one person an external recruiter reads is the one they added');
update applications set stage = 'contacted' where id = 'ac300000-0000-4000-8000-00000000000c';
select pg_temp.expect((select stage from applications) = 'contacted', 'they can move their own candidate');
update applications set stage = 'rejected' where id = 'ac300000-0000-4000-8000-000000000001';
select pg_temp.as_owner();
select pg_temp.expect((select stage from applications where id = 'ac300000-0000-4000-8000-000000000001') = 'screening',
  'an external recruiter cannot touch a candidate someone else added');

-- 11. Client admins invite their own team (20261014120000_client_invites).
select pg_temp.as_owner();
create function pg_temp.raises(stmt text, code text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return sqlstate = code;
end $$;
grant execute on function pg_temp.raises(text, text) to authenticated;

select pg_temp.as_member('user_acme', 'org_acme');
-- Kept in a setting rather than a temp table: the member may not create one.
select set_config('tacit_test.invited',
  (select actor_id::text || ' ' || resent::text from invite_org_member('  New.Hire@Acme.test ', 'New Hire', 'elevated')), true);
select pg_temp.expect(split_part(current_setting('tacit_test.invited'), ' ', 2) = 'false', 'a first invitation makes an actor');
select pg_temp.expect((select resent from invite_org_member('new.hire@ACME.test', 'Someone Else', 'admin')),
  'inviting the same address again only re-sends');
select pg_temp.expect((select actor_id from invite_org_member('new.hire@acme.test', 'x', 'limited')) = split_part(current_setting('tacit_test.invited'), ' ', 1)::uuid,
  'and lands on the same actor');
select pg_temp.expect((select email || '/' || access_level from org_pending_invites()) = 'new.hire@acme.test/elevated',
  'an admin sees the pending invitation, unchanged by the re-sends');
select pg_temp.expect(exists (select 1 from org_members where email = 'new.hire@acme.test'), 'the invited person is on the team list');
select pg_temp.expect(pg_temp.raises($q$select * from invite_org_member('hm@acme.test', 'HM', 'admin')$q$, '23505'),
  'an address that has signed in is refused');
select pg_temp.expect(pg_temp.raises($q$select * from invite_org_member('not an email', 'X', 'limited')$q$, '22023'),
  'a bad address is refused');
select pg_temp.expect(pg_temp.raises($q$select * from invite_org_member('a@acme.test', 'X', 'owner')$q$, '22023'),
  'an unknown level is refused');
select pg_temp.expect(not withdraw_org_invite('a1000000-0000-4000-8000-000000000003'), 'a signed-in member cannot be withdrawn');

select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select * from invite_org_member('b@acme.test', 'B', 'admin')$q$, '42501'),
  'a non-admin cannot invite');
select pg_temp.expect(not exists (select 1 from org_pending_invites()), 'nor see who is invited');
select pg_temp.expect(pg_temp.raises($q$select withdraw_org_invite('00000000-0000-4000-8000-000000000000')$q$, '42501'),
  'nor withdraw');
select pg_temp.as_member('user_acme', null);
select pg_temp.expect(pg_temp.raises($q$select * from invite_org_member('b@acme.test', 'B', 'admin')$q$, '42501'),
  'a token without the org cannot invite');

select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect(not exists (select 1 from org_pending_invites()), 'another org''s admin sees none of Acme''s invitations');
select pg_temp.expect(not withdraw_org_invite(split_part(current_setting('tacit_test.invited'), ' ', 1)::uuid), 'nor can withdraw one');

select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(withdraw_org_invite(split_part(current_setting('tacit_test.invited'), ' ', 1)::uuid), 'an admin withdraws their own org''s invitation');
select pg_temp.expect(not exists (select 1 from org_pending_invites()), 'and it is gone');
select pg_temp.as_owner();

-- 12. A member's write claims (20261014180000_client_write_audit).
select pg_temp.as_member('user_acme', 'org_acme');
select set_config('tacit_test.claim', client_claim_write('claude', 'note.add', 'person')::text, true);
select pg_temp.expect(current_setting('tacit_test.claim') <> '', 'a member can claim a write');
select pg_temp.as_owner();
select pg_temp.expect((select actor_id = 'a1000000-0000-4000-8000-000000000001' and org_id = 'a0000000-0000-4000-8000-00000000000a' and after is null
  from audit_log where id = current_setting('tacit_test.claim')::uuid), 'the claim is the caller''s, in the caller''s org, still open');

select pg_temp.as_member('user_acme_int', 'org_acme');
select client_finish_write(current_setting('tacit_test.claim')::uuid, null, null, '{"x":1}'::jsonb, true);
select pg_temp.as_owner();
select pg_temp.expect((select after is null from audit_log where id = current_setting('tacit_test.claim')::uuid),
  'another member cannot complete someone else''s claim');

select pg_temp.as_member('user_acme', 'org_acme');
select client_finish_write(current_setting('tacit_test.claim')::uuid, 'ac200000-0000-4000-8000-00000000000b', '{}'::jsonb, '{"x":1}'::jsonb, true);
select pg_temp.as_owner();
select pg_temp.expect((select after = '{"x":1}'::jsonb from audit_log where id = current_setting('tacit_test.claim')::uuid),
  'the claimer completes their own');

select pg_temp.as_member('user_acme', 'org_acme');
select set_config('tacit_test.claim2', client_claim_write('chatgpt', 'application.stage_change', 'application')::text, true);
select client_finish_write(current_setting('tacit_test.claim2')::uuid, null, null, null, false);
select pg_temp.as_owner();
select pg_temp.expect(not exists (select 1 from audit_log where id = current_setting('tacit_test.claim2')::uuid),
  'a claim whose write changed nothing is given back');

select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select client_claim_write('slack', 'note.add', 'person')$q$, '22023'), 'only the connector''s and the web app''s sources');
select pg_temp.expect(pg_temp.raises($q$select client_claim_write('claude', 'drop table', 'person')$q$, '22023'), 'a malformed action is refused');
select pg_temp.as_member('user_acme', null);
select pg_temp.expect(pg_temp.raises($q$select client_claim_write('claude', 'note.add', 'person')$q$, '42501'), 'a token without an org cannot claim');

select pg_temp.as_owner();
insert into audit_log (actor_id, source, action, entity)
select 'a1000000-0000-4000-8000-000000000001', 'claude', 'note.add', 'person' from generate_series(1, 300);
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(client_claim_write('claude', 'note.add', 'person') is null, 'past 300 in the hour, a claim is refused');
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect(client_claim_write('claude', 'note.add', 'person') is not null, 'the limit is per member');
select pg_temp.as_owner();

-- 13. A client admin changes a member's access (20261014200000_client_member_access).
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(set_org_member_access('a1000000-0000-4000-8000-000000000002', 'elevated') = 'limited',
  'an admin raises a member, and learns the level they had');
select pg_temp.expect((select access_level from org_members where id = 'a1000000-0000-4000-8000-000000000002') = 'elevated',
  'the new level is what the org reads');
select pg_temp.expect(pg_temp.raises($q$select set_org_member_access('a1000000-0000-4000-8000-000000000002', 'owner')$q$, '22023'),
  'only the three levels');
select pg_temp.expect(pg_temp.raises($q$select set_org_member_access('b1000000-0000-4000-8000-000000000001', 'limited')$q$, '22023'),
  'another org''s actor is no such member');
-- Acme has two signed-in admins (acme-admin, acme-both): one can be lowered.
select pg_temp.expect(set_org_member_access('a1000000-0000-4000-8000-000000000005', 'elevated') = 'admin',
  'with another admin signed in, an admin can be lowered');
select set_config('tacit_test.pending_admin',
  (select actor_id::text from invite_org_member('pending.admin@acme.test', 'Pending Admin', 'admin')), true);
select pg_temp.expect(pg_temp.raises($q$select set_org_member_access('a1000000-0000-4000-8000-000000000001', 'elevated')$q$, '23514'),
  'the last signed-in admin cannot step down, even with an admin invited');
select withdraw_org_invite(current_setting('tacit_test.pending_admin')::uuid);
select pg_temp.expect(set_org_member_access('a1000000-0000-4000-8000-000000000005', 'admin') = 'elevated', 'and is raised back');
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select set_org_member_access('a1000000-0000-4000-8000-000000000002', 'admin')$q$, '42501'),
  'a hiring manager cannot change access');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(set_org_member_access('a1000000-0000-4000-8000-000000000002', 'limited') = 'elevated', 'and lowers them again');
select pg_temp.as_owner();

-- 14. An interviewer's own interviews (20261014220000_client_my_interviews).
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from my_interviews()) = 1, 'an interviewer lists the one interview they are on');
select pg_temp.expect((select person_id = 'ac200000-0000-4000-8000-000000000001' and job_id = 'ac100000-0000-4000-8000-000000000001'
  and application_id = 'ac300000-0000-4000-8000-000000000001' from my_interviews()),
  'with the candidate and job their own token cannot join to');
select pg_temp.expect(not exists (select 1 from applications where id = 'ac300000-0000-4000-8000-000000000001'),
  'which they still cannot read directly');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(not exists (select 1 from my_interviews()), 'an admin who interviews no one lists nothing');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect(not exists (select 1 from my_interviews()), 'another org lists nothing of Acme''s');
select pg_temp.as_owner();

-- 15. Rejection reasons and offers (20261014230000_offers_rejection_reasons).
select pg_temp.expect((select count(*) from rejection_reasons where org_id = 'b0000000-0000-4000-8000-00000000000b') = 14,
  'a new org is seeded with the rejection reasons');
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from rejection_reasons) = 0, 'an interviewer reads no rejection reasons');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select count(*) from rejection_reasons) = 14, 'an admin reads their own org''s, and only those');
select set_config('tacit_test.skills', (select id::text from rejection_reasons where kind = 'rejected' and name = 'Skills or experience'), true);
select set_config('tacit_test.timing', (select id::text from rejection_reasons where kind = 'withdrew' and name = 'Timing'), true);
update applications set stage = 'rejected', rejection_reason_id = current_setting('tacit_test.skills')::uuid, rejection_note = 'needs more depth'
  where id = 'ac300000-0000-4000-8000-00000000000b';
select pg_temp.expect((select rejection_reason_id = current_setting('tacit_test.skills')::uuid and rejection_note = 'needs more depth'
  from applications where id = 'ac300000-0000-4000-8000-00000000000b'), 'a rejection keeps its reason and note');
select pg_temp.expect(pg_temp.raises(
  $q$update applications set rejection_reason_id = current_setting('tacit_test.timing')::uuid where id = 'ac300000-0000-4000-8000-00000000000b'$q$, '22023'),
  'a withdrew reason is refused on a rejected application');
update applications set stage = 'withdrawn' where id = 'ac300000-0000-4000-8000-00000000000b';
select pg_temp.expect((select rejection_reason_id is null and rejection_note = 'needs more depth' from applications where id = 'ac300000-0000-4000-8000-00000000000b'),
  'moving to withdrawn drops a reason of the other kind, not the move');
update applications set stage = 'screening' where id = 'ac300000-0000-4000-8000-00000000000b';
select pg_temp.expect((select rejection_reason_id is null and rejection_note is null from applications where id = 'ac300000-0000-4000-8000-00000000000b'),
  'reopening clears the reason and note');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect(not exists (select 1 from rejection_reasons where org_id = 'a0000000-0000-4000-8000-00000000000a'),
  'another org reads none of Acme''s reasons');
insert into rejection_reasons (kind, name) values ('rejected', 'Globex only');
select pg_temp.expect((select org_id from rejection_reasons where name = 'Globex only') = 'b0000000-0000-4000-8000-00000000000b',
  'an admin adds a reason to their own org');

-- Offers: whoever can manage the job.
select pg_temp.as_member('user_acme', 'org_acme');
select set_config('tacit_test.offer', gen_random_uuid()::text, true);
insert into offers (id, application_id, salary, start_date)
  values (current_setting('tacit_test.offer')::uuid, 'ac300000-0000-4000-8000-00000000000b', 180000, '2026-12-01');
select pg_temp.as_owner();
select pg_temp.expect((select created_by_actor_id = 'a1000000-0000-4000-8000-000000000001' and org_id = 'a0000000-0000-4000-8000-00000000000a'
  and status = 'draft' from offers where id = current_setting('tacit_test.offer')::uuid), 'an offer is stamped with its author, in the job''s org, as a draft');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(pg_temp.raises(
  $q$insert into offers (application_id) values ('ac300000-0000-4000-8000-00000000000b')$q$, '23505'),
  'one open offer per application');
select pg_temp.expect(pg_temp.raises(
  $q$update offers set status = 'accepted' where id = current_setting('tacit_test.offer')::uuid$q$, '22023'),
  'a draft cannot be accepted');
update offers set salary = 185000, status = 'extended' where id = current_setting('tacit_test.offer')::uuid;
select pg_temp.expect((select extended_at is not null and salary = 185000 from offers where id = current_setting('tacit_test.offer')::uuid),
  'extending stamps it, with the last draft terms');
select pg_temp.expect(pg_temp.raises(
  $q$update offers set salary = 190000 where id = current_setting('tacit_test.offer')::uuid$q$, '22023'),
  'an extended offer''s terms do not change');
update offers set notes = 'verbal yes' where id = current_setting('tacit_test.offer')::uuid;
update offers set status = 'accepted' where id = current_setting('tacit_test.offer')::uuid;
select pg_temp.expect((select resolved_at is not null and notes = 'verbal yes' from offers where id = current_setting('tacit_test.offer')::uuid),
  'accepting stamps it closed');
select pg_temp.expect(pg_temp.raises(
  $q$update offers set notes = 'changed my mind' where id = current_setting('tacit_test.offer')::uuid$q$, '22023'),
  'a closed offer never changes');
select pg_temp.expect(pg_temp.raises(
  $q$insert into offers (application_id, status) values ('ac300000-0000-4000-8000-00000000000b', 'accepted')$q$, '22023'),
  'an offer starts as a draft');
delete from offers;
select pg_temp.expect((select count(*) from offers) = 1, 'nobody deletes an offer');

select pg_temp.as_member('user_acme_hm', 'org_acme');
insert into offers (application_id, salary) values ('ac300000-0000-4000-8000-000000000001', 150000);
select pg_temp.expect((select count(*) from offers) = 1, 'a hiring manager reads the offers on their job and not another job''s');
select pg_temp.expect(pg_temp.raises(
  $q$insert into offers (application_id) values ('ac300000-0000-4000-8000-00000000000b')$q$, '42501'),
  'and cannot make one on another job');
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from offers) = 0, 'an interviewer reads no offers');
select pg_temp.expect(pg_temp.raises(
  $q$insert into offers (application_id) values ('ac300000-0000-4000-8000-000000000001')$q$, '42501'),
  'nor makes one');
select pg_temp.as_member('user_acme_ext', 'org_acme');
select pg_temp.expect((select count(*) from offers) = 0, 'an external recruiter reads no offers, even on their own candidate''s job');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from offers) = 0, 'another org reads none');
select pg_temp.as_owner();

-- 18. A candidate's files, written by members (20261015120000_client_person_files).
--     Ada has the resume and the portfolio from 10; her job's hiring manager adds one.
select pg_temp.as_member('user_acme_hm', 'org_acme');
select set_config('tacit_test.file', gen_random_uuid()::text, true);
insert into person_files (id, person_id, kind, storage_path, filename, content_type, size_bytes)
values (current_setting('tacit_test.file')::uuid, 'ac200000-0000-4000-8000-000000000001', 'attachment',
        'a0000000-0000-4000-8000-00000000000a/ac200000-0000-4000-8000-000000000001/' || current_setting('tacit_test.file'),
        'take-home.pdf', 'application/pdf', 1024);
select pg_temp.as_owner();
select pg_temp.expect((select uploaded_by_actor_id = 'a1000000-0000-4000-8000-000000000003' and org_id = 'a0000000-0000-4000-8000-00000000000a'
  from person_files where id = current_setting('tacit_test.file')::uuid), 'a file a member adds is stamped with them, in the person''s org');
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from person_files) = 3, 'the hiring manager reads it beside the other two');
select pg_temp.expect(pg_temp.raises($q$
  insert into person_files (id, person_id, kind, storage_path, filename)
  values ('ac500000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-000000000001', 'resume',
          'b0000000-0000-4000-8000-00000000000b/ac200000-0000-4000-8000-000000000001/ac500000-0000-4000-8000-000000000001', 'x.pdf')$q$, '42501'),
  'a storage path that is not the row''s own is refused');
select pg_temp.expect(pg_temp.raises($q$
  insert into person_files (id, person_id, kind, storage_path, filename, uploaded_by_actor_id)
  values ('ac500000-0000-4000-8000-000000000002', 'ac200000-0000-4000-8000-000000000001', 'resume',
          'a0000000-0000-4000-8000-00000000000a/ac200000-0000-4000-8000-000000000001/ac500000-0000-4000-8000-000000000002', 'x.pdf',
          'a1000000-0000-4000-8000-000000000001')$q$, '42501'),
  'nor can a member file one as someone else');
select pg_temp.expect(pg_temp.raises($q$
  insert into person_files (id, person_id, kind, storage_path, filename)
  values ('ac500000-0000-4000-8000-000000000003', 'ac200000-0000-4000-8000-00000000000b', 'resume',
          'a0000000-0000-4000-8000-00000000000a/ac200000-0000-4000-8000-00000000000b/ac500000-0000-4000-8000-000000000003', 'x.pdf')$q$, '42501'),
  'a hiring manager cannot attach to a candidate on another job');
select pg_temp.expect(pg_temp.raises($q$
  insert into person_files (id, person_id, kind, storage_path, filename)
  values ('ac500000-0000-4000-8000-000000000004', 'ac200000-0000-4000-8000-000000000001', 'resume',
          'a0000000-0000-4000-8000-00000000000a/ac200000-0000-4000-8000-000000000001/ac500000-0000-4000-8000-000000000004', '')$q$, '23514'),
  'an empty filename is refused');
update person_files set filename = 'renamed.pdf';
select pg_temp.expect(not exists (select 1 from person_files where filename = 'renamed.pdf'), 'nobody renames a file');

-- An interviewer reads the resume and attaches nothing.
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select array_agg(kind) from person_files) = array['resume'], 'an interviewer still reads only the resume');
select pg_temp.expect(pg_temp.raises($q$
  insert into person_files (id, person_id, kind, storage_path, filename)
  values ('ac500000-0000-4000-8000-000000000005', 'ac200000-0000-4000-8000-000000000001', 'resume',
          'a0000000-0000-4000-8000-00000000000a/ac200000-0000-4000-8000-000000000001/ac500000-0000-4000-8000-000000000005', 'x.pdf')$q$, '42501'),
  'an interviewer cannot attach a file, even to someone they interview');

-- An external recruiter attaches to the candidate they added, and reads only that.
select pg_temp.as_member('user_acme_ext', 'org_acme');
insert into person_files (id, person_id, kind, storage_path, filename)
values ('ac500000-0000-4000-8000-000000000006', 'ac200000-0000-4000-8000-00000000000c', 'resume',
        'a0000000-0000-4000-8000-00000000000a/ac200000-0000-4000-8000-00000000000c/ac500000-0000-4000-8000-000000000006', 'cy.pdf');
select pg_temp.expect((select array_agg(filename) from person_files) = array['cy.pdf'], 'an external recruiter reads the file on their own candidate only');

-- Another org sees none of it and cannot add to it.
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from person_files) = 0, 'another org reads none of Acme''s files');
select pg_temp.expect(pg_temp.raises($q$
  insert into person_files (id, person_id, kind, storage_path, filename)
  values ('ac500000-0000-4000-8000-000000000007', 'ac200000-0000-4000-8000-000000000001', 'resume',
          'a0000000-0000-4000-8000-00000000000a/ac200000-0000-4000-8000-000000000001/ac500000-0000-4000-8000-000000000007', 'x.pdf')$q$, '42501'),
  'nor attaches a file to an Acme candidate');
delete from person_files;

-- Deleting: only your own upload.
select pg_temp.as_member('user_acme', 'org_acme');
delete from person_files where person_id = 'ac200000-0000-4000-8000-000000000001';
select pg_temp.expect((select count(*) from person_files where person_id = 'ac200000-0000-4000-8000-000000000001') = 3,
  'an admin deletes no one else''s file, and Globex deleted none');
select pg_temp.as_member('user_acme_hm', 'org_acme');
delete from person_files where id = current_setting('tacit_test.file')::uuid;
select pg_temp.expect(not exists (select 1 from person_files where id = current_setting('tacit_test.file')::uuid),
  'the uploader deletes their own');
select pg_temp.as_owner();

-- 16. Structured scorecards (20261015140000_scorecards). The interview on the
--     Founding engineer job has two interviewers, the limited one and the
--     hiring manager, and each has filed feedback (10d, 10e); the org is at
--     feedback_visibility 'never'.
select set_config('tacit_test.int_feedback',
  (select id::text from interview_feedback where interviewer_actor_id = 'a1000000-0000-4000-8000-000000000002'), true);
select set_config('tacit_test.hm_feedback',
  (select id::text from interview_feedback where interviewer_actor_id = 'a1000000-0000-4000-8000-000000000003'), true);
select pg_temp.as_member('user_acme_hm', 'org_acme');
insert into scorecard_attributes (id, role_id, name, position) values
  ('ac500000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001', 'Systems design', 10),
  ('ac500000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000001', 'Communication', 20);
select pg_temp.expect((select count(*) from scorecard_attributes) = 2, 'a hiring manager sets their job''s scorecard');
select pg_temp.expect(pg_temp.raises(
  $q$insert into scorecard_attributes (role_id, name) values ('ac100000-0000-4000-8000-000000000001', ' communication ')$q$, '23505'),
  'an attribute name is unique per job, whatever its case');
select pg_temp.expect(pg_temp.raises(
  $q$insert into scorecard_attributes (role_id, name) values ('ac100000-0000-4000-8000-000000000002', 'Taste')$q$, '42501'),
  'but not another job''s');
select pg_temp.as_member('user_acme', 'org_acme');
insert into scorecard_attributes (id, role_id, name) values
  ('ac500000-0000-4000-8000-000000000003', 'ac100000-0000-4000-8000-000000000002', 'Taste');
select pg_temp.expect(pg_temp.raises(
  $q$update scorecard_attributes set role_id = 'ac100000-0000-4000-8000-000000000001' where id = 'ac500000-0000-4000-8000-000000000003'$q$, '22023'),
  'an attribute stays on its job');
select pg_temp.as_owner();
select pg_temp.expect((select org_id from scorecard_attributes where id = 'ac500000-0000-4000-8000-000000000003') = 'a0000000-0000-4000-8000-00000000000a',
  'an attribute is filed under its job''s org');

-- The interviewer reads the scorecard of the job they interview on, and files
-- ratings only on their own feedback, only against that job's attributes.
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select array_agg(name order by position) from scorecard_attributes) = array['Systems design', 'Communication'],
  'an interviewer reads the scorecard of the job they interview on, and no other');
update scorecard_attributes set name = 'Vibes' where id = 'ac500000-0000-4000-8000-000000000001';
select pg_temp.expect(pg_temp.raises(
  $q$insert into scorecard_attributes (role_id, name) values ('ac100000-0000-4000-8000-000000000001', 'Vibes')$q$, '42501'),
  'and does not write it');
insert into interview_feedback_ratings (feedback_id, attribute_id, rating, note) values
  (current_setting('tacit_test.int_feedback')::uuid, 'ac500000-0000-4000-8000-000000000001', 4, 'clear tradeoffs'),
  (current_setting('tacit_test.int_feedback')::uuid, 'ac500000-0000-4000-8000-000000000002', 3, null);
select pg_temp.expect((select count(*) from interview_feedback_ratings) = 2, 'an interviewer rates their own feedback');
select pg_temp.expect(pg_temp.raises(
  $q$insert into interview_feedback_ratings (feedback_id, attribute_id, rating)
     values (current_setting('tacit_test.int_feedback')::uuid, 'ac500000-0000-4000-8000-000000000003', 2)$q$, '22023'),
  'an attribute of another job is refused');
select pg_temp.expect(pg_temp.raises(
  $q$insert into interview_feedback_ratings (feedback_id, attribute_id, rating)
     values (current_setting('tacit_test.hm_feedback')::uuid, 'ac500000-0000-4000-8000-000000000001', 1)$q$, '42501'),
  'nobody rates on someone else''s feedback');
select pg_temp.expect(pg_temp.raises(
  $q$update interview_feedback_ratings set attribute_id = 'ac500000-0000-4000-8000-000000000002'
     where attribute_id = 'ac500000-0000-4000-8000-000000000001'$q$, '22023'),
  'a rating stays on its attribute');
update interview_feedback_ratings set rating = 3 where attribute_id = 'ac500000-0000-4000-8000-000000000001';
select pg_temp.expect((select rating from interview_feedback_ratings where attribute_id = 'ac500000-0000-4000-8000-000000000001') = 3,
  'and changes their own rating');
select pg_temp.as_owner();
select pg_temp.expect((select name from scorecard_attributes where id = 'ac500000-0000-4000-8000-000000000001') = 'Systems design',
  'the interviewer''s rename changed nothing');
select pg_temp.expect((select count(*) from interview_feedback_ratings where org_id = 'a0000000-0000-4000-8000-00000000000a') = 2,
  'ratings are filed under their feedback''s org');

-- Another member reads the ratings exactly when they read the feedback.
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from interview_feedback_ratings) = 0, 'never: another interviewer''s ratings stay hidden with their feedback');
select pg_temp.as_owner();
update orgs set feedback_visibility = 'always' where slug = 'acme';
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from interview_feedback_ratings) = 2, 'always: they read them once they read the feedback');
update interview_feedback_ratings set rating = 1;
delete from interview_feedback_ratings;
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select array_agg(rating order by rating) from interview_feedback_ratings) = array[3, 3]::smallint[],
  'nobody but the interviewer changes or deletes their ratings, and an admin reads them');

-- Archive, never delete: an old rating keeps its attribute, a new one cannot use it.
select pg_temp.as_member('user_acme_hm', 'org_acme');
update scorecard_attributes set archived_at = now() where id = 'ac500000-0000-4000-8000-000000000002';
delete from scorecard_attributes;
select pg_temp.as_owner();
select pg_temp.expect((select count(*) from scorecard_attributes where org_id = 'a0000000-0000-4000-8000-00000000000a') = 3, 'nobody deletes an attribute');
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from scorecard_attributes where archived_at is not null) = 1, 'the interviewer still reads the archived one');
delete from interview_feedback_ratings where attribute_id = 'ac500000-0000-4000-8000-000000000002';
select pg_temp.expect(pg_temp.raises(
  $q$insert into interview_feedback_ratings (feedback_id, attribute_id, rating)
     values (current_setting('tacit_test.int_feedback')::uuid, 'ac500000-0000-4000-8000-000000000002', 2)$q$, '22023'),
  'an archived attribute takes no new rating');

select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from scorecard_attributes) = 0 and (select count(*) from interview_feedback_ratings) = 0,
  'another org reads no scorecards or ratings');
select pg_temp.expect(pg_temp.raises(
  $q$insert into interview_feedback_ratings (feedback_id, attribute_id, rating)
     values (current_setting('tacit_test.int_feedback')::uuid, 'ac500000-0000-4000-8000-000000000001', 1)$q$, '42501'),
  'and rates nothing of Acme''s');
select pg_temp.as_owner();

-- 19. Sources and tags (20261015150000_client_sources_tags).
select pg_temp.as_member('user_acme', 'org_acme');
update applications set source = 'agency', source_detail = 'Hunt & Co' where id = 'ac300000-0000-4000-8000-00000000000b';
select pg_temp.expect((select source = 'agency' and source_detail = 'Hunt & Co' from applications where id = 'ac300000-0000-4000-8000-00000000000b'),
  'an application takes one of the wider sources, with a detail');
select pg_temp.expect(pg_temp.raises(
  $q$update applications set source = 'linkedin' where id = 'ac300000-0000-4000-8000-00000000000b'$q$, '23514'),
  'a source outside the list is refused');
select pg_temp.expect(pg_temp.raises(
  $q$update applications set source_detail = '  ' where id = 'ac300000-0000-4000-8000-00000000000b'$q$, '23514'),
  'a blank detail is refused');

insert into tags (name) values ('Needs referral check');
select pg_temp.expect(pg_temp.raises($q$insert into tags (name) values ('strong')$q$, '23505'), 'a tag''s name is unique ignoring case');
select pg_temp.expect(pg_temp.raises($q$insert into tags (name) values (' padded ')$q$, '23514'), 'and trimmed');
insert into person_tags (person_id, tag_id) values ('ac200000-0000-4000-8000-00000000000b', 'ac500000-0000-4000-8000-000000000001');
select pg_temp.as_owner();
select pg_temp.expect((select org_id = 'a0000000-0000-4000-8000-00000000000a' and created_by_actor_id = 'a1000000-0000-4000-8000-000000000001'
  from tags where name = 'Needs referral check'), 'a tag lands in its maker''s org, stamped with them');
select pg_temp.expect((select added_by_actor_id from person_tags where person_id = 'ac200000-0000-4000-8000-00000000000b')
  = 'a1000000-0000-4000-8000-000000000001', 'a tag on a candidate is stamped with who put it there');

-- A hiring manager reads and makes tags, and tags only their own job's candidates.
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from tags) = 2, 'a hiring manager reads the org''s tags');
insert into tags (name) values ('Fast mover');
update tags set archived_at = now() where name = 'Strong';
select pg_temp.expect((select count(*) from tags where archived_at is not null) = 0, 'but archiving one is for admins');
select pg_temp.expect((select count(*) from person_tags) = 2, 'they read the tags on their job''s candidates and no one else''s');
insert into person_tags (person_id, tag_id) select 'ac200000-0000-4000-8000-000000000001', id from tags where name = 'Fast mover';
select pg_temp.expect(pg_temp.raises(
  $q$insert into person_tags (person_id, tag_id) select 'ac200000-0000-4000-8000-00000000000b', id from tags where name = 'Fast mover'$q$, '42501'),
  'a hiring manager cannot tag someone on another job');
select pg_temp.expect(pg_temp.raises(
  $q$insert into person_tags (person_id, tag_id) values ('ac200000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000001')$q$, '23505'),
  'a tag goes on a candidate once');
delete from person_tags where person_id = 'ac200000-0000-4000-8000-00000000000b';
delete from person_tags where person_id = 'ac200000-0000-4000-8000-000000000001' and tag_id = (select id from tags where name = 'Fast mover');
select pg_temp.as_owner();
select pg_temp.expect(exists (select 1 from person_tags where person_id = 'ac200000-0000-4000-8000-00000000000b'),
  'nor untag them');
select pg_temp.expect(not exists (select 1 from person_tags p join tags t on t.id = p.tag_id where t.name = 'Fast mover'),
  'but untags their own job''s candidate');

select pg_temp.as_member('user_acme', 'org_acme');
update tags set archived_at = now() where name = 'Needs referral check';
select pg_temp.expect((select archived_at is not null from tags where name = 'Needs referral check'), 'an admin archives a tag');
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect(pg_temp.raises(
  $q$insert into person_tags (person_id, tag_id) select 'ac200000-0000-4000-8000-000000000001', id from tags where name = 'Needs referral check'$q$, '42501'),
  'an archived tag goes on no one');

select pg_temp.as_member('user_acme_ext', 'org_acme');
select pg_temp.expect((select person_id from person_tags) = 'ac200000-0000-4000-8000-00000000000c',
  'an external recruiter reads the tags on the candidate they added, and no others');
select pg_temp.expect(pg_temp.raises($q$insert into tags (name) values ('Agency pick')$q$, '42501'), 'and cannot make a tag');
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from tags) = 0 and (select count(*) from person_tags) = 0, 'an interviewer reads no tags');
select pg_temp.expect(pg_temp.raises(
  $q$insert into person_tags (person_id, tag_id) values ('ac200000-0000-4000-8000-00000000000d', 'ac500000-0000-4000-8000-000000000001')$q$, '42501'),
  'nor tags anyone');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from tags) = 0 and (select count(*) from person_tags) = 0, 'another org reads none of Acme''s tags');
select pg_temp.expect(pg_temp.raises(
  $q$insert into person_tags (person_id, tag_id) values ('ac200000-0000-4000-8000-00000000000d', 'ac500000-0000-4000-8000-000000000001')$q$, '42501'),
  'nor tags an Acme person');
insert into tags (name) values ('Strong');
select pg_temp.expect((select org_id from tags where name = 'Strong') = 'b0000000-0000-4000-8000-00000000000b',
  'the same name is another org''s own tag');
select pg_temp.as_owner();
select pg_temp.as_tacit_internal();
select pg_temp.expect((select count(*) from tags) = 0 and (select count(*) from person_tags) = 0, 'tacit_internal reads no client tags');
select pg_temp.as_owner();

-- 20. Candidate email and templates (20261016100000_client_email).
--     Ada (ac2..01, ada@example.com) is on the hiring manager's job; Bob
--     (ac2..0b) is on another; Cy (ac2..0c) is the external recruiter's.
select pg_temp.as_member('user_acme', 'org_acme');
insert into email_templates (id, name, subject, body)
  values ('ae100000-0000-4000-8000-000000000001', 'Screen invite', 'Hi {{candidate_first_name}}', 'Could we talk this week?');
select pg_temp.expect(pg_temp.raises($q$insert into email_templates (name, subject, body) values ('screen INVITE', 's', 'b')$q$, '23505'),
  'a template''s name is unique ignoring case');
select pg_temp.expect(pg_temp.raises($q$insert into email_templates (name, subject, body) values ('Two lines', E'a\nb', 'b')$q$, '23514'),
  'a template''s subject is one line');
select pg_temp.as_owner();
select pg_temp.expect((select org_id = 'a0000000-0000-4000-8000-00000000000a' and created_by_actor_id = 'a1000000-0000-4000-8000-000000000001'
  from email_templates where id = 'ae100000-0000-4000-8000-000000000001'), 'a template lands in its maker''s org, stamped with them');

select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from email_templates) = 1, 'a hiring manager reads the org''s templates');
select pg_temp.expect(pg_temp.raises($q$insert into email_templates (name, subject, body) values ('Mine', 's', 'b')$q$, '42501'),
  'but templates are written by admins');
update email_templates set archived_at = now();
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from email_templates) = 0, 'an interviewer reads no templates');
select pg_temp.expect(pg_temp.raises(
  $q$insert into candidate_emails (person_id, to_email, subject, body) values ('ac200000-0000-4000-8000-000000000001', 'ada@example.com', 's', 'b')$q$, '42501'),
  'and emails no one, not even someone they interview');
select pg_temp.as_owner();
select pg_temp.expect((select archived_at is null from email_templates where id = 'ae100000-0000-4000-8000-000000000001'),
  'a hiring manager cannot archive a template');

-- The hiring manager drafts to their job's candidate, at an address on file.
select pg_temp.as_member('user_acme_hm', 'org_acme');
insert into candidate_emails (id, person_id, application_id, template_id, to_email, subject, body) values
  ('ae200000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-000000000001', 'ac300000-0000-4000-8000-000000000001',
   'ae100000-0000-4000-8000-000000000001', 'ada@example.com', 'Hi Ada', 'Could we talk this week?'),
  ('ae200000-0000-4000-8000-000000000002', 'ac200000-0000-4000-8000-000000000001', null, null, 'ada@example.com', 'Still here', 'A second note');
select pg_temp.expect(pg_temp.raises(
  $q$insert into candidate_emails (person_id, to_email, subject, body) values ('ac200000-0000-4000-8000-000000000001', 'boss@evil.test', 's', 'b')$q$, '22023'),
  'an address not on file for the candidate is refused');
select pg_temp.expect(pg_temp.raises(
  $q$insert into candidate_emails (person_id, application_id, to_email, subject, body)
     values ('ac200000-0000-4000-8000-000000000001', 'ac300000-0000-4000-8000-00000000000c', 'ada@example.com', 's', 'b')$q$, '22023'),
  'so is another candidate''s application');
select pg_temp.expect(pg_temp.raises(
  $q$insert into candidate_emails (person_id, to_email, subject, body) values ('ac200000-0000-4000-8000-00000000000b', 'bob@example.com', 's', 'b')$q$, '42501'),
  'a hiring manager cannot email a candidate on another job');
select pg_temp.expect(pg_temp.raises(
  $q$insert into candidate_emails (person_id, to_email, subject, body, status) values ('ac200000-0000-4000-8000-000000000001', 'ada@example.com', 's', 'b', 'sent')$q$, '22023'),
  'an email starts as a draft');
select pg_temp.expect(pg_temp.raises(
  $q$insert into candidate_emails (person_id, author_actor_id, to_email, subject, body)
     values ('ac200000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'ada@example.com', 's', 'b')$q$, '42501'),
  'nor as someone else');
select pg_temp.expect(pg_temp.raises(
  $q$update candidate_emails set body = 'changed' where id = 'ae200000-0000-4000-8000-000000000001'$q$, '22023'),
  'what was drafted does not change');
update candidate_emails set status = 'sending' where id = 'ae200000-0000-4000-8000-000000000001';
select pg_temp.expect(pg_temp.raises(
  $q$update candidate_emails set status = 'draft' where id = 'ae200000-0000-4000-8000-000000000001'$q$, '22023'),
  'a send in flight does not go back to draft');
select pg_temp.expect(pg_temp.raises(
  $q$update candidate_emails set status = 'sent' where id = 'ae200000-0000-4000-8000-000000000001'$q$, '22023'),
  'sent names the provider''s id');
update candidate_emails set status = 'sent', provider_id = 're_1' where id = 'ae200000-0000-4000-8000-000000000001';
select pg_temp.as_owner();
select pg_temp.expect((select org_id = 'a0000000-0000-4000-8000-00000000000a' and author_actor_id = 'a1000000-0000-4000-8000-000000000003'
    and sending_at is not null and sent_at is not null
  from candidate_emails where id = 'ae200000-0000-4000-8000-000000000001'),
  'an email lands in the candidate''s org, stamped with its author, its send and its sending');

-- A draft is its author's; a sent email is the candidate's record.
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select array_agg(id) from candidate_emails) = array['ae200000-0000-4000-8000-000000000001']::uuid[],
  'an admin reads the sent email and not someone else''s draft');
update candidate_emails set status = 'sending' where id = 'ae200000-0000-4000-8000-000000000002';
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from candidate_emails) = 2, 'the author reads their draft too');
select pg_temp.expect((select status from candidate_emails where id = 'ae200000-0000-4000-8000-000000000002') = 'draft',
  'and only the author sends it');
select pg_temp.as_member('user_acme_ext', 'org_acme');
select pg_temp.expect((select count(*) from candidate_emails) = 0, 'an external recruiter reads no email to a candidate they did not add');
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from candidate_emails) = 0, 'an interviewer reads none');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from candidate_emails) = 0 and (select count(*) from email_templates) = 0,
  'another org reads none of Acme''s email or templates');
select pg_temp.expect(pg_temp.raises(
  $q$insert into candidate_emails (person_id, to_email, subject, body) values ('ac200000-0000-4000-8000-000000000001', 'nobody@example.com', 's', 'b')$q$, '42501'),
  'and cannot email an Acme person, nor learn which address they have');
select pg_temp.as_owner();
select pg_temp.as_tacit_internal();
select pg_temp.expect((select count(*) from candidate_emails) = 0 and (select count(*) from email_templates) = 0,
  'tacit_internal reads no client email');
select pg_temp.as_owner();

-- Thirty sends an hour per member, counted by the database.
insert into candidate_emails (person_id, author_actor_id, to_email, subject, body)
select 'ac200000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'ada@example.com', 'Bulk ' || n, 'b'
from generate_series(1, 29) n;
update candidate_emails set status = 'sending' where subject like 'Bulk %';
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect(pg_temp.raises(
  $q$update candidate_emails set status = 'sending' where id = 'ae200000-0000-4000-8000-000000000002'$q$, '54000'),
  'a member''s 31st send in an hour is refused');
select pg_temp.as_owner();

-- 21. Approvals for offers and jobs (20261016110000_client_approvals). A new
--     paused job the hiring manager runs, one candidate with a draft offer.
--     The offer flow: the admin, then the interviewer or acme-both (any one).
select pg_temp.as_owner();
insert into roles (id, company_id, title, org_id, status) values
  ('ac210000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001', 'Approvals job', 'a0000000-0000-4000-8000-00000000000a', 'paused');
insert into hiring_team (role_id, actor_id, team_role) values
  ('ac210000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'hiring_manager');
insert into people (id, display_name, email, org_id) values
  ('ac210000-0000-4000-8000-000000000002', 'Ann Approve', 'ann.approve@example.com', 'a0000000-0000-4000-8000-00000000000a');
insert into applications (id, person_id, role_id) values
  ('ac210000-0000-4000-8000-000000000003', 'ac210000-0000-4000-8000-000000000002', 'ac210000-0000-4000-8000-000000000001');
insert into offers (id, application_id, salary) values
  ('ac210000-0000-4000-8000-000000000004', 'ac210000-0000-4000-8000-000000000003', 200000);

select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect(pg_temp.raises(
  $q$select * from request_approval('offer', 'ac210000-0000-4000-8000-000000000004')$q$, '22023'),
  'with no flow there is nothing to approve');
select pg_temp.expect((select changed and requests_reset = 0 from set_approval_flow('ac210000-0000-4000-8000-000000000001', 'offer',
  '[["a1000000-0000-4000-8000-000000000001"], ["a1000000-0000-4000-8000-000000000002", "a1000000-0000-4000-8000-000000000005"]]')),
  'a hiring manager sets their job''s offer flow');
select pg_temp.expect((select not changed from set_approval_flow('ac210000-0000-4000-8000-000000000001', 'offer',
  '[["a1000000-0000-4000-8000-000000000001"], ["a1000000-0000-4000-8000-000000000005", "a1000000-0000-4000-8000-000000000002"]]')),
  'the same flow again changes nothing, whatever the order within a step');
select pg_temp.expect((select count(*) from approval_flow_approvers) = 3 and (select count(*) from approval_flows) = 1,
  'they read the flow and its three approvers');
select pg_temp.as_owner();
select pg_temp.expect((select org_id from approval_flows where role_id = 'ac210000-0000-4000-8000-000000000001') = 'a0000000-0000-4000-8000-00000000000a'
  and (select updated_by_actor_id from approval_flows where role_id = 'ac210000-0000-4000-8000-000000000001') = 'a1000000-0000-4000-8000-000000000003',
  'a flow is filed under its job''s org, stamped with who set it');
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select * from set_approval_flow('ac210000-0000-4000-8000-000000000001', 'offer',
  '[["b1000000-0000-4000-8000-000000000001"]]')$q$, '22023'), 'an approver from another org is refused');
select pg_temp.expect(pg_temp.raises($q$select * from set_approval_flow('ac210000-0000-4000-8000-000000000001', 'offer',
  '[["a1000000-0000-4000-8000-000000000001"], ["a1000000-0000-4000-8000-000000000001"]]')$q$, '22023'), 'nobody appears twice in a flow');
select pg_temp.expect(pg_temp.raises($q$select * from set_approval_flow('ac210000-0000-4000-8000-000000000001', 'offer', '[["nope"]]')$q$, '22023'),
  'an approver is a member id');
select pg_temp.expect(pg_temp.raises($q$select * from set_approval_flow('ac100000-0000-4000-8000-000000000002', 'offer',
  '[["a1000000-0000-4000-8000-000000000001"]]')$q$, '42501'), 'a hiring manager does not set another job''s flow');
select pg_temp.expect(pg_temp.raises($q$insert into approval_requests (role_id, kind, current_step) values ('ac210000-0000-4000-8000-000000000001', 'job_open', 1)$q$, '42501'),
  'a member makes requests only through request_approval');
select pg_temp.expect(pg_temp.raises(
  $q$update offers set status = 'extended' where id = 'ac210000-0000-4000-8000-000000000004'$q$, '22023'),
  'an offer on a job with a flow is not extended unapproved');
select set_config('tacit_test.req1',
  (select request_id::text from request_approval('offer', 'ac210000-0000-4000-8000-000000000004')), true);
select pg_temp.expect((select outcome = 'already_pending' and request_id = current_setting('tacit_test.req1')::uuid
  from request_approval('offer', 'ac210000-0000-4000-8000-000000000004')), 'asking again returns the request in progress');
select pg_temp.expect((select current_step = 1 and requested_by_actor_id = 'a1000000-0000-4000-8000-000000000003'
  from approval_requests where id = current_setting('tacit_test.req1')::uuid), 'it waits on step 1, stamped with who asked');

-- Step 2's approvers wait their turn; the interviewer may set nothing.
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect(not exists (select 1 from my_approvals()), 'a step-2 approver has nothing waiting on them yet');
select pg_temp.expect(pg_temp.raises(
  $q$select * from decide_approval(current_setting('tacit_test.req1')::uuid, true)$q$, '42501'), 'nor can they pass step 1');
select pg_temp.expect(pg_temp.raises(
  $q$select * from set_approval_flow('ac210000-0000-4000-8000-000000000001', 'offer', '[]')$q$, '42501'), 'an interviewer sets no flow');

select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select candidate_name = 'Ann Approve' and salary = 200000 and waiting_step = 1 and steps = 2 from my_approvals()),
  'the step-1 approver sees the candidate and the terms they approve');
select pg_temp.expect((select outcome = 'advanced' and waiting_step = 2 from decide_approval(current_setting('tacit_test.req1')::uuid, true)),
  'approving step 1 moves it to step 2');
select pg_temp.expect(pg_temp.raises(
  $q$select * from decide_approval(current_setting('tacit_test.req1')::uuid, true)$q$, '42501'), 'and a step-1 approver cannot pass step 2 too');

select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select candidate_name = 'Ann Approve' and salary = 200000 and waiting_step = 2 from my_approvals()),
  'now it waits on the interviewer, who sees what they are approving');
select pg_temp.expect((select count(*) from approval_requests) = 1 and (select count(*) from approval_decisions) = 1,
  'an approver reads the request and its decisions');
select pg_temp.expect((select count(*) from offers) = 0 and not exists (select 1 from people where id = 'ac210000-0000-4000-8000-000000000002'),
  'but still no offer or candidate record');
select pg_temp.expect(pg_temp.raises(
  $q$select * from decide_approval(current_setting('tacit_test.req1')::uuid, false, '  ')$q$, '22023'), 'a rejection needs a reason');
select pg_temp.expect((select outcome = 'rejected' from decide_approval(current_setting('tacit_test.req1')::uuid, false, 'over band')),
  'the interviewer rejects it with a reason');
select pg_temp.expect((select outcome = 'not_pending' and request_status = 'rejected' from decide_approval(current_setting('tacit_test.req1')::uuid, true)),
  'a decided request is answered, not changed');

select pg_temp.as_member('user_acme_hm', 'org_acme');
update approval_requests set status = 'approved' where id = current_setting('tacit_test.req1')::uuid;
select pg_temp.expect((select status from approval_requests where id = current_setting('tacit_test.req1')::uuid) = 'rejected',
  'nobody writes a request directly');
select pg_temp.expect((select status from offers where id = 'ac210000-0000-4000-8000-000000000004') = 'draft', 'a rejected offer stays a draft');
select pg_temp.expect((select reason = 'over band' and actor_id = 'a1000000-0000-4000-8000-000000000002' and step = 2
  from approval_decisions where decision = 'rejected'), 'the hiring manager reads who rejected it, at which step, and why');
select set_config('tacit_test.req2',
  (select request_id::text from request_approval('offer', 'ac210000-0000-4000-8000-000000000004')), true);
select pg_temp.expect(current_setting('tacit_test.req2') <> current_setting('tacit_test.req1'), 'asking again starts a new request');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select outcome = 'advanced' from decide_approval(current_setting('tacit_test.req2')::uuid, true, 'fine by me')),
  'step 1 approves again, with a comment');
select pg_temp.as_member('user_both', 'org_acme');
select pg_temp.expect((select outcome = 'approved' from decide_approval(current_setting('tacit_test.req2')::uuid, true)),
  'any one approver of the last step approves it');

select pg_temp.as_member('user_acme_hm', 'org_acme');
update offers set salary = 210000 where id = 'ac210000-0000-4000-8000-000000000004';
select pg_temp.expect((select status = 'reset' and resolved_at is not null from approval_requests where id = current_setting('tacit_test.req2')::uuid),
  'changing the terms after approval resets it');
select pg_temp.expect(pg_temp.raises(
  $q$update offers set status = 'extended' where id = 'ac210000-0000-4000-8000-000000000004'$q$, '22023'),
  'so the new terms are not extended unapproved');
select set_config('tacit_test.req3',
  (select request_id::text from request_approval('offer', 'ac210000-0000-4000-8000-000000000004')), true);
select pg_temp.as_member('user_acme', 'org_acme');
select * from decide_approval(current_setting('tacit_test.req3')::uuid, true);
select pg_temp.as_member('user_acme_int', 'org_acme');
select * from decide_approval(current_setting('tacit_test.req3')::uuid, true);
select pg_temp.as_member('user_acme_hm', 'org_acme');
update offers set notes = 'call before sending' where id = 'ac210000-0000-4000-8000-000000000004';
select pg_temp.expect((select status = 'approved' from approval_requests where id = current_setting('tacit_test.req3')::uuid),
  'a note is not a term: the approval stands');
select pg_temp.expect(pg_temp.raises(
  $q$update offers set salary = 220000, status = 'extended' where id = 'ac210000-0000-4000-8000-000000000004'$q$, '22023'),
  'terms do not change in the same update that extends');
update offers set status = 'extended' where id = 'ac210000-0000-4000-8000-000000000004';
select pg_temp.expect((select status = 'extended' and salary = 210000 from offers where id = 'ac210000-0000-4000-8000-000000000004'),
  'an approved offer is extended with the approved terms');
select pg_temp.expect((select used_at is not null and status = 'approved' from approval_requests where id = current_setting('tacit_test.req3')::uuid),
  'which spends the approval');
select pg_temp.expect((select count(*) from approval_requests where offer_id = 'ac210000-0000-4000-8000-000000000004') = 3,
  'every request stays on record');

-- Opening the job.
select pg_temp.expect((select changed from set_approval_flow('ac210000-0000-4000-8000-000000000001', 'job_open',
  '[["a1000000-0000-4000-8000-000000000005"]]')), 'a job_open flow is set beside the offer flow');
select pg_temp.expect(pg_temp.raises(
  $q$update roles set status = 'open' where id = 'ac210000-0000-4000-8000-000000000001'$q$, '22023'),
  'a job with a job_open flow does not open unapproved');
select set_config('tacit_test.req4',
  (select request_id::text from request_approval('job_open', 'ac210000-0000-4000-8000-000000000001')), true);
select pg_temp.expect(pg_temp.raises(
  $q$update roles set status = 'open' where id = 'ac210000-0000-4000-8000-000000000001'$q$, '22023'),
  'nor while its opening waits on approval');
select pg_temp.as_member('user_both', 'org_acme');
select pg_temp.expect((select kind = 'job_open' and job_title = 'Approvals job' and candidate_id is null from my_approvals()),
  'a job opening waits on its approver, with no candidate in it');
select pg_temp.expect((select outcome = 'approved' from decide_approval(current_setting('tacit_test.req4')::uuid, true)),
  'a one-step flow is approved by its one approval');
select pg_temp.as_member('user_acme_hm', 'org_acme');
update roles set status = 'open' where id = 'ac210000-0000-4000-8000-000000000001';
select pg_temp.expect((select status from roles where id = 'ac210000-0000-4000-8000-000000000001') = 'open', 'an approved job opens');
select pg_temp.expect((select used_at is not null from approval_requests where id = current_setting('tacit_test.req4')::uuid), 'spending its approval');
select pg_temp.expect(pg_temp.raises(
  $q$select * from request_approval('job_open', 'ac210000-0000-4000-8000-000000000001')$q$, '22023'), 'an open job needs no approval to open');
update roles set status = 'paused' where id = 'ac210000-0000-4000-8000-000000000001';
update roles set status = 'open' where id = 'ac210000-0000-4000-8000-000000000001';
select pg_temp.expect((select status from roles where id = 'ac210000-0000-4000-8000-000000000001') = 'open',
  'a paused job picks back up on the approval it already spent');
update roles set status = 'closed' where id = 'ac210000-0000-4000-8000-000000000001';
select pg_temp.expect(pg_temp.raises(
  $q$update roles set status = 'open' where id = 'ac210000-0000-4000-8000-000000000001'$q$, '22023'),
  'but a closed job needs its reopening approved');
select set_config('tacit_test.req5',
  (select request_id::text from request_approval('job_open', 'ac210000-0000-4000-8000-000000000001')), true);
select pg_temp.expect((select requests_reset = 1 from set_approval_flow('ac210000-0000-4000-8000-000000000001', 'job_open',
  '[["a1000000-0000-4000-8000-000000000001"]]')), 'changing the flow resets the request in progress');
select pg_temp.expect((select status from approval_requests where id = current_setting('tacit_test.req5')::uuid) = 'reset',
  'which is marked reset');
select pg_temp.expect((select changed from set_approval_flow('ac210000-0000-4000-8000-000000000001', 'job_open', '[]')),
  'an empty list removes the flow');
update roles set status = 'open' where id = 'ac210000-0000-4000-8000-000000000001';
select pg_temp.expect((select status from roles where id = 'ac210000-0000-4000-8000-000000000001') = 'open',
  'and with no flow nothing is gated');

-- Nobody else reads any of it.
select pg_temp.as_member('user_acme_ext', 'org_acme');
select pg_temp.expect((select count(*) from approval_flows) + (select count(*) from approval_flow_approvers)
  + (select count(*) from approval_requests) + (select count(*) from approval_decisions) = 0 and not exists (select 1 from my_approvals()),
  'an external recruiter reads no approvals');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from approval_flows) + (select count(*) from approval_flow_approvers)
  + (select count(*) from approval_requests) + (select count(*) from approval_decisions) = 0 and not exists (select 1 from my_approvals()),
  'another org reads none of Acme''s approvals');
select pg_temp.expect(pg_temp.raises($q$select * from set_approval_flow('ac210000-0000-4000-8000-000000000001', 'offer', '[]')$q$, '42501'),
  'nor changes a flow');
select pg_temp.expect(pg_temp.raises(
  $q$select * from decide_approval(current_setting('tacit_test.req3')::uuid, false, 'no')$q$, '22023'), 'nor finds a request to decide');
select pg_temp.expect(pg_temp.raises(
  $q$select * from request_approval('offer', 'ac210000-0000-4000-8000-000000000004')$q$, '22023'), 'nor one to make');
select pg_temp.as_owner();
select pg_temp.as_tacit_internal();
select pg_temp.expect((select count(*) from approval_requests) = 0 and (select count(*) from approval_flows) = 0,
  'tacit_internal reads no client approvals');
select pg_temp.as_owner();

-- 22. Custom fields (20261016120000_client_custom_fields). Admins define them;
--     a value is read and written with the candidate, job or offer it is on,
--     a private one only by admins and the job's managers.
select pg_temp.as_member('user_acme', 'org_acme');
insert into custom_fields (id, object, name, field_type, private) values
  ('cf220000-0000-4000-8000-000000000001', 'candidate', 'Work style', 'single_select', false),
  ('cf220000-0000-4000-8000-000000000002', 'candidate', 'Expected comp', 'number', true),
  ('cf220000-0000-4000-8000-000000000003', 'candidate', 'Portfolio', 'url', false),
  ('cf220000-0000-4000-8000-000000000004', 'candidate', 'Available from', 'date', false),
  ('cf220000-0000-4000-8000-000000000005', 'job', 'Team', 'short_text', false),
  ('cf220000-0000-4000-8000-000000000006', 'job', 'Budget code', 'short_text', true),
  ('cf220000-0000-4000-8000-000000000007', 'offer', 'Signing bonus', 'number', false);
insert into custom_field_options (id, field_id, name, position) values
  ('cf221000-0000-4000-8000-000000000001', 'cf220000-0000-4000-8000-000000000001', 'Remote', 1),
  ('cf221000-0000-4000-8000-000000000002', 'cf220000-0000-4000-8000-000000000001', 'Onsite', 2);
select pg_temp.as_owner();
select pg_temp.expect((select bool_and(org_id = 'a0000000-0000-4000-8000-00000000000a' and created_by_actor_id = 'a1000000-0000-4000-8000-000000000001')
  from custom_fields), 'a field lands in its admin''s org, stamped with them');
select pg_temp.expect((select bool_and(org_id = 'a0000000-0000-4000-8000-00000000000a') from custom_field_options), 'an option takes its field''s org');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_fields (object, name, field_type) values ('candidate', 'work STYLE', 'short_text')$q$, '23505'),
  'a field''s name is unique per object ignoring case');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_fields (object, name, field_type) values ('person', 'Elsewhere', 'short_text')$q$, '23514'),
  'a field is on a candidate, job or offer');
select pg_temp.expect(pg_temp.raises(
  $q$update custom_fields set field_type = 'short_text' where id = 'cf220000-0000-4000-8000-000000000001'$q$, '22023'),
  'a field keeps its type');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_field_options (field_id, name) values ('cf220000-0000-4000-8000-000000000005', 'Infra')$q$, '22023'),
  'only a select field has options');

-- Values, checked against the field's type.
select set_config('tacit_test.hm_offer',
  (select id::text from offers where application_id = 'ac300000-0000-4000-8000-000000000001' and status = 'draft'), true);
insert into custom_field_values (field_id, person_id, value) values
  ('cf220000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-000000000001', '"cf221000-0000-4000-8000-000000000001"'),
  ('cf220000-0000-4000-8000-000000000002', 'ac200000-0000-4000-8000-000000000001', '150000'),
  ('cf220000-0000-4000-8000-000000000003', 'ac200000-0000-4000-8000-000000000001', '"https://ada.example.com"'),
  ('cf220000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-00000000000b', '"cf221000-0000-4000-8000-000000000002"');
insert into custom_field_values (field_id, role_id, value) values
  ('cf220000-0000-4000-8000-000000000005', 'ac100000-0000-4000-8000-000000000001', '"Platform"'),
  ('cf220000-0000-4000-8000-000000000006', 'ac100000-0000-4000-8000-000000000001', '"ENG-1"'),
  ('cf220000-0000-4000-8000-000000000005', 'ac100000-0000-4000-8000-000000000002', '"Design"');
insert into custom_field_values (field_id, offer_id, value) values
  ('cf220000-0000-4000-8000-000000000007', current_setting('tacit_test.hm_offer')::uuid, '20000');
select pg_temp.expect((select count(*) from custom_field_values) = 8, 'an admin reads every value they set');
select pg_temp.as_owner();
select pg_temp.expect((select bool_and(org_id = 'a0000000-0000-4000-8000-00000000000a' and updated_by_actor_id = 'a1000000-0000-4000-8000-000000000001')
  from custom_field_values), 'a value lands in its field''s org, stamped with who set it');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_field_values (field_id, person_id, value) values ('cf220000-0000-4000-8000-000000000002', 'ac200000-0000-4000-8000-00000000000d', '"lots"')$q$, '22023'),
  'a number field takes a number');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_field_values (field_id, person_id, value) values ('cf220000-0000-4000-8000-000000000003', 'ac200000-0000-4000-8000-00000000000d', '"ada.example.com"')$q$, '22023'),
  'a url field takes an http(s) address');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_field_values (field_id, person_id, value) values ('cf220000-0000-4000-8000-000000000004', 'ac200000-0000-4000-8000-00000000000d', '"2026-02-30"')$q$, '22023'),
  'a date field takes a real date');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_field_values (field_id, person_id, value) values ('cf220000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-00000000000d', '"cf221000-0000-4000-8000-000000000099"')$q$, '22023'),
  'a select field takes one of its own options');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_field_values (field_id, role_id, value) values ('cf220000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001', '"cf221000-0000-4000-8000-000000000001"')$q$, '22023'),
  'a candidate field goes on no job');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_field_values (field_id, person_id, role_id, value) values ('cf220000-0000-4000-8000-000000000005', 'ac200000-0000-4000-8000-00000000000d', 'ac100000-0000-4000-8000-000000000002', '"x"')$q$, '23514'),
  'a value is on exactly one object');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_field_values (field_id, person_id, value) values ('cf220000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-000000000001', '"cf221000-0000-4000-8000-000000000002"')$q$, '23505'),
  'one value per field per candidate');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_field_values (field_id, offer_id, value) values ('cf220000-0000-4000-8000-000000000007', current_setting('tacit_test.offer')::uuid, '1')$q$, '22023'),
  'a closed offer takes no field value');

-- Archived options and fields: kept where they are, chosen by no one new.
update custom_field_options set archived_at = now() where id = 'cf221000-0000-4000-8000-000000000002';
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_field_values (field_id, person_id, value) values ('cf220000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-00000000000d', '"cf221000-0000-4000-8000-000000000002"')$q$, '22023'),
  'an archived option goes on no one new');
update custom_field_values set updated_at = now() where field_id = 'cf220000-0000-4000-8000-000000000001' and person_id = 'ac200000-0000-4000-8000-00000000000b';
select pg_temp.expect((select value = '"cf221000-0000-4000-8000-000000000002"' from custom_field_values
  where field_id = 'cf220000-0000-4000-8000-000000000001' and person_id = 'ac200000-0000-4000-8000-00000000000b'),
  'but stays on whoever had it');
update custom_fields set archived_at = now() where id = 'cf220000-0000-4000-8000-000000000003';
select pg_temp.expect(pg_temp.raises(
  $q$update custom_field_values set value = '"https://ada.dev"' where field_id = 'cf220000-0000-4000-8000-000000000003'$q$, '22023'),
  'an archived field takes no new value');
delete from custom_fields;
select pg_temp.expect((select count(*) from custom_fields) = 7, 'nobody deletes a field');

-- A hiring manager: their job's candidates and the job itself, private fields included.
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from custom_fields) = 7, 'a hiring manager reads the field definitions');
select pg_temp.expect((select count(*) from custom_field_values) = 6,
  'and the values on their candidate, their job and their offer, private ones included, and none on another job');
insert into custom_field_values (field_id, person_id, value) values
  ('cf220000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-00000000000c', '"cf221000-0000-4000-8000-000000000001"');
update custom_field_values set value = '160000' where field_id = 'cf220000-0000-4000-8000-000000000002';
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_field_values (field_id, person_id, value) values ('cf220000-0000-4000-8000-000000000004', 'ac200000-0000-4000-8000-00000000000b', '"2026-11-01"')$q$, '42501'),
  'a hiring manager sets nothing on a candidate of another job');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_field_values (field_id, role_id, value) values ('cf220000-0000-4000-8000-000000000006', 'ac100000-0000-4000-8000-000000000002', '"X-9"')$q$, '42501'),
  'nor on another job');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_fields (object, name, field_type) values ('job', 'Cost centre', 'short_text')$q$, '42501'),
  'and defines no field');
update custom_fields set name = 'Hijacked' where id = 'cf220000-0000-4000-8000-000000000005';
select pg_temp.as_owner();
select pg_temp.expect((select value = '160000' from custom_field_values where field_id = 'cf220000-0000-4000-8000-000000000002'),
  'a hiring manager changes a private value on their own candidate');
select pg_temp.expect((select name = 'Team' from custom_fields where id = 'cf220000-0000-4000-8000-000000000005'), 'but renames no field');

-- An external recruiter: the candidate they added and the job, nothing private.
select pg_temp.as_member('user_acme_ext', 'org_acme');
select pg_temp.expect((select array_agg(field_id::text order by field_id) from custom_field_values)
  = array['cf220000-0000-4000-8000-000000000001', 'cf220000-0000-4000-8000-000000000005'],
  'an external recruiter reads their candidate''s value and the job''s non-private one');
update custom_field_values set value = '"Hijacked"' where field_id = 'cf220000-0000-4000-8000-000000000005';
select pg_temp.expect((select value = '"Platform"' from custom_field_values where field_id = 'cf220000-0000-4000-8000-000000000005'),
  'and changes no job field');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_field_values (field_id, person_id, value) values ('cf220000-0000-4000-8000-000000000004', 'ac200000-0000-4000-8000-000000000001', '"2026-11-01"')$q$, '42501'),
  'nor anything on a candidate someone else added');
delete from custom_field_values where field_id = 'cf220000-0000-4000-8000-000000000001';
select pg_temp.as_owner();
select pg_temp.expect((select count(*) from custom_field_values where field_id = 'cf220000-0000-4000-8000-000000000001') = 2,
  'clearing removes only the value on their own candidate');

-- An interviewer and another org: nothing.
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from custom_fields) = 0 and (select count(*) from custom_field_options) = 0
  and (select count(*) from custom_field_values) = 0, 'an interviewer reads no custom fields');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_field_values (field_id, person_id, value) values ('cf220000-0000-4000-8000-000000000004', 'ac200000-0000-4000-8000-000000000001', '"2026-11-01"')$q$, '42501'),
  'nor sets one on the candidate they interview');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from custom_fields) = 0 and (select count(*) from custom_field_values) = 0,
  'another org reads none of Acme''s fields');
select pg_temp.expect(pg_temp.raises(
  $q$insert into custom_field_values (field_id, person_id, value) values ('cf220000-0000-4000-8000-000000000004', 'ac200000-0000-4000-8000-000000000001', '"2026-11-01"')$q$, '42501'),
  'nor sets one on an Acme candidate');
insert into custom_fields (object, name, field_type) values ('candidate', 'Work style', 'yes_no');
select pg_temp.expect((select org_id from custom_fields where name = 'Work style') = 'b0000000-0000-4000-8000-00000000000b',
  'the same name is another org''s own field');
select pg_temp.as_tacit_internal();
select pg_temp.expect((select count(*) from custom_fields) = 0 and (select count(*) from custom_field_values) = 0,
  'tacit_internal reads no client custom fields');
select pg_temp.as_owner();

-- 23. Departments, offices and openings (20261016130000_client_org_structure).
--     Ends with every application back at the stage it started at here, so
--     the sections after it see the fixtures as section 19 left them.
select pg_temp.as_member('user_acme', 'org_acme');
insert into departments (id, name) values ('a2300001-0000-4000-8000-000000000001', 'Engineering');
insert into departments (id, name, parent_id) values ('a2300001-0000-4000-8000-000000000002', 'Platform', 'a2300001-0000-4000-8000-000000000001');
select pg_temp.expect(pg_temp.raises($q$insert into departments (name) values ('engineering')$q$, '23505'), 'a department''s name is unique ignoring case');
select pg_temp.expect(pg_temp.raises($q$insert into departments (name) values (' padded ')$q$, '23514'), 'and trimmed');
select pg_temp.expect(pg_temp.raises(
  $q$update departments set parent_id = 'a2300001-0000-4000-8000-000000000002' where id = 'a2300001-0000-4000-8000-000000000001'$q$, '22023'),
  'a department cannot sit inside its own child');
select pg_temp.expect(pg_temp.raises(
  $q$update departments set parent_id = id where id = 'a2300001-0000-4000-8000-000000000001'$q$, '22023'),
  'or inside itself');
insert into offices (id, name, location) values
  ('a2300002-0000-4000-8000-000000000001', 'New York', 'New York, NY'),
  ('a2300002-0000-4000-8000-000000000002', 'Remote', null);
update roles set department_id = 'a2300001-0000-4000-8000-000000000002' where id = 'ac100000-0000-4000-8000-000000000001';
insert into job_offices (role_id, office_id) values ('ac100000-0000-4000-8000-000000000001', 'a2300002-0000-4000-8000-000000000001');
update offices set archived_at = now() where id = 'a2300002-0000-4000-8000-000000000002';
select pg_temp.expect(pg_temp.raises(
  $q$insert into job_offices (role_id, office_id) values ('ac100000-0000-4000-8000-000000000001', 'a2300002-0000-4000-8000-000000000002')$q$, '42501'),
  'an archived office goes on no new job');

insert into openings (role_id, opening_code, target_start_date) values ('ac100000-0000-4000-8000-000000000001', 'ENG-1', '2026-12-01');
insert into openings (role_id) values ('ac100000-0000-4000-8000-000000000001');
insert into openings (role_id, opening_code) values ('ac100000-0000-4000-8000-000000000002', 'DES-1');
select pg_temp.as_owner();
select pg_temp.expect((select org_id = 'a0000000-0000-4000-8000-00000000000a' and created_by_actor_id = 'a1000000-0000-4000-8000-000000000001'
  from departments where name = 'Platform'), 'a department lands in its maker''s org, stamped with them');
select pg_temp.expect((select org_id from job_offices) = 'a0000000-0000-4000-8000-00000000000a', 'a job''s office inherits the job''s org');
select pg_temp.expect((select array_agg(number order by number) from openings where role_id = 'ac100000-0000-4000-8000-000000000001') = array[1, 2]
  and (select number from openings where opening_code = 'DES-1') = 1, 'openings are numbered per job');
select pg_temp.expect((select bool_and(org_id = 'a0000000-0000-4000-8000-00000000000a' and status = 'open'
  and created_by_actor_id = 'a1000000-0000-4000-8000-000000000001') from openings), 'an opening starts open, in the job''s org, stamped with its maker');

select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(pg_temp.raises(
  $q$insert into openings (role_id, status) values ('ac100000-0000-4000-8000-000000000001', 'filled')$q$, '22023'),
  'an opening cannot start filled');
select pg_temp.expect(pg_temp.raises(
  $q$insert into openings (role_id, opening_code) values ('ac100000-0000-4000-8000-000000000002', 'eng-1')$q$, '23505'),
  'an opening code is unique in the org, ignoring case');
select pg_temp.expect(pg_temp.raises($q$update openings set status = 'closed' where opening_code = 'DES-1'$q$, '22023'),
  'closing an opening needs a reason');
select pg_temp.expect(pg_temp.raises($q$update openings set close_reason = 'why' where opening_code = 'ENG-1'$q$, '22023'),
  'and only a closed opening has one');
update openings set status = 'closed', close_reason = 'Budget moved' where opening_code = 'DES-1';
select pg_temp.expect((select closed_at is not null from openings where opening_code = 'DES-1'), 'closing stamps it');
select pg_temp.expect(pg_temp.raises(
  $q$update openings set status = 'filled', filled_by_application_id = 'ac300000-0000-4000-8000-00000000000b' where opening_code = 'DES-1'$q$, '22023'),
  'a closed opening is not filled');
select pg_temp.expect(pg_temp.raises(
  $q$update openings set status = 'filled', filled_by_application_id = 'ac300000-0000-4000-8000-000000000001' where opening_code = 'ENG-1'$q$, '22023'),
  'an opening is filled only by someone hired into its job');
select pg_temp.expect(pg_temp.raises(
  $q$update openings set role_id = 'ac100000-0000-4000-8000-000000000002' where opening_code = 'ENG-1'$q$, '22023'),
  'an opening stays on its job');
delete from openings;
select pg_temp.expect((select count(*) from openings) = 3, 'nobody deletes an opening');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect(pg_temp.raises(
  $q$insert into departments (name, parent_id) values ('Globex eng', 'a2300001-0000-4000-8000-000000000001')$q$, '23503'),
  'another org''s department is no parent');

-- A hiring manager reads the structure and their job's openings, and hires.
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from departments) = 2 and (select count(*) from offices) = 2, 'a hiring manager reads departments and offices');
select pg_temp.expect((select count(*) from job_offices) = 1, 'and their job''s office');
select pg_temp.expect((select count(*) from openings) = 2, 'and their job''s openings, not another job''s');
select pg_temp.expect(pg_temp.raises($q$insert into departments (name) values ('Sales')$q$, '42501'), 'but makes no department');
select pg_temp.expect(pg_temp.raises($q$insert into offices (name) values ('Paris')$q$, '42501'), 'or office');
select pg_temp.expect(pg_temp.raises(
  $q$insert into openings (role_id) values ('ac100000-0000-4000-8000-000000000002')$q$, '42501'),
  'and adds no opening to another job');
update applications set stage = 'hired' where id = 'ac300000-0000-4000-8000-000000000001';
select pg_temp.as_owner();
select pg_temp.expect((select status = 'filled' and filled_by_application_id = 'ac300000-0000-4000-8000-000000000001' and filled_at is not null
  from openings where opening_code = 'ENG-1'), 'hiring fills the job''s oldest open opening');
select pg_temp.expect((select status from roles where id = 'ac100000-0000-4000-8000-000000000001') = 'open', 'the job stays open while an opening is');

select pg_temp.as_member('user_acme', 'org_acme');
update applications set stage = 'hired' where id = 'ac300000-0000-4000-8000-00000000000c';
select pg_temp.as_owner();
select pg_temp.expect((select filled_by_application_id from openings where role_id = 'ac100000-0000-4000-8000-000000000001' and number = 2)
  = 'ac300000-0000-4000-8000-00000000000c', 'the next hire fills the next opening');
select pg_temp.expect((select status from roles where id = 'ac100000-0000-4000-8000-000000000001') = 'filled', 'and the last one filled fills the job');
select pg_temp.as_member('user_acme', 'org_acme');
update applications set stage = 'offer' where id = 'ac300000-0000-4000-8000-00000000000c';
select pg_temp.as_owner();
select pg_temp.expect((select status = 'open' and filled_by_application_id is null and filled_at is null
  from openings where role_id = 'ac100000-0000-4000-8000-000000000001' and number = 2), 'un-hiring opens the opening again');
select pg_temp.expect((select status from roles where id = 'ac100000-0000-4000-8000-000000000001') = 'open', 'and the job');
-- With a job_open approval flow (20261016110000) the job stays filled when
-- someone is un-hired: opening it again needs a new approval, not a refusal.
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select changed from set_approval_flow('ac100000-0000-4000-8000-000000000001', 'job_open',
  '[["a1000000-0000-4000-8000-000000000001"]]'::jsonb)), 'a job_open flow on the job');
update applications set stage = 'hired' where id = 'ac300000-0000-4000-8000-00000000000c';
update applications set stage = 'offer' where id = 'ac300000-0000-4000-8000-00000000000c';
select pg_temp.as_owner();
select pg_temp.expect((select stage from applications where id = 'ac300000-0000-4000-8000-00000000000c') = 'offer'
  and (select status from roles where id = 'ac100000-0000-4000-8000-000000000001') = 'filled'
  and (select status from openings where role_id = 'ac100000-0000-4000-8000-000000000001' and number = 2) = 'open',
  'under a job_open flow, un-hiring opens the opening and leaves the job filled');
select pg_temp.expect(not exists (select 1 from approval_requests where role_id = 'ac100000-0000-4000-8000-000000000001'),
  'and asks for or spends no approval');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select changed from set_approval_flow('ac100000-0000-4000-8000-000000000001', 'job_open', '[]'::jsonb)),
  'the flow removed');
update roles set status = 'open' where id = 'ac100000-0000-4000-8000-000000000001';
select pg_temp.as_owner();
select pg_temp.expect((select status from roles where id = 'ac100000-0000-4000-8000-000000000001') = 'open', 'the job opens again by hand');
select pg_temp.as_member('user_acme', 'org_acme');
update applications set stage = 'hired' where id = 'ac300000-0000-4000-8000-00000000000b';
select pg_temp.as_owner();
select pg_temp.expect((select stage from applications where id = 'ac300000-0000-4000-8000-00000000000b') = 'hired'
  and (select status from openings where opening_code = 'DES-1') = 'closed'
  and (select status from roles where id = 'ac100000-0000-4000-8000-000000000002') = 'open',
  'a job with no open opening is still hired into, and nothing else changes');

-- Back to section 19's stages; Ada's opening opens again.
select pg_temp.as_member('user_acme', 'org_acme');
update applications set stage = 'screening' where id = 'ac300000-0000-4000-8000-00000000000b';
update applications set stage = 'contacted' where id = 'ac300000-0000-4000-8000-00000000000c';
update applications set stage = 'screening' where id = 'ac300000-0000-4000-8000-000000000001';
select pg_temp.as_owner();
select pg_temp.expect((select count(*) from openings where role_id = 'ac100000-0000-4000-8000-000000000001' and status = 'open') = 2,
  'both of the job''s openings are open again');

-- A hired candidate deleted keeps the seat filled, by no one.
insert into people (id, display_name, org_id) values ('a2300004-0000-4000-8000-000000000001', 'Zed Acme', 'a0000000-0000-4000-8000-00000000000a');
insert into applications (id, person_id, role_id, stage) values
  ('a2300005-0000-4000-8000-000000000001', 'a2300004-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001', 'hired');
select pg_temp.expect((select filled_by_application_id from openings where opening_code = 'ENG-1') = 'a2300005-0000-4000-8000-000000000001',
  'someone added straight in at hired fills an opening too');
delete from people where id = 'a2300004-0000-4000-8000-000000000001';
select pg_temp.expect((select status = 'filled' and filled_by_application_id is null from openings where opening_code = 'ENG-1'),
  'deleting them leaves the opening filled by no one');
select pg_temp.as_member('user_acme', 'org_acme');
update openings set status = 'open' where opening_code = 'ENG-1';
select pg_temp.as_owner();
select pg_temp.expect((select status = 'open' and filled_at is null from openings where opening_code = 'ENG-1'), 'and an admin can open it again');

select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from departments) + (select count(*) from offices) + (select count(*) from job_offices)
  + (select count(*) from openings) = 0, 'an interviewer reads no departments, offices or openings');
select pg_temp.as_member('user_acme_ext', 'org_acme');
select pg_temp.expect((select count(*) from openings) = 0, 'an external recruiter reads no openings');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from departments) + (select count(*) from offices) + (select count(*) from job_offices)
  + (select count(*) from openings) = 0, 'another org reads none of Acme''s structure');
select pg_temp.expect(pg_temp.raises(
  $q$insert into openings (role_id) values ('ac100000-0000-4000-8000-000000000001')$q$, '42501'),
  'and adds no opening to an Acme job');
select pg_temp.as_tacit_internal();
select pg_temp.expect((select count(*) from departments) + (select count(*) from openings) = 0, 'tacit_internal reads no client structure');
select pg_temp.as_owner();
update roles set department_id = null where id = 'ac100000-0000-4000-8000-000000000001';

-- 24. Prospects and talent pools (20261016140000_client_pools). A prospect is
--     a person in no pipeline: read by every member above interviewer who is
--     not an external recruiter, changed by its creator and admins. Dee (from
--     10) is one nobody is recorded as adding.
select pg_temp.as_member('user_acme_hm', 'org_acme');
insert into people (id, display_name, email, prospect_source, prospect_source_detail) values
  ('ac240000-0000-4000-8000-000000000001', 'Pat Prospect', 'pat@example.com', 'referral', 'Ada');
select pg_temp.as_owner();
select pg_temp.expect((select added_by_actor_id = 'a1000000-0000-4000-8000-000000000003' and org_id = 'a0000000-0000-4000-8000-00000000000a'
  from people where id = 'ac240000-0000-4000-8000-000000000001'), 'a prospect a member adds is stamped with them, in their org');
select pg_temp.as_member('user_acme', 'org_acme');
insert into people (id, display_name) values ('ac240000-0000-4000-8000-000000000002', 'Quinn Prospect');
select pg_temp.expect(pg_temp.raises($q$
  insert into people (display_name, added_by_actor_id) values ('Forged', 'a1000000-0000-4000-8000-000000000003')$q$, '42501'),
  'nobody adds a person as someone else');
select pg_temp.expect(pg_temp.raises($q$
  update people set prospect_source = 'linkedin' where id = 'ac240000-0000-4000-8000-000000000002'$q$, '23514'),
  'a prospect''s source is one of the application sources');

select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from people where id in ('ac240000-0000-4000-8000-000000000001',
  'ac240000-0000-4000-8000-000000000002', 'ac200000-0000-4000-8000-00000000000d')) = 3,
  'a hiring manager reads every prospect, whoever added it');
select pg_temp.expect(can_read_person('ac240000-0000-4000-8000-000000000002', true), 'including a prospect''s detail');
select pg_temp.expect((select count(*) from person_identifiers where person_id = 'ac240000-0000-4000-8000-000000000001') = 1,
  'such as the identifiers that let add_candidate find them by email');
update people set current_title = 'Researcher' where id = 'ac240000-0000-4000-8000-000000000001';
update people set current_title = 'hijacked' where id in ('ac240000-0000-4000-8000-000000000002', 'ac200000-0000-4000-8000-00000000000d');
select pg_temp.expect(pg_temp.raises($q$
  insert into person_tags (person_id, tag_id) values ('ac240000-0000-4000-8000-000000000002', 'ac500000-0000-4000-8000-000000000001')$q$, '42501'),
  'nor tags a prospect someone else added');
insert into person_tags (person_id, tag_id) values ('ac240000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000001');
insert into person_notes (person_id, text) values ('ac240000-0000-4000-8000-000000000002', 'met at a meetup');
select pg_temp.expect(pg_temp.raises($q$
  update people set added_by_actor_id = 'a1000000-0000-4000-8000-000000000001' where id = 'ac240000-0000-4000-8000-000000000001'$q$, '42501'),
  'and only an admin changes who added a person');
select pg_temp.as_owner();
select pg_temp.expect((select current_title from people where id = 'ac240000-0000-4000-8000-000000000001') = 'Researcher',
  'the creator changes their own prospect');
select pg_temp.expect(not exists (select 1 from people where current_title = 'hijacked'),
  'but not one an admin added, nor one nobody is recorded as adding');
select pg_temp.expect((select count(*) from person_notes where person_id = 'ac240000-0000-4000-8000-000000000002') = 1,
  'a member who reads a prospect notes on them');

-- Pools: made by whoever can add candidates, archived by admins.
select pg_temp.as_member('user_acme_hm', 'org_acme');
insert into talent_pools (id, name) values
  ('ac240000-0000-4000-8000-000000000011', 'Staff engineers'),
  ('ac240000-0000-4000-8000-000000000012', 'Designers');
select pg_temp.expect(pg_temp.raises($q$insert into talent_pools (name) values ('STAFF ENGINEERS')$q$, '23505'), 'a pool''s name is unique ignoring case');
select pg_temp.expect(pg_temp.raises($q$insert into talent_pools (name) values (' padded ')$q$, '23514'), 'and trimmed');
insert into pool_memberships (id, pool_id, person_id) values
  ('ac240000-0000-4000-8000-000000000021', 'ac240000-0000-4000-8000-000000000011', 'ac240000-0000-4000-8000-000000000001');
insert into pool_memberships (pool_id, person_id, stage) values
  ('ac240000-0000-4000-8000-000000000011', 'ac240000-0000-4000-8000-000000000002', 'contacted'),
  ('ac240000-0000-4000-8000-000000000011', 'ac200000-0000-4000-8000-000000000001', 'engaged');
select pg_temp.expect((select count(*) from pool_memberships) = 3, 'a pool holds prospects and candidates alike');
select pg_temp.expect(pg_temp.raises($q$
  insert into pool_memberships (pool_id, person_id) values ('ac240000-0000-4000-8000-000000000011', 'ac200000-0000-4000-8000-00000000000b')$q$, '42501'),
  'but only people the member can read');
select pg_temp.expect(pg_temp.raises($q$
  insert into pool_memberships (pool_id, person_id) values ('ac240000-0000-4000-8000-000000000011', 'ac240000-0000-4000-8000-000000000001')$q$, '23505'),
  'once per pool');
update pool_memberships set stage = 'engaged' where id = 'ac240000-0000-4000-8000-000000000021';
select pg_temp.expect((select stage = 'engaged' and updated_at >= created_at from pool_memberships where id = 'ac240000-0000-4000-8000-000000000021'),
  'a pool stage moves');
select pg_temp.expect(pg_temp.raises($q$
  update pool_memberships set stage = 'hired' where id = 'ac240000-0000-4000-8000-000000000021'$q$, '23514'),
  'to one of the four pool stages only');
select pg_temp.expect(pg_temp.raises($q$
  update pool_memberships set pool_id = 'ac240000-0000-4000-8000-000000000012' where id = 'ac240000-0000-4000-8000-000000000021'$q$, '22023'),
  'and a membership stays in its pool');
update talent_pools set archived_at = now() where id = 'ac240000-0000-4000-8000-000000000012';
select pg_temp.expect((select count(*) from talent_pools where archived_at is not null) = 0, 'archiving a pool is for admins');
select pg_temp.as_owner();
select pg_temp.expect((select org_id = 'a0000000-0000-4000-8000-00000000000a' and created_by_actor_id = 'a1000000-0000-4000-8000-000000000003'
  from talent_pools where id = 'ac240000-0000-4000-8000-000000000011'), 'a pool lands in its maker''s org, stamped with them');
select pg_temp.expect((select count(*) from pool_memberships where org_id = 'a0000000-0000-4000-8000-00000000000a'
  and added_by_actor_id = 'a1000000-0000-4000-8000-000000000003') = 3, 'memberships are filed under the org, stamped with who added them');
select pg_temp.as_member('user_acme', 'org_acme');
update talent_pools set archived_at = now() where id = 'ac240000-0000-4000-8000-000000000012';
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$
  insert into pool_memberships (pool_id, person_id) values ('ac240000-0000-4000-8000-000000000012', 'ac240000-0000-4000-8000-000000000001')$q$, '42501'),
  'an archived pool takes no one new');
delete from talent_pools;
select pg_temp.expect((select count(*) from talent_pools) = 2, 'nobody deletes a pool');

-- Joining a job ends being a prospect: the job's access decides from then on.
insert into applications (person_id, role_id) values ('ac240000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000001');
select pg_temp.expect(can_edit_person('ac240000-0000-4000-8000-000000000002'), 'a prospect converted into the job is the hiring manager''s to change');

-- An interviewer reads no prospects and no pools, and writes neither.
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from people where id in ('ac240000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-00000000000d')) = 0
  and (select count(*) from talent_pools) = 0 and (select count(*) from pool_memberships) = 0,
  'an interviewer reads no prospects, pools or memberships');
select pg_temp.expect(not can_read_person('ac240000-0000-4000-8000-000000000001'), 'not even by asking the helper');
select pg_temp.expect(pg_temp.raises($q$insert into people (display_name) values ('Interviewer pick')$q$, '42501'), 'and adds no prospect');
select pg_temp.expect(pg_temp.raises($q$insert into talent_pools (name) values ('Mine')$q$, '42501'), 'nor a pool');
select pg_temp.expect(pg_temp.raises($q$
  insert into pool_memberships (pool_id, person_id) values ('ac240000-0000-4000-8000-000000000011', 'ac200000-0000-4000-8000-000000000001')$q$, '42501'),
  'nor puts anyone in one');

-- An external recruiter reads only the prospects they added, and no pools.
select pg_temp.as_owner();
insert into people (id, display_name, email, org_id, added_by_actor_id) values
  ('ac240000-0000-4000-8000-000000000003', 'Xena Agency', 'xena@example.com', 'a0000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000004');
select pg_temp.as_member('user_acme_ext', 'org_acme');
select pg_temp.expect(exists (select 1 from people where id = 'ac240000-0000-4000-8000-000000000003')
  and (select count(*) from people where id in ('ac240000-0000-4000-8000-000000000001', 'ac240000-0000-4000-8000-000000000002',
                                                'ac200000-0000-4000-8000-00000000000d')) = 0,
  'an external recruiter reads the prospect they added, and no other prospect');
select pg_temp.expect(can_edit_person('ac240000-0000-4000-8000-000000000003'), 'and may change their own prospect');
select pg_temp.expect(not can_read_person('ac240000-0000-4000-8000-000000000003', true)
  and (select count(*) from person_identifiers) = 0, 'but reads none of its detail');
select pg_temp.expect((select count(*) from talent_pools) = 0 and (select count(*) from pool_memberships) = 0,
  'an external recruiter reads no pools');
select pg_temp.expect(pg_temp.raises($q$insert into people (display_name) values ('Agency pick')$q$, '42501'), 'and adds no prospect');
select pg_temp.expect(pg_temp.raises($q$
  insert into pool_memberships (pool_id, person_id) values ('ac240000-0000-4000-8000-000000000011', 'ac200000-0000-4000-8000-00000000000c')$q$, '42501'),
  'nor pools even their own candidate');

-- Removing someone from a pool, and another org.
select pg_temp.as_member('user_acme_hm', 'org_acme');
delete from pool_memberships where person_id = 'ac200000-0000-4000-8000-000000000001';
select pg_temp.expect((select count(*) from pool_memberships) = 2, 'a member who can add candidates takes someone out of a pool');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from talent_pools) = 0 and (select count(*) from pool_memberships) = 0
  and not exists (select 1 from people where id = 'ac240000-0000-4000-8000-000000000001'),
  'another org reads none of Acme''s prospects or pools');
select pg_temp.expect(not can_read_person('ac240000-0000-4000-8000-000000000001') and not can_edit_person('ac240000-0000-4000-8000-000000000001'),
  'and its helpers answer no for them');
select pg_temp.expect(pg_temp.raises($q$
  insert into pool_memberships (pool_id, person_id) values ('ac240000-0000-4000-8000-000000000011', 'ac240000-0000-4000-8000-000000000001')$q$, '42501'),
  'nor puts an Acme prospect in an Acme pool');
insert into talent_pools (name) values ('Staff engineers');
select pg_temp.expect((select org_id from talent_pools where name = 'Staff engineers') = 'b0000000-0000-4000-8000-00000000000b',
  'the same name is another org''s own pool');
select pg_temp.as_owner();
select pg_temp.as_tacit_internal();
select pg_temp.expect((select count(*) from talent_pools) = 0 and (select count(*) from pool_memberships) = 0, 'tacit_internal reads no client pools');
select pg_temp.as_owner();

-- 25. Job posts and inbound applications (20261016150000_client_job_posts).
--     The hiring manager on Founding engineer posts it; the public applies
--     through the two anon functions and nothing else.
grant execute on function pg_temp.raises(text, text) to anon;
select pg_temp.as_member('user_acme_hm', 'org_acme');
insert into job_posts (id, role_id, title, location, description, questions) values
  ('ac600000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001', 'Founding Engineer', 'Remote', 'Build it with us.',
   '[{"id": "name", "type": "name", "label": "Full name", "required": true},
     {"id": "email", "type": "email", "label": "Email", "required": true},
     {"id": "phone", "type": "phone", "label": "Phone", "required": false},
     {"id": "linkedin", "type": "linkedin", "label": "LinkedIn", "required": false},
     {"id": "q_why1", "type": "long_text", "label": "Why us?", "required": true},
     {"id": "q_auth", "type": "yes_no", "label": "Authorized to work in the US?", "required": true},
     {"id": "q_when", "type": "select", "label": "When could you start?", "required": false, "options": ["Now", "In a month"]}]');
select pg_temp.as_owner();
select set_config('tacit_test.slug', (select slug from job_posts where id = 'ac600000-0000-4000-8000-000000000001'), true);
select pg_temp.expect((select org_id = 'a0000000-0000-4000-8000-00000000000a' and created_by_actor_id = 'a1000000-0000-4000-8000-000000000003'
  and status = 'draft' and slug ~ '^[a-z0-9]{32}$' from job_posts where id = 'ac600000-0000-4000-8000-000000000001'),
  'a post lands in the job''s org as a draft, stamped with its author, under a random slug');
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$insert into job_posts (role_id, title, status) values ('ac100000-0000-4000-8000-000000000001', 'Live at once', 'live')$q$, '22023'),
  'a post starts as a draft');
select pg_temp.expect(pg_temp.raises($q$insert into job_posts (role_id, title, questions) values ('ac100000-0000-4000-8000-000000000001', 'No email',
  '[{"id": "name", "type": "name", "label": "Name", "required": true}]')$q$, '22023'), 'a post always asks for an email');
select pg_temp.expect(pg_temp.raises($q$insert into job_posts (role_id, title, questions) values ('ac100000-0000-4000-8000-000000000001', 'Bad select',
  '[{"id": "name", "type": "name", "label": "Name", "required": true}, {"id": "email", "type": "email", "label": "Email", "required": true},
    {"id": "q_pick", "type": "select", "label": "Pick", "required": true, "options": ["only one"]}]')$q$, '22023'), 'a select needs two options');
select pg_temp.expect(pg_temp.raises($q$insert into job_posts (role_id, title, questions) values ('ac100000-0000-4000-8000-000000000001', 'Optional email',
  '[{"id": "name", "type": "name", "label": "Name", "required": true}, {"id": "email", "type": "email", "label": "Email", "required": false}]')$q$, '22023'),
  'and email is always required');
select pg_temp.expect(pg_temp.raises($q$insert into job_posts (role_id, title) values ('ac100000-0000-4000-8000-000000000002', 'Not my job')$q$, '42501'),
  'a hiring manager cannot post a job they do not manage');
select pg_temp.expect(pg_temp.raises($q$update job_posts set slug = 'abcdefghijklmnopqrstuvwxyz' where id = 'ac600000-0000-4000-8000-000000000001'$q$, '22023'),
  'a post keeps its slug');

-- A draft is not public, by either function.
select pg_temp.as_anon();
select pg_temp.expect(not exists (select 1 from job_post_public(current_setting('tacit_test.slug'))), 'a draft is not public');
select pg_temp.expect(pg_temp.raises(format($q$select submit_job_application(%L, '{"name": "A", "email": "a@x.test"}')$q$, current_setting('tacit_test.slug')), 'P0002'),
  'and takes no applications');
select pg_temp.as_member('user_acme_hm', 'org_acme');
update job_posts set status = 'live' where id = 'ac600000-0000-4000-8000-000000000001';
select pg_temp.expect((select published_at is not null from job_posts where id = 'ac600000-0000-4000-8000-000000000001'), 'going live stamps published_at');
select pg_temp.expect(pg_temp.raises($q$update job_posts set status = 'draft' where id = 'ac600000-0000-4000-8000-000000000001'$q$, '22023'),
  'a live post never goes back to draft');

-- The public reads the post's public fields and nothing else.
select pg_temp.as_anon();
select pg_temp.expect((select title = 'Founding Engineer' and company = 'Acme' and location = 'Remote' and jsonb_array_length(questions) = 7
  from job_post_public(current_setting('tacit_test.slug'))), 'a live post is public, with the company''s name');
select pg_temp.expect(
  (select array_agg(k order by k) from jsonb_object_keys((select to_jsonb(p) from job_post_public(current_setting('tacit_test.slug')) p)) k)
    = array['company', 'description', 'location', 'questions', 'title'], 'job_post_public returns exactly the five public fields');
select pg_temp.expect(
  (select array_agg(k order by k) from jsonb_object_keys((select to_jsonb(p) from job_post_page(current_setting('tacit_test.slug')) p)) k)
    = array['company', 'department', 'description', 'location', 'org_slug', 'questions', 'title'], 'job_post_page returns exactly the seven public fields');
select pg_temp.expect(not exists (select 1 from job_post_public('nope')) and not exists (select 1 from job_post_public(null))
  and not exists (select 1 from job_post_page('nope')) and not exists (select 1 from job_post_page(null)), 'a wrong slug reads nothing');
select pg_temp.expect((select count(*) from job_posts) = 0 and (select count(*) from application_answers) = 0
  and (select count(*) from job_post_attempts) = 0 and (select count(*) from people) = 0 and (select count(*) from applications) = 0
  and (select count(*) from roles) = 0 and (select count(*) from orgs) = 0, 'anon reads no table directly');

-- A new applicant: a person in Acme, an application at sourced from the job board, the answers.
select pg_temp.expect(submit_job_application(current_setting('tacit_test.slug'),
  '{"name": "  Nia Applicant ", "email": "Nia@Example.test", "phone": "+1 415 555 0100", "q_why1": "I like hard problems.", "q_auth": true, "q_when": "Now"}'),
  'a valid application is answered with true');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) from people where email = 'nia@example.test' and org_id = 'a0000000-0000-4000-8000-00000000000a'
  and display_name = 'Nia Applicant' and phone = '+1 415 555 0100') = 1, 'the applicant is a new person in the post''s org, address lowercased');
select pg_temp.expect((select a.stage = 'sourced' and a.source = 'job_board' and a.source_detail = 'Founding Engineer' and a.added_by_actor_id is null
  from applications a join people p on p.id = a.person_id where p.email = 'nia@example.test'), 'in the job at sourced, from the job board, named by the post');
select pg_temp.expect((select count(*) from application_events e join applications a on a.id = e.application_id join people p on p.id = a.person_id
  where p.email = 'nia@example.test' and e.kind = 'added' and e.to_stage = 'sourced') = 1, 'with an added event');
select pg_temp.expect((select aa.job_post_id = 'ac600000-0000-4000-8000-000000000001'
  and aa.answers @> '[{"id": "q_auth", "value": "yes", "label": "Authorized to work in the US?"}, {"id": "q_why1", "value": "I like hard problems."}]'
  and not aa.answers @> '[{"id": "linkedin"}]'
  from application_answers aa join applications a on a.id = aa.application_id join people p on p.id = a.person_id
  where p.email = 'nia@example.test'), 'the answers are kept with their labels, unanswered optional ones left out');

-- Someone already in the org is reused, and someone already in the job is left alone.
select pg_temp.as_anon();
select pg_temp.expect(submit_job_application(current_setting('tacit_test.slug'),
  '{"name": "Robert", "email": "BOB@example.com", "q_why1": "Design to code.", "q_auth": "no"}'), 'an applicant already on file is answered the same');
select pg_temp.expect(submit_job_application(current_setting('tacit_test.slug'),
  '{"name": "Nia Again", "email": "nia@example.test", "q_why1": "Again.", "q_auth": "yes"}'), 'and so is one already in the job');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) from people where lower(email) = 'bob@example.com' and org_id = 'a0000000-0000-4000-8000-00000000000a') = 1
  and (select display_name from people where id = 'ac200000-0000-4000-8000-00000000000b') = 'Bob Acme',
  'an address on file is the same person, and their record is not touched');
select pg_temp.expect(exists (select 1 from applications where person_id = 'ac200000-0000-4000-8000-00000000000b'
  and role_id = 'ac100000-0000-4000-8000-000000000001' and source = 'job_board'), 'they join the job');
select pg_temp.expect((select count(*) from applications a join people p on p.id = a.person_id where p.email = 'nia@example.test') = 1
  and (select count(*) from application_answers aa join applications a on a.id = aa.application_id join people p on p.id = a.person_id
       where p.email = 'nia@example.test' and aa.answers @> '[{"value": "I like hard problems."}]') = 1,
  'applying twice changes nothing');
select pg_temp.expect((select count(*) from people where email = 'nia@example.test') = 1, 'nor makes a second person');
select pg_temp.expect((select added_by_actor_id is null from people where email = 'nia@example.test'), 'an applicant was added by no member');

-- A prospect (20261016140000_client_pools) applying is the same person, now in the job.
select pg_temp.as_anon();
select pg_temp.expect(submit_job_application(current_setting('tacit_test.slug'),
  '{"name": "Patricia", "email": "PAT@example.com", "q_why1": "Saw the post.", "q_auth": "yes"}'), 'a prospect applying is answered the same');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) from people where lower(email) = 'pat@example.com' and org_id = 'a0000000-0000-4000-8000-00000000000a') = 1
  and exists (select 1 from applications where person_id = 'ac240000-0000-4000-8000-000000000001'
              and role_id = 'ac100000-0000-4000-8000-000000000001' and source = 'job_board'),
  'a prospect is reused, not duplicated, and joins the job');
select pg_temp.expect((select display_name = 'Pat Prospect' and added_by_actor_id = 'a1000000-0000-4000-8000-000000000003'
  from people where id = 'ac240000-0000-4000-8000-000000000001'), 'and their record, who added them included, is untouched');

-- Every answer is checked against the questions.
select pg_temp.as_anon();
select pg_temp.expect(pg_temp.raises(format($q$select submit_job_application(%L, '{"name": "Zed", "email": "zed@x.test", "q_auth": "yes"}')$q$,
  current_setting('tacit_test.slug')), '22023'), 'a required answer missing is refused');
select pg_temp.expect(pg_temp.raises(format($q$select submit_job_application(%L, '{"name": "Zed", "email": "zed@x.test", "q_why1": "  ", "q_auth": "yes"}')$q$,
  current_setting('tacit_test.slug')), '22023'), 'a blank one too');
select pg_temp.expect(pg_temp.raises(format($q$select submit_job_application(%L, '{"name": "Zed", "email": "not an address", "q_why1": "x", "q_auth": "yes"}')$q$,
  current_setting('tacit_test.slug')), '22023'), 'an address that is not one');
select pg_temp.expect(pg_temp.raises(format($q$select submit_job_application(%L, '{"name": "Zed", "email": "zed@x.test", "q_why1": "x", "q_auth": "maybe"}')$q$,
  current_setting('tacit_test.slug')), '22023'), 'a yes/no that is neither');
select pg_temp.expect(pg_temp.raises(format($q$select submit_job_application(%L, '{"name": "Zed", "email": "zed@x.test", "q_why1": "x", "q_auth": "yes", "q_when": "Never"}')$q$,
  current_setting('tacit_test.slug')), '22023'), 'a choice not offered');
select pg_temp.expect(pg_temp.raises(format($q$select submit_job_application(%L, '{"name": "Zed", "email": "zed@x.test", "q_why1": "x", "q_auth": "yes", "linkedin": "https://evil.test/in/zed"}')$q$,
  current_setting('tacit_test.slug')), '22023'), 'a LinkedIn link that is not LinkedIn');
select pg_temp.expect(pg_temp.raises(format($q$select submit_job_application(%L, jsonb_build_object('name', 'Zed', 'email', 'zed@x.test', 'q_why1', repeat('x', 5001), 'q_auth', 'yes'))$q$,
  current_setting('tacit_test.slug')), '22023'), 'a long answer over 5,000 characters');
select pg_temp.expect(pg_temp.raises(format($q$select submit_job_application(%L, '{"name": "Zed", "email": "zed@x.test", "q_why1": "x", "q_auth": "yes", "salary": "1"}')$q$,
  current_setting('tacit_test.slug')), '22023'), 'an answer to a question the post does not ask');
select pg_temp.expect(pg_temp.raises(format($q$select submit_job_application(%L, '{"name": "Zed", "email": "zed@x.test", "q_why1": 7, "q_auth": "yes"}')$q$,
  current_setting('tacit_test.slug')), '22023'), 'an answer that is not text');
-- The honeypot: answered as a success, nothing written.
select pg_temp.expect(submit_job_application(current_setting('tacit_test.slug'),
  '{"name": "Bot", "email": "bot@spam.test", "q_why1": "x", "q_auth": "yes"}', 'http://spam.test'), 'a filled honeypot is answered with true');
select pg_temp.as_owner();
select pg_temp.expect(not exists (select 1 from people where email in ('zed@x.test', 'bot@spam.test')), 'and no refused or honeypot submission wrote anyone');

-- The rate limit: five submissions an hour from one address.
insert into job_post_attempts (job_post_id, email_digest)
select 'ac600000-0000-4000-8000-000000000001', md5('busy@x.test') from generate_series(1, 5);
select pg_temp.expect((select count(*) from job_post_attempts where org_id = 'a0000000-0000-4000-8000-00000000000a') = 9,
  'an attempt inherits its post''s org, and each accepted submission left one');
select pg_temp.as_anon();
select pg_temp.expect(pg_temp.raises(format($q$select submit_job_application(%L, '{"name": "Busy", "email": "busy@x.test", "q_why1": "x", "q_auth": "yes"}')$q$,
  current_setting('tacit_test.slug')), 'PT429'), 'a sixth from one address in an hour is refused');

-- Who reads the answers: those who read the application.
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select count(*) from job_posts) = 1 and (select count(*) from application_answers) = 3, 'an admin reads the post and every answer');
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from application_answers) = 3, 'so does the job''s hiring manager');
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from job_posts) = 1, 'an interviewer on the job sees its post');
select pg_temp.expect((select count(*) from application_answers) = 0, 'but no answers');
update job_posts set title = 'Hijacked' where id = 'ac600000-0000-4000-8000-000000000001';
select pg_temp.expect((select title from job_posts) = 'Founding Engineer', 'and cannot change it');
select pg_temp.as_member('user_acme_ext', 'org_acme');
select pg_temp.expect((select count(*) from application_answers) = 0 and (select count(*) from job_post_attempts) = 0,
  'an external recruiter reads no one else''s applicants'' answers');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from job_posts) = 0 and (select count(*) from application_answers) = 0, 'another org reads none of it');
select pg_temp.expect(pg_temp.raises($q$insert into job_posts (role_id, title) values ('ac100000-0000-4000-8000-000000000001', 'Poach')$q$, '42501'),
  'nor posts Acme''s job');
select pg_temp.as_tacit_internal();
select pg_temp.expect((select count(*) from job_posts) = 0 and (select count(*) from application_answers) = 0
  and (select count(*) from job_post_attempts) = 0, 'tacit_internal reads no client posts');

-- Closed, wrong and not-open answer alike.
select pg_temp.as_member('user_acme_hm', 'org_acme');
update job_posts set status = 'closed' where id = 'ac600000-0000-4000-8000-000000000001';
select pg_temp.as_owner();
create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'no error';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
grant execute on function pg_temp.refusal(text) to anon;
select pg_temp.as_anon();
select pg_temp.expect(not exists (select 1 from job_post_public(current_setting('tacit_test.slug'))), 'a closed post is not public');
select pg_temp.expect(
  pg_temp.refusal(format($q$select submit_job_application(%L, '{"name": "Late", "email": "late@x.test", "q_why1": "x", "q_auth": "yes"}')$q$, current_setting('tacit_test.slug')))
    = pg_temp.refusal($q$select submit_job_application('0123456789abcdef0123456789abcdef', '{"name": "Late", "email": "late@x.test", "q_why1": "x", "q_auth": "yes"}')$q$)
  and pg_temp.refusal($q$select submit_job_application('0123456789abcdef0123456789abcdef', '{}')$q$) = 'P0002 job post not found',
  'a closed post and a wrong slug are refused identically');
select pg_temp.as_member('user_acme_hm', 'org_acme');
update job_posts set status = 'live' where id = 'ac600000-0000-4000-8000-000000000001';
select pg_temp.as_owner();
update roles set status = 'paused' where id = 'ac100000-0000-4000-8000-000000000001';
select pg_temp.as_anon();
select pg_temp.expect(not exists (select 1 from job_post_public(current_setting('tacit_test.slug')))
  and pg_temp.refusal(format($q$select submit_job_application(%L, '{}')$q$, current_setting('tacit_test.slug'))) = 'P0002 job post not found',
  'a live post on a job that is not open reads as not found too');
select pg_temp.as_owner();
update roles set status = 'open' where id = 'ac100000-0000-4000-8000-000000000001';

-- 26. Merging duplicates and erasing a candidate (20261016160000_client_merge_anonymize).
--     Kim (kept), Kimberly (her duplicate) and Kit (Kimberly's duplicate), every
--     scrap of their personal data marked zq26marker so the erasure can be
--     checked against every table at the end.
select pg_temp.as_owner();
insert into people (id, org_id, display_name, email, phone, location, current_title) values
  ('a2600000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'Kim Zq26marker', 'zq26marker@dup.test', null, 'Berlin', null),
  ('a2600000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 'Kimberly Zq26marker', 'ZQ26MARKER@dup.test', '+1 415 555 2626', 'Paris', 'Engineer zq26marker'),
  ('a2600000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-00000000000a', 'Kit Zq26marker', null, null, 'Lisbon', null),
  ('a2600000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-00000000000a', 'Yan Section', null, null, null, null),
  ('b2600000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b', 'Gil Globex', null, null, null, null);
-- Both in the Designer job (Kimberly further along), Kimberly also in Founding engineer.
insert into applications (id, person_id, role_id, stage, next_action) values
  ('a2630000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000002', 'sourced', null),
  ('a2630000-0000-4000-8000-000000000002', 'a2600000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000002', 'interviewing', null),
  ('a2630000-0000-4000-8000-000000000003', 'a2600000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000001', 'screening', 'call zq26marker back');
insert into application_events (application_id, kind, detail) values
  ('a2630000-0000-4000-8000-000000000001', 'note', 'zq26marker said maybe');
-- An interview, feedback and a rating on Kim's Designer application (the one that will lose), and an offer on it.
insert into interviews (id, application_id, starts_at, ends_at, interviewer_actor_ids, location_or_link) values
  ('a2640000-0000-4000-8000-000000000001', 'a2630000-0000-4000-8000-000000000001', now() - interval '1 day', now() - interval '23 hours',
   array['a1000000-0000-4000-8000-000000000002']::uuid[], 'zq26marker home office');
insert into interview_feedback (id, interview_id, interviewer_actor_id, recommendation, notes) values
  ('a2640000-0000-4000-8000-000000000002', 'a2640000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'yes', 'zq26marker was sharp');
insert into scorecard_attributes (id, role_id, name) values
  ('a2650000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000002', 'Section 26 craft');
insert into interview_feedback_ratings (feedback_id, attribute_id, rating, note) values
  ('a2640000-0000-4000-8000-000000000002', 'a2650000-0000-4000-8000-000000000001', 3, 'zq26marker portfolio');
insert into offers (id, application_id, notes) values
  ('a2670000-0000-4000-8000-000000000001', 'a2630000-0000-4000-8000-000000000001', 'zq26marker wants remote');
-- Kimberly's notes, transcript, file, message and tags; both carry the Strong tag.
insert into person_notes (person_id, text) values ('a2600000-0000-4000-8000-000000000002', 'zq26marker knows Rust');
insert into transcript_entries (person_id, source, source_ref, sent_at, from_me, text) values
  ('a2600000-0000-4000-8000-000000000002', 'granola', 'note-zq#t0', now(), false, 'hi, zq26marker here');
insert into person_files (id, person_id, kind, storage_path, filename) values
  ('a2660000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000002', 'resume',
   'a0000000-0000-4000-8000-00000000000a/a2600000-0000-4000-8000-000000000002/a2660000-0000-4000-8000-000000000001', 'zq26marker.pdf');
insert into candidate_messages (person_id, to_email, subject, body) values
  ('a2600000-0000-4000-8000-000000000002', 'zq26marker@dup.test', 'Hello zq26marker', 'Dear zq26marker');
insert into person_tags (person_id, tag_id) values
  ('a2600000-0000-4000-8000-000000000001', 'ac500000-0000-4000-8000-000000000001'),
  ('a2600000-0000-4000-8000-000000000002', 'ac500000-0000-4000-8000-000000000001');
-- The newer tables: a candidate email, a custom field value on each (Kim's
-- will win), both in one pool (Kim's membership will win) and Kimberly alone
-- in another, Kimberly's prospect source, a job-post answer and its rate-limit row.
insert into custom_fields (id, org_id, object, name, field_type) values
  ('a2680000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'candidate', 'Section 26 note', 'short_text');
insert into custom_field_values (field_id, person_id, value) values
  ('a2680000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000001', '"Kim keeps zq26marker"'),
  ('a2680000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000002', '"Kimberly said zq26marker"');
insert into talent_pools (id, org_id, name) values
  ('a2690000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'Section 26 pool'),
  ('a2690000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 'Section 26 other pool');
insert into pool_memberships (pool_id, person_id, stage) values
  ('a2690000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000001', 'new'),
  ('a2690000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000002', 'engaged'),
  ('a2690000-0000-4000-8000-000000000002', 'a2600000-0000-4000-8000-000000000002', 'contacted');
insert into candidate_emails (person_id, to_email, subject, body) values
  ('a2600000-0000-4000-8000-000000000002', 'zq26marker@dup.test', 'About zq26marker', 'Dear zq26marker, thanks');
update people set prospect_source = 'event', prospect_source_detail = 'met zq26marker at a meetup'
  where id = 'a2600000-0000-4000-8000-000000000002';
insert into application_answers (application_id, job_post_id, answers) values
  ('a2630000-0000-4000-8000-000000000003', 'ac600000-0000-4000-8000-000000000001',
   '[{"id": "q_why1", "type": "long_text", "label": "Why us?", "value": "zq26marker loves it"}]');
insert into job_post_attempts (job_post_id, email_digest) values
  ('ac600000-0000-4000-8000-000000000001', md5('zq26marker@dup.test'));

-- The guard: every foreign key to people is one the merge and the erasure
-- handle, and every one they name still exists.
select pg_temp.expect(client_person_fks_unhandled() = '{}'::text[],
  'a foreign key to people that client_merge_person_fks does not name: ' || array_to_string(client_person_fks_unhandled(), ', ')
  || ' (add it to client_merge_person_fks and handle it in client_anonymize_candidate)');
select pg_temp.expect(not exists (
  select 1 from unnest(client_merge_person_fks()) h(fk)
  where not exists (
    select 1 from pg_constraint c
    cross join lateral unnest(c.conkey) as k(attnum)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f' and c.confrelid = 'public.people'::regclass
      and c.conrelid::regclass::text || '.' || a.attname = h.fk)),
  'every foreign key client_merge_person_fks names still exists');
create table public.zz_section26_probe (person_id uuid references public.people (id));
select pg_temp.expect(client_person_fks_unhandled() = array['zz_section26_probe.person_id'], 'the guard sees a new foreign key to people');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select client_merge_candidates('a2600000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000004')$q$, '0A000'),
  'and the merge refuses until it is handled');
select pg_temp.expect(pg_temp.raises($q$select client_anonymize_candidate('a2600000-0000-4000-8000-000000000004', 'ANONYMIZE Yan Section')$q$, '0A000'),
  'as does the erasure');
select pg_temp.as_owner();
drop table public.zz_section26_probe;

-- Refused: anyone but an admin, another org, the same person twice.
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select client_merge_candidates('a2600000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000002')$q$, '42501'),
  'a hiring manager cannot merge candidates');
select pg_temp.expect(pg_temp.raises($q$select client_anonymize_candidate('a2600000-0000-4000-8000-000000000001', 'ANONYMIZE Kim Zq26marker')$q$, '42501'),
  'nor anonymize one');
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select client_merge_candidates('a2600000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000002')$q$, '42501'),
  'nor can an interviewer');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect(pg_temp.raises($q$select client_merge_candidates('a2600000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000002')$q$, 'P0002'),
  'another org''s admin finds no such candidates');
select pg_temp.expect(pg_temp.raises($q$select client_anonymize_candidate('a2600000-0000-4000-8000-000000000001', 'ANONYMIZE Kim Zq26marker')$q$, 'P0002'),
  'and cannot anonymize one');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select client_merge_candidates('a2600000-0000-4000-8000-000000000001', 'b2600000-0000-4000-8000-000000000001')$q$, 'P0002'),
  'an admin cannot merge in another org''s candidate');
select pg_temp.expect(pg_temp.raises($q$select client_merge_candidates('a2600000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000001')$q$, '22023'),
  'nor a candidate with themselves');
select pg_temp.as_owner();
do $$ begin
  perform pg_temp.as_service();
  perform client_merge_candidates('a2600000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000002');
  raise exception 'FAILED: the service role merged as nobody';
exception when insufficient_privilege then null;
end $$;
reset role;
select pg_temp.expect(not exists (select 1 from people where merged_into_id is not null), 'nothing was merged by any refusal');

-- Kit into Kimberly, then Kimberly into Kim.
select pg_temp.as_member('user_acme', 'org_acme');
select client_merge_candidates('a2600000-0000-4000-8000-000000000002', 'a2600000-0000-4000-8000-000000000003');
select set_config('tacit_test.merge',
  client_merge_candidates('a2600000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000002')::text, true);
select pg_temp.expect((current_setting('tacit_test.merge')::jsonb ->> 'applications_merged')::int = 1, 'one job both were in');
select pg_temp.expect(current_setting('tacit_test.merge')::jsonb -> 'left_behind' ? 'person_tags.person_id', 'the tag Kim already had stays behind');
select pg_temp.expect(current_setting('tacit_test.merge')::jsonb -> 'filled' ? 'current_title', 'Kim''s blank title is filled');
select pg_temp.expect(not exists (select 1 from people where id in ('a2600000-0000-4000-8000-000000000002', 'a2600000-0000-4000-8000-000000000003')),
  'a merged candidate is hidden from members');
select pg_temp.expect((select array_agg(id) from applications where person_id = 'a2600000-0000-4000-8000-000000000001' and role_id = 'ac100000-0000-4000-8000-000000000002')
  = array['a2630000-0000-4000-8000-000000000002']::uuid[], 'and so is the application that lost: the Designer job shows the further one');
select pg_temp.expect(pg_temp.raises($q$select client_merge_candidates('a2600000-0000-4000-8000-000000000004', 'a2600000-0000-4000-8000-000000000002')$q$, '55000'),
  'a merged candidate cannot be merged again');
select pg_temp.as_owner();
select pg_temp.expect((select merged_into_id = 'a2600000-0000-4000-8000-000000000001' and merged_by_actor_id = 'a1000000-0000-4000-8000-000000000001'
  from people where id = 'a2600000-0000-4000-8000-000000000002'), 'the duplicate stays, pointing at the record kept, stamped with who merged it');
select pg_temp.expect((select merged_into_id from people where id = 'a2600000-0000-4000-8000-000000000003') = 'a2600000-0000-4000-8000-000000000001',
  'a row merged into the duplicate follows it');
select pg_temp.expect((select current_title = 'Engineer zq26marker' and location = 'Berlin' and display_name = 'Kim Zq26marker'
  from people where id = 'a2600000-0000-4000-8000-000000000001'), 'blank fields are filled and nothing is overwritten');
select pg_temp.expect((select count(*) from applications where person_id = 'a2600000-0000-4000-8000-000000000001') = 3
  and not exists (select 1 from applications where person_id = 'a2600000-0000-4000-8000-000000000002'), 'every application is on the record kept');
select pg_temp.expect((select merged_into_id from applications where id = 'a2630000-0000-4000-8000-000000000001') = 'a2630000-0000-4000-8000-000000000002',
  'the less advanced application is marked merged into the other');
select pg_temp.expect((select application_id from interviews where id = 'a2640000-0000-4000-8000-000000000001') = 'a2630000-0000-4000-8000-000000000002',
  'its interview, and so its feedback, moves to the application kept');
select pg_temp.expect((select application_id from offers where id = 'a2670000-0000-4000-8000-000000000001') = 'a2630000-0000-4000-8000-000000000001',
  'its offer stays with it');
select pg_temp.expect(exists (select 1 from application_events where application_id = 'a2630000-0000-4000-8000-000000000002'
  and kind = 'note' and actor_id = 'a1000000-0000-4000-8000-000000000001'), 'the merge is on the kept application''s history');
select pg_temp.expect((select person_id = 'a2600000-0000-4000-8000-000000000001' and storage_path like '%/a2600000-0000-4000-8000-000000000002/%'
  from person_files where id = 'a2660000-0000-4000-8000-000000000001'), 'the file moves and keeps its stored path');
select pg_temp.expect(not exists (select 1 from person_notes where person_id = 'a2600000-0000-4000-8000-000000000002')
  and not exists (select 1 from transcript_entries where person_id = 'a2600000-0000-4000-8000-000000000002')
  and not exists (select 1 from candidate_messages where person_id = 'a2600000-0000-4000-8000-000000000002')
  and exists (select 1 from person_identifiers where person_id = 'a2600000-0000-4000-8000-000000000001' and kind = 'phone'),
  'notes, transcripts, messages and identifiers move');
select pg_temp.expect((select count(*) from person_tags where person_id = 'a2600000-0000-4000-8000-000000000001') = 1
  and exists (select 1 from person_tags where person_id = 'a2600000-0000-4000-8000-000000000002'), 'a tag both had is not doubled');
select pg_temp.expect(pg_temp.raises($q$insert into applications (person_id, role_id, org_id)
  values ('a2600000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a')$q$, '23505'),
  'one live application per person per job still holds');
select pg_temp.expect((select person_id from candidate_emails where subject = 'About zq26marker') = 'a2600000-0000-4000-8000-000000000001',
  'a sent or drafted email moves, unchanged otherwise');
select pg_temp.expect((select value from custom_field_values where person_id = 'a2600000-0000-4000-8000-000000000001') = '"Kim keeps zq26marker"'::jsonb
  and exists (select 1 from custom_field_values where person_id = 'a2600000-0000-4000-8000-000000000002')
  and current_setting('tacit_test.merge')::jsonb -> 'left_behind' ? 'custom_field_values.person_id',
  'a custom field both had keeps the kept record''s value');
select pg_temp.expect((select stage from pool_memberships where pool_id = 'a2690000-0000-4000-8000-000000000001'
  and person_id = 'a2600000-0000-4000-8000-000000000001') = 'new'
  and (select person_id from pool_memberships where pool_id = 'a2690000-0000-4000-8000-000000000002') = 'a2600000-0000-4000-8000-000000000001',
  'a pool both were in keeps the kept record''s membership; the other pool moves');
select pg_temp.expect((select prospect_source = 'event' and prospect_source_detail = 'met zq26marker at a meetup'
  from people where id = 'a2600000-0000-4000-8000-000000000001'), 'the prospect source fills in too');
select pg_temp.expect(current_setting('tacit.merging', true) is distinct from 'on', 'the merge leaves no bypass switched on');
select pg_temp.expect(pg_temp.raises($q$update candidate_emails set person_id = 'a2600000-0000-4000-8000-000000000004' where subject = 'About zq26marker'$q$, '22023'),
  'an email still stays on its candidate outside a merge');

-- Erasure.
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select client_anonymize_candidate('a2600000-0000-4000-8000-000000000001', 'ANONYMIZE Kim')$q$, '22023'),
  'a confirmation that does not name the candidate is refused');
select pg_temp.expect(pg_temp.raises($q$select client_anonymize_candidate('a2600000-0000-4000-8000-000000000002', 'ANONYMIZE Kimberly Zq26marker')$q$, '55000'),
  'a merged-away row is erased through the record kept, not on its own');
select set_config('tacit_test.erased',
  client_anonymize_candidate('a2600000-0000-4000-8000-000000000001', '  ANONYMIZE  Kim   Zq26marker ')::text, true);
select pg_temp.expect((current_setting('tacit_test.erased')::jsonb ->> 'anonymized')::int = 3, 'the person and both rows merged into them');
select pg_temp.expect(current_setting('tacit_test.erased')::jsonb -> 'storage_paths'
  = '["a0000000-0000-4000-8000-00000000000a/a2600000-0000-4000-8000-000000000002/a2660000-0000-4000-8000-000000000001"]'::jsonb,
  'the deleted file''s stored path comes back for Storage');
select pg_temp.expect((select display_name from people where id = 'a2600000-0000-4000-8000-000000000001') = 'Anonymized candidate',
  'the admin still sees the record, anonymized');
select pg_temp.expect(pg_temp.raises($q$select client_anonymize_candidate('a2600000-0000-4000-8000-000000000001', 'ANONYMIZE Anonymized candidate')$q$, '55000'),
  'and cannot anonymize it twice');
select pg_temp.expect(pg_temp.raises($q$select client_merge_candidates('a2600000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000004')$q$, '55000'),
  'nor merge anyone into it');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) from people where id in ('a2600000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000002',
  'a2600000-0000-4000-8000-000000000003') and anonymized_at is not null and anonymized_by_actor_id = 'a1000000-0000-4000-8000-000000000001'
  and email is null and phone is null and linkedin_url is null and current_title is null and location is null) = 3,
  'every row is stamped and blank');
select pg_temp.expect((select array_agg(stage order by stage) from applications where person_id = 'a2600000-0000-4000-8000-000000000001')
  = array['interviewing', 'screening', 'sourced'], 'the applications and their stages stay for reporting');
select pg_temp.expect((select notes = '' from interview_feedback where id = 'a2640000-0000-4000-8000-000000000002')
  and exists (select 1 from interview_feedback_ratings where feedback_id = 'a2640000-0000-4000-8000-000000000002' and rating = 3 and note is null),
  'feedback keeps its recommendation and ratings, not its words');
select pg_temp.expect(not exists (select 1 from person_identifiers where person_id in ('a2600000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000002'))
  and not exists (select 1 from person_files where id = 'a2660000-0000-4000-8000-000000000001')
  and not exists (select 1 from offers where id = 'a2670000-0000-4000-8000-000000000001'),
  'identifiers, files and offers are gone');
select pg_temp.expect(not exists (select 1 from candidate_emails where person_id = 'a2600000-0000-4000-8000-000000000001')
  and not exists (select 1 from custom_field_values where person_id in ('a2600000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000002'))
  and not exists (select 1 from pool_memberships where person_id in ('a2600000-0000-4000-8000-000000000001', 'a2600000-0000-4000-8000-000000000002'))
  and not exists (select 1 from application_answers where application_id = 'a2630000-0000-4000-8000-000000000003')
  and not exists (select 1 from job_post_attempts where email_digest = md5('zq26marker@dup.test')),
  'emails, custom field values, pool memberships, job-post answers and the rate-limit row keyed by their address are gone');
select pg_temp.expect((select prospect_source = 'event' and prospect_source_detail is null
  from people where id = 'a2600000-0000-4000-8000-000000000001'), 'how they came in stays, what was said about it does not');
do $$
declare
  t text;
  n bigint;
begin
  for t in
    select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind in ('r', 'p') order by 1
  loop
    execute format('select count(*) from public.%I x where lower(to_jsonb(x)::text) like ''%%zq26marker%%''', t) into n;
    if n > 0 then
      raise exception 'FAILED: % row(s) of % still carry the anonymized candidate''s data', n, t;
    end if;
  end loop;
end $$;

-- 27. EEOC self-identification (20261016170000_client_reports_eeoc). Only an
--     org admin reads a row; managers on the job record paper forms through
--     record_eeoc and read nothing back; nobody writes the table directly.
--     Apps here: Ada (001) and Cy (00c, added by the external recruiter) on
--     the Founding engineer job the hiring manager manages, Bob (00b) on the
--     Designer job, Eve (00e) on the confidential Chief of staff job.
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect(record_eeoc('ac300000-0000-4000-8000-000000000001', 'female', 'asian', 'not_a_protected_veteran', 'decline_to_self_identify') = 'recorded',
  'a hiring manager records a paper EEO form on their job');
select pg_temp.expect((select count(*) from eeoc_responses) = 0, 'and cannot read back what they recorded');
select pg_temp.expect(record_eeoc('ac300000-0000-4000-8000-000000000001', 'female') = 'replaced',
  'recording again replaces the paper form');
select pg_temp.expect(pg_temp.raises(
  $q$select record_eeoc('ac300000-0000-4000-8000-00000000000b', 'male')$q$, '42501'),
  'a hiring manager records nothing on another job');
select pg_temp.expect(pg_temp.raises(
  $q$select record_eeoc('ac300000-0000-4000-8000-000000000001', 'robot')$q$, '22023'),
  'a value outside the EEO-1 categories is refused');
select pg_temp.expect(pg_temp.raises(
  $q$select record_eeoc('ac300000-0000-4000-8000-000000000001')$q$, '22023'),
  'an empty form is refused');
select pg_temp.expect(pg_temp.raises(
  $q$insert into eeoc_responses (application_id, gender) values ('ac300000-0000-4000-8000-00000000000c', 'male')$q$, '42501'),
  'nobody inserts into the table directly');
select pg_temp.expect(pg_temp.raises($q$update eeoc_responses set gender = 'male'$q$, '42501'), 'or updates it');
select pg_temp.expect(pg_temp.raises($q$delete from eeoc_responses$q$, '42501'), 'or deletes from it');
select pg_temp.as_owner();
select pg_temp.expect((select org_id = 'a0000000-0000-4000-8000-00000000000a' and source = 'paper' and gender = 'female' and race_ethnicity is null
  and recorded_by_actor_id = 'a1000000-0000-4000-8000-000000000003'
  from eeoc_responses where application_id = 'ac300000-0000-4000-8000-000000000001'),
  'the paper form lands in the application''s org, replaced whole, stamped with who typed it in');
select pg_temp.expect(pg_temp.raises(
  $q$insert into eeoc_responses (application_id) values ('ac300000-0000-4000-8000-00000000000b')$q$, '23514'),
  'a response answers at least one question');
-- The candidate's own answers, as the apply path writes them, and one on the
-- confidential job.
insert into eeoc_responses (application_id, gender, race_ethnicity) values
  ('ac300000-0000-4000-8000-00000000000c', 'male', 'two_or_more_races'),
  ('ac300000-0000-4000-8000-00000000000e', 'decline_to_self_identify', null);
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect(pg_temp.raises(
  $q$select record_eeoc('ac300000-0000-4000-8000-00000000000c', 'female')$q$, '23505'),
  'a paper form never overwrites the candidate''s own answers');
select pg_temp.expect((select count(*) from eeoc_responses) = 0, 'a hiring manager reads no EEO answers, their job''s included');
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from eeoc_responses) = 0, 'an interviewer reads none');
select pg_temp.expect(pg_temp.raises(
  $q$select record_eeoc('ac300000-0000-4000-8000-000000000001', 'male')$q$, '42501'),
  'and records none, even for someone they interview');
select pg_temp.as_member('user_acme_ext', 'org_acme');
select pg_temp.expect((select count(*) from eeoc_responses) = 0, 'an external recruiter reads none, their own candidate''s included');
select pg_temp.expect(pg_temp.raises(
  $q$select record_eeoc('ac300000-0000-4000-8000-00000000000c', 'male')$q$, '42501'),
  'and records none');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select count(*) from eeoc_responses) = 3, 'an admin with confidential access reads every response in the org');
select pg_temp.expect(record_eeoc('ac300000-0000-4000-8000-00000000000b', 'male', 'white') = 'recorded', 'and records a form on any job');
select pg_temp.as_member('user_both', 'org_acme');
select pg_temp.expect((select count(*) from eeoc_responses) = 3, 'an admin without it reads none on the confidential job');
select pg_temp.expect(pg_temp.raises(
  $q$select record_eeoc('ac300000-0000-4000-8000-00000000000e', 'male')$q$, '42501'),
  'and records none there');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from eeoc_responses) = 0, 'another org reads none of Acme''s');
select pg_temp.expect(pg_temp.raises(
  $q$select record_eeoc('ac300000-0000-4000-8000-000000000001', 'male')$q$, 'P0002'),
  'and an Acme application is not one of theirs to record on');
select pg_temp.as_member('user_both', 'org_globex');
select pg_temp.expect((select count(*) from eeoc_responses) = 0, 'the same human on their other org''s token reads none of Acme''s');
select pg_temp.as_owner();
select pg_temp.as_tacit_internal();
select pg_temp.expect((select count(*) from eeoc_responses) = 0, 'tacit_internal reads no client EEO answers');
select pg_temp.as_owner();

-- The public form (section 25's post, live on an open job): the candidate's
-- own answers ride submit_job_application's p_eeoc, onto the new application only.
select pg_temp.as_anon();
select pg_temp.expect(submit_job_application(current_setting('tacit_test.slug'),
  '{"name": "Eda Eeoc", "email": "eda@eeoc.test", "q_why1": "x", "q_auth": "yes"}', null,
  '{"gender": "female", "race_ethnicity": "decline_to_self_identify", "veteran_status": ""}'),
  'an applicant answers the voluntary questions with the form');
select pg_temp.expect(pg_temp.raises(format($q$select submit_job_application(%L,
  '{"name": "Bad", "email": "bad@eeoc.test", "q_why1": "x", "q_auth": "yes"}', null, '{"gender": "robot"}')$q$,
  current_setting('tacit_test.slug')), '22023'), 'an answer outside the categories is refused');
select pg_temp.expect(pg_temp.raises(format($q$select submit_job_application(%L,
  '{"name": "Bad", "email": "bad@eeoc.test", "q_why1": "x", "q_auth": "yes"}', null, '{"shoe_size": "9"}')$q$,
  current_setting('tacit_test.slug')), '22023'), 'and so is a question that is not one of the four');
select pg_temp.expect(pg_temp.raises(
  $q$select submit_job_application('0123456789abcdef0123456789abcdef', '{}', null, '{"gender": "female"}')$q$, 'P0002'),
  'a wrong slug is still the one not-found, answers or not');
select pg_temp.expect(submit_job_application(current_setting('tacit_test.slug'),
  '{"name": "Eda Eeoc", "email": "eda@eeoc.test", "q_why1": "again", "q_auth": "yes"}', null, '{"gender": "male"}'),
  'applying again is answered the same');
select pg_temp.expect(submit_job_application(current_setting('tacit_test.slug'),
  '{"name": "Noe Answer", "email": "noe@eeoc.test", "q_why1": "x", "q_auth": "yes"}', null, '{}'),
  'answering none of them is fine');
select pg_temp.as_owner();
select set_config('tacit_test.eda', (select id::text from people where email = 'eda@eeoc.test'), true);
select pg_temp.expect((select count(*) = 1 and bool_and(r.gender = 'female' and r.race_ethnicity = 'decline_to_self_identify'
  and r.veteran_status is null and r.disability_status is null and r.source = 'candidate' and r.recorded_by_actor_id is null
  and r.org_id = 'a0000000-0000-4000-8000-00000000000a')
  from eeoc_responses r join applications a on a.id = r.application_id where a.person_id = current_setting('tacit_test.eda')::uuid),
  'stored once, as the candidate''s own, in the post''s org; applying again changed nothing');
select pg_temp.expect(exists (select 1 from applications a join people p on p.id = a.person_id where p.email = 'noe@eeoc.test')
  and not exists (select 1 from eeoc_responses r join applications a on a.id = r.application_id join people p on p.id = a.person_id
                  where p.email = 'noe@eeoc.test'),
  'nothing answered writes no row');
select pg_temp.expect(not exists (select 1 from people where email = 'bad@eeoc.test'), 'a refused answer wrote no application either');
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from eeoc_responses) = 0, 'the hiring manager on the job still reads none');

-- Erasure deletes the answers; the application stays for reporting.
select pg_temp.as_member('user_acme', 'org_acme');
select client_anonymize_candidate(current_setting('tacit_test.eda')::uuid, 'ANONYMIZE Eda Eeoc');
select pg_temp.as_owner();
select pg_temp.expect(exists (select 1 from applications where person_id = current_setting('tacit_test.eda')::uuid)
  and not exists (select 1 from eeoc_responses r join applications a on a.id = r.application_id
                  where a.person_id = current_setting('tacit_test.eda')::uuid),
  'erasing a candidate deletes their EEO answers and keeps the application');

-- 28. The client connector's read-only switch (20261017110000_client_connector_access).
-- Globex's admin, whose claims are not at the hourly limit; user_both is limited at Globex.
select pg_temp.as_member('user_both', 'org_globex');
select pg_temp.expect(pg_temp.raises($q$select set_connector_access('read_only')$q$, '42501'), 'only an admin sets the connector''s access');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select connector_access from orgs) = 'read_write', 'the connector is read-write by default, and a member reads it');
select pg_temp.expect(pg_temp.raises($q$select set_connector_access('read_some')$q$, '22023'), 'one of the two values');
select pg_temp.expect(set_connector_access('read_only') = 'read_write', 'an admin makes it read-only and gets the previous value');
select pg_temp.expect((select connector_access = 'read_only' and connector_access_set_by_actor_id = 'b1000000-0000-4000-8000-000000000001'
  and connector_access_set_at is not null from orgs), 'with who set it and when');
select pg_temp.expect(pg_temp.raises($q$select client_claim_write('claude', 'note.add', 'person')$q$, '42501'),
  'a read-only org''s connector cannot claim a write');
select pg_temp.expect(client_claim_write('claude', 'org.connector_access', 'org') is not null,
  'except the admin''s own claim to switch it back');
select set_config('tacit_test.web_claim', client_claim_write('dashboard', 'interview.update', 'interview')::text, true);
select pg_temp.expect(current_setting('tacit_test.web_claim') <> '', 'a read-only org''s web app still claims writes (20261030120000)');
select pg_temp.as_owner();
select pg_temp.expect((select source = 'dashboard' from audit_log where id = current_setting('tacit_test.web_claim')::uuid),
  'and the audit row says it came from the web app');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.as_member('user_both', 'org_globex');
select pg_temp.expect(pg_temp.raises($q$select client_claim_write('claude', 'org.connector_access', 'org')$q$, '42501'),
  'a non-admin cannot use that way in');
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect(client_claim_write('claude', 'note.add', 'person') is not null, 'another org''s connector is unaffected');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect(set_connector_access('read_write') = 'read_only', 'the admin switches it back');
select pg_temp.expect(client_claim_write('claude', 'note.add', 'person') is not null, 'and writes are claimed again');
select pg_temp.as_owner();

-- 29. Calendar connections (20261017120000_client_calendar_connections).
select pg_temp.as_member('user_acme_hm', 'org_acme');
select client_connect_calendar('google', ' HM@Acme.test ', 'rt-hm', 'calendar.events');
select pg_temp.as_member('user_acme', 'org_acme');
select client_connect_calendar('google', 'admin@acme.test', 'rt-admin', 'calendar.events');
select pg_temp.expect((select count(*) from calendar_connections) = 1
  and (select actor_id from calendar_connections) = 'a1000000-0000-4000-8000-000000000001',
  'a member reads only their own calendar connection, an admin included');
do $$ begin
  perform refresh_token from calendar_connections;
  raise exception 'FAILED: a member read a calendar refresh token';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into calendar_connections (actor_id, org_id, account_email, refresh_token)
  values ('a1000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-00000000000a', 'x@acme.test', 'forged');
  raise exception 'FAILED: a member wrote a calendar connection directly';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform client_connect_calendar('microsoft', 'admin@acme.test', 'rt', '');
  raise exception 'FAILED: a provider other than google was connected';
exception when sqlstate '22023' then null;
end $$;
select client_connect_calendar('google', 'admin@acme.test', 'rt-admin-2', 'calendar.events');
select pg_temp.as_owner();
select pg_temp.expect((select refresh_token from calendar_connections where actor_id = 'a1000000-0000-4000-8000-000000000001') = 'rt-admin-2'
  and (select account_email from calendar_connections where actor_id = 'a1000000-0000-4000-8000-000000000003') = 'hm@acme.test'
  and (select count(*) from calendar_connections) = 2,
  'connecting again replaces your own grant; each member''s row is their own, lower-cased');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from calendar_connections) = 0, 'another company reads no connection');
select pg_temp.as_anon();
do $$ begin
  perform client_connect_calendar('google', 'a@b.test', 'rt', '');
  raise exception 'FAILED: anon connected a calendar';
exception when insufficient_privilege then null;
end $$;

-- An interview names its booker's own calendar or one of its interviewers'
-- (20261025120000_client_calendar_interviewer_holds), and on an
-- interviewer's only the event Tacit made for it.
select pg_temp.as_member('user_acme', 'org_acme');
do $$ begin
  update interviews set calendar_actor_id = 'a1000000-0000-4000-8000-000000000004' where id = 'ac400000-0000-4000-8000-000000000001';
  raise exception 'FAILED: a member put an interview on the calendar of a colleague not interviewing';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update interviews set calendar_actor_id = 'a1000000-0000-4000-8000-000000000003', google_event_id = 'their-standup'
    where id = 'ac400000-0000-4000-8000-000000000001';
  raise exception 'FAILED: a member pointed an interview at another event on an interviewer''s calendar';
exception when insufficient_privilege then null;
end $$;
update interviews set calendar_actor_id = 'a1000000-0000-4000-8000-000000000003', google_event_id = 'ac400000000040008000000000000001'
  where id = 'ac400000-0000-4000-8000-000000000001';
select pg_temp.expect((select calendar_actor_id from interviews where id = 'ac400000-0000-4000-8000-000000000001') = 'a1000000-0000-4000-8000-000000000003',
  'a member books on an interviewer''s calendar, under the interview''s own event id');
update interviews set calendar_actor_id = 'a1000000-0000-4000-8000-000000000001', google_event_id = 'evt1'
  where id = 'ac400000-0000-4000-8000-000000000001';
select pg_temp.expect((select google_event_id from interviews where id = 'ac400000-0000-4000-8000-000000000001') = 'evt1',
  'a member books on their own calendar');
do $$ begin
  update interviews set calendar_actor_id = 'a1000000-0000-4000-8000-000000000003' where id = 'ac400000-0000-4000-8000-000000000001';
  raise exception 'FAILED: a member carried their own event id onto an interviewer''s calendar';
exception when insufficient_privilege then null;
end $$;
select pg_temp.as_member('user_both', 'org_acme');
do $$ begin
  update interviews set google_event_id = 'someone-elses' where id = 'ac400000-0000-4000-8000-000000000001';
  raise exception 'FAILED: a member pointed another''s booking at a different event';
exception when insufficient_privilege then null;
end $$;
update interviews set location_or_link = 'Room 2' where id = 'ac400000-0000-4000-8000-000000000001';
select pg_temp.expect((select location_or_link from interviews where id = 'ac400000-0000-4000-8000-000000000001') = 'Room 2'
  and (select calendar_actor_id from interviews where id = 'ac400000-0000-4000-8000-000000000001') = 'a1000000-0000-4000-8000-000000000001',
  'another scheduler still changes the interview, leaving its calendar alone');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(client_disconnect_calendar(), 'disconnecting removes your connection');
select pg_temp.expect(not client_disconnect_calendar(), 'and the second time there is nothing to remove');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) from calendar_connections) = 1, 'the other member''s connection stays');

-- 30. Tacit's submissions into a client's jobs (tacit_submit_to_client and
-- tacit_submit_application) stay on tacit; on this project the bridge's
-- bridge_submit_candidate does the client half (bridge.test.sql).

-- 30. A company's own bot, and its notifications (20261028120000_notify_per_company).
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select client_set_agent_destination('https://bot.acme.test/hook')$q$, '42501'),
  'only an admin sets the company''s bot');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select client_set_agent_destination('http://bot.acme.test/hook')$q$, '22023'), 'the bot''s address is https');
select pg_temp.expect(pg_temp.raises($q$select client_set_agent_destination('https://user@bot.acme.test/hook')$q$, '22023'), 'with no credentials in it');
select set_config('tacit_test.bot_secret', client_set_agent_destination(' https://bot.acme.test/hook '), false);
select pg_temp.expect(current_setting('tacit_test.bot_secret') ~ '^tbs_[0-9a-f]{64}$', 'an admin sets it and sees its secret, once');
select pg_temp.expect((select url = 'https://bot.acme.test/hook' and enabled and verified_at is null from agent_destinations),
  'and reads its address back');
do $$ begin
  perform secret from agent_destinations;
  raise exception 'FAILED: a member read a bot secret';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into agent_destinations (org_id, url, secret)
  values ('a0000000-0000-4000-8000-00000000000a', 'https://evil.test/', 'tbs_' || repeat('0', 64));
  raise exception 'FAILED: a member wrote a bot directly';
exception when insufficient_privilege then null;
end $$;
select pg_temp.expect(client_rotate_agent_secret() <> current_setting('tacit_test.bot_secret'), 'a rotation is a new secret');
select pg_temp.expect(client_enable_agent_destination(false), 'an admin turns it off');
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from agent_destinations) = 0, 'a member who is not an admin does not see it');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from agent_destinations) = 0, 'another company does not see it');
select pg_temp.expect(not client_remove_agent_destination(), 'and removes nothing of it');
select pg_temp.as_owner();
insert into notify_events (org_id, type, source, dedupe_key, occurred_at)
values ('a0000000-0000-4000-8000-00000000000a', 'interview.reminder_t5m', 'interviews', 'test:acme-reminder', now());
select pg_temp.as_tacit_internal();
select pg_temp.expect((select count(*) from agent_destinations) = 0, 'tacit_internal sees no client''s bot');
select pg_temp.expect(not exists (select 1 from notify_events where dedupe_key = 'test:acme-reminder'),
  'nor a client''s notification events');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) from audit_log where action like 'agent_destination.%'
  and org_id = 'a0000000-0000-4000-8000-00000000000a') = 3, 'set, rotate and turn off are each audited under the company');
select pg_temp.expect((select secret from agent_destinations) <> current_setting('tacit_test.bot_secret'), 'the old secret is gone');
-- The bot's own key (20261029120000_agent_destination_own_key): stored, never returned.
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select client_set_agent_destination('https://bot.acme.test/hook', 'short')$q$, '22023'),
  'a key of under 16 characters is refused');
select pg_temp.expect(pg_temp.raises($q$select client_set_agent_destination('https://bot.acme.test/hook', 'has a space in it, sixteen+')$q$, '22023'),
  'and one with whitespace');
select pg_temp.expect(client_set_agent_destination('https://grok.acme.test/routine', '  xai-routine-key-0123456789  ') is null,
  'a bot''s own key is not handed back');
select pg_temp.expect(client_rotate_agent_secret('xai-routine-key-abcdefghij') is null, 'nor is a new one');
select pg_temp.expect(client_rotate_agent_secret() ~ '^tbs_[0-9a-f]{64}$', 'with none given, Tacit makes one and shows it once');
select pg_temp.expect(client_rotate_agent_secret('xai-routine-key-abcdefghij') is null, 'and the bot''s own one again');
select pg_temp.as_owner();
select pg_temp.expect((select secret = 'xai-routine-key-abcdefghij' and url = 'https://grok.acme.test/routine' and verified_at is null
  from agent_destinations where org_id = 'a0000000-0000-4000-8000-00000000000a'), 'stored as given, trimmed, unverified');
select pg_temp.expect(exists (select 1 from audit_log where action = 'agent_destination.set'
  and org_id = 'a0000000-0000-4000-8000-00000000000a' and after ->> 'key' = 'provided')
  and not exists (select 1 from audit_log where after::text like '%xai-routine-key%'), 'the audit says a key was provided, never the key');

-- 33. Inbox dismissals (20261030140000_inbox_dismissals). A member's own, one
-- instance of an issue at a time, ids and timestamps only. The keys are made
-- up: nothing here points at a row, on purpose.
select pg_temp.as_member('user_acme', 'org_acme');
insert into inbox_dismissals (issue_key, reason, issue_at)
values ('app-ac300000-0000-4000-8000-0000000000d1', 'overdue', '2026-10-20T00:00:00Z');
select pg_temp.expect((select org_id = 'a0000000-0000-4000-8000-00000000000a'
    and actor_id = 'a1000000-0000-4000-8000-000000000001' and how = 'dismissed' and dismissed_at = now()
  from inbox_dismissals), 'a dismissal is stamped with the member, their org and now, none of them named');
-- Dismissing twice, two tabs or a double click, is one row.
insert into inbox_dismissals (issue_key, reason, issue_at)
values ('app-ac300000-0000-4000-8000-0000000000d1', 'overdue', '2026-10-20T00:00:00Z')
on conflict (actor_id, issue_key, reason, issue_at) do nothing;
select pg_temp.expect((select count(*) from inbox_dismissals) = 1, 'dismissing the same issue again changes nothing');
select pg_temp.expect(pg_temp.raises($q$insert into inbox_dismissals (issue_key, reason, issue_at)
  values ('app-ac300000-0000-4000-8000-0000000000d1', 'overdue', '2026-10-20T00:00:00Z')$q$, '23505'),
  'and without the conflict clause it is refused, not doubled');
-- A new issue of the same kind on the same application is a new instance: the
-- old row does not match it, so it stays in the queue until dismissed itself.
select pg_temp.expect(not exists (select 1 from inbox_dismissals
    where issue_key = 'app-ac300000-0000-4000-8000-0000000000d1' and reason = 'overdue' and issue_at = '2026-10-25T00:00:00Z'),
  'a later overdue on the same application is not covered by the first dismissal');
select pg_temp.expect(not exists (select 1 from inbox_dismissals
    where issue_key = 'app-ac300000-0000-4000-8000-0000000000d1' and reason = 'overdue' and issue_at = '2026-10-01T00:00:00Z'),
  'nor is one dated before it, a next action set late with a past due date');
select pg_temp.expect(not exists (select 1 from inbox_dismissals
    where issue_key = 'app-ac300000-0000-4000-8000-0000000000d1' and reason = 'quiet' and issue_at = '2026-10-20T00:00:00Z'),
  'nor is a different reason on the same application');
insert into inbox_dismissals (issue_key, reason, issue_at, how) values
  ('app-ac300000-0000-4000-8000-0000000000d1', 'overdue', '2026-10-25T00:00:00Z', 'resolved'),
  ('app-ac300000-0000-4000-8000-0000000000d1', 'quiet', '2026-10-20T00:00:00Z', 'dismissed');
select pg_temp.expect((select count(*) from inbox_dismissals) = 3, 'each instance has its own row, for the Done tab');
-- Only ids and a one-word reason fit, so wording cannot end up here.
select pg_temp.expect(pg_temp.raises($q$insert into inbox_dismissals (issue_key, reason, issue_at)
  values ('Decide on Ada Lovelace', 'decide', now())$q$, '23514'), 'a key is a prefix and a uuid, not text');
select pg_temp.expect(pg_temp.raises($q$insert into inbox_dismissals (issue_key, reason, issue_at)
  values ('draft-ac300000-0000-4000-8000-0000000000d1 Your offer', 'draft', now())$q$, '23514'), 'not even after a valid key');
select pg_temp.expect(pg_temp.raises($q$insert into inbox_dismissals (issue_key, reason, issue_at)
  values ('app-ac300000-0000-4000-8000-0000000000d2', 'Not a fit, weak system design', now())$q$, '23514'), 'a reason is one word');
select pg_temp.expect(pg_temp.raises($q$insert into inbox_dismissals (issue_key, reason, issue_at, how)
  values ('app-ac300000-0000-4000-8000-0000000000d2', 'decide', now(), 'snoozed')$q$, '23514'), 'and how it left is one of the two');
-- A prefix and a reason are short labels: wording runs out of room, and a huge
-- value is refused as a bad row, not a 500 from the index.
select pg_temp.expect(pg_temp.raises($q$insert into inbox_dismissals (issue_key, reason, issue_at)
  values ('weaksystemdesignnotafitatall-ac300000-0000-4000-8000-0000000000d2', 'decide', now())$q$, '23514'), 'a key''s prefix is not a place for words');
select pg_temp.expect(pg_temp.raises(format($q$insert into inbox_dismissals (issue_key, reason, issue_at)
  values ('%s-ac300000-0000-4000-8000-0000000000d2', 'decide', now())$q$, repeat('a', 30000)), '23514'), 'nor for 30 KB');
select pg_temp.expect(pg_temp.raises(format($q$insert into inbox_dismissals (issue_key, reason, issue_at)
  values ('%s-ac300000-0000-4000-8000-0000000000d2', 'decide', now())$q$, repeat('a', 1000000)), '23514'), 'and a megabyte is a bad row, not an index error');
select pg_temp.expect(pg_temp.raises($q$insert into inbox_dismissals (issue_key, reason, issue_at)
  values ('app-ac300000-0000-4000-8000-0000000000d2', 'weak_system_design_not_a_fit', now())$q$, '23514'), 'a reason cannot string words together');
-- Tacit-ats reads issue_at back with Date.parse, which gives NaN for these,
-- and one such row would throw on a member's Done tab until it was deleted.
select pg_temp.expect(pg_temp.raises(format($q$insert into inbox_dismissals (issue_key, reason, issue_at)
  values ('app-ac300000-0000-4000-8000-0000000000d2', 'decide', %L)$q$, at_value), '23514'),
  format('an issue_at of %s is refused, JavaScript cannot read it', at_value))
from unnest(array['infinity', '-infinity', '0044-03-15 BC', '294276-12-31T00:00:00Z']) as at_value;
-- Not theirs to name: the actor, the org, the time.
select pg_temp.expect(pg_temp.raises($q$insert into inbox_dismissals (actor_id, issue_key, reason, issue_at)
  values ('a1000000-0000-4000-8000-000000000003', 'app-ac300000-0000-4000-8000-0000000000d2', 'decide', now())$q$, '42501'),
  'a member cannot dismiss for a teammate');
select pg_temp.expect(pg_temp.raises($q$insert into inbox_dismissals (org_id, issue_key, reason, issue_at)
  values ('b0000000-0000-4000-8000-00000000000b', 'app-ac300000-0000-4000-8000-0000000000d2', 'decide', now())$q$, '42501'),
  'nor into another org');
select pg_temp.expect(pg_temp.raises($q$insert into inbox_dismissals (dismissed_at, issue_key, reason, issue_at)
  values ('2020-01-01', 'app-ac300000-0000-4000-8000-0000000000d2', 'decide', now())$q$, '42501'),
  'nor backdate one');
select pg_temp.expect(pg_temp.raises($q$update inbox_dismissals set issue_at = now()$q$, '42501'),
  'a dismissal is never edited: delete it and dismiss again');
-- Someone else's queue, in the same org and out of it.
select pg_temp.as_owner();
insert into inbox_dismissals (org_id, actor_id, issue_key, reason, issue_at) values
  ('a0000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000003', 'appr-ac300000-0000-4000-8000-0000000000d3', 'approval', '2026-10-21T00:00:00Z');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select count(*) from inbox_dismissals) = 3
  and not exists (select 1 from inbox_dismissals where actor_id <> 'a1000000-0000-4000-8000-000000000001'),
  'an admin reads their own dismissals, not a teammate''s');
delete from inbox_dismissals where actor_id = 'a1000000-0000-4000-8000-000000000003';
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from inbox_dismissals) = 0, 'Globex reads none of Acme''s');
delete from inbox_dismissals;
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from inbox_dismissals) = 1, 'a member reads their own, a teammate''s delete did not reach it');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) from inbox_dismissals) = 4, 'nobody deleted anyone else''s');
-- An interviewer has no Inbox, so nothing to dismiss.
update actors set access_level = 'limited' where id = 'a1000000-0000-4000-8000-000000000002';
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$insert into inbox_dismissals (issue_key, reason, issue_at)
  values ('app-ac300000-0000-4000-8000-0000000000d2', 'decide', now())$q$, '42501'), 'a limited member cannot dismiss');
select pg_temp.as_anon();
select pg_temp.expect(pg_temp.raises($q$select * from inbox_dismissals$q$, '42501'), 'anon reads nothing');
select pg_temp.expect(pg_temp.raises($q$insert into inbox_dismissals (issue_key, reason, issue_at)
  values ('app-ac300000-0000-4000-8000-0000000000d2', 'decide', now())$q$, '42501'), 'and writes nothing');
-- Tacit's own apps see Tacit's rows only, and name the actor themselves.
select pg_temp.as_tacit_internal();
select pg_temp.expect((select count(*) from inbox_dismissals) = 0, 'tacit_internal reads no client''s dismissals');
insert into inbox_dismissals (actor_id, issue_key, reason, issue_at)
values ('71000000-0000-4000-8000-000000000001', 'app-ac300000-0000-4000-8000-0000000000d4', 'decide', now());
select pg_temp.expect((select org_id from inbox_dismissals) = tacit_org_id(), 'a Tacit actor''s dismissal lands in Tacit');
select pg_temp.as_owner();
-- A member's own undo, and the row going with its member.
select pg_temp.as_member('user_acme', 'org_acme');
delete from inbox_dismissals where reason = 'quiet';
select pg_temp.expect((select count(*) from inbox_dismissals) = 2, 'moving one back to the Inbox removes that instance alone');
select pg_temp.as_owner();
select pg_temp.expect(not exists (select 1 from information_schema.columns where table_name = 'inbox_dismissals' and column_name in ('what', 'why', 'subject', 'person_id')),
  'no wording and no person FK: erasure and merge have nothing to do here');
insert into actors (id, slug, display_name, org_id, access_level) values
  ('a1000000-0000-4000-8000-0000000000d5', 'acme-gone', 'Acme Gone', 'a0000000-0000-4000-8000-00000000000a', 'elevated');
insert into inbox_dismissals (actor_id, issue_key, reason, issue_at)
values ('a1000000-0000-4000-8000-0000000000d5', 'app-ac300000-0000-4000-8000-0000000000d5', 'decide', now());
delete from actors where id = 'a1000000-0000-4000-8000-0000000000d5';
select pg_temp.expect(not exists (select 1 from inbox_dismissals where actor_id = 'a1000000-0000-4000-8000-0000000000d5'), 'a dismissal goes with its member');
-- Tightening the checks must not refuse what the Inbox actually writes: every
-- prefix and reason in tacit-ats's inbox-issues.ts, on the oldest and newest
-- dates JavaScript can read back.
select pg_temp.as_member('user_acme', 'org_acme');
insert into inbox_dismissals (issue_key, reason, issue_at)
select prefix || '-ac300000-0000-4000-8000-0000000000d6', reason, stamp::timestamptz
from unnest(array['app', 'appr', 'draft']) as prefix
cross join unnest(array['draft', 'feedback', 'overdue', 'quiet', 'decide', 'approval']) as reason
cross join unnest(array['0001-01-01T00:00:00Z', '2026-10-30T09:53:03.123456+00:00', '9999-12-31T23:59:59Z']) as stamp;
select pg_temp.expect((select count(*) from inbox_dismissals where issue_key like '%-ac300000-0000-4000-8000-0000000000d6') = 54,
  'every key and reason the Inbox computes today is accepted');
delete from inbox_dismissals where issue_key like '%-ac300000-0000-4000-8000-0000000000d6';
select pg_temp.as_owner();

-- 34. Interview reviews (20261030153000_interview_reviews). A member's own
-- check on an interview, read by whoever can read the interview. Interview 1
-- is on the job the hiring manager has, with the limited interviewer on it;
-- 2 is on a job they do not have; 3 is confidential; 4 is Globex's.
update actors set access_level = 'limited' where id = 'a1000000-0000-4000-8000-000000000002';
update actors set can_view_all_confidential = false where slug = 'acme-admin';
insert into companies (id, name, org_id) values ('bc340000-0000-4000-8000-000000000001', 'Globex', 'b0000000-0000-4000-8000-00000000000b');
insert into roles (id, company_id, title, org_id) values
  ('bc341000-0000-4000-8000-000000000001', 'bc340000-0000-4000-8000-000000000001', 'Globex role', 'b0000000-0000-4000-8000-00000000000b');
insert into people (id, display_name, org_id) values
  ('ac342000-0000-4000-8000-000000000001', 'Ivy One', 'a0000000-0000-4000-8000-00000000000a'),
  ('ac342000-0000-4000-8000-000000000002', 'Ivy Two', 'a0000000-0000-4000-8000-00000000000a'),
  ('ac342000-0000-4000-8000-000000000003', 'Ivy Three', 'a0000000-0000-4000-8000-00000000000a'),
  ('bc342000-0000-4000-8000-000000000004', 'Ivy Four', 'b0000000-0000-4000-8000-00000000000b');
insert into applications (id, person_id, role_id, added_by_actor_id) values
  ('ac343000-0000-4000-8000-000000000001', 'ac342000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('ac343000-0000-4000-8000-000000000002', 'ac342000-0000-4000-8000-000000000002', 'ac100000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001'),
  ('ac343000-0000-4000-8000-000000000003', 'ac342000-0000-4000-8000-000000000003', 'ac100000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001'),
  ('bc343000-0000-4000-8000-000000000004', 'bc342000-0000-4000-8000-000000000004', 'bc341000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001');
insert into interviews (id, application_id, starts_at, ends_at, interviewer_actor_ids) values
  ('ac344000-0000-4000-8000-000000000001', 'ac343000-0000-4000-8000-000000000001', now() - interval '2 days', now() - interval '47 hours',
   array['a1000000-0000-4000-8000-000000000002']::uuid[]),
  ('ac344000-0000-4000-8000-000000000002', 'ac343000-0000-4000-8000-000000000002', now() - interval '2 days', now() - interval '47 hours', '{}'),
  ('ac344000-0000-4000-8000-000000000003', 'ac343000-0000-4000-8000-000000000003', now() - interval '2 days', now() - interval '47 hours', '{}'),
  ('bc344000-0000-4000-8000-000000000004', 'bc343000-0000-4000-8000-000000000004', now() - interval '2 days', now() - interval '47 hours',
   array['b1000000-0000-4000-8000-000000000005']::uuid[]);
delete from job_access where actor_id = 'a1000000-0000-4000-8000-000000000003' and role_id <> 'ac100000-0000-4000-8000-000000000001';

select pg_temp.as_member('user_acme_hm', 'org_acme');
insert into interview_reviews (interview_id) values ('ac344000-0000-4000-8000-000000000001');
select pg_temp.expect((select org_id = 'a0000000-0000-4000-8000-00000000000a'
    and actor_id = 'a1000000-0000-4000-8000-000000000003' and reviewed_at = now()
  from interview_reviews), 'a check is stamped with the member, their org and now, none of them named');
-- Checking twice, two tabs or a double click, is one row.
insert into interview_reviews (interview_id) values ('ac344000-0000-4000-8000-000000000001')
on conflict (interview_id, actor_id) do nothing;
select pg_temp.expect((select count(*) from interview_reviews) = 1, 'checking the same interview again changes nothing');
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id) values ('ac344000-0000-4000-8000-000000000001')$q$, '23505'),
  'and without the conflict clause it is refused, not doubled');
-- Not theirs to name: the actor, the org, the time.
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id, actor_id)
  values ('ac344000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')$q$, '42501'), 'a member cannot check off for a teammate');
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id, org_id)
  values ('ac344000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b')$q$, '42501'), 'nor into another org');
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id, reviewed_at)
  values ('ac344000-0000-4000-8000-000000000001', '2020-01-01')$q$, '42501'), 'nor backdate one');
select pg_temp.expect(pg_temp.raises($q$update interview_reviews set reviewed_at = '2020-01-01'$q$, '42501'),
  'a check is never edited: uncheck and check again');
-- The interviews a member cannot read: not on a job they have, and not one
-- that does not exist. The same refusal for both, so it answers nothing.
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id) values ('ac344000-0000-4000-8000-000000000002')$q$, '42501'),
  'a hiring manager cannot check off an interview on a job they do not have');
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id) values ('bc344000-0000-4000-8000-000000000004')$q$, '42501'),
  'nor one in another org, same-org FK or not');
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id) values ('ac344000-0000-4000-8000-0000000000ff')$q$, '42501'),
  'nor one that does not exist, which refuses the same way');

-- Read follows the interview: a teammate who can read it reads the check, and
-- each member has their own.
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select count(*) from interview_reviews) = 1, 'an admin reads a teammate''s check on an interview they can read');
insert into interview_reviews (interview_id) values
  ('ac344000-0000-4000-8000-000000000001'), ('ac344000-0000-4000-8000-000000000002');
select pg_temp.expect((select count(*) from interview_reviews where interview_id = 'ac344000-0000-4000-8000-000000000001') = 2,
  'two members who check the same interview have a row each');
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id) values ('ac344000-0000-4000-8000-000000000003')$q$, '42501'),
  'an admin cannot check off a confidential interview they are not on');
select pg_temp.as_owner();
insert into interview_reviews (interview_id, actor_id) values
  ('ac344000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000005');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(not exists (select 1 from interview_reviews where interview_id = 'ac344000-0000-4000-8000-000000000003'),
  'nor read a check on one, the row is hidden with the interview');
-- A limited interviewer reads the interview they sat on and no other, through
-- interviews' own policy; they have no application to read.
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from interview_reviews where interview_id = 'ac344000-0000-4000-8000-000000000001') = 2
  and (select count(*) from interview_reviews) = 2, 'a limited interviewer reads the checks on their own interview only');
insert into interview_reviews (interview_id) values ('ac344000-0000-4000-8000-000000000001');
select pg_temp.expect((select count(*) from interview_reviews) = 3, 'and checks it off themselves');
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id) values ('ac344000-0000-4000-8000-000000000002')$q$, '42501'),
  'not one they did not sit on');
-- An external recruiter sees only the candidates they added.
select pg_temp.as_member('user_acme_ext', 'org_acme');
select pg_temp.expect((select count(*) from interview_reviews) = 0, 'an external recruiter reads no check on someone else''s candidate');
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id) values ('ac344000-0000-4000-8000-000000000001')$q$, '42501'),
  'and cannot check one off');
-- On the candidate they added, they have the interview and so the check.
select pg_temp.as_owner();
insert into people (id, display_name, org_id) values
  ('ac342000-0000-4000-8000-000000000005', 'Ivy Five', 'a0000000-0000-4000-8000-00000000000a');
insert into applications (id, person_id, role_id, added_by_actor_id) values
  ('ac343000-0000-4000-8000-000000000005', 'ac342000-0000-4000-8000-000000000005', 'ac100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004');
insert into interviews (id, application_id, starts_at, ends_at, interviewer_actor_ids) values
  ('ac344000-0000-4000-8000-000000000005', 'ac343000-0000-4000-8000-000000000005', now() - interval '2 days', now() - interval '47 hours', '{}');
select pg_temp.as_member('user_acme_ext', 'org_acme');
insert into interview_reviews (interview_id) values ('ac344000-0000-4000-8000-000000000005');
select pg_temp.expect((select count(*) from interview_reviews) = 1, 'an external recruiter checks off an interview of a candidate they added');
delete from interview_reviews;
select pg_temp.expect((select count(*) from interview_reviews) = 0, 'and unchecks it');
-- An archived member has no actor on their token: nothing to read or write.
select pg_temp.as_owner();
savepoint interview_reviews_archived;
update actors set archived_at = now() where id = 'a1000000-0000-4000-8000-000000000003';
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from interview_reviews) = 0, 'an archived member reads no check, their own included');
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id) values ('ac344000-0000-4000-8000-000000000001')$q$, '42501'),
  'and writes none');
rollback to savepoint interview_reviews_archived;
select pg_temp.as_owner();
select pg_temp.expect(exists (select 1 from interview_reviews where actor_id = 'a1000000-0000-4000-8000-000000000003'),
  'a check outlives the member being archived');
-- Another org, and the one person in both.
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from interview_reviews) = 0, 'Globex reads none of Acme''s');
insert into interview_reviews (interview_id) values ('bc344000-0000-4000-8000-000000000004');
delete from interview_reviews where interview_id = 'ac344000-0000-4000-8000-000000000001';
select pg_temp.as_member('user_both', 'org_globex');
select pg_temp.expect((select count(*) from interview_reviews) = 1 and (select org_id from interview_reviews) = 'b0000000-0000-4000-8000-00000000000b',
  'someone in both orgs reads the org on their token');
select pg_temp.as_member('user_both', 'org_acme');
select pg_temp.expect((select count(*) from interview_reviews) = 4
  and not exists (select 1 from interview_reviews where org_id <> 'a0000000-0000-4000-8000-00000000000a'), 'and the other org on the other token');

-- Unchecking is a member's own delete, and reaches nobody else's.
select pg_temp.as_member('user_acme', 'org_acme');
delete from interview_reviews where interview_id = 'ac344000-0000-4000-8000-000000000001' and actor_id <> 'a1000000-0000-4000-8000-000000000001';
select pg_temp.as_owner();
select pg_temp.expect((select count(*) from interview_reviews where interview_id = 'ac344000-0000-4000-8000-000000000001') = 3,
  'an admin cannot clear a teammate''s check');
select pg_temp.as_member('user_acme', 'org_acme');
delete from interview_reviews where interview_id = 'ac344000-0000-4000-8000-000000000001';
select pg_temp.as_owner();
select pg_temp.expect((select count(*) from interview_reviews where interview_id = 'ac344000-0000-4000-8000-000000000001') = 2
  and not exists (select 1 from interview_reviews where actor_id = 'a1000000-0000-4000-8000-000000000001' and interview_id = 'ac344000-0000-4000-8000-000000000001'),
  'unchecking removes that member''s row and no other');

-- Losing the job hides the marks with the interview; getting it back shows them.
delete from job_access where actor_id = 'a1000000-0000-4000-8000-000000000003' and role_id = 'ac100000-0000-4000-8000-000000000001';
delete from hiring_team where actor_id = 'a1000000-0000-4000-8000-000000000003' and role_id = 'ac100000-0000-4000-8000-000000000001';
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from interview_reviews) = 0, 'a member off the job reads no check on it, their own included');
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id) values ('ac344000-0000-4000-8000-000000000001')
  on conflict (interview_id, actor_id) do nothing$q$, '42501'), 'and a repeat is refused, not a no-op that says the row is there');
-- A row they cannot read is a row a filtered delete does not reach.
delete from interview_reviews where interview_id = 'ac344000-0000-4000-8000-000000000001';
select pg_temp.as_owner();
insert into hiring_team (role_id, actor_id, team_role) values
  ('ac100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'hiring_manager');
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from interview_reviews) = 2, 'back on the job, the checks are there');

select pg_temp.as_anon();
select pg_temp.expect(pg_temp.raises($q$select * from interview_reviews$q$, '42501'), 'anon reads nothing');
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id) values ('ac344000-0000-4000-8000-000000000001')$q$, '42501'), 'and writes nothing');
-- Tacit's own apps see Tacit's rows only, and name the actor themselves.
select pg_temp.as_tacit_internal();
select pg_temp.expect((select count(*) from interview_reviews) = 0, 'tacit_internal reads no client''s checks');
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id, actor_id)
  values ('ac344000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001')$q$, '23503'), 'a Tacit actor cannot check off a client''s interview');
-- A Tacit interview hangs off a person, with no application.
select pg_temp.as_owner();
insert into people (id, display_name, org_id) values ('71342000-0000-4000-8000-000000000001', 'Tacit Intro', tacit_org_id());
insert into interviews (id, person_id, starts_at, ends_at, interviewer_actor_ids) values
  ('71344000-0000-4000-8000-000000000001', '71342000-0000-4000-8000-000000000001', now() - interval '2 days', now() - interval '47 hours', '{}');
select pg_temp.as_tacit_internal();
insert into interview_reviews (interview_id, actor_id) values ('71344000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001');
select pg_temp.expect((select org_id from interview_reviews) = tacit_org_id(), 'a check on Tacit''s own interview lands in Tacit');
-- A writer with no member token still cannot cross orgs: the FKs refuse it.
select pg_temp.as_service();
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id, actor_id)
  values ('ac344000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001')$q$, '23503'), 'a Globex actor cannot check off an Acme interview');
select pg_temp.expect(pg_temp.raises($q$insert into interview_reviews (interview_id) values ('ac344000-0000-4000-8000-000000000001')$q$, '23502'),
  'and a check always names who made it');

-- What outlives what. Cancelling keeps the check; the row goes with the
-- interview, and a member's go with them.
select pg_temp.as_owner();
select pg_temp.expect((select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'interview_reviews') = array['actor_id', 'interview_id', 'org_id', 'reviewed_at'],
  'ids and a timestamp: no column can hold feedback, and no person FK for a merge or erasure');
update interviews set status = 'cancelled' where id = 'ac344000-0000-4000-8000-000000000002';
select pg_temp.expect(exists (select 1 from interview_reviews where interview_id = 'ac344000-0000-4000-8000-000000000002'), 'cancelling an interview keeps its checks');
delete from interviews where id = 'ac344000-0000-4000-8000-000000000002';
select pg_temp.expect(not exists (select 1 from interview_reviews where interview_id = 'ac344000-0000-4000-8000-000000000002'), 'a check goes with its interview');
delete from actors where id = 'a1000000-0000-4000-8000-000000000005';
select pg_temp.expect(not exists (select 1 from interview_reviews where actor_id = 'a1000000-0000-4000-8000-000000000005'), 'and with its member');
delete from interview_reviews;

-- 35. Job post views and channels (20261030180000_job_post_views_channels).
-- A view is a count per post per UTC day and nothing about who. Anon writes
-- one through a definer function that answers nothing; a channel comes from
-- the public form alone. Concurrency and the real PostgREST overload choice
-- and that over a limit nothing is written (a transaction's own row lock
-- leaves no mark to look for) are job-post-views.integration.test.ts.
select pg_temp.as_member('user_acme_hm', 'org_acme');
insert into job_posts (id, role_id, title, questions) values
  ('ac600000-0000-4000-8000-000000000351', 'ac100000-0000-4000-8000-000000000001', 'Section 35',
   '[{"id": "name", "type": "name", "label": "Full name", "required": true},
     {"id": "email", "type": "email", "label": "Email", "required": true}]');
select pg_temp.as_owner();
select set_config('tacit_test.v_slug', (select slug from job_posts where id = 'ac600000-0000-4000-8000-000000000351'), true);
create function pg_temp.today_views() returns integer language sql as $$
  select views from job_post_views
  where job_post_id = 'ac600000-0000-4000-8000-000000000351' and day = (now() at time zone 'utc')::date
$$;
select pg_temp.expect((select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'job_post_views')
    = array['day', 'job_post_id', 'minute_at', 'minute_views', 'org_id', 'views'],
  'a post, a day and counts: no column can hold a reader');
select pg_temp.expect((select relrowsecurity from pg_class where oid = 'public.job_post_views'::regclass), 'RLS is on');

-- Only a live post on an open job counts, and every other answer is the same nothing.
select pg_temp.as_anon();
select record_job_post_view(current_setting('tacit_test.v_slug'));
select pg_temp.as_owner();
select pg_temp.expect(not exists (select 1 from job_post_views), 'a draft is not counted');
select pg_temp.as_member('user_acme_hm', 'org_acme');
update job_posts set status = 'live' where id = 'ac600000-0000-4000-8000-000000000351';
select pg_temp.as_anon();
select record_job_post_view(current_setting('tacit_test.v_slug')) from generate_series(1, 3);
select pg_temp.as_owner();
select pg_temp.expect((select views = 3 and minute_views = 3 and org_id = 'a0000000-0000-4000-8000-00000000000a'
    and day = (now() at time zone 'utc')::date and minute_at = date_trunc('minute', now())
  from job_post_views), 'three views are one row, in the post''s org, on today''s UTC date');
select pg_temp.as_anon();
select pg_temp.expect(pg_temp.refusal($q$select record_job_post_view('0123456789abcdef0123456789abcdef')$q$) = 'no error'
  and pg_temp.refusal($q$select record_job_post_view(null)$q$) = 'no error'
  and pg_temp.refusal($q$select record_job_post_view('')$q$) = 'no error'
  and pg_temp.refusal(format($q$select record_job_post_view(%L)$q$, repeat('a', 100000))) = 'no error'
  and pg_temp.refusal($q$select record_job_post_view('x'' or ''1''=''1')$q$) = 'no error',
  'a wrong, empty, huge or hostile slug is answered like a right one');
select pg_temp.expect(pg_temp.refusal(format($q$select record_job_post_view(%L)$q$, upper(current_setting('tacit_test.v_slug')))) = 'no error',
  'and so is the right slug in the wrong case');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) from job_post_views) = 1 and pg_temp.today_views() = 3, 'and none of them wrote anything');
update job_posts set status = 'closed' where id = 'ac600000-0000-4000-8000-000000000351';
select pg_temp.as_anon();
select record_job_post_view(current_setting('tacit_test.v_slug'));
select pg_temp.as_owner();
select pg_temp.expect(pg_temp.today_views() = 3, 'a closed post is not counted');
update job_posts set status = 'live' where id = 'ac600000-0000-4000-8000-000000000351';
update roles set status = 'paused' where id = 'ac100000-0000-4000-8000-000000000001';
select pg_temp.as_anon();
select record_job_post_view(current_setting('tacit_test.v_slug'));
select pg_temp.as_owner();
select pg_temp.expect(pg_temp.today_views() = 3, 'nor a live post on a job that is not open');
update roles set status = 'open' where id = 'ac100000-0000-4000-8000-000000000001';

-- The limits. The row's rate-limit columns are set by hand: a transaction's
-- now() does not move, so nothing here can wait for a minute to pass.
update job_post_views set minute_views = 300, minute_at = date_trunc('minute', now());
select pg_temp.as_anon();
select record_job_post_view(current_setting('tacit_test.v_slug'));
select pg_temp.as_owner();
select pg_temp.expect((select views = 3 and minute_views = 300 from job_post_views), 'the 301st view of a minute is not counted');
update job_post_views set minute_at = date_trunc('minute', now()) - interval '1 minute';
select pg_temp.as_anon();
select record_job_post_view(current_setting('tacit_test.v_slug'));
select pg_temp.as_owner();
select pg_temp.expect((select views = 4 and minute_views = 1 and minute_at = date_trunc('minute', now()) from job_post_views),
  'the next minute starts again');
-- A call whose transaction began just before the turn of a minute, after a
-- newer one has already moved the row on.
update job_post_views set minute_at = date_trunc('minute', now()) + interval '1 minute', minute_views = 5;
select pg_temp.as_anon();
select record_job_post_view(current_setting('tacit_test.v_slug'));
select pg_temp.as_owner();
select pg_temp.expect((select views = 5 and minute_views = 6 and minute_at = date_trunc('minute', now()) + interval '1 minute' from job_post_views),
  'a late call counts in the newer minute and does not rewind it');
update job_post_views set minute_at = date_trunc('minute', now()) + interval '1 minute', minute_views = 300;
select pg_temp.as_anon();
select record_job_post_view(current_setting('tacit_test.v_slug'));
select pg_temp.as_owner();
select pg_temp.expect((select views = 5 from job_post_views), 'and a full newer minute refuses it');
update job_post_views set views = 100000, minute_views = 0, minute_at = date_trunc('minute', now()) - interval '1 minute';
select pg_temp.as_anon();
select record_job_post_view(current_setting('tacit_test.v_slug'));
select pg_temp.as_owner();
select pg_temp.expect((select views = 100000 from job_post_views), 'the 100,001st view of a day is not counted');
update job_post_views set day = day - 1;
select pg_temp.as_anon();
select record_job_post_view(current_setting('tacit_test.v_slug'));
select pg_temp.as_owner();
select pg_temp.expect((select count(*) from job_post_views) = 2 and pg_temp.today_views() = 1, 'a new UTC day is a new row, from one');

-- Nobody writes the table but the function.
select pg_temp.as_anon();
select pg_temp.expect(pg_temp.raises($q$select * from job_post_views$q$, '42501'), 'anon reads nothing');
select pg_temp.expect(pg_temp.raises($q$update job_post_views set views = 9$q$, '42501'), 'and writes nothing');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$insert into job_post_views (job_post_id, day, views) values ('ac600000-0000-4000-8000-000000000351', '2026-01-01', 9)$q$, '42501'),
  'an admin cannot add views');
select pg_temp.expect(pg_temp.raises($q$update job_post_views set views = 9$q$, '42501'), 'or change them');
select pg_temp.expect(pg_temp.raises($q$delete from job_post_views$q$, '42501'), 'or clear them');
select pg_temp.expect(pg_temp.raises($q$select record_job_post_view('0123456789abcdef0123456789abcdef')$q$, '42501'),
  'a signed-in token cannot call the anon function');
select pg_temp.as_tacit_internal();
select pg_temp.expect(pg_temp.raises($q$update job_post_views set views = 9$q$, '42501'), 'tacit_internal cannot change them either');
select pg_temp.as_owner();

-- Who reads them: above limited, on a post they can read.
insert into job_posts (id, org_id, role_id, title, questions) values
  ('ac600000-0000-4000-8000-000000000352', 'a0000000-0000-4000-8000-00000000000a', 'ac100000-0000-4000-8000-000000000002', 'Not the HM''s',
   '[{"id": "name", "type": "name", "label": "Name", "required": true}, {"id": "email", "type": "email", "label": "Email", "required": true}]');
insert into job_post_views (job_post_id, day, views) values ('ac600000-0000-4000-8000-000000000352', '2026-10-01', 7);
select pg_temp.expect((select org_id from job_post_views where job_post_id = 'ac600000-0000-4000-8000-000000000352') = 'a0000000-0000-4000-8000-00000000000a',
  'a row inherits its post''s org');
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect((select count(*) from job_post_views) = 3, 'an admin reads every post''s views');
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from job_post_views) = 2
    and not exists (select 1 from job_post_views where job_post_id = 'ac600000-0000-4000-8000-000000000352'),
  'a hiring manager reads their own job''s and no other');
-- An interview opens a job's post to a member above limited as it does to a
-- limited one, and it stops there: can_see_role is the wrong line for numbers.
select pg_temp.as_owner();
insert into interviews (id, application_id, starts_at, ends_at, interviewer_actor_ids) values
  ('ac344000-0000-4000-8000-000000000035', 'ac300000-0000-4000-8000-00000000000b', now(), now() + interval '1 hour',
   array['a1000000-0000-4000-8000-000000000003']::uuid[]);
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from job_posts where id = 'ac600000-0000-4000-8000-000000000352') = 1
    and not exists (select 1 from job_post_views where job_post_id = 'ac600000-0000-4000-8000-000000000352'),
  'a hiring manager interviewing on another job reads its post but not its numbers');
select pg_temp.as_owner();
delete from interviews where id = 'ac344000-0000-4000-8000-000000000035';
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from job_posts where id = 'ac600000-0000-4000-8000-000000000351') = 1
    and (select count(*) from job_post_views) = 0,
  'an interviewer on the job reads the post but not its numbers');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from job_post_views) = 0, 'another org reads none of it');
select pg_temp.as_tacit_internal();
select pg_temp.expect((select count(*) from job_post_views) = 0, 'tacit_internal reads no client''s');
-- A writer with no member token still cannot cross orgs: the FK refuses it.
select pg_temp.as_service();
select pg_temp.expect(pg_temp.raises($q$insert into job_post_views (org_id, job_post_id, day)
  values ('b0000000-0000-4000-8000-00000000000b', 'ac600000-0000-4000-8000-000000000351', '2026-10-02')$q$, '23503'),
  'Globex cannot hold a row for an Acme post');

-- Channels. Each listed value lands on the application; a bad one is refused
-- after the post is found, so it says nothing about a slug.
select pg_temp.as_anon();
select pg_temp.expect(submit_job_application(current_setting('tacit_test.v_slug'), '{"name": "Li", "email": "li@ch.test"}', null, null, 'linkedin'), 'a form with a channel is accepted');
select pg_temp.expect(submit_job_application(current_setting('tacit_test.v_slug'), '{"name": "Hn", "email": "hn@ch.test"}', null, null, 'hackernews'), 'hackernews');
select pg_temp.expect(submit_job_application(current_setting('tacit_test.v_slug'), '{"name": "Di", "email": "di@ch.test"}', null, null, 'direct'), 'direct');
select pg_temp.expect(submit_job_application(current_setting('tacit_test.v_slug'), '{"name": "Ot", "email": "ot@ch.test"}', null, null, 'other'), 'other');
select pg_temp.expect(submit_job_application(current_setting('tacit_test.v_slug'), '{"name": "Nu", "email": "nu@ch.test"}', null, null, null), 'a null channel is not recorded, and not refused');
select pg_temp.expect(submit_job_application(current_setting('tacit_test.v_slug'), '{"name": "Fo", "email": "fo@ch.test"}', null, null), 'the four-argument call still answers');
select pg_temp.expect(submit_job_application(current_setting('tacit_test.v_slug'), '{"name": "Tw", "email": "tw@ch.test"}'), 'and so does the two-argument one');
select pg_temp.as_owner();
select pg_temp.expect((select jsonb_object_agg(p.email, a.channel) from applications a join people p on p.id = a.person_id where p.email like '%@ch.test')
    = '{"li@ch.test": "linkedin", "hn@ch.test": "hackernews", "di@ch.test": "direct", "ot@ch.test": "other",
        "nu@ch.test": null, "fo@ch.test": null, "tw@ch.test": null}'::jsonb,
  'each channel lands on its application, and no channel is null');
select pg_temp.expect((select bool_and(a.source = 'job_board' and a.source_detail = 'Section 35') from applications a join people p on p.id = a.person_id where p.email like '%@ch.test'),
  'source stays what it was: the channel is beside it, not instead of it');
select pg_temp.as_anon();
select pg_temp.expect(pg_temp.refusal(format($q$select submit_job_application(%L, '{"name": "Ba", "email": "ba@ch.test"}', null, null, 'LinkedIn')$q$, current_setting('tacit_test.v_slug'))) = '22023 channel: invalid',
  'a channel is exact, with no case folding');
select pg_temp.expect(pg_temp.refusal(format($q$select submit_job_application(%L, '{"name": "Ba", "email": "ba@ch.test"}', null, null, '')$q$, current_setting('tacit_test.v_slug'))) = '22023 channel: invalid',
  'empty is not null');
select pg_temp.expect(pg_temp.refusal(format($q$select submit_job_application(%L, '{"name": "Ba", "email": "ba@ch.test"}', null, null, 'twitter''; drop table people; --')$q$, current_setting('tacit_test.v_slug'))) = '22023 channel: invalid',
  'and anything else is refused, and not echoed');
select pg_temp.expect(pg_temp.refusal($q$select submit_job_application('0123456789abcdef0123456789abcdef', '{}', null, null, 'nonsense')$q$) = 'P0002 job post not found',
  'a bad channel on a wrong slug is the same not-found');
select pg_temp.expect(submit_job_application(current_setting('tacit_test.v_slug'), '{"name": "Bot", "email": "bot@ch.test"}', 'http://spam.test', null, 'nonsense'),
  'a filled honeypot is still only a true');
select pg_temp.as_owner();
select pg_temp.expect(not exists (select 1 from people where email in ('ba@ch.test', 'bot@ch.test')), 'no refused or honeypot submission wrote anyone');
select pg_temp.expect(not exists (select 1 from job_post_attempts where email_digest = md5('ba@ch.test')), 'and a bad channel cost no attempt');
-- Someone already in the job keeps the channel they came in on.
select pg_temp.as_anon();
select pg_temp.expect(submit_job_application(current_setting('tacit_test.v_slug'), '{"name": "Li", "email": "li@ch.test"}', null, null, 'hackernews'), 'applying again answers the same');
select pg_temp.as_owner();
select pg_temp.expect((select a.channel from applications a join people p on p.id = a.person_id where p.email = 'li@ch.test') = 'linkedin', 'and leaves the first channel');

-- A channel is the form's. A member keeps every other write they had. The
-- message is compared because a policy refuses with 42501 too.
grant execute on function pg_temp.refusal(text) to authenticated;
select set_config('tacit_test.guard', '42501 channel is recorded by the public job post, not by a member', true);
select pg_temp.as_member('user_acme', 'org_acme');
select pg_temp.expect(pg_temp.refusal($q$update applications set channel = 'direct' where person_id = (select id from people where email = 'li@ch.test')$q$) = current_setting('tacit_test.guard'),
  'an admin cannot rewrite a channel');
select pg_temp.expect(pg_temp.refusal($q$update applications set channel = null where person_id = (select id from people where email = 'li@ch.test')$q$) = current_setting('tacit_test.guard'),
  'or clear one');
select pg_temp.expect(pg_temp.refusal($q$update applications set channel = 'direct' where person_id = (select id from people where email = 'nu@ch.test')$q$) = current_setting('tacit_test.guard'),
  'or fill one in');
select pg_temp.expect(pg_temp.refusal($q$insert into applications (person_id, role_id, channel)
  select id, 'ac100000-0000-4000-8000-000000000002', 'linkedin' from people where email = 'li@ch.test'$q$) = current_setting('tacit_test.guard'),
  'or add an application with one');
update applications set next_action = 'Call Li' where person_id = (select id from people where email = 'li@ch.test');
select pg_temp.expect((select next_action = 'Call Li' and channel = 'linkedin' from applications where person_id = (select id from people where email = 'li@ch.test')),
  'and every other edit still works, leaving it alone');
select pg_temp.as_service();
select pg_temp.expect(pg_temp.raises($q$update applications set channel = 'nonsense' where person_id = (select id from people where email = 'li@ch.test')$q$, '23514'),
  'the column takes only the listed values, whoever writes it');

-- Merging and erasing a candidate, member-run definers, get past the guard.
-- A merge moves an application with its channel; erasure keeps it as it keeps
-- source, a category with no room for anything personal, and blanks the detail.
select pg_temp.as_owner();
insert into job_posts (id, org_id, role_id, title, questions) values
  ('ac600000-0000-4000-8000-000000000353', 'a0000000-0000-4000-8000-00000000000a', 'ac100000-0000-4000-8000-000000000002', 'Other job',
   '[{"id": "name", "type": "name", "label": "Name", "required": true}, {"id": "email", "type": "email", "label": "Email", "required": true}]');
update job_posts set status = 'live' where id = 'ac600000-0000-4000-8000-000000000353';
update roles set status = 'open' where id = 'ac100000-0000-4000-8000-000000000002';
select set_config('tacit_test.o_slug', (select slug from job_posts where id = 'ac600000-0000-4000-8000-000000000353'), true);
select set_config('tacit_test.hn_app', (select a.id::text from applications a join people p on p.id = a.person_id where p.email = 'hn@ch.test'), true);
select pg_temp.as_anon();
select pg_temp.expect(submit_job_application(current_setting('tacit_test.o_slug'), '{"name": "Dup", "email": "dup@ch.test"}', null, null, 'hackernews'), 'a duplicate applies to another job');
select pg_temp.as_member('user_acme', 'org_acme');
select client_merge_candidates((select id from people where email = 'di@ch.test'), (select id from people where email = 'dup@ch.test'));
select pg_temp.expect((select a.channel from applications a where a.role_id = 'ac100000-0000-4000-8000-000000000002'
    and a.person_id = (select id from people where email = 'di@ch.test')) = 'hackernews',
  'a merge moves the application with its channel');
select client_anonymize_candidate((select id from people where email = 'hn@ch.test'), 'ANONYMIZE Hn');
select pg_temp.as_owner();
select pg_temp.expect((select channel = 'hackernews' and source = 'job_board' and source_detail is null
    from applications where id = current_setting('tacit_test.hn_app')::uuid),
  'erasure keeps the channel with the source, and blanks the detail');

-- The counts go with their post.
delete from job_posts where id in ('ac600000-0000-4000-8000-000000000351', 'ac600000-0000-4000-8000-000000000352', 'ac600000-0000-4000-8000-000000000353');
select pg_temp.expect(not exists (select 1 from job_post_views), 'views go with their post');

-- 36. A resume uploaded on the public form (20261108120000_job_post_resume_upload).
-- The six-argument call takes the file's details and answers the path of the
-- person_files row it adds; the bytes are the caller's to store. A link still
-- answers through the five-argument call, unchanged.
select pg_temp.as_member('user_acme_hm', 'org_acme');
insert into job_posts (id, role_id, title, questions) values
  ('ac600000-0000-4000-8000-000000000361', 'ac100000-0000-4000-8000-000000000001', 'Section 36',
   '[{"id": "resume", "type": "resume", "label": "Resume", "required": true},
     {"id": "name", "type": "name", "label": "Full name", "required": true},
     {"id": "email", "type": "email", "label": "Email", "required": true}]'),
  ('ac600000-0000-4000-8000-000000000362', 'ac100000-0000-4000-8000-000000000001', 'Section 36, no resume',
   '[{"id": "name", "type": "name", "label": "Full name", "required": true},
     {"id": "email", "type": "email", "label": "Email", "required": true}]');
update job_posts set status = 'live' where id in ('ac600000-0000-4000-8000-000000000361', 'ac600000-0000-4000-8000-000000000362');
select pg_temp.as_owner();
select set_config('tacit_test.r_slug', (select slug from job_posts where id = 'ac600000-0000-4000-8000-000000000361'), true);
select set_config('tacit_test.n_slug', (select slug from job_posts where id = 'ac600000-0000-4000-8000-000000000362'), true);
create function pg_temp.cv(name text default 'Ada CV.pdf', ctype text default 'application/pdf', size jsonb default '2048') returns jsonb
language sql as $$ select jsonb_build_object('filename', name, 'content_type', ctype, 'size_bytes', size) $$;
grant execute on function pg_temp.cv(text, text, jsonb) to anon;

select pg_temp.as_anon();
select set_config('tacit_test.r_path',
  submit_job_application(current_setting('tacit_test.r_slug'), '{"name": "Rf", "email": "rf@rf.test"}', null, null, 'direct', pg_temp.cv()), true);
select pg_temp.as_owner();
select pg_temp.expect((select current_setting('tacit_test.r_path') = f.org_id::text || '/' || f.person_id::text || '/' || f.id::text
    and f.kind = 'resume' and f.filename = 'Ada CV.pdf' and f.content_type = 'application/pdf' and f.size_bytes = 2048
    and f.uploaded_by_actor_id is null and f.org_id = 'a0000000-0000-4000-8000-00000000000a'
  from person_files f join people p on p.id = f.person_id where p.email = 'rf@rf.test'),
  'a file is a resume row on the new person, in the post''s org, at the path it answered');
select pg_temp.expect((select aa.answers -> 0 = '{"id": "resume", "type": "resume", "label": "Resume", "value": "Ada CV.pdf", "file": true}'::jsonb
  from application_answers aa join applications a on a.id = aa.application_id join people p on p.id = a.person_id where p.email = 'rf@rf.test'),
  'and answers the resume question with the file''s name');

select pg_temp.as_anon();
select pg_temp.expect(submit_job_application(current_setting('tacit_test.r_slug'), '{"name": "Rf", "email": "rf@rf.test"}', null, null, null, pg_temp.cv('Again.pdf')) is null,
  'someone already in the job gets no path');
select pg_temp.expect(submit_job_application(current_setting('tacit_test.r_slug'), '{"name": "Bot", "email": "bot@rf.test"}', 'http://spam.test', null, null, pg_temp.cv()) is null,
  'nor does a filled honeypot');
select pg_temp.expect(submit_job_application(current_setting('tacit_test.r_slug'), '{"name": "Ln", "email": "ln@rf.test", "resume": "https://ln.test/cv"}', null, null, null, null) is null,
  'a link with no file is still an answer, and no path');
select pg_temp.expect(submit_job_application(current_setting('tacit_test.r_slug'), '{"name": "L5", "email": "l5@rf.test", "resume": "https://l5.test/cv"}', null, null, null),
  'and the five-argument call still answers true');
select pg_temp.expect(submit_job_application(current_setting('tacit_test.n_slug'), '{"name": "Nf", "email": "nf@rf.test"}', null, null, null, null) is null,
  'no file on a post with no resume question is fine');

create function pg_temp.r_refusal(answers text, resume jsonb, s text default current_setting('tacit_test.r_slug')) returns text language sql as $$
  select pg_temp.refusal(format($q$select submit_job_application(%L, %L::jsonb, null, null, null, %L::jsonb)$q$, s, answers, resume))
$$;
grant execute on function pg_temp.r_refusal(text, jsonb, text) to anon;
select pg_temp.expect(pg_temp.r_refusal('{"name": "Ba", "email": "ba@rf.test"}', null) = '22023 resume: required', 'a required resume needs a file or a link');
select pg_temp.expect(pg_temp.r_refusal('{"name": "Ba", "email": "ba@rf.test", "resume": "https://x.test/cv"}', pg_temp.cv()) = '22023 resume: invalid', 'not both');
select pg_temp.expect(pg_temp.r_refusal('{"name": "Ba", "email": "ba@rf.test"}', pg_temp.cv(), current_setting('tacit_test.n_slug')) = '22023 resume: invalid', 'a file on a post with no resume question is refused');
select pg_temp.expect(pg_temp.r_refusal('{"name": "Ba", "email": "ba@rf.test"}', pg_temp.cv(ctype => 'text/html')) = '22023 resume: invalid', 'a type off the list');
select pg_temp.expect(pg_temp.r_refusal('{"name": "Ba", "email": "ba@rf.test"}', pg_temp.cv(size => '3145729')) = '22023 resume: too_long', 'over 3 MB');
select pg_temp.expect(pg_temp.r_refusal('{"name": "Ba", "email": "ba@rf.test"}', pg_temp.cv(size => '3145728')) = 'no error', 'exactly 3 MB is fine');
select pg_temp.expect(pg_temp.r_refusal('{"name": "Bz", "email": "bz@rf.test"}', pg_temp.cv(size => '0')) = '22023 resume: invalid', 'an empty file');
select pg_temp.expect(pg_temp.r_refusal('{"name": "Bz", "email": "bz@rf.test"}', pg_temp.cv(size => '1.5')) = '22023 resume: invalid', 'a fraction of a byte');
select pg_temp.expect(pg_temp.r_refusal('{"name": "Bz", "email": "bz@rf.test"}', pg_temp.cv(size => '"2048"')) = '22023 resume: invalid', 'a size as text');
select pg_temp.expect(pg_temp.r_refusal('{"name": "Bz", "email": "bz@rf.test"}', pg_temp.cv(name => '../../etc/passwd')) = '22023 resume: invalid', 'a name with a slash');
select pg_temp.expect(pg_temp.r_refusal('{"name": "Bz", "email": "bz@rf.test"}', pg_temp.cv(name => E'cv\n.pdf')) = '22023 resume: invalid', 'or a control character');
select pg_temp.expect(pg_temp.r_refusal('{"name": "Bz", "email": "bz@rf.test"}', pg_temp.cv(name => '   ')) = '22023 resume: invalid', 'or none');
select pg_temp.expect(pg_temp.r_refusal('{"name": "Bz", "email": "bz@rf.test"}', pg_temp.cv(name => repeat('a', 201))) = '22023 resume: invalid', 'or a long one');
select pg_temp.expect(pg_temp.r_refusal('{"name": "Bz", "email": "bz@rf.test"}', pg_temp.cv() || '{"storage_path": "x/y/z"}') = '22023 resume: invalid', 'the caller cannot name the path');
select pg_temp.expect(pg_temp.r_refusal('{"name": "Bz", "email": "bz@rf.test"}', '"cv.pdf"') = '22023 resume: invalid', 'the details are an object');
select pg_temp.as_owner();
select pg_temp.expect(not exists (select 1 from people where email in ('bz@rf.test', 'bot@rf.test')), 'no refused or honeypot submission wrote anyone');
select pg_temp.expect((select count(*) from person_files f join people p on p.id = f.person_id where p.email like '%@rf.test') = 2,
  'two files in all: the first, and the 3 MB one');
select pg_temp.expect(not exists (select 1 from person_files f join people p on p.id = f.person_id where p.email in ('ln@rf.test', 'l5@rf.test', 'nf@rf.test')),
  'a link writes no file');

-- Anon reads no file row; a member reads it with the person, as any other.
select pg_temp.as_anon();
select pg_temp.expect((select count(*) from person_files) = 0, 'anon reads no file');
select pg_temp.as_member('user_acme_hm', 'org_acme');
select pg_temp.expect((select count(*) from person_files f join people p on p.id = f.person_id where p.email = 'rf@rf.test') = 1,
  'the hiring manager reads the applicant''s resume');
select pg_temp.expect(pg_temp.raises(format($q$select submit_job_application(%L, '{"name": "Me", "email": "me@rf.test"}', null, null, null, null)$q$, current_setting('tacit_test.r_slug')), '42501'),
  'a signed-in token cannot call the anon function');
select pg_temp.as_owner();
delete from job_posts where id in ('ac600000-0000-4000-8000-000000000361', 'ac600000-0000-4000-8000-000000000362');

-- 9. The original FK actions still work beside the same-org ones.
delete from actors where id = 'a1000000-0000-4000-8000-000000000001';
delete from people where id = 'ac200000-0000-4000-8000-000000000001';
select pg_temp.expect(not exists (select 1 from applications where id = 'ac300000-0000-4000-8000-000000000001'), 'person delete still cascades through the pipeline');

\echo 'org tenancy: all checks passed'
rollback;
