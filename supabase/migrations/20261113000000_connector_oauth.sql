-- The client connector (apps/mcp) and tats signing in through Supabase Auth's
-- OAuth 2.1 server on this project, in place of WorkOS AuthKit. Additive:
-- nothing uses it until the OAuth server is turned on and the connector's flag
-- is set. Plan: https://claude.ai/artifact/DTK4YUVXtJhbCJRq52EEmb; the design
-- follows the 2026-11-06 spike's findings:
--
-- 1. Supabase does not bind a token to the connector it was issued for (its
--    `aud` is always `authenticated`), so every OAuth token on the project
--    would pass any connector that checks only the signature. The consent page
--    records the authorization's RFC 8707 `resource` (and the company picked)
--    through choose_connector_company(), reading Supabase's pending
--    authorization row by its id for the signed-in user; at the code exchange
--    the hook pins both to the new session, and on every refresh reads them
--    back, setting `aud` = ["authenticated", resource]. The connector requires
--    its own URL in `aud` and a `client_id`, so a portal session token, a
--    token for another connector, or one from a client that sent no resource
--    is refused.
-- 2. The company is pinned per session: a later sign-in picking another
--    company does not move an existing session.
--
-- The hook never reads Supabase's internal tables; only the consent function
-- does, while the authorization is pending.

create table public.oauth_connector_choice (
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null,
  resource text,
  org_id uuid not null references public.orgs (id) on delete cascade,
  chosen_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

comment on table public.oauth_connector_choice is
  'What a member last approved for an OAuth client on the consent page: the resource (connector URL) it asked for and the company picked. Copied to oauth_connector_sessions at the code exchange. Written only by choose_connector_company().';

create table public.oauth_connector_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null,
  resource text,
  org_id uuid references public.orgs (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.oauth_connector_sessions is
  'An OAuth session''s pinned resource and company, written by custom_access_token_hook at the code exchange and read on each refresh. No member reads it.';

alter table public.oauth_connector_choice enable row level security;
alter table public.oauth_connector_sessions enable row level security;
revoke all on public.oauth_connector_choice from public, anon, authenticated;
revoke all on public.oauth_connector_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.oauth_connector_choice, public.oauth_connector_sessions to service_role;

-- The consent page, on the signed-in member's own token: records the company
-- they picked for the OAuth authorization Supabase sent them to approve, and
-- returns that authorization's client and resource so the page can refuse a
-- resource that is not one of ours. plpgsql so it is checked when called, not
-- when created (auth.oauth_authorizations is GoTrue's).
create function public.choose_connector_company(p_authorization_id text, p_org uuid)
returns table (client_id uuid, resource text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.supabase_auth_subject();
  auth_client uuid;
  auth_resource text;
begin
  if me is null then
    raise exception 'needs a Supabase Auth sign-in' using errcode = '42501';
  end if;
  select a.client_id, a.resource into auth_client, auth_resource
  from auth.oauth_authorizations a
  where a.authorization_id = p_authorization_id and a.user_id = me
  order by a.created_at desc
  limit 1;
  if auth_client is null then
    raise exception 'no such authorization for you' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.actors a
    where a.org_id = p_org and a.auth_subject = me::text and a.archived_at is null
  ) then
    raise exception 'not a member of that company' using errcode = '42501';
  end if;
  insert into public.oauth_connector_choice (user_id, client_id, resource, org_id, chosen_at)
  values (me, auth_client, auth_resource, p_org, now())
  on conflict on constraint oauth_connector_choice_pkey
  do update set resource = excluded.resource, org_id = excluded.org_id, chosen_at = excluded.chosen_at;
  return query select auth_client, auth_resource;
end
$$;

revoke all on function public.choose_connector_company(text, uuid) from public, anon;
grant execute on function public.choose_connector_company(text, uuid) to authenticated;

-- The hook again: unchanged for portal sign-ins; for an OAuth token (a
-- client_id in the claims) it pins and reads back the session's resource and
-- company. volatile now, since the code exchange writes the pin.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid text := event ->> 'user_id';
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  cid text := nullif(claims ->> 'client_id', '');
  sid text := nullif(claims ->> 'session_id', '');
  res text;
  org uuid;
begin
  if cid is not null then
    if sid is not null then
      if event ->> 'authentication_method' = 'oauth_provider/authorization_code' then
        select c.resource, c.org_id into res, org
        from public.oauth_connector_choice c
        where c.user_id::text = uid and c.client_id::text = cid;
        insert into public.oauth_connector_sessions (session_id, user_id, client_id, resource, org_id)
        values (sid::uuid, uid::uuid, cid::uuid, res, org)
        on conflict (session_id) do update set resource = excluded.resource, org_id = excluded.org_id;
      else
        select s.resource, s.org_id into res, org
        from public.oauth_connector_sessions s
        where s.session_id::text = sid and s.client_id::text = cid;
      end if;
    end if;
    -- No pinned resource: aud stays `authenticated`, which no connector accepts.
    if res is not null then
      claims := jsonb_set(claims, '{aud}', jsonb_build_array('authenticated', res));
    end if;
    -- The pinned company only while they are still an active member there.
    if org is not null and not exists (
      select 1 from public.actors a where a.org_id = org and a.auth_subject = uid and a.archived_at is null
    ) then
      org := null;
    end if;
  else
    select aa.org_id into org
    from public.auth_active_org aa
    join public.actors a on a.org_id = aa.org_id and a.auth_subject = uid and a.archived_at is null
    where aa.user_id::text = uid;
  end if;

  -- A connector session keeps the company its consent pinned, or none: never
  -- another one of theirs in its place, which would move an open session into
  -- a different company's data. Without a consent (aud unbound) it doesn't
  -- matter, as no connector takes the token.
  if org is null and cid is null then
    select min(a.org_id::text)::uuid into org
    from public.actors a
    where a.auth_subject = uid and a.archived_at is null
    having count(*) = 1;
  end if;

  if org is null then
    claims := claims - 'org_id';
  else
    claims := jsonb_set(claims, '{org_id}', to_jsonb(org::text));
  end if;
  return jsonb_set(event, '{claims}', claims);
end
$$;

revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
