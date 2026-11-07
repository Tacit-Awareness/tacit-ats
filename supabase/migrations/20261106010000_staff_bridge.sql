-- The staff -> client bridge's database half (docs/client-project-split.md).
--
-- On the shared project, tacit-internal wrote into client orgs with five
-- definer functions: tacit_client_jobs, tacit_client_job_for_role,
-- tacit_submit_to_client, tacit_submit_application and
-- tacit_client_submissions. After the split those rows live here and Tacit's
-- own (its people, its roles, tacit_submissions) stay on tacit, so each
-- function splits in two: Tacit's half stays there, and the client half is
-- one of the bridge_* functions below, reached only through apps/web's
-- signed /api/bridge/* routes on the service role. Nothing here is callable
-- by a member, the public key or tacit_internal.
--
-- Links back to tacit, which are ids only, never foreign keys (the rows are in
-- the other project):
--   orgs.company_id       Tacit's companies row for this client (was a FK).
--   roles.staff_role_id   the Tacit role a job was opened for (was tacit_role_jobs).
--   people.staff_person_id the Tacit person a candidate was submitted as.

-- orgs.company_id names a row of Tacit's CRM, which stays on tacit.
alter table public.orgs drop constraint orgs_company_id_fkey;
comment on column public.orgs.company_id is
  'Tacit''s companies.id for this client, on the tacit project. An id only: the row is not here.';

alter table public.roles add column staff_role_id uuid;
create unique index roles_staff_role_id_key on public.roles (staff_role_id) where staff_role_id is not null;
comment on column public.roles.staff_role_id is
  'The Tacit role (tacit project) this job was opened for by bridge_job_for_role.';

alter table public.people add column staff_person_id uuid;
create index people_staff_person_idx on public.people (org_id, staff_person_id) where staff_person_id is not null;
comment on column public.people.staff_person_id is
  'The Tacit person (tacit project) a Tacit teammate submitted as this candidate.';

-- Every job Tacit may submit to: open, not confidential, in a client org.
-- tacit_client_jobs, plus the client's company_id so Tacit can name it.
create function public.bridge_client_jobs(p_org uuid default null)
returns table (org_id uuid, org_name text, company_id uuid, role_id uuid, title text, location text)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.company_id, r.id, r.title, r.location
  from orgs o
  join roles r on r.org_id = o.id
  where o.kind = 'client'
    and (p_org is null or o.id = p_org)
    and r.status = 'open'
    and not r.confidential
  order by o.name, r.title
$$;

-- The client's job for one of Tacit's roles at its company: the one opened
-- before, else a new open job (with one opening) under the client's own
-- company row. Null when no client org is that company. The client half of
-- tacit_client_job_for_role; Tacit sends the role's fields, since its roles
-- table is on tacit.
create function public.bridge_job_for_role(
  p_company uuid, p_staff_role uuid, p_title text, p_location text, p_seniority text, p_description text
) returns table (org_id uuid, org_name text, role_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_org_name text;
  v_company uuid;
  v_job uuid;
begin
  if p_company is null or p_staff_role is null or nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'a company, a role and a title are required' using errcode = '22023';
  end if;

  select o.id, o.name into v_org, v_org_name
  from orgs o where o.kind = 'client' and o.company_id = p_company;
  if v_org is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tacit-role-job:' || p_staff_role, 0));
  select r.id into v_job from roles r where r.staff_role_id = p_staff_role;
  if v_job is not null then
    return query select r.org_id, o.name, r.id from roles r join orgs o on o.id = r.org_id where r.id = v_job;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('client-own-company:' || v_org, 0));
  select c.id into v_company from companies c where c.org_id = v_org order by c.created_at limit 1;
  if v_company is null then
    insert into companies (org_id, name) values (v_org, btrim(v_org_name)) returning id into v_company;
  end if;

  insert into roles (org_id, company_id, title, location, seniority, description, status, staff_role_id)
  values (v_org, v_company, btrim(p_title), p_location, p_seniority, p_description, 'open', p_staff_role)
  returning id into v_job;
  insert into openings (org_id, role_id) values (v_org, v_job);
  return query select v_org, v_org_name, v_job;
end;
$$;

-- A Tacit teammate submits a Tacit person into a client's job: the client
-- half of tacit_submit_to_client, with tacit_submit_application's stage raise
-- (p_stage). Tacit has already checked consent, its teammate and its person,
-- and records its own tacit_submissions row from what this returns.
--
-- In the client org: the teammate's actor, matched by email and made on their
-- first submission ("<name> (Tacit)", tacit_agency, limited); External
-- Recruiter access to this job unless they have some or are an admin; the
-- person found by email (left exactly as the client has them) or added with
-- staff_person_id; the application at 'sourced', raised to p_stage when Tacit
-- had them further along; the note; the audit row, with ids only.
create function public.bridge_submit_candidate(
  p_role uuid,
  p_submitter_email text,
  p_submitter_name text,
  p_staff_person_id uuid,
  p_person jsonb,
  p_note text,
  p_source text,
  p_stage text default 'sourced'
) returns table (status text, org_id uuid, person_id uuid, application_id uuid, actor_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  note text := nullif(btrim(coalesce(p_note, '')), '');
  v_submitter text := lower(btrim(coalesce(p_submitter_email, '')));
  v_name text := nullif(btrim(coalesce(p_submitter_name, '')), '');
  v_email text := lower(btrim(coalesce(p_person ->> 'email', '')));
  v_display text := nullif(btrim(coalesce(p_person ->> 'display_name', '')), '');
  job record;
  v_actor uuid;
  v_actor_archived timestamptz;
  v_actor_agency boolean;
  v_recruiter uuid;
  v_person uuid;
  v_app uuid;
begin
  if p_source is null or p_source not in ('dashboard', 'claude') then
    raise exception 'unknown source' using errcode = '22023';
  end if;
  if p_stage is null or p_stage not in ('sourced', 'contacted', 'screening', 'interviewing', 'offer') then
    raise exception 'a submission starts at sourced, contacted, screening, interviewing or offer' using errcode = '22023';
  end if;
  if note is not null and length(note) > 5000 then
    raise exception 'the note is at most 5,000 characters' using errcode = '22023';
  end if;
  if v_submitter = '' or v_name is null then
    raise exception 'the teammate''s name and email are required' using errcode = '22023';
  end if;
  if v_email = '' or v_display is null or p_staff_person_id is null then
    raise exception 'the person''s name, email and Tacit id are required' using errcode = '22023';
  end if;

  -- Every job Tacit may not submit to answers alike.
  select j.org_id, j.role_id into job from bridge_client_jobs() j where j.role_id = p_role;
  if not found then
    raise exception 'job not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tacit-submitter:' || job.org_id || ':' || v_submitter, 0));
  select a.id, a.archived_at, a.tacit_agency into v_actor, v_actor_archived, v_actor_agency
  from actors a where a.org_id = job.org_id and lower(a.email) = v_submitter;
  if v_actor is not null and v_actor_archived is not null then
    if not v_actor_agency then
      raise exception 'this client has removed you from their team' using errcode = '42501';
    end if;
    update actors set archived_at = null where id = v_actor;
  end if;
  if v_actor is null then
    insert into actors (org_id, slug, display_name, email, access_level, tacit_agency)
    values (
      job.org_id,
      'c-' || (select o.slug from orgs o where o.id = job.org_id) || '-' || substr(md5(gen_random_uuid()::text), 1, 8),
      left(v_name, 112) || ' (Tacit)',
      v_submitter,
      'limited',
      true
    )
    returning id into v_actor;
  end if;
  if not exists (select 1 from actors a where a.id = v_actor and a.access_level = 'admin')
     and not exists (select 1 from job_access ja where ja.actor_id = v_actor and ja.role_id = job.role_id) then
    select ar.id into v_recruiter
    from access_roles ar where ar.org_id = job.org_id and ar.name = 'External Recruiter' and ar.is_builtin;
    if v_recruiter is null then
      raise exception 'this client has no External Recruiter role' using errcode = '22023';
    end if;
    insert into job_access (org_id, actor_id, role_id, access_role_id, source)
    values (job.org_id, v_actor, job.role_id, v_recruiter, 'manual');
  end if;

  -- Find or add the person, under the lock submit_job_application and
  -- connector_add_person take.
  perform pg_advisory_xact_lock(hashtextextended('connector-person-email:' || job.org_id || ':' || v_email, 0));
  select pi.person_id into v_person
  from person_identifiers pi
  where pi.org_id = job.org_id and pi.kind = 'email' and pi.value = v_email;
  if v_person is null then
    select p.id into v_person
    from people p
    where p.org_id = job.org_id and lower(p.email) = v_email and p.merged_into_id is null
    order by p.created_at
    limit 1;
  end if;

  if v_person is not null and exists (
    select 1 from applications a
    where a.person_id = v_person and a.role_id = job.role_id and a.merged_into_id is null
  ) then
    return query select 'already_in_job'::text, job.org_id, v_person, null::uuid, v_actor;
    return;
  end if;

  if v_person is null then
    v_person := gen_random_uuid();
    insert into people (
      id, org_id, display_name, email, phone, linkedin_url, current_title, current_company, location,
      added_by_actor_id, prospect_source, prospect_source_detail, staff_person_id
    )
    values (
      v_person, job.org_id, v_display, v_email,
      nullif(btrim(coalesce(p_person ->> 'phone', '')), ''),
      nullif(btrim(coalesce(p_person ->> 'linkedin_url', '')), ''),
      nullif(btrim(coalesce(p_person ->> 'current_title', '')), ''),
      nullif(btrim(coalesce(p_person ->> 'current_company', '')), ''),
      nullif(btrim(coalesce(p_person ->> 'location', '')), ''),
      v_actor, 'agency', 'Tacit', p_staff_person_id
    );
  end if;

  v_app := gen_random_uuid();
  insert into applications (id, person_id, role_id, org_id, stage, source, source_detail, added_by_actor_id)
  values (v_app, v_person, job.role_id, job.org_id, 'sourced', 'agency', left('Tacit · ' || v_name, 200), v_actor);
  insert into application_events (application_id, org_id, actor_id, kind, to_stage, detail)
  values (v_app, job.org_id, v_actor, 'added', 'sourced', 'agency');
  if p_stage <> 'sourced' then
    update applications set stage = p_stage where id = v_app;
    insert into application_events (application_id, org_id, actor_id, kind, from_stage, to_stage, detail)
    values (v_app, job.org_id, v_actor, 'stage_changed', 'sourced', p_stage, 'agency');
  end if;
  if note is not null then
    insert into person_notes (person_id, org_id, actor_id, text, private, source)
    values (v_person, job.org_id, v_actor, note, false, 'agency');
  end if;
  insert into audit_log (org_id, actor_id, source, action, entity, entity_id, after)
  values (job.org_id, v_actor, p_source, 'application.agency_submit', 'application', v_app,
          jsonb_build_object('role_id', job.role_id, 'person_id', v_person, 'agency', 'Tacit'));

  return query select 'submitted'::text, job.org_id, v_person, v_app, v_actor;
end;
$$;

-- Where Tacit's submissions stand now: the pull report. For each client
-- application Tacit made, the job, the company and the live stage (the
-- merged-into application's, after a merge). The client half of
-- tacit_client_submissions; Tacit joins it to its own tacit_submissions.
create function public.bridge_submission_report(p_applications uuid[])
returns table (application_id uuid, org_id uuid, org_name text, company_id uuid, role_id uuid, job_title text, stage text)
language sql stable security definer set search_path = public as $$
  select a.id, o.id, o.name, o.company_id, r.id, r.title, coalesce(merged.stage, a.stage)
  from applications a
  join orgs o on o.id = a.org_id
  left join applications merged on merged.id = a.merged_into_id
  left join roles r on r.id = coalesce(merged.role_id, a.role_id)
  where a.id = any (p_applications) and o.kind = 'client'
$$;

revoke all on function public.bridge_client_jobs(uuid) from public, anon, authenticated, tacit_internal;
revoke all on function public.bridge_job_for_role(uuid, uuid, text, text, text, text) from public, anon, authenticated, tacit_internal;
revoke all on function public.bridge_submit_candidate(uuid, text, text, uuid, jsonb, text, text, text) from public, anon, authenticated, tacit_internal;
revoke all on function public.bridge_submission_report(uuid[]) from public, anon, authenticated, tacit_internal;
grant execute on function public.bridge_client_jobs(uuid) to service_role;
grant execute on function public.bridge_job_for_role(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.bridge_submit_candidate(uuid, text, text, uuid, jsonb, text, text, text) to service_role;
grant execute on function public.bridge_submission_report(uuid[]) to service_role;
