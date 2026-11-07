-- bot_tasks checks for 20261030200000_bot_tasks: member reads scoped to their
-- own org and the jobs they can see, commands through the definer only, links
-- held to the org, merge and erasure handled, the same posture as the pipeline
-- tables.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bot_tasks.test.sql
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

create function pg_temp.expect(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', what; end if;
end $$;

grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- Fixtures: Acme, with an admin and a limited interviewer; Globex with its own admin.
insert into orgs (id, name, slug, workos_org_id) values
  ('a0000000-0000-4000-8000-00000000000a', 'Acme', 'acme-bt', 'org_acme'),
  ('b0000000-0000-4000-8000-00000000000b', 'Globex', 'globex-bt', 'org_globex');
insert into actors (id, slug, display_name, org_id, access_level, auth_subject) values
  ('a1000000-0000-4000-8000-000000000001', 'acme-admin', 'Acme Admin', 'a0000000-0000-4000-8000-00000000000a', 'admin', 'user_acme_admin'),
  ('a1000000-0000-4000-8000-000000000002', 'acme-int', 'Acme Interviewer', 'a0000000-0000-4000-8000-00000000000a', 'limited', 'user_acme_int'),
  ('b1000000-0000-4000-8000-000000000001', 'globex-admin', 'Globex Admin', 'b0000000-0000-4000-8000-00000000000b', 'admin', 'user_globex');
select pg_temp.as_service();
insert into companies (id, org_id, name) values ('ac000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'Acme');
insert into roles (id, org_id, company_id, title) values ('ac100000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'ac000000-0000-4000-8000-000000000001', 'Founding engineer');
insert into people (id, org_id, display_name, email) values ('ac200000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'Ada Acme', 'ada@example.com');
insert into applications (id, org_id, person_id, role_id, added_by_actor_id) values
  ('ac300000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'ac200000-0000-4000-8000-000000000001', 'ac100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001');
insert into agent_destinations (id, org_id, channel, url, secret, enabled, verified_at) values
  ('ac400000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'grok_bot_webhook', 'https://bot.acme.test/hook', 'tbs_' || repeat('a', 64), true, now()),
  ('bc400000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b', 'grok_bot_webhook', 'https://bot.globex.test/hook', 'tbs_' || repeat('b', 64), true, now());
-- Three Acme tasks: one on an application, one with no application serving the
-- interviewer, one naming no one (admins only). One of Globex's.
insert into bot_tasks (id, org_id, agent_destination_id, kind, application_id, actor_id, status, ref, needs_you) values
  ('ac500000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'ac400000-0000-4000-8000-000000000001', 'schedule_interview', 'ac300000-0000-4000-8000-000000000001', null, 'waiting', 't1', true),
  ('ac500000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 'ac400000-0000-4000-8000-000000000001', 'get_read', null, 'a1000000-0000-4000-8000-000000000002', 'running', 't2', false),
  ('ac500000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-00000000000a', 'ac400000-0000-4000-8000-000000000001', 'other', null, null, 'running', 't3', false),
  ('bc500000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b', 'bc400000-0000-4000-8000-000000000001', 'send_rejection', null, null, 'running', 't1', false);
reset role;

-- 1. The admin reads the tasks of their own jobs and org, nobody else's.
select pg_temp.as_member('user_acme_admin', 'org_acme');
select pg_temp.expect((select count(*) from bot_tasks) = 3, 'admin reads their org''s tasks');
select pg_temp.expect(not exists (select 1 from bot_tasks where org_id <> 'a0000000-0000-4000-8000-00000000000a'), 'admin reads no other org''s tasks');
select pg_temp.expect((select count(*) from bot_task_commands) = 0, 'no commands yet');
reset role;

-- 2. Globex sees only its own task, never Acme's.
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from bot_tasks) = 1 and (select id from bot_tasks) = 'bc500000-0000-4000-8000-000000000001', 'Globex reads only its own');
reset role;
-- Nor by naming the other org in the claim: the org follows the member.
select pg_temp.as_member('user_globex', 'org_acme');
select pg_temp.expect(not exists (select 1 from bot_tasks where org_id = 'a0000000-0000-4000-8000-00000000000a'), 'another org''s claim reads nothing of Acme''s');
reset role;

-- 3. A limited interviewer reads the task that serves them but not the
--    job-scoped one (limited has no can_view_candidates).
select pg_temp.as_member('user_acme_int', 'org_acme');
select pg_temp.expect((select count(*) from bot_tasks) = 1 and (select id from bot_tasks) = 'ac500000-0000-4000-8000-000000000002',
  'limited interviewer reads only the task that serves them');
reset role;

-- 4. A member never writes the tables directly.
select pg_temp.as_member('user_acme_admin', 'org_acme');
do $$ begin
  insert into bot_tasks (org_id, agent_destination_id, kind, ref) values ('a0000000-0000-4000-8000-00000000000a', 'ac400000-0000-4000-8000-000000000001', 'other', 'hax');
  raise exception 'FAILED: a member inserted a bot_task';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update bot_tasks set status = 'failed' where id = 'ac500000-0000-4000-8000-000000000001';
  raise exception 'FAILED: a member updated a bot_task';
exception when insufficient_privilege then null;
end $$;
reset role;

-- 4b. A task cannot link across orgs, whatever a callback sends (the service
--     role, which RLS does not stop): the FKs hold it.
select pg_temp.as_service();
do $$ begin
  insert into bot_tasks (org_id, agent_destination_id, kind, ref, application_id) values
    ('b0000000-0000-4000-8000-00000000000b', 'bc400000-0000-4000-8000-000000000001', 'other', 'x1', 'ac300000-0000-4000-8000-000000000001');
  raise exception 'FAILED: a task named another org''s application';
exception when foreign_key_violation then null;
end $$;
do $$ begin
  insert into bot_tasks (org_id, agent_destination_id, kind, ref) values
    ('b0000000-0000-4000-8000-00000000000b', 'ac400000-0000-4000-8000-000000000001', 'other', 'x2');
  raise exception 'FAILED: a task named another org''s bot';
exception when foreign_key_violation then null;
end $$;
do $$ begin
  insert into bot_tasks (org_id, agent_destination_id, kind, ref, waiting_on_person_id) values
    ('b0000000-0000-4000-8000-00000000000b', 'bc400000-0000-4000-8000-000000000001', 'other', 'x3', 'ac200000-0000-4000-8000-000000000001');
  raise exception 'FAILED: a task waited on another org''s person';
exception when foreign_key_violation then null;
end $$;
do $$ begin
  insert into bot_task_commands (org_id, task_id, command) values
    ('b0000000-0000-4000-8000-00000000000b', 'ac500000-0000-4000-8000-000000000001', 'retry');
  raise exception 'FAILED: a command named another org''s task';
exception when foreign_key_violation then null;
end $$;
reset role;

-- 5. bot_task_command: queued, audited, clears the task's needs_you.
select pg_temp.as_member('user_acme_admin', 'org_acme');
select pg_temp.expect(bot_task_command('ac500000-0000-4000-8000-000000000001', 'nudge') is not null, 'command queued');
select pg_temp.expect((select count(*) from bot_task_commands where command = 'nudge' and status = 'pending'
  and created_by_actor_id = 'a1000000-0000-4000-8000-000000000001') = 1, 'command row recorded as pending');
select pg_temp.expect((select needs_you from bot_tasks where id = 'ac500000-0000-4000-8000-000000000001') = false, 'needs_you cleared by the command');
reset role;
select pg_temp.as_service();
select pg_temp.expect((select count(*) from audit_log where action = 'bot_task.command' and org_id = 'a0000000-0000-4000-8000-00000000000a') = 1, 'command audited');
reset role;

-- 6. Refusals: a task the caller cannot read, a closed task, an unknown
--    command, another org's task.
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from bot_task_commands) = 0, 'Globex reads none of Acme''s commands');
do $$ begin
  perform bot_task_command('ac500000-0000-4000-8000-000000000001', 'retry');
  raise exception 'FAILED: commanded another org''s task';
exception when no_data_found then null;
end $$;
reset role;
select pg_temp.as_member('user_acme_int', 'org_acme');
do $$ begin
  perform bot_task_command('ac500000-0000-4000-8000-000000000001', 'retry');
  raise exception 'FAILED: commanded an unreadable task';
exception when no_data_found then null;
end $$;
-- A task naming no one reads as false for them, not null, so the definer
-- refuses it just as the policy hides it.
select pg_temp.expect(can_read_bot_task(null, null) = false, 'can_read_bot_task is false, never null');
select pg_temp.expect(not exists (select 1 from bot_tasks where id = 'ac500000-0000-4000-8000-000000000003'), 'interviewer cannot read a task naming no one');
do $$ begin
  perform bot_task_command('ac500000-0000-4000-8000-000000000003', 'cancel');
  raise exception 'FAILED: commanded a task the caller cannot read';
exception when no_data_found then null;
end $$;
-- The interviewer CAN command the task that serves them.
select pg_temp.expect(bot_task_command('ac500000-0000-4000-8000-000000000002', 'nudge') is not null, 'interviewer commands their own task');
do $$ begin
  perform bot_task_command('ac500000-0000-4000-8000-000000000002', 'detonate');
  raise exception 'FAILED: unknown command accepted';
exception when invalid_parameter_value then null;
end $$;
reset role;
select pg_temp.as_member('user_acme_admin', 'org_acme');
select pg_temp.as_service();
update bot_tasks set status = 'done' where id = 'ac500000-0000-4000-8000-000000000001';
reset role;
select pg_temp.as_member('user_acme_admin', 'org_acme');
do $$ begin
  perform bot_task_command('ac500000-0000-4000-8000-000000000001', 'retry');
  raise exception 'FAILED: commanded a done task';
exception when invalid_parameter_value then null;
end $$;
reset role;

-- 6b. An admin can command the task naming no one.
select pg_temp.as_member('user_acme_admin', 'org_acme');
select pg_temp.expect(bot_task_command('ac500000-0000-4000-8000-000000000003', 'cancel') is not null, 'admin commands a task naming no one');
reset role;

-- 7. tacit_internal sees only Tacit's org rows (there are none here).
select pg_temp.as_service();
set local role tacit_internal;
select pg_temp.expect((select count(*) from bot_tasks) = 0, 'tacit_internal reads only Tacit-org tasks');
reset role;

-- 8. Merge and erasure know the table. Neither runs at all while a foreign key
--    to people goes unnamed, so this is also what keeps them working.
select pg_temp.as_service();
select pg_temp.expect(cardinality(client_person_fks_unhandled()) = 0, 'every FK to people is one merge and erasure know');
insert into people (id, org_id, display_name, email) values
  ('ac200000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 'Ada Again', 'ada2@example.com'),
  ('ac200000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-00000000000a', 'Bo Bystander', 'bo@example.com'),
  ('ac200000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-00000000000a', 'Cy Candidate', 'cy@example.com');
insert into applications (id, org_id, person_id, role_id, added_by_actor_id) values
  ('ac300000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-00000000000a', 'ac200000-0000-4000-8000-000000000003', 'ac100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('ac300000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-00000000000a', 'ac200000-0000-4000-8000-000000000004', 'ac100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001');
insert into bot_tasks (id, org_id, agent_destination_id, kind, application_id, status, ref, needs_you, steps, error, waiting_on_person_id, waiting_channel) values
  -- Waiting on the duplicate: follows the merge.
  ('ac500000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-00000000000a', 'ac400000-0000-4000-8000-000000000001', 'schedule_interview', null, 'waiting', 'm1', false, '[]', null, 'ac200000-0000-4000-8000-000000000002', 'imessage'),
  -- Open, on the application of the candidate erased below.
  ('ac500000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-00000000000a', 'ac400000-0000-4000-8000-000000000001', 'send_testbench', 'ac300000-0000-4000-8000-000000000004', 'waiting', 'e1', true, '[{"label":"Texted Cy Candidate"}]', 'Cy Candidate did not answer', 'ac200000-0000-4000-8000-000000000004', 'imessage'),
  -- Finished, same application: stays done, still loses its words.
  ('ac500000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-00000000000a', 'ac400000-0000-4000-8000-000000000001', 'other', 'ac300000-0000-4000-8000-000000000004', 'done', 'e2', false, '[{"label":"Cy said yes"}]', null, null, null),
  -- Someone else's, untouched by the erasure.
  ('ac500000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-00000000000a', 'ac400000-0000-4000-8000-000000000001', 'get_read', 'ac300000-0000-4000-8000-000000000003', 'running', 'e3', false, '[{"label":"Asked Bo"}]', 'still waiting', null, null);
reset role;

select pg_temp.as_member('user_acme_admin', 'org_acme');
select pg_temp.expect(bot_task_command('ac500000-0000-4000-8000-000000000005', 'nudge') is not null, 'a command queued on the task about to be erased');
select pg_temp.expect(bot_task_command('ac500000-0000-4000-8000-000000000007', 'nudge') is not null, 'a command queued on a bystander''s task');
select client_merge_candidates('ac200000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-000000000002');
select pg_temp.expect((select waiting_on_person_id from bot_tasks where id = 'ac500000-0000-4000-8000-000000000004') = 'ac200000-0000-4000-8000-000000000001',
  'a merge moves the wait to the record kept');
select client_anonymize_candidate('ac200000-0000-4000-8000-000000000004', 'ANONYMIZE Cy Candidate');
reset role;

select pg_temp.as_service();
select pg_temp.expect((select status = 'cancelled' and not needs_you and steps = '[]'::jsonb and error is null
    and waiting_on_person_id is null and waiting_channel is null and application_id = 'ac300000-0000-4000-8000-000000000004'
  from bot_tasks where id = 'ac500000-0000-4000-8000-000000000005'), 'erasure blanks and cancels an open task, keeping its application');
select pg_temp.expect((select status = 'done' and steps = '[]'::jsonb from bot_tasks where id = 'ac500000-0000-4000-8000-000000000006'),
  'erasure blanks a finished task and leaves its status');
select pg_temp.expect((select status from bot_task_commands where task_id = 'ac500000-0000-4000-8000-000000000005') = 'cancelled',
  'erasure cancels a queued command');
select pg_temp.expect((select status = 'running' and steps <> '[]'::jsonb and error = 'still waiting' from bot_tasks where id = 'ac500000-0000-4000-8000-000000000007'),
  'erasure leaves another candidate''s task alone');
select pg_temp.expect((select status from bot_task_commands where task_id = 'ac500000-0000-4000-8000-000000000007') = 'pending',
  'erasure leaves another candidate''s command queued');
select pg_temp.expect(not exists (select 1 from bot_tasks where steps::text ilike '%Cy %' or error ilike '%Cy %'), 'nothing names the erased candidate');
reset role;

-- 9. Removing a member's reference keeps the org on the row: the same-org FK
--    nulls the column, never org_id.
select pg_temp.as_service();
update bot_tasks set actor_id = 'a1000000-0000-4000-8000-000000000002' where id = 'ac500000-0000-4000-8000-000000000007';
delete from actors where id = 'a1000000-0000-4000-8000-000000000002';
select pg_temp.expect((select actor_id is null and org_id = 'a0000000-0000-4000-8000-00000000000a' from bot_tasks where id = 'ac500000-0000-4000-8000-000000000007'),
  'a removed member leaves the task, org intact');
reset role;

-- 10. Reading a task is not the right to make the bot act on it. A retry on a
--     send_rejection really emails the candidate, so a command on an
--     application takes what changing that application takes. Hiring Team
--     Member reads and cannot edit; an External Recruiter edits only their own.
insert into orgs (id, name, slug, workos_org_id) values
  ('c0000000-0000-4000-8000-00000000000c', 'Initech', 'initech-bt', 'org_initech');
insert into actors (id, slug, display_name, org_id, access_level, auth_subject, archived_at) values
  ('c1000000-0000-4000-8000-000000000001', 'init-admin', 'Admin', 'c0000000-0000-4000-8000-00000000000c', 'admin', 'user_init_admin', null),
  ('c1000000-0000-4000-8000-000000000002', 'init-hm', 'Hiring Manager', 'c0000000-0000-4000-8000-00000000000c', 'elevated', 'user_init_hm', null),
  ('c1000000-0000-4000-8000-000000000003', 'init-view', 'Hiring Team Member', 'c0000000-0000-4000-8000-00000000000c', 'elevated', 'user_init_view', null),
  ('c1000000-0000-4000-8000-000000000004', 'init-ext', 'External Recruiter', 'c0000000-0000-4000-8000-00000000000c', 'elevated', 'user_init_ext', null),
  ('c1000000-0000-4000-8000-000000000005', 'init-none', 'No job access', 'c0000000-0000-4000-8000-00000000000c', 'elevated', 'user_init_none', null),
  ('c1000000-0000-4000-8000-000000000006', 'init-gone', 'Archived admin', 'c0000000-0000-4000-8000-00000000000c', 'admin', 'user_init_gone', now());
select pg_temp.as_service();
insert into companies (id, org_id, name) values ('cc000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000c', 'Initech');
insert into roles (id, org_id, company_id, title) values ('cc100000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000c', 'cc000000-0000-4000-8000-000000000001', 'Engineer');
insert into roles (id, org_id, company_id, title, confidential) values ('cc100000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-00000000000c', 'cc000000-0000-4000-8000-000000000001', 'Secret', true);
insert into job_access (org_id, actor_id, role_id, access_role_id)
select 'c0000000-0000-4000-8000-00000000000c', j.actor::uuid, 'cc100000-0000-4000-8000-000000000001', ar.id
from (values ('c1000000-0000-4000-8000-000000000002', 'Hiring Manager'),
             ('c1000000-0000-4000-8000-000000000003', 'Hiring Team Member'),
             ('c1000000-0000-4000-8000-000000000004', 'External Recruiter')) as j (actor, access)
join access_roles ar on ar.org_id = 'c0000000-0000-4000-8000-00000000000c' and ar.name = j.access;
insert into people (id, org_id, display_name, email) values
  ('cc200000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000c', 'Dee', 'dee@example.com'),
  ('cc200000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-00000000000c', 'Eli', 'eli@example.com'),
  ('cc200000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-00000000000c', 'Fay', 'fay@example.com');
insert into applications (id, org_id, person_id, role_id, added_by_actor_id) values
  ('cc300000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000c', 'cc200000-0000-4000-8000-000000000001', 'cc100000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001'),
  ('cc300000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-00000000000c', 'cc200000-0000-4000-8000-000000000002', 'cc100000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000004'),
  ('cc300000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-00000000000c', 'cc200000-0000-4000-8000-000000000003', 'cc100000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001');
insert into agent_destinations (id, org_id, channel, url, secret, enabled, verified_at) values
  ('cc400000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000c', 'grok_bot_webhook', 'https://bot.initech.test/hook', 'tbs_' || repeat('c', 64), true, now());
insert into bot_tasks (id, org_id, agent_destination_id, kind, application_id, status, ref) values
  ('cc500000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000c', 'cc400000-0000-4000-8000-000000000001', 'send_rejection', 'cc300000-0000-4000-8000-000000000001', 'failed', 'p1'),
  ('cc500000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-00000000000c', 'cc400000-0000-4000-8000-000000000001', 'send_rejection', 'cc300000-0000-4000-8000-000000000002', 'failed', 'p2'),
  ('cc500000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-00000000000c', 'cc400000-0000-4000-8000-000000000001', 'send_rejection', 'cc300000-0000-4000-8000-000000000003', 'failed', 'p3');
reset role;

create function pg_temp.command_outcome(p_task uuid) returns text language plpgsql as $$
begin
  perform bot_task_command(p_task, 'retry');
  return 'queued';
exception when others then
  return sqlstate;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.as_member('user_init_hm', 'org_initech');
select pg_temp.expect((select count(*) from bot_tasks) = 2, 'a hiring manager reads the job''s tasks, not the confidential one');
select pg_temp.expect(pg_temp.command_outcome('cc500000-0000-4000-8000-000000000001') = 'queued', 'a hiring manager commands on their job');
select pg_temp.expect(pg_temp.command_outcome('cc500000-0000-4000-8000-000000000003') = 'P0002', 'a hiring manager does not reach the confidential job');
reset role;
select pg_temp.as_member('user_init_view', 'org_initech');
select pg_temp.expect((select count(*) from bot_tasks) = 2, 'a hiring team member reads the job''s tasks');
select pg_temp.expect(pg_temp.command_outcome('cc500000-0000-4000-8000-000000000001') = '42501', 'a hiring team member reads and cannot command');
select pg_temp.expect(pg_temp.command_outcome('cc500000-0000-4000-8000-000000000002') = '42501', 'nor on anyone''s application');
reset role;
select pg_temp.as_member('user_init_ext', 'org_initech');
select pg_temp.expect((select count(*) from bot_tasks) = 1 and (select ref from bot_tasks) = 'p2', 'an external recruiter reads only the application they added');
select pg_temp.expect(pg_temp.command_outcome('cc500000-0000-4000-8000-000000000002') = 'queued', 'an external recruiter commands on their own');
select pg_temp.expect(pg_temp.command_outcome('cc500000-0000-4000-8000-000000000001') = 'P0002', 'and not on one they did not add');
reset role;
select pg_temp.as_member('user_init_none', 'org_initech');
select pg_temp.expect((select count(*) from bot_tasks) = 0, 'no job access reads nothing');
select pg_temp.expect(pg_temp.command_outcome('cc500000-0000-4000-8000-000000000001') = 'P0002', 'no job access commands nothing');
reset role;
select pg_temp.as_member('user_init_gone', 'org_initech');
select pg_temp.expect((select count(*) from bot_tasks) = 0, 'an archived admin reads nothing');
select pg_temp.expect(pg_temp.command_outcome('cc500000-0000-4000-8000-000000000001') = '42501', 'an archived admin commands nothing');
reset role;

-- 11. A double click is one command: nothing but the id tells two apart, so
--     the bot would act twice. Once sent, the same command queues again.
select pg_temp.as_service();
delete from bot_task_commands where org_id = 'c0000000-0000-4000-8000-00000000000c';
delete from audit_log where org_id = 'c0000000-0000-4000-8000-00000000000c';
create temp table first_click (id uuid) on commit drop;
grant select, insert on first_click to authenticated;
reset role;
select pg_temp.as_member('user_init_admin', 'org_initech');
insert into first_click select bot_task_command('cc500000-0000-4000-8000-000000000001', 'retry');
select pg_temp.expect(bot_task_command('cc500000-0000-4000-8000-000000000001', 'retry') = (select id from first_click), 'a repeat returns the command already queued');
select pg_temp.expect((select count(*) from bot_task_commands where task_id = 'cc500000-0000-4000-8000-000000000001') = 1, 'a double click queues one');
select pg_temp.expect(bot_task_command('cc500000-0000-4000-8000-000000000001', 'cancel') <> (select id from first_click), 'a different command is its own');
reset role;
select pg_temp.as_service();
select pg_temp.expect((select count(*) from audit_log where action = 'bot_task.command' and org_id = 'c0000000-0000-4000-8000-00000000000c') = 2,
  'a repeat is not audited as another command');
update bot_task_commands set status = 'sent' where task_id = 'cc500000-0000-4000-8000-000000000001';
reset role;
select pg_temp.as_member('user_init_admin', 'org_initech');
select pg_temp.expect(bot_task_command('cc500000-0000-4000-8000-000000000001', 'retry') <> (select id from first_click), 'once sent, the same command queues again');
reset role;

-- 12. Erasure reaches every task on the candidate, however it is linked, and
--     nothing can write them back. Dee's interview; a task naming only it; a
--     failed one a member could otherwise retry.
select pg_temp.as_service();
insert into interviews (id, org_id, application_id, starts_at, ends_at) values
  ('cc600000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000c', 'cc300000-0000-4000-8000-000000000001', now(), now() + interval '1 hour');
insert into bot_tasks (id, org_id, agent_destination_id, kind, interview_id, status, ref, steps, error) values
  ('cc500000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-00000000000c', 'cc400000-0000-4000-8000-000000000001', 'get_read', 'cc600000-0000-4000-8000-000000000001', 'waiting', 'iv', '[{"label":"Asked about Dee"}]', 'Dee did not answer');
reset role;
select pg_temp.as_member('user_init_admin', 'org_initech');
select client_anonymize_candidate('cc200000-0000-4000-8000-000000000001', 'ANONYMIZE Dee');
reset role;
select pg_temp.as_service();
select pg_temp.expect((select status = 'cancelled' and steps = '[]'::jsonb and error is null from bot_tasks where id = 'cc500000-0000-4000-8000-000000000004'),
  'erasure reaches a task linked only through the interview');
select pg_temp.expect((select status from bot_tasks where id = 'cc500000-0000-4000-8000-000000000001') = 'cancelled', 'a failed task stops too');
reset role;
select pg_temp.as_member('user_init_admin', 'org_initech');
select pg_temp.expect(pg_temp.command_outcome('cc500000-0000-4000-8000-000000000001') = '22023', 'nothing can be retried on an erased candidate');
reset role;
select pg_temp.as_service();
update bot_tasks set status = 'running', error = 'Dee phoned back', steps = '[{"label":"Dee"}]', needs_you = true,
    waiting_on_person_id = 'cc200000-0000-4000-8000-000000000001', waiting_channel = 'imessage'
  where id = 'cc500000-0000-4000-8000-000000000004';
select pg_temp.expect((select status = 'cancelled' and steps = '[]'::jsonb and error is null and not needs_you and waiting_on_person_id is null and waiting_channel is null
  from bot_tasks where id = 'cc500000-0000-4000-8000-000000000004'), 'a report after erasure cannot write the candidate back');
insert into bot_tasks (id, org_id, agent_destination_id, kind, application_id, status, ref, steps, error) values
  ('cc500000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-00000000000c', 'cc400000-0000-4000-8000-000000000001', 'other', 'cc300000-0000-4000-8000-000000000001', 'running', 'new', '[{"label":"Dee"}]', 'Dee');
select pg_temp.expect((select status = 'cancelled' and steps = '[]'::jsonb and error is null from bot_tasks where id = 'cc500000-0000-4000-8000-000000000005'),
  'nor can a new task on them');
-- A done task keeps its status: that part of the record is the process.
update bot_tasks set status = 'done' where id = 'cc500000-0000-4000-8000-000000000005';
update bot_tasks set status = 'running' where id = 'cc500000-0000-4000-8000-000000000005';
select pg_temp.expect((select status from bot_tasks where id = 'cc500000-0000-4000-8000-000000000005') = 'done', 'a finished task stays finished');
reset role;

-- 13. A finished task owes no one anything and bot_task_command refuses it, so
--     nothing else could clear needs_you: it would sit in the Inbox for good.
select pg_temp.as_service();
update bot_tasks set needs_you = true where id = 'cc500000-0000-4000-8000-000000000002';
select pg_temp.expect((select needs_you from bot_tasks where id = 'cc500000-0000-4000-8000-000000000002'), 'a failed task keeps needs_you');
update bot_tasks set status = 'done' where id = 'cc500000-0000-4000-8000-000000000002';
select pg_temp.expect((select not needs_you from bot_tasks where id = 'cc500000-0000-4000-8000-000000000002'), 'finishing clears it');
reset role;

rollback;

select 'bot tasks: all checks passed' as result;
