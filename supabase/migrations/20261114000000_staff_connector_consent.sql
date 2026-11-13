-- Tacit's staff connector (tacit-internal's apps/mcp /api/connector) signing
-- in through this project's Supabase Auth OAuth server, so Tacit's team uses
-- the same account as in the ATS (plan:
-- https://claude.ai/artifact/DTK4YUVXtJhbCJRq52EEmb). Supabase has one
-- consent path per project, apps/web's /client/oauth/consent; for the staff
-- connector's resource that page hands over to internal.tacitawareness.com,
-- which draws the consent as Tacit Internal and approves there on the
-- person's own token. Two pieces:
--
-- 1. connector_authorization_resource(): which connector a pending
--    authorization is for, before anyone has signed in, so the ATS can send a
--    staff authorization on without showing its own sign-in. Only the
--    resource (a public connector URL) of a pending, unexpired authorization
--    whose id the caller already holds; never who it is for.
-- 2. choose_connector_resource(): the staff consent's choice, which pins the
--    authorization's resource with no company. The staff connector reads
--    nothing company-scoped from the token (it maps the person to Tacit's own
--    team on the staff project), and the client connector refuses a token
--    without org_id, so a choice with no company gets no one into a company.

alter table public.oauth_connector_choice alter column org_id drop not null;

comment on column public.oauth_connector_choice.org_id is
  'The company picked (choose_connector_company), or null for a connector that is not about one company (choose_connector_resource, the staff connector).';

create function public.connector_authorization_resource(p_authorization_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.resource
  from auth.oauth_authorizations a
  where a.authorization_id = p_authorization_id
    and a.status = 'pending'
    and a.expires_at > now()
$$;

revoke all on function public.connector_authorization_resource(text) from public;
grant execute on function public.connector_authorization_resource(text) to anon, authenticated;

create function public.choose_connector_resource(p_authorization_id text)
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
  insert into public.oauth_connector_choice (user_id, client_id, resource, org_id, chosen_at)
  values (me, auth_client, auth_resource, null, now())
  on conflict on constraint oauth_connector_choice_pkey
  do update set resource = excluded.resource, org_id = null, chosen_at = excluded.chosen_at;
  return query select auth_client, auth_resource;
end
$$;

revoke all on function public.choose_connector_resource(text) from public, anon;
grant execute on function public.choose_connector_resource(text) to authenticated;
