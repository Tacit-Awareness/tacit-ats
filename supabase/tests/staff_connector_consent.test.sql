-- Checks for 20261114000000_staff_connector_consent: the pre-sign-in lookup
-- of which connector a pending authorization is for, and the staff consent's
-- choice with no company, pinned by custom_access_token_hook as aud with no
-- org_id. The client connector's consent is connector_oauth.test.sql's.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/staff_connector_consent.test.sql

begin;

create function pg_temp.as_member(sub text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
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

create function pg_temp.hook(uid uuid, client uuid, session uuid, method text) returns jsonb language sql as $$
  select public.custom_access_token_hook(jsonb_build_object(
    'user_id', uid::text,
    'authentication_method', method,
    'claims', jsonb_build_object('sub', uid::text, 'role', 'authenticated', 'aud', 'authenticated',
                                 'client_id', client::text, 'session_id', session::text, 'org_id', 'stale')
  )) -> 'claims'
$$;

grant execute on all functions in schema pg_temp to authenticated, anon;

insert into orgs (id, name, slug) values ('a0000000-0000-4000-8000-00000000000a', 'Acme', 'acme');
-- Staff: an account with no company at all. Member: an Acme member.
insert into auth.users (id, email, aud, role) values
  ('5a000000-0000-4000-8000-000000000001', 'ryan@tacitawareness.test', 'authenticated', 'authenticated'),
  ('5a000000-0000-4000-8000-000000000002', 'ada@acme.test', 'authenticated', 'authenticated');
insert into actors (id, slug, display_name, org_id, access_level, auth_subject) values
  ('a1000000-0000-4000-8000-000000000002', 'acme-ada', 'Ada', 'a0000000-0000-4000-8000-00000000000a', 'admin', '5a000000-0000-4000-8000-000000000002');

insert into auth.oauth_clients (id, registration_type, redirect_uris, grant_types, token_endpoint_auth_method) values
  ('c1000000-0000-4000-8000-0000000000c1', 'dynamic', 'https://claude.ai/api/mcp/auth_callback', 'authorization_code,refresh_token', 'none'),
  ('c2000000-0000-4000-8000-0000000000c2', 'dynamic', 'https://claude.ai/api/mcp/auth_callback', 'authorization_code,refresh_token', 'none');
insert into auth.oauth_authorizations (id, authorization_id, client_id, user_id, redirect_uri, scope, resource, status, created_at, expires_at) values
  -- Not signed in yet: Supabase has no user on it until the consent page reads it.
  (gen_random_uuid(), 'authz-staff-new', 'c1000000-0000-4000-8000-0000000000c1', null, 'https://claude.ai/api/mcp/auth_callback', 'openid email', 'https://mcp.example/api/connector', 'pending', now(), now() + interval '3 minutes'),
  (gen_random_uuid(), 'authz-staff', 'c1000000-0000-4000-8000-0000000000c1', '5a000000-0000-4000-8000-000000000001', 'https://claude.ai/api/mcp/auth_callback', 'openid email', 'https://mcp.example/api/connector', 'pending', now(), now() + interval '3 minutes'),
  (gen_random_uuid(), 'authz-expired', 'c1000000-0000-4000-8000-0000000000c1', null, 'https://claude.ai/api/mcp/auth_callback', 'openid email', 'https://mcp.example/api/connector', 'pending', now() - interval '10 minutes', now() - interval '7 minutes'),
  (gen_random_uuid(), 'authz-answered', 'c1000000-0000-4000-8000-0000000000c1', '5a000000-0000-4000-8000-000000000001', 'https://claude.ai/api/mcp/auth_callback', 'openid email', 'https://mcp.example/api/connector', 'approved', now(), now() + interval '3 minutes'),
  (gen_random_uuid(), 'authz-member', 'c2000000-0000-4000-8000-0000000000c2', '5a000000-0000-4000-8000-000000000002', 'https://claude.ai/api/mcp/auth_callback', 'openid email', 'https://ats-mcp.example/api/client', 'pending', now(), now() + interval '3 minutes');

-- ---------------------------------------------------------------------------
-- Which connector, before sign-in
-- ---------------------------------------------------------------------------
select pg_temp.as_anon();
select pg_temp.expect(public.connector_authorization_resource('authz-staff-new') = 'https://mcp.example/api/connector', 'anon reads a pending authorization''s resource');
select pg_temp.expect(public.connector_authorization_resource('authz-expired') is null, 'an expired authorization says nothing');
select pg_temp.expect(public.connector_authorization_resource('authz-answered') is null, 'an answered authorization says nothing');
select pg_temp.expect(public.connector_authorization_resource('nope') is null, 'an unknown id says nothing');
do $$ begin
  perform public.choose_connector_resource('authz-staff');
  raise exception 'FAILED: anon chose';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------------------
-- The staff consent's choice: no company needed
-- ---------------------------------------------------------------------------
select pg_temp.as_member('5a000000-0000-4000-8000-000000000001');
select pg_temp.expect(
  (select resource from public.choose_connector_resource('authz-staff')) = 'https://mcp.example/api/connector',
  'someone in no company can approve the staff connector');
do $$ begin
  perform public.choose_connector_resource('authz-member');
  raise exception 'FAILED: chose on someone else''s authorization';
exception when insufficient_privilege then null;
end $$;

select pg_temp.as_owner();
select pg_temp.expect(
  (select org_id from oauth_connector_choice where user_id = '5a000000-0000-4000-8000-000000000001') is null,
  'the choice has no company');

-- The code exchange pins aud and no org_id; a refresh reads the same back.
select pg_temp.expect(
  pg_temp.hook('5a000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000c1', 'e1000000-0000-4000-8000-0000000000e1', 'oauth_provider/authorization_code') -> 'aud'
    = '["authenticated", "https://mcp.example/api/connector"]'::jsonb,
  'aud carries the staff connector');
select pg_temp.expect(
  not (pg_temp.hook('5a000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000c1', 'e1000000-0000-4000-8000-0000000000e1', 'token_refresh') ? 'org_id'),
  'a staff token carries no org_id, so the client connector refuses it');

-- A member who approves the staff connector gets no company on that token either,
-- even with exactly one company: a no-company choice never falls back to theirs.
insert into auth.oauth_authorizations (id, authorization_id, client_id, user_id, redirect_uri, scope, resource) values
  (gen_random_uuid(), 'authz-member-staff', 'c1000000-0000-4000-8000-0000000000c1', '5a000000-0000-4000-8000-000000000002', 'https://claude.ai/api/mcp/auth_callback', 'openid email', 'https://mcp.example/api/connector');
select pg_temp.as_member('5a000000-0000-4000-8000-000000000002');
select public.choose_connector_resource('authz-member-staff');
select pg_temp.as_owner();
select pg_temp.expect(
  not (pg_temp.hook('5a000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-0000000000c1', 'e2000000-0000-4000-8000-0000000000e2', 'oauth_provider/authorization_code') ? 'org_id'),
  'a member''s staff-connector token carries no company');

-- Choosing a company again for the same client replaces a no-company choice, and the reverse.
select pg_temp.as_member('5a000000-0000-4000-8000-000000000002');
select public.choose_connector_company('authz-member-staff', 'a0000000-0000-4000-8000-00000000000a');
select public.choose_connector_resource('authz-member-staff');
select pg_temp.as_owner();
select pg_temp.expect(
  (select org_id from oauth_connector_choice where user_id = '5a000000-0000-4000-8000-000000000002' and client_id = 'c1000000-0000-4000-8000-0000000000c1') is null,
  'the last choice wins');

select pg_temp.expect(has_function_privilege('anon', 'public.connector_authorization_resource(text)', 'execute'), 'anon can look up the resource');
select pg_temp.expect(not has_function_privilege('anon', 'public.choose_connector_resource(text)', 'execute'), 'anon cannot choose');

rollback;
