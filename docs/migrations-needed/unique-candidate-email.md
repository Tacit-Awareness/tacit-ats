# Migration needed: one person per email per company

**Owner:** tacit-internal `packages/db` (this repo never edits the schema).
**Why:** the production stress test added the same email to the same job in
parallel and got duplicate people, two from a race of two and four from a burst
of eight, each with its own application. Most of the duplicates had no email
row in `person_identifiers`, so later email dedupe could not find them.

## What the database does today

- `people.email` has no unique constraint. The client paths look the address
  up and then insert, as two separate PostgREST requests on the member's token,
  so concurrent adds all miss the lookup and all insert.
- `people_attach_identifiers_ins` (`tacit_attach_person_identifiers`, last
  re-created in `20261012230000_per_org_identifiers`) indexes the new row's
  email with `on conflict (org_id, kind, value) do nothing`. The first row gets
  the identifier and the others are left with none. That is why most of the
  duplicates had no identifier.
- `connector_add_person` and `submit_job_application` already serialise on
  `pg_advisory_xact_lock(hashtextextended('connector-person-email:' || org_id || ':' || email, 0))`.
  The client token paths (`add_candidate`, `add_prospect`, and the web's
  referrals, which go through `add_candidate`) have no equivalent, because
  there is no definer function for them to call.

## What this repo already does (branch `fix/parallel-duplicate-candidates`)

`packages/core/src/client-tools/people.ts` (`findOrAddPerson`) is now the only
find-or-create path in this repo:

- One normalisation, `normalizeEmail` (trim, then lowercase). It matches
  `normalizeIdentifier` and the trigger.
- The lookup checks the identifier first. If that finds nothing it checks
  `people.email` (case-insensitive, oldest row first), so a row that lost the
  identifier race is still found.
- After an insert it calls `client_add_contact` so the email identifier always
  gets written. If someone else already owns the identifier, this add lost the
  race: it reuses the owner and deletes its own new row (only admins may delete,
  so for other members the row stays behind with no application, ready for
  `client_merge_candidates`).
- On a `23505` from the people insert it re-reads and reuses the winner. Today
  nothing raises that error. It is written for the constraint below.

The code-side fix makes duplicates much rarer, but it cannot get rid of them
completely: two requests can each finish their lookup before either inserts.
Only a lock or a constraint inside the database closes that gap.

## Step 1: merge the duplicates that already exist

Run this first, or Step 3 fails on the existing duplicates. Report:

```sql
-- Live (unmerged, not anonymised) people sharing one normalised email in a client org.
select org_id,
       lower(regexp_replace(email, '^\s+|\s+$', '', 'g')) as email_key,
       count(*)                                        as n,
       array_agg(id order by created_at)               as ids
from public.people
where email is not null and btrim(email) <> ''
  and merged_into_id is null and anonymized_at is null
  and org_id <> public.tacit_org_id()        -- see "Tacit's own org" below
group by 1, 2
having count(*) > 1
order by n desc;
```

Merge each group into one keeper. The keeper is the row that owns the email
identifier, or the oldest row if none does. Use `client_merge_candidates`: it
already merges applications to the same job (keeping the more advanced one),
moves interviews, notes, files and so on, and soft-merges the loser through
`merged_into_id`. It checks `current_actor_id()` / `current_access_level()`,
both of which read `auth.jwt()`, so the block runs each merge as one of that
org's admins:

```sql
do $$
declare
  g record;
  dup uuid;
  keeper uuid;
  admin record;
begin
  for g in
    select org_id,
           lower(regexp_replace(email, '^\s+|\s+$', '', 'g')) as email_key,
           array_agg(id order by created_at) as ids
    from public.people
    where email is not null and btrim(email) <> ''
      and merged_into_id is null and anonymized_at is null
      and org_id <> public.tacit_org_id()
    group by 1, 2
    having count(*) > 1
  loop
    select pi.person_id into keeper
    from public.person_identifiers pi
    where pi.org_id = g.org_id and pi.kind = 'email' and pi.value = g.email_key
      and pi.person_id = any (g.ids);
    keeper := coalesce(keeper, g.ids[1]);

    select a.auth_subject, o.workos_org_id into admin
    from public.actors a join public.orgs o on o.id = a.org_id
    where a.org_id = g.org_id and a.access_level = 'admin' and a.archived_at is null
    order by a.created_at
    limit 1;
    if admin is null then
      raise notice 'org % has no admin; merge % by hand', g.org_id, g.ids;
      continue;
    end if;
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', admin.auth_subject, 'org_id', admin.workos_org_id, 'role', 'authenticated')::text,
      true);

    foreach dup in array g.ids loop
      continue when dup = keeper;
      perform public.client_merge_candidates(keeper, dup);
    end loop;

    -- The keeper gets the identifier the trigger skipped.
    insert into public.person_identifiers (person_id, org_id, kind, value)
    values (keeper, g.org_id, 'email', g.email_key)
    on conflict (org_id, kind, value) do nothing;
  end loop;
end;
$$;
```

Check the report query returns no rows before you go on. If
`client_merge_candidates` raises `merge does not know ...`, a new foreign key to
`people` was added since that function was written: add it to
`client_merge_person_fks` first, as its own error asks.

## Step 2: a find-or-add definer for client members, under the existing lock

This closes the race completely for every client writer, and it is the change
that matters most. Same lock key as `connector_add_person` and
`submit_job_application`, so all three serialise against each other:

```sql
create function public.client_find_or_add_person(
  p_name text,
  p_email text,
  p_linkedin_url text default null,
  p_prospect_source text default null,
  p_prospect_source_detail text default null
)
returns table (person_id uuid, created boolean)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  my_org uuid := current_org_id();
  me uuid := current_actor_id();
  v_email text := nullif(lower(regexp_replace(coalesce(p_email, ''), '^\s+|\s+$', '', 'g')), '');
  found uuid;
  new_id uuid := gen_random_uuid();
begin
  if my_org is null or me is null or not (select can_add_people()) then
    raise exception 'you cannot add people' using errcode = '42501';
  end if;
  if v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended('connector-person-email:' || my_org || ':' || v_email, 0));
    select pi.person_id into found
    from person_identifiers pi
    join people p on p.id = pi.person_id and p.merged_into_id is null
    where pi.org_id = my_org and pi.kind = 'email' and pi.value = v_email;
    if found is null then
      select p.id into found
      from people p
      where p.org_id = my_org and p.merged_into_id is null and p.anonymized_at is null
        and lower(regexp_replace(p.email, '^\s+|\s+$', '', 'g')) = v_email
      order by p.created_at
      limit 1;
    end if;
    if found is not null then
      return query select found, false;
      return;
    end if;
  end if;
  -- people_attach_identifiers_ins indexes the address; under the lock nobody else holds it.
  insert into people (id, org_id, display_name, email, linkedin_url, added_by_actor_id,
                      prospect_source, prospect_source_detail)
  values (new_id, my_org, p_name, v_email, p_linkedin_url, me, p_prospect_source, p_prospect_source_detail);
  return query select new_id, true;
end;
$$;

revoke all on function public.client_find_or_add_person(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.client_find_or_add_person(text, text, text, text, text) to authenticated;
```

A product decision to make before it lands: as written, the function returns
the existing person **even when the calling member cannot see them** (for
example, someone who is only in another team's job). The member then adds them
to their own job and can see them from then on. That is the Ashby / Greenhouse
behaviour, one person per email per company. Today's code deliberately makes a
second row instead, so that the add does not reveal who is in other pipelines.
If you want to keep that, have the function raise
`using errcode = '23505'` when `found` is not `can_read_person(found)`.
`findOrAddPerson` then turns that into "Someone with that email is already in
your company's records, somewhere you can't see. Ask an admin to add them."

Once this function ships, run `pnpm sync:tacit` here and replace the body of
`findOrAddPerson` (lookup, insert, `claimEmail`) with one
`db.rpc("client_find_or_add_person", ...)`. Keep the 23505 path.

## Step 3: a constraint as the backstop for every writer

Even with Step 2 in place, a constraint stops any other writer (a script, a
future path, the staff console) from forking a person. The constraint has to
be **deferrable**: both `client_merge_candidates` and `merge_people` copy the
loser's email onto the keeper *before* they mark the loser merged or delete it,
so a check on every statement would fail partway through a merge. A unique
index cannot be deferred, but a unique constraint can, so the key goes in a
generated column:

```sql
alter table public.people
  add column email_key text generated always as (
    case
      when merged_into_id is null and anonymized_at is null
       and org_id <> '7ac17000-0000-4000-8000-000000000001'::uuid  -- Tacit's own org, see below
      then nullif(lower(regexp_replace(email, '^\s+|\s+$', '', 'g')), '')
    end
  ) stored;

alter table public.people
  add constraint people_org_email_key unique (org_id, email_key)
  deferrable initially deferred;

comment on constraint people_org_email_key on public.people is
  'One live person per normalised email per client org. Deferred so a merge can copy the email onto the keeper before it retires the duplicate.';
```

(`tacit_org_id()` is not immutable, so it cannot go in a generated column, and
the uuid above is `TACIT_ORG_ID` from `@tacit/db`.) NULLs never conflict, so
rows with no email, merged rows and anonymised rows are all exempt.

Because the constraint is deferred, a duplicate insert fails at commit with
`23505`. PostgREST commits each request on its own, so the people insert in
`findOrAddPerson` gets that `23505` back and re-reads, which is the path this
branch adds and tests. `on conflict` cannot name a deferrable constraint as its
arbiter, but no writer of `people` uses `on conflict` on the email.

Adding a stored generated column rewrites `people` and takes an
`ACCESS EXCLUSIVE` lock for as long as the rewrite runs. Run it when traffic is
low, or split it into: add a plain column, backfill it in batches, fill it with
a trigger from then on, and add the constraint `not valid` and then validate it.
The single statement above is fine at today's table size.

### Tacit's own org

Tacit's `/apply` path (the anon insert, `rotate_portal_token` /
`google_portal_token` picking `order by created_at desc`, and
`20260911040000_merge_newest_portal_token`) still creates a new people row for
each application and lets the merge daemon fold them together later. A
constraint covering Tacit's org would break that path, so the generated column
leaves Tacit's org out. Remove the `org_id <>` clause once `/apply` finds or
adds under the lock as `submit_job_application` does.

## Order

1. Step 1 (merge existing duplicates). Re-run its report query until it returns
   no rows.
2. Step 2 (`client_find_or_add_person`) and Step 3 (the constraint), in one
   migration or two.
3. `pnpm sync:tacit` in this repo, then switch `findOrAddPerson` over to the
   RPC.
4. Run the stress test again (eight parallel adds of one email to one job). It
   should leave one person, one application and one email identifier.
