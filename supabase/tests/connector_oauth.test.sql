-- Checks for 20261113000000_connector_oauth: the consent page's
-- choose_connector_company(), and custom_access_token_hook pinning an OAuth
-- session's resource (aud) and company at the code exchange and reading them
-- back on refresh. Portal sign-ins are supabase_auth.test.sql's.
--
-- One transaction, rolled back; every check raises on failure:
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/connector_oauth.test.sql

begin;

create function pg_temp.as_member(sub text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
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

-- The claims the hook returns for an OAuth token event.
create function pg_temp.hook(uid uuid, client uuid, session uuid, method text) returns jsonb language sql as $$
  select public.custom_access_token_hook(jsonb_build_object(
    'user_id', uid::text,
    'authentication_method', method,
    'claims', jsonb_build_object('sub', uid::text, 'role', 'authenticated', 'aud', 'authenticated',
                                 'client_id', client::text, 'session_id', session::text, 'org_id', 'stale')
  )) -> 'claims'
$$;

grant execute on all functions in schema pg_temp to authenticated;

insert into orgs (id, name, slug) values
  ('a0000000-0000-4000-8000-00000000000a', 'Acme', 'acme'),
  ('b0000000-0000-4000-8000-00000000000b', 'Globex', 'globex');
insert into auth.users (id, email, aud, role) values
  ('5a000000-0000-4000-8000-000000000001', 'solo@acme.test', 'authenticated', 'authenticated'),
  ('5a000000-0000-4000-8000-000000000002', 'both@example.test', 'authenticated', 'authenticated');
insert into actors (id, slug, display_name, org_id, access_level, auth_subject) values
  ('a1000000-0000-4000-8000-000000000001', 'acme-solo', 'Solo', 'a0000000-0000-4000-8000-00000000000a', 'admin', '5a000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000002', 'acme-both', 'Both', 'a0000000-0000-4000-8000-00000000000a', 'limited', '5a000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000002', 'globex-both', 'Both', 'b0000000-0000-4000-8000-00000000000b', 'admin', '5a000000-0000-4000-8000-000000000002');

-- Two OAuth clients (Claude, tats) and pending authorizations, as Supabase leaves them for the consent page.
insert into auth.oauth_clients (id, registration_type, redirect_uris, grant_types, token_endpoint_auth_method) values
  ('c1000000-0000-4000-8000-0000000000c1', 'dynamic', 'https://claude.ai/api/mcp/auth_callback', 'authorization_code,refresh_token', 'none'),
  ('c2000000-0000-4000-8000-0000000000c2', 'dynamic', 'http://localhost:33418/callback', 'authorization_code,refresh_token', 'none');
insert into auth.oauth_authorizations (id, authorization_id, client_id, user_id, redirect_uri, scope, resource) values
  (gen_random_uuid(), 'authz-both-claude', 'c1000000-0000-4000-8000-0000000000c1', '5a000000-0000-4000-8000-000000000002', 'https://claude.ai/api/mcp/auth_callback', 'openid email', 'https://ats-mcp.example/api/client'),
  (gen_random_uuid(), 'authz-both-tats', 'c2000000-0000-4000-8000-0000000000c2', '5a000000-0000-4000-8000-000000000002', 'http://localhost:33418/callback', 'openid email', 'https://ats-mcp.example/api/client'),
  (gen_random_uuid(), 'authz-no-resource', 'c2000000-0000-4000-8000-0000000000c2', '5a000000-0000-4000-8000-000000000001', 'http://localhost:33418/callback', 'openid email', null);

-- ---------------------------------------------------------------------------
-- The consent page's choice
-- ---------------------------------------------------------------------------
select pg_temp.as_member('5a000000-0000-4000-8000-000000000002');
select pg_temp.expect(
  (select resource from public.choose_connector_company('authz-both-claude', 'b0000000-0000-4000-8000-00000000000b')) = 'https://ats-mcp.example/api/client',
  'choosing returns the authorization''s resource');
select public.choose_connector_company('authz-both-tats', 'a0000000-0000-4000-8000-00000000000a');

do $$ begin
  perform public.choose_connector_company('authz-no-resource', 'a0000000-0000-4000-8000-00000000000a');
  raise exception 'FAILED: chose on someone else''s authorization';
exception when insufficient_privilege then null;
end $$;

select pg_temp.as_member('5a000000-0000-4000-8000-000000000001');
do $$ begin
  perform public.choose_connector_company('authz-no-resource', 'b0000000-0000-4000-8000-00000000000b');
  raise exception 'FAILED: chose a company they are not in';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform 1 from public.oauth_connector_choice;
  raise exception 'FAILED: a member read oauth_connector_choice';
exception when insufficient_privilege then null;
end $$;

select pg_temp.as_member('user_legacy');
do $$ begin
  perform public.choose_connector_company('authz-both-claude', 'a0000000-0000-4000-8000-00000000000a');
  raise exception 'FAILED: a WorkOS token chose';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------------------
-- The hook: code exchange pins, refresh reads back
-- ---------------------------------------------------------------------------
select pg_temp.as_owner();

-- Both, through Claude, picked Globex.
select pg_temp.expect(
  pg_temp.hook('5a000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-0000000000c1', 'e1000000-0000-4000-8000-0000000000e1', 'oauth_provider/authorization_code')
    = pg_temp.hook('5a000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-0000000000c1', 'e1000000-0000-4000-8000-0000000000e1', 'token_refresh'),
  'a refresh gives the same claims as the exchange');
select pg_temp.expect(
  (pg_temp.hook('5a000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-0000000000c1', 'e1000000-0000-4000-8000-0000000000e1', 'token_refresh')) -> 'aud'
    = '["authenticated", "https://ats-mcp.example/api/client"]'::jsonb,
  'aud carries the connector the authorization asked for');
select pg_temp.expect(
  (pg_temp.hook('5a000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-0000000000c1', 'e1000000-0000-4000-8000-0000000000e1', 'token_refresh')) ->> 'org_id'
    = 'b0000000-0000-4000-8000-00000000000b',
  'org_id is the company picked on the consent page');

-- Through tats, the same person picked Acme: each session keeps its own.
select pg_temp.hook('5a000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-0000000000c2', 'e2000000-0000-4000-8000-0000000000e2', 'oauth_provider/authorization_code');
select pg_temp.expect(
  (pg_temp.hook('5a000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-0000000000c2', 'e2000000-0000-4000-8000-0000000000e2', 'token_refresh')) ->> 'org_id' = 'a0000000-0000-4000-8000-00000000000a'
  and (pg_temp.hook('5a000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-0000000000c1', 'e1000000-0000-4000-8000-0000000000e1', 'token_refresh')) ->> 'org_id' = 'b0000000-0000-4000-8000-00000000000b',
  'two sessions keep their own companies');

-- A later consent for Claude picking Acme does not move the earlier Claude session.
select pg_temp.as_member('5a000000-0000-4000-8000-000000000002');
select public.choose_connector_company('authz-both-claude', 'a0000000-0000-4000-8000-00000000000a');
select pg_temp.as_owner();
select pg_temp.expect(
  (pg_temp.hook('5a000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-0000000000c1', 'e1000000-0000-4000-8000-0000000000e1', 'token_refresh')) ->> 'org_id' = 'b0000000-0000-4000-8000-00000000000b',
  'the company is pinned per session, not per client');

-- Leaving the pinned company: no org_id at all, even though Both still has Acme,
-- so the session can't drift into another company's data; the connector refuses.
update actors set archived_at = now() where id = 'b1000000-0000-4000-8000-000000000002';
select pg_temp.expect(
  not (pg_temp.hook('5a000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-0000000000c1', 'e1000000-0000-4000-8000-0000000000e1', 'token_refresh')) ? 'org_id',
  'left the pinned company: no company, never another one');
update actors set archived_at = null where id = 'b1000000-0000-4000-8000-000000000002';

-- A client that never went through our consent page: aud stays bare, so no connector takes it.
select pg_temp.expect(
  (pg_temp.hook('5a000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000c1', 'e3000000-0000-4000-8000-0000000000e3', 'oauth_provider/authorization_code')) -> 'aud' = '"authenticated"'::jsonb,
  'no consent recorded: aud is not bound to any connector');
-- A refresh of a session the hook never saw: the same.
select pg_temp.expect(
  (pg_temp.hook('5a000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-0000000000c1', 'e9000000-0000-4000-8000-0000000000e9', 'token_refresh')) -> 'aud' = '"authenticated"'::jsonb,
  'unknown session: aud is not bound');
-- One client's session can't be read with another client's id.
select pg_temp.expect(
  (pg_temp.hook('5a000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-0000000000c2', 'e1000000-0000-4000-8000-0000000000e1', 'token_refresh')) -> 'aud' = '"authenticated"'::jsonb,
  'a session is read only by its own client');

-- Portal sign-ins (no client_id) are untouched: one company, org_id set, aud left alone.
select pg_temp.expect(
  (public.custom_access_token_hook('{"user_id":"5a000000-0000-4000-8000-000000000001","claims":{"sub":"5a000000-0000-4000-8000-000000000001","aud":"authenticated"}}') -> 'claims')
    = '{"sub":"5a000000-0000-4000-8000-000000000001","aud":"authenticated","org_id":"a0000000-0000-4000-8000-00000000000a"}'::jsonb,
  'a portal token is as before');

select pg_temp.expect(not has_function_privilege('anon', 'public.choose_connector_company(text, uuid)', 'execute'), 'anon cannot choose');
select pg_temp.expect(not has_table_privilege('authenticated', 'public.oauth_connector_sessions', 'select'), 'members cannot read sessions');

rollback;
