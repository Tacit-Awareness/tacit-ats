-- Groundwork for moving client sign-in from WorkOS to Supabase Auth on this
-- project (the plan: https://claude.ai/artifact/DTK4YUVXtJhbCJRq52EEmb).
-- Additive: WorkOS tokens keep working exactly as before, and nothing signs
-- in through Supabase Auth until the apps do.
--
-- 1. auth_active_org: the company a Supabase user is working in, for people
--    who belong to more than one. Written only through set_active_org().
-- 2. custom_access_token_hook: adds `org_id` (= orgs.id) to every token
--    Supabase issues, from auth_active_org, or from the user's one company.
-- 3. current_actor_id / current_org_id / current_access_level: match the
--    token's org_id against orgs.id as well as orgs.workos_org_id, so either
--    issuer's tokens resolve to the same actor. The WorkOS branch goes in
--    the clean-up after cutover.
-- 4. my_sign_in_orgs(): the companies a signed-in person can pick from.
--
-- A Supabase user's actors.auth_subject is their auth.users id as text.
-- WorkOS subjects look like `user_01...` and are never uuids, and WorkOS
-- org ids look like `org_01...`, so the two kinds never collide.

-- ---------------------------------------------------------------------------
-- 1. The active company
-- ---------------------------------------------------------------------------
create table public.auth_active_org (
  user_id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  updated_at timestamptz not null default now()
);

comment on table public.auth_active_org is
  'The company a Supabase Auth user last chose to work in. custom_access_token_hook copies it into the token''s org_id. Written only by set_active_org(); a member reads only their own row.';

alter table public.auth_active_org enable row level security;

create policy auth_active_org_own_read on public.auth_active_org
  for select to authenticated
  using (user_id::text = auth.jwt() ->> 'sub');

revoke all on public.auth_active_org from public, anon, authenticated, service_role;
grant select on public.auth_active_org to authenticated;
grant select, insert, update, delete on public.auth_active_org to service_role;

-- The caller's subject, when it is a Supabase Auth user (a uuid); null for
-- WorkOS tokens and for no token at all.
create function public.supabase_auth_subject()
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when (auth.jwt() ->> 'sub') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (auth.jwt() ->> 'sub')::uuid
  end
$$;

revoke all on function public.supabase_auth_subject() from public, anon;
grant execute on function public.supabase_auth_subject() to authenticated, service_role;

-- Choose the company to work in. The caller must be an active member there.
-- The new org_id reaches the token on the next refresh, so the app calls
-- refreshSession() right after.
create function public.set_active_org(p_org uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.supabase_auth_subject();
begin
  if me is null then
    raise exception 'set_active_org needs a Supabase Auth sign-in' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.actors a
    where a.org_id = p_org
      and a.auth_subject = me::text
      and a.archived_at is null
  ) then
    raise exception 'not a member of that company' using errcode = '42501';
  end if;
  insert into public.auth_active_org (user_id, org_id, updated_at)
  values (me, p_org, now())
  on conflict (user_id) do update set org_id = excluded.org_id, updated_at = excluded.updated_at;
end
$$;

revoke all on function public.set_active_org(uuid) from public, anon;
grant execute on function public.set_active_org(uuid) to authenticated;

-- The companies the signed-in Supabase user belongs to, for the picker.
create function public.my_sign_in_orgs()
returns table (id uuid, name text, slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.slug
  from public.actors a
  join public.orgs o on o.id = a.org_id
  where a.auth_subject = public.supabase_auth_subject()::text
    and a.archived_at is null
  order by o.name
$$;

revoke all on function public.my_sign_in_orgs() from public, anon;
grant execute on function public.my_sign_in_orgs() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The access token hook
-- ---------------------------------------------------------------------------
-- Supabase Auth calls this (as supabase_auth_admin) before issuing any token,
-- OAuth server tokens included. It sets claims.org_id to the user's active
-- company when they are still an active member there, else to their only
-- company, else removes it (no company yet, or several and none chosen: the
-- app shows the picker). It never fails a sign-in: a member with no org_id
-- simply resolves to no actor.
create function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid text := event ->> 'user_id';
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  org uuid;
begin
  select aa.org_id into org
  from public.auth_active_org aa
  join public.actors a on a.org_id = aa.org_id and a.auth_subject = uid and a.archived_at is null
  where aa.user_id::text = uid;

  if org is null then
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
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 3. Either org key
-- ---------------------------------------------------------------------------
create or replace function public.current_actor_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id
  from actors a
  join orgs o on o.id = a.org_id
  where a.auth_subject = auth.jwt() ->> 'sub'
    and a.archived_at is null
    and (o.workos_org_id = auth.jwt() ->> 'org_id' or o.id::text = auth.jwt() ->> 'org_id')
$$;

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.org_id
  from actors a
  join orgs o on o.id = a.org_id
  where a.auth_subject = auth.jwt() ->> 'sub'
    and a.archived_at is null
    and (o.workos_org_id = auth.jwt() ->> 'org_id' or o.id::text = auth.jwt() ->> 'org_id')
$$;

create or replace function public.current_access_level()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.access_level
  from actors a
  join orgs o on o.id = a.org_id
  where a.auth_subject = auth.jwt() ->> 'sub'
    and a.archived_at is null
    and (o.workos_org_id = auth.jwt() ->> 'org_id' or o.id::text = auth.jwt() ->> 'org_id')
$$;

comment on column public.actors.auth_subject is
  'Who this actor signs in as: a WorkOS user id (`user_01...`) until the Supabase Auth cutover, then the auth.users id as text. Null until the member first signs in (a pending invitation).';
