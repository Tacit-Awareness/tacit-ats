-- interviewer_profiles checks for 20261030210000_interviewer_profiles: a member
-- writes their own row at any level, an admin any row in their org, reads stop
-- at the member's own row below elevated, and nothing crosses an org.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/interviewer_profiles.test.sql
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

-- Fixtures: Acme with one member at each level, plus one who has left; Globex
-- with its own admin.
insert into orgs (id, name, slug, workos_org_id) values
  ('a0000000-0000-4000-8000-00000000000a', 'Acme', 'acme-ip', 'org_acme_ip'),
  ('b0000000-0000-4000-8000-00000000000b', 'Globex', 'globex-ip', 'org_globex_ip');
insert into actors (id, slug, display_name, org_id, access_level, auth_subject, archived_at) values
  ('a1000000-0000-4000-8000-000000000001', 'acme-admin', 'Acme Admin', 'a0000000-0000-4000-8000-00000000000a', 'admin', 'ip_admin', null),
  ('a1000000-0000-4000-8000-000000000002', 'acme-hm', 'Acme Manager', 'a0000000-0000-4000-8000-00000000000a', 'elevated', 'ip_hm', null),
  ('a1000000-0000-4000-8000-000000000003', 'acme-int', 'Acme Interviewer', 'a0000000-0000-4000-8000-00000000000a', 'limited', 'ip_int', null),
  ('a1000000-0000-4000-8000-000000000004', 'acme-int2', 'Acme Interviewer Two', 'a0000000-0000-4000-8000-00000000000a', 'limited', 'ip_int2', null),
  ('a1000000-0000-4000-8000-000000000005', 'acme-gone', 'Acme Gone', 'a0000000-0000-4000-8000-00000000000a', 'admin', 'ip_gone', now()),
  ('a1000000-0000-4000-8000-000000000006', 'acme-new', 'Acme New', 'a0000000-0000-4000-8000-00000000000a', 'limited', 'ip_new', null),
  ('a1000000-0000-4000-8000-000000000007', 'acme-ext', 'Acme External Recruiter', 'a0000000-0000-4000-8000-00000000000a', 'limited', 'ip_ext', null),
  ('a1000000-0000-4000-8000-000000000008', 'acme-both', 'Acme Both', 'a0000000-0000-4000-8000-00000000000a', 'limited', 'ip_both', null),
  ('b1000000-0000-4000-8000-000000000001', 'globex-admin', 'Globex Admin', 'b0000000-0000-4000-8000-00000000000b', 'admin', 'ip_globex', null);
-- An external recruiter is an elevated member: any job access raises the level.
-- One holds only that, the other also manages a job.
insert into companies (id, name, org_id) values
  ('a2000000-0000-4000-8000-000000000001', 'Acme', 'a0000000-0000-4000-8000-00000000000a');
insert into roles (id, company_id, title, org_id) values
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Engineer', 'a0000000-0000-4000-8000-00000000000a'),
  ('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'Designer', 'a0000000-0000-4000-8000-00000000000a');
insert into job_access (actor_id, role_id, access_role_id)
select v.actor, v.job, ar.id
from (values
  ('a1000000-0000-4000-8000-000000000007'::uuid, 'a3000000-0000-4000-8000-000000000001'::uuid, 'External Recruiter'),
  ('a1000000-0000-4000-8000-000000000008', 'a3000000-0000-4000-8000-000000000001', 'External Recruiter'),
  ('a1000000-0000-4000-8000-000000000008', 'a3000000-0000-4000-8000-000000000002', 'Hiring Manager')) v (actor, job, access_name)
join access_roles ar on ar.org_id = 'a0000000-0000-4000-8000-00000000000a' and ar.name = v.access_name;

-- 1. An interviewer writes their own row, naming no one: the actor comes from
-- their token and the org from the actor.
select pg_temp.as_member('ip_int', 'org_acme_ip');
insert into interviewer_profiles (interview_preference, weekly_interview_cap, focus_areas, preferred_channel, away_until)
values ('loves', 3, array['Distributed systems', 'Debugging'], 'imessage', '2026-11-14');
select pg_temp.expect((select actor_id = 'a1000000-0000-4000-8000-000000000003' and org_id = 'a0000000-0000-4000-8000-00000000000a'
  from interviewer_profiles), 'an insert takes the actor from the token and the org from the actor');
select pg_temp.expect(pg_temp.changed($$update interviewer_profiles set weekly_interview_cap = 2$$) = 1, 'an interviewer updates their own row');
select pg_temp.expect((select weekly_interview_cap from interviewer_profiles) = 2, 'the update landed');
select pg_temp.expect(pg_temp.changed($$update interviewer_profiles set interview_preference = null, weekly_interview_cap = null, focus_areas = '{}', preferred_channel = null, away_until = null$$) = 1,
  'every field can be cleared');
select pg_temp.expect(pg_temp.changed($$update interviewer_profiles set interview_preference = 'avoids', weekly_interview_cap = 1, focus_areas = array['Go'], away_until = '2026-11-14'$$) = 1, 'and set again');
reset role;

-- 2. An interviewer neither reads nor writes a teammate.
select pg_temp.as_service();
insert into interviewer_profiles (actor_id, weekly_interview_cap) values
  ('a1000000-0000-4000-8000-000000000001', 5),
  ('a1000000-0000-4000-8000-000000000004', 2),
  ('b1000000-0000-4000-8000-000000000001', 9);
select pg_temp.expect((select org_id from interviewer_profiles where actor_id = 'b1000000-0000-4000-8000-000000000001') = 'b0000000-0000-4000-8000-00000000000b',
  'the service role''s insert also takes the org from the actor');
reset role;
select pg_temp.as_member('ip_int', 'org_acme_ip');
select pg_temp.expect((select count(*) from interviewer_profiles) = 1, 'an interviewer reads only their own row');
select pg_temp.expect(pg_temp.changed($$update interviewer_profiles set weekly_interview_cap = 99 where actor_id = 'a1000000-0000-4000-8000-000000000004'$$) = 0,
  'an interviewer cannot update a teammate');
select pg_temp.refuses($$insert into interviewer_profiles (actor_id, weekly_interview_cap) values ('a1000000-0000-4000-8000-000000000002', 1)$$,
  '42501', 'an interviewer cannot make a teammate''s row');
select pg_temp.refuses($$update interviewer_profiles set actor_id = 'a1000000-0000-4000-8000-000000000004'$$,
  '22023', 'an interviewer cannot hand their row to a teammate');
reset role;

-- 3. Elevated reads the org and writes only their own.
select pg_temp.as_member('ip_hm', 'org_acme_ip');
select pg_temp.expect((select count(*) from interviewer_profiles) = 3, 'elevated reads the org''s rows, not another org''s');
select pg_temp.expect(pg_temp.changed($$update interviewer_profiles set weekly_interview_cap = 39$$) = 0, 'elevated updates no one else');
select pg_temp.refuses($$insert into interviewer_profiles (actor_id, weekly_interview_cap) values ('a1000000-0000-4000-8000-000000000004', 1)
  on conflict (actor_id) do update set weekly_interview_cap = excluded.weekly_interview_cap$$,
  '42501', 'an upsert is no way around it');
insert into interviewer_profiles (weekly_interview_cap) values (4);
select pg_temp.expect(pg_temp.changed($$update interviewer_profiles set weekly_interview_cap = 3$$) = 1, 'elevated updates their own');
reset role;

-- 4. An admin edits anyone in their org, with or without a row yet.
select pg_temp.as_member('ip_admin', 'org_acme_ip');
select pg_temp.expect((select count(*) from interviewer_profiles) = 4, 'an admin reads the org''s rows');
select pg_temp.expect(pg_temp.changed($$update interviewer_profiles set away_until = '2027-01-02' where actor_id = 'a1000000-0000-4000-8000-000000000003'$$) = 1, 'an admin updates a member');
insert into interviewer_profiles (actor_id, preferred_channel, focus_areas)
values ('a1000000-0000-4000-8000-000000000005', 'slack', array['Storage']);
select pg_temp.expect((select count(*) from interviewer_profiles) = 5, 'an admin makes a member''s row');
-- PostgREST names every column it was sent, so an upsert sets actor_id to itself.
insert into interviewer_profiles (actor_id, weekly_interview_cap) values ('a1000000-0000-4000-8000-000000000004', 6)
on conflict (actor_id) do update set actor_id = excluded.actor_id, weekly_interview_cap = excluded.weekly_interview_cap;
select pg_temp.expect((select weekly_interview_cap from interviewer_profiles where actor_id = 'a1000000-0000-4000-8000-000000000004') = 6, 'an admin upserts a member''s row');

-- 5. A row stays on its member, and its org and dates are not a member's to name.
select pg_temp.refuses($$update interviewer_profiles set actor_id = 'a1000000-0000-4000-8000-000000000002' where actor_id = 'a1000000-0000-4000-8000-000000000004'$$,
  '22023', 'an admin cannot move a profile to another member');
select pg_temp.refuses($$update interviewer_profiles set org_id = 'b0000000-0000-4000-8000-00000000000b' where actor_id = 'a1000000-0000-4000-8000-000000000004'$$,
  '42501', 'org_id is not on the update grant');
select pg_temp.refuses($$update interviewer_profiles set updated_at = now() where actor_id = 'a1000000-0000-4000-8000-000000000004'$$,
  '42501', 'updated_at is not on the update grant');
select pg_temp.refuses($$update interviewer_profiles set created_at = now() where actor_id = 'a1000000-0000-4000-8000-000000000004'$$,
  '42501', 'created_at is not on the update grant');
select pg_temp.refuses($$insert into interviewer_profiles (org_id) values ('b0000000-0000-4000-8000-00000000000b')$$,
  '42501', 'org_id is not on the insert grant');
select pg_temp.refuses($$delete from interviewer_profiles where actor_id = 'a1000000-0000-4000-8000-000000000004'$$,
  '42501', 'no member deletes a profile, an admin included');
reset role;

-- 6. Nothing crosses an org. Globex's admin sees only Globex's row, and Acme's
-- admin cannot reach Globex's.
select pg_temp.as_member('ip_globex', 'org_globex_ip');
select pg_temp.expect((select count(*) from interviewer_profiles) = 1, 'another org''s admin reads only their own org');
select pg_temp.expect(pg_temp.changed($$update interviewer_profiles set weekly_interview_cap = 0 where actor_id = 'a1000000-0000-4000-8000-000000000003'$$) = 0,
  'another org''s admin cannot update a row');
select pg_temp.refuses($$insert into interviewer_profiles (actor_id, weekly_interview_cap) values ('a1000000-0000-4000-8000-000000000002', 1)$$,
  '42501', 'another org''s admin cannot make a row for a member');
reset role;
select pg_temp.as_member('ip_admin', 'org_acme_ip');
select pg_temp.refuses($$insert into interviewer_profiles (actor_id, weekly_interview_cap) values ('b1000000-0000-4000-8000-000000000001', 1)
  on conflict (actor_id) do update set weekly_interview_cap = excluded.weekly_interview_cap$$,
  '42501', 'an admin cannot upsert onto another org''s member');
select pg_temp.refuses($$insert into interviewer_profiles (actor_id) values ('c1000000-0000-4000-8000-000000000001')$$,
  '23503', 'an admin cannot make a row for no one');
reset role;
-- A token claiming the wrong org is no one at all.
select pg_temp.as_member('ip_int', 'org_globex_ip');
select pg_temp.expect((select count(*) from interviewer_profiles) = 0, 'the wrong org claim reads nothing');
select pg_temp.refuses($$insert into interviewer_profiles (weekly_interview_cap) values (1)$$, '42501', 'the wrong org claim has no actor to write as');
reset role;

-- 7. Someone who left has no access, even as an admin.
select pg_temp.as_member('ip_gone', 'org_acme_ip');
select pg_temp.expect((select count(*) from interviewer_profiles) = 0, 'an archived member reads nothing');
select pg_temp.expect(pg_temp.changed($$update interviewer_profiles set weekly_interview_cap = 0$$) = 0, 'an archived member updates nothing');
reset role;

-- 8. The values. A list item is checked one by one, by the trigger.
select pg_temp.as_member('ip_int', 'org_acme_ip');
select pg_temp.refuses($$update interviewer_profiles set interview_preference = 'fine'$$, '23514', 'preference is one of three');
select pg_temp.refuses($$update interviewer_profiles set preferred_channel = 'carrier pigeon'$$, '23514', 'channel is one of three');
select pg_temp.refuses($$update interviewer_profiles set weekly_interview_cap = -1$$, '23514', 'a negative cap');
select pg_temp.refuses($$update interviewer_profiles set weekly_interview_cap = 41$$, '23514', 'a cap over 40');
select pg_temp.expect(pg_temp.changed($$update interviewer_profiles set weekly_interview_cap = 0$$) = 1, 'a cap of 0 is allowed');
select pg_temp.refuses($$update interviewer_profiles set away_until = 'infinity'$$, '23514', 'away_until infinity');
select pg_temp.refuses($$update interviewer_profiles set away_until = '-infinity'$$, '23514', 'away_until -infinity');
select pg_temp.refuses($$update interviewer_profiles set away_until = '0044-03-15 BC'$$, '23514', 'away_until BC');
select pg_temp.refuses($$update interviewer_profiles set away_until = '10000-01-01'$$, '23514', 'away_until year 10000');
select pg_temp.expect(pg_temp.changed($$update interviewer_profiles set away_until = '9999-12-31'$$) = 1, 'the last readable date');
select pg_temp.refuses($$update interviewer_profiles set focus_areas = null$$, '23502', 'focus_areas is never null');
select pg_temp.refuses($$update interviewer_profiles set focus_areas = array[null]::text[]$$, '22023', 'a null item');
select pg_temp.refuses($$update interviewer_profiles set focus_areas = array['']$$, '22023', 'an empty item');
select pg_temp.refuses($$update interviewer_profiles set focus_areas = array['   ']$$, '22023', 'a blank item');
select pg_temp.refuses($$update interviewer_profiles set focus_areas = array[' Go']$$, '22023', 'an untrimmed item');
select pg_temp.refuses($$update interviewer_profiles set focus_areas = array[E'Go\nRust']$$, '22023', 'a two-line item');
select pg_temp.refuses($$update interviewer_profiles set focus_areas = array[repeat('x', 61)]$$, '22023', 'a long item');
select pg_temp.expect(pg_temp.changed($$update interviewer_profiles set focus_areas = array[repeat('é', 60)]$$) = 1, '60 characters, not bytes');
select pg_temp.refuses($$update interviewer_profiles set focus_areas = array['Go', 'GO']$$, '22023', 'a repeat in another case');
select pg_temp.refuses($$update interviewer_profiles set focus_areas = (select array_agg('a' || i) from generate_series(1, 21) i)$$, '23514', '21 items');
select pg_temp.expect(pg_temp.changed($$update interviewer_profiles set focus_areas = (select array_agg('a' || i) from generate_series(1, 20) i)$$) = 1, '20 items');
select pg_temp.refuses($$update interviewer_profiles set focus_areas = '{{a,b},{c,d}}'$$, '23514', 'a list of lists');
reset role;

-- 9. updated_at follows every write, whoever makes it. now() is fixed inside a
-- transaction, so the row is first backdated with the trigger off.
alter table interviewer_profiles disable trigger validate_interviewer_profile;
update interviewer_profiles set updated_at = '2020-01-01', created_at = '2020-01-01' where actor_id = 'a1000000-0000-4000-8000-000000000003';
alter table interviewer_profiles enable trigger validate_interviewer_profile;
select pg_temp.as_member('ip_int', 'org_acme_ip');
update interviewer_profiles set weekly_interview_cap = 2;
select pg_temp.expect((select updated_at > '2021-01-01' and created_at < '2021-01-01' from interviewer_profiles), 'updated_at moved and created_at did not');
reset role;
select pg_temp.as_service();
select pg_temp.refuses($$update interviewer_profiles set actor_id = 'a1000000-0000-4000-8000-000000000002' where actor_id = 'a1000000-0000-4000-8000-000000000003'$$,
  '22023', 'the service role cannot move a profile either');
select pg_temp.refuses($$insert into interviewer_profiles (actor_id, org_id) values ('a1000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-00000000000b')$$,
  '23503', 'the same-org FK refuses a row in another org than its member');
reset role;

-- 10. No key without a member reaches it, and Tacit's own role sees Tacit's org only.
select pg_temp.as_anon();
select pg_temp.refuses($$select * from interviewer_profiles$$, '42501', 'anon cannot read');
select pg_temp.refuses($$insert into interviewer_profiles (actor_id) values ('a1000000-0000-4000-8000-000000000003')$$, '42501', 'anon cannot write');
reset role;
select pg_temp.as_tacit_internal();
select pg_temp.expect((select count(*) from interviewer_profiles where org_id in
  ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b')) = 0, 'tacit_internal reads no client''s rows');
select pg_temp.expect(pg_temp.changed($$update interviewer_profiles set weekly_interview_cap = 0$$) = 0, 'tacit_internal updates no client''s rows');
reset role;

-- 11. A row goes with its member.
delete from actors where id = 'a1000000-0000-4000-8000-000000000004';
select pg_temp.expect((select count(*) from interviewer_profiles where actor_id = 'a1000000-0000-4000-8000-000000000004') = 0, 'a row goes with its actor');

-- 12. The validate trigger is no one's to call.
select pg_temp.expect(not has_function_privilege('authenticated', 'public.interviewer_profiles_validate()', 'execute'), 'members cannot execute the trigger function');
select pg_temp.expect(not has_function_privilege('anon', 'public.interviewer_profiles_validate()', 'execute'), 'anon cannot execute the trigger function');

-- 13. An external recruiter is elevated, and is not the company: they write and
-- read their own row and no one else's "rather not" or dates away.
select pg_temp.expect((select access_level from actors where id = 'a1000000-0000-4000-8000-000000000007') = 'elevated',
  'an external recruiter is elevated, so the level alone cannot tell them apart');
select pg_temp.as_member('ip_ext', 'org_acme_ip');
select pg_temp.expect((select count(*) from interviewer_profiles) = 0, 'an external recruiter reads no teammate''s row');
select pg_temp.expect(pg_temp.changed($$update interviewer_profiles set weekly_interview_cap = 1$$) = 0, 'an external recruiter updates no one');
insert into interviewer_profiles (weekly_interview_cap) values (2);
select pg_temp.expect((select count(*) from interviewer_profiles) = 1, 'an external recruiter reads their own row');
reset role;
select pg_temp.as_member('ip_both', 'org_acme_ip');
select pg_temp.expect((select count(*) from interviewer_profiles) > 1, 'managing another job still reads the org');
reset role;

-- 14. A list over the limit costs nothing: the check constraint runs after the
-- trigger, so the trigger has to stop first, or this is a quadratic loop any
-- member can start. Unbounded, this one takes seconds.
select pg_temp.as_member('ip_int', 'org_acme_ip');
set local statement_timeout = '500ms';
select pg_temp.refuses($$update interviewer_profiles set focus_areas = (select array_agg('area number ' || i) from generate_series(1, 32000) i)$$,
  '23514', 'a huge list is refused at once');
set local statement_timeout = 0;

-- 15. Trimmed and one line, in Unicode. btrim takes only ASCII spaces, so a list
-- could hold a chip that shows nothing, or "Go" twice.
select pg_temp.refuses(format($$update interviewer_profiles set focus_areas = array[%L]$$, v.item), '22023', 'refused: ' || v.what)
from (values
  ('a no-break space', E' '),
  ('an ideographic space', E'　'),
  ('a zero-width space', E'​'),
  ('a zero-width joiner', E'‍'),
  ('a byte order mark', E'﻿'),
  ('a soft hyphen', E'­'),
  ('a trailing no-break space', E'Go '),
  ('a leading en space', E' Go'),
  ('a leading byte order mark', E'﻿Go'),
  ('a line separator', E'Go Rust'),
  ('a paragraph separator', E'Go Rust'),
  ('a next line', E'Go\u0085Rust'),
  ('a right-to-left override', E'Go‮Rust'),
  ('a bidi isolate', E'Go⁧Rust')) v (what, item);
select pg_temp.expect(pg_temp.changed(format($$update interviewer_profiles set focus_areas = array[%L, %L, %L]$$,
  E'\U0001F469‍\U0001F4BB Debugging', E'分散式', '<b>C#</b> & "F#"')) = 1,
  'a joined emoji, another script and markup are ordinary text');
select pg_temp.refuses(format($$update interviewer_profiles set focus_areas = array[%L, %L]$$, E'café', E'café'),
  '22023', 'the same text composed two ways is a repeat');
reset role;

-- 16. No delete, for Tacit's own role too, whose default privileges would allow
-- it. Truncate ignores RLS, so it would reach every org.
select pg_temp.as_tacit_internal();
select pg_temp.refuses($$delete from interviewer_profiles$$, '42501', 'tacit_internal deletes no profile');
select pg_temp.refuses($$truncate interviewer_profiles$$, '42501', 'tacit_internal truncates nothing');
reset role;

\echo 'interviewer profiles: all checks passed'
rollback;
