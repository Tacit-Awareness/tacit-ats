-- Checks for 20261112000000_supabase_auth_groundwork: the access token hook,
-- auth_active_org / set_active_org, my_sign_in_orgs, and the actor
-- functions accepting either org key (WorkOS's or orgs.id).
--
-- One transaction, rolled back; every check raises on failure:
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/supabase_auth.test.sql

begin;

create function pg_temp.as_member(sub text, org_claim text default null) returns void
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

create function pg_temp.expect(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', what; end if;
end $$;

-- What the hook puts in claims.org_id for a user (null = no claim).
create function pg_temp.hook_org(uid uuid) returns text language sql as $$
  select public.custom_access_token_hook(jsonb_build_object(
    'user_id', uid::text,
    'claims', jsonb_build_object('sub', uid::text, 'role', 'authenticated', 'org_id', 'org_stale'),
    'authentication_method', 'password'
  )) -> 'claims' ->> 'org_id'
$$;

grant execute on all functions in schema pg_temp to authenticated;

-- Two companies. Solo belongs to Acme only; Both to Acme and Globex;
-- Gone was archived at Acme; Legacy still signs in with WorkOS.
insert into orgs (id, name, slug, workos_org_id) values
  ('a0000000-0000-4000-8000-00000000000a', 'Acme', 'acme', 'org_acme'),
  ('b0000000-0000-4000-8000-00000000000b', 'Globex', 'globex', 'org_globex');

insert into auth.users (id, email, aud, role) values
  ('5a000000-0000-4000-8000-000000000001', 'solo@acme.test', 'authenticated', 'authenticated'),
  ('5a000000-0000-4000-8000-000000000002', 'both@example.test', 'authenticated', 'authenticated'),
  ('5a000000-0000-4000-8000-000000000003', 'gone@acme.test', 'authenticated', 'authenticated'),
  ('5a000000-0000-4000-8000-000000000004', 'new@acme.test', 'authenticated', 'authenticated');

insert into actors (id, slug, display_name, org_id, access_level, auth_subject, archived_at) values
  ('a1000000-0000-4000-8000-000000000001', 'acme-solo', 'Solo', 'a0000000-0000-4000-8000-00000000000a', 'admin', '5a000000-0000-4000-8000-000000000001', null),
  ('a1000000-0000-4000-8000-000000000002', 'acme-both', 'Both', 'a0000000-0000-4000-8000-00000000000a', 'limited', '5a000000-0000-4000-8000-000000000002', null),
  ('b1000000-0000-4000-8000-000000000002', 'globex-both', 'Both', 'b0000000-0000-4000-8000-00000000000b', 'admin', '5a000000-0000-4000-8000-000000000002', null),
  ('a1000000-0000-4000-8000-000000000003', 'acme-gone', 'Gone', 'a0000000-0000-4000-8000-00000000000a', 'admin', '5a000000-0000-4000-8000-000000000003', now()),
  ('a1000000-0000-4000-8000-000000000005', 'acme-legacy', 'Legacy', 'a0000000-0000-4000-8000-00000000000a', 'elevated', 'user_legacy', null);

-- ---------------------------------------------------------------------------
-- The hook, as Supabase Auth calls it. The local postgres user may not
-- become supabase_auth_admin, so the hook runs as its owner here (it is
-- security definer, so that is how it reads anyway) and the grant is
-- checked on its own.
-- ---------------------------------------------------------------------------
select pg_temp.as_owner();

select pg_temp.expect(pg_temp.hook_org('5a000000-0000-4000-8000-000000000001') = 'a0000000-0000-4000-8000-00000000000a',
  'one company: the hook sets org_id to it');
select pg_temp.expect(pg_temp.hook_org('5a000000-0000-4000-8000-000000000002') is null,
  'two companies and none chosen: no org_id (and a stale one is removed)');
select pg_temp.expect(pg_temp.hook_org('5a000000-0000-4000-8000-000000000003') is null,
  'archived member: no org_id');
select pg_temp.expect(pg_temp.hook_org('5a000000-0000-4000-8000-000000000004') is null,
  'not bound to any actor yet: no org_id');
select pg_temp.expect(
  (public.custom_access_token_hook('{"user_id":"5a000000-0000-4000-8000-000000000001","claims":{"sub":"5a000000-0000-4000-8000-000000000001","aal":"aal1"}}') -> 'claims' ->> 'aal') = 'aal1',
  'the hook keeps the other claims');

-- ---------------------------------------------------------------------------
-- Choosing a company
-- ---------------------------------------------------------------------------
select pg_temp.as_member('5a000000-0000-4000-8000-000000000002');
select pg_temp.expect((select count(*) from public.my_sign_in_orgs()) = 2, 'Both sees their two companies');
select public.set_active_org('b0000000-0000-4000-8000-00000000000b');
select pg_temp.expect((select org_id from public.auth_active_org) = 'b0000000-0000-4000-8000-00000000000b',
  'Both reads their own active company');

do $$ begin
  perform public.set_active_org('a0000000-0000-4000-8000-00000000000a');
  perform public.set_active_org('b0000000-0000-4000-8000-00000000000b');
end $$;

select pg_temp.as_member('5a000000-0000-4000-8000-000000000001');
select pg_temp.expect((select count(*) from public.auth_active_org) = 0, 'Solo cannot read Both''s choice');
do $$ begin
  perform public.set_active_org('b0000000-0000-4000-8000-00000000000b');
  raise exception 'FAILED: Solo chose a company they are not in';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.auth_active_org (user_id, org_id) values ('5a000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a');
  raise exception 'FAILED: a member wrote auth_active_org directly';
exception when insufficient_privilege then null;
end $$;

select pg_temp.as_member('5a000000-0000-4000-8000-000000000003');
do $$ begin
  perform public.set_active_org('a0000000-0000-4000-8000-00000000000a');
  raise exception 'FAILED: an archived member chose their old company';
exception when insufficient_privilege then null;
end $$;

select pg_temp.as_member('user_legacy', 'org_acme');
do $$ begin
  perform public.set_active_org('a0000000-0000-4000-8000-00000000000a');
  raise exception 'FAILED: a WorkOS token used set_active_org';
exception when insufficient_privilege then null;
end $$;
select pg_temp.expect((select count(*) from public.my_sign_in_orgs()) = 0, 'a WorkOS token lists no sign-in companies');

select pg_temp.as_owner();
select pg_temp.expect(pg_temp.hook_org('5a000000-0000-4000-8000-000000000002') = 'b0000000-0000-4000-8000-00000000000b',
  'the hook uses the chosen company');

-- A chosen company the member has since left falls back to the rule for none.
select pg_temp.as_owner();
update actors set archived_at = now() where id = 'b1000000-0000-4000-8000-000000000002';
select pg_temp.as_owner();
select pg_temp.expect(pg_temp.hook_org('5a000000-0000-4000-8000-000000000002') = 'a0000000-0000-4000-8000-00000000000a',
  'left the chosen company: falls back to their only remaining one');
select pg_temp.as_owner();
update actors set archived_at = null where id = 'b1000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- Either org key resolves the same actor
-- ---------------------------------------------------------------------------
select pg_temp.as_member('5a000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a');
select pg_temp.expect(public.current_actor_id() = 'a1000000-0000-4000-8000-000000000001', 'Supabase token + orgs.id: the actor');
select pg_temp.expect(public.current_org_id() = 'a0000000-0000-4000-8000-00000000000a', 'Supabase token + orgs.id: the org');
select pg_temp.expect(public.current_access_level() = 'admin', 'Supabase token + orgs.id: the level');

select pg_temp.as_member('5a000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b');
select pg_temp.expect(public.current_actor_id() is null, 'Supabase token naming a company they are not in: no actor');

select pg_temp.as_member('5a000000-0000-4000-8000-000000000001');
select pg_temp.expect(public.current_actor_id() is null, 'Supabase token with no org_id: no actor');

select pg_temp.as_member('5a000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-00000000000b');
select pg_temp.expect(public.current_actor_id() = 'b1000000-0000-4000-8000-000000000002', 'Both acting at Globex');
select pg_temp.expect(public.current_access_level() = 'admin', 'Both is an admin at Globex');
select pg_temp.as_member('5a000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a');
select pg_temp.expect(public.current_access_level() = 'limited', 'and an interviewer at Acme');

select pg_temp.as_member('user_legacy', 'org_acme');
select pg_temp.expect(public.current_actor_id() = 'a1000000-0000-4000-8000-000000000005', 'WorkOS token + WorkOS org id: unchanged');
select pg_temp.as_member('user_legacy', 'a0000000-0000-4000-8000-00000000000a');
select pg_temp.expect(public.current_actor_id() = 'a1000000-0000-4000-8000-000000000005', 'WorkOS subject + orgs.id also resolves (either key)');

select pg_temp.as_member('5a000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-00000000000a');
select pg_temp.expect(public.current_actor_id() is null, 'archived member: no actor');

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
select pg_temp.as_owner();
select pg_temp.expect(has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'Supabase Auth can call the hook');
select pg_temp.expect(not has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'members cannot call the hook');
select pg_temp.expect(not has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'anon cannot call the hook');
select pg_temp.expect(not has_function_privilege('anon', 'public.set_active_org(uuid)', 'execute'),
  'anon cannot choose a company');
select pg_temp.expect(not has_table_privilege('authenticated', 'public.auth_active_org', 'insert'),
  'members cannot insert auth_active_org');

rollback;
