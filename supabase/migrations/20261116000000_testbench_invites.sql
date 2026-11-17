-- Tacit Testbench invitations from the ATS, phase 1: a per-candidate invite
-- link in the New Applicants reply, in place of one link for everyone.
-- Testbench is its own product on its own project; the ATS reaches it over
-- its invite service connection (one credential, Tacit's own Testbench
-- agency, for every ATS company), so which Testbench company a member may
-- invite into is decided here, by their org's row, never by the request.
--
-- 1. orgs.testbench_client_id: the Testbench company this org maps to. Set
--    by Tacit staff (service role). Members read their own org's row as
--    before; orgs has no member UPDATE policy, so none can set or change it.
-- 2. roles.testbench_role_id: the Testbench role a job's test comes from,
--    picked by whoever may manage the job (roles' own client_update policy,
--    can_on_role(job, 'can_manage_job')).
-- 3. testbench_invites: one row per ATS application that was invited, with
--    Testbench's application and attempt ids. The invite link itself is a
--    credential and is never stored: Testbench returns it again for the same
--    request id.

alter table public.orgs add column testbench_client_id uuid;
comment on column public.orgs.testbench_client_id is
  'The Tacit Testbench company (its uuid there) this org''s members invite candidates into. Null: Testbench is off for the org. Set by Tacit staff on the service role; no member policy updates orgs.';

alter table public.roles add column testbench_role_id uuid;
comment on column public.roles.testbench_role_id is
  'The Tacit Testbench role (its uuid there, in the org''s testbench_client_id company) this job''s test comes from. Null: the job has no Testbench test. Set by whoever may manage the job.';

create table public.testbench_invites (
  application_id uuid primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  testbench_role_id uuid not null,
  testbench_application_id uuid not null,
  testbench_attempt_id uuid,
  invited_by_actor_id uuid,
  created_at timestamptz not null default now(),
  constraint testbench_invites_application_id_fkey
    foreign key (org_id, application_id) references public.applications (org_id, id) on delete cascade,
  constraint testbench_invites_invited_by_actor_id_fkey
    foreign key (org_id, invited_by_actor_id) references public.actors (org_id, id) on delete set null (invited_by_actor_id)
);

comment on table public.testbench_invites is
  'An ATS application invited to a Tacit Testbench test: Testbench''s own application and attempt ids, and who invited. Ids only: the invite link is a credential and is not stored. Read by whoever can read the application; written by a member who may edit the candidate, on their own token.';

create index testbench_invites_org on public.testbench_invites (org_id);

alter table public.testbench_invites enable row level security;

-- The applications subquery runs as the caller, so applications' own policy
-- decides: an invite is readable exactly when its application is.
create policy client_read on public.testbench_invites for select to authenticated
  using (
    org_id = (select public.current_org_id())
    and exists (select 1 from public.applications a where a.id = testbench_invites.application_id)
  );

create policy client_insert on public.testbench_invites for insert to authenticated
  with check (
    org_id = (select public.current_org_id())
    and invited_by_actor_id = (select public.current_actor_id())
    and exists (
      select 1 from public.applications a
      where a.id = testbench_invites.application_id
        and a.org_id = testbench_invites.org_id
        and public.can_edit_person(a.person_id)
    )
  );

-- An upsert: inviting the same application again (a retry, another member, a
-- job whose Testbench role changed) replaces the row.
create policy client_update on public.testbench_invites for update to authenticated
  using (
    org_id = (select public.current_org_id())
    and exists (
      select 1 from public.applications a
      where a.id = testbench_invites.application_id
        and a.org_id = testbench_invites.org_id
        and public.can_edit_person(a.person_id)
    )
  )
  with check (
    org_id = (select public.current_org_id())
    and invited_by_actor_id = (select public.current_actor_id())
    and exists (
      select 1 from public.applications a
      where a.id = testbench_invites.application_id
        and a.org_id = testbench_invites.org_id
        and public.can_edit_person(a.person_id)
    )
  );

-- Exact privileges, as the baseline's: a new project's defaults would give
-- anon and authenticated everything.
revoke all on table public.testbench_invites from public, anon, authenticated, service_role, tacit_internal;
grant select, insert, update on table public.testbench_invites to authenticated;
grant all on table public.testbench_invites to service_role;
