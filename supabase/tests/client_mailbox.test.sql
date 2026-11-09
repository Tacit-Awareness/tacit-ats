-- client_mailbox checks for 20261106120000_client_mailbox: a member connects
-- and disconnects only their own mailbox and never reads its refresh token or
-- the reader's place, and how an email went out (sent_via, thread_id) is set
-- once, on sending -> sent, and never changes after.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/client_mailbox.test.sql
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

create function pg_temp.expect(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', what; end if;
end $$;

-- True when the statement raises exactly this SQLSTATE.
create function pg_temp.raises(stmt text, code text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return sqlstate = code;
end $$;

grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- Fixtures: Acme with an admin and a second admin; Globex with its own admin.
insert into orgs (id, name, slug, workos_org_id) values
  ('a0000000-0000-4000-8000-00000000000a', 'Acme', 'acme-mb', 'org_acme'),
  ('b0000000-0000-4000-8000-00000000000b', 'Globex', 'globex-mb', 'org_globex');
insert into actors (id, slug, display_name, org_id, access_level, auth_subject) values
  ('a1000000-0000-4000-8000-000000000001', 'acme-admin', 'Acme Admin', 'a0000000-0000-4000-8000-00000000000a', 'admin', 'user_acme_admin'),
  ('a1000000-0000-4000-8000-000000000002', 'acme-other', 'Acme Other', 'a0000000-0000-4000-8000-00000000000a', 'admin', 'user_acme_other'),
  ('b1000000-0000-4000-8000-000000000001', 'globex-admin', 'Globex Admin', 'b0000000-0000-4000-8000-00000000000b', 'admin', 'user_globex');
select pg_temp.as_service();
insert into people (id, org_id, display_name, email) values
  ('ac200000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'Ada Acme', 'ada@example.com');
reset role;

-- 1. A member connects their own mailbox, and reads it back without the token.
select pg_temp.as_member('user_acme_admin', 'org_acme');
select public.client_connect_mailbox('google', ' Admin@Acme.test ', 'rt_admin', 'https://www.googleapis.com/auth/gmail.send');
select pg_temp.expect((select count(*) from mailbox_connections) = 1, 'a member reads their own connection');
select pg_temp.expect((select account_email from mailbox_connections) = 'admin@acme.test', 'the account is stored lower case and trimmed');
select pg_temp.expect(pg_temp.raises($q$select refresh_token from mailbox_connections$q$, '42501'), 'but never the refresh token');
select pg_temp.expect(pg_temp.raises(
  $q$insert into mailbox_connections (actor_id, org_id, account_email, refresh_token) values
     ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 'x@acme.test', 'rt')$q$, '42501'),
  'and writes no row directly, not even for a colleague');
select pg_temp.expect(pg_temp.raises($q$update mailbox_connections set account_email = 'y@acme.test'$q$, '42501'), 'or changes one');
select pg_temp.expect(pg_temp.raises($q$select public.client_connect_mailbox('microsoft', 'a@acme.test', 'rt', '')$q$, '22023'),
  'only Gmail can be connected');
select pg_temp.expect(pg_temp.raises($q$select public.client_connect_mailbox('google', 'a@acme.test', '  ', '')$q$, '22023'),
  'a grant needs a refresh token');

-- 2. Nobody else reads it.
select pg_temp.as_member('user_acme_other', 'org_acme');
select pg_temp.expect((select count(*) from mailbox_connections) = 0, 'a colleague, even an admin, reads none of it');
select public.client_connect_mailbox('google', 'other@acme.test', 'rt_other', '');
select pg_temp.expect(public.client_disconnect_mailbox(), 'disconnecting their own says there was one');
select pg_temp.expect(not public.client_disconnect_mailbox(), 'and then that there is none');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from mailbox_connections) = 0, 'another company reads none of it');
reset role;
select pg_temp.expect((select count(*) from mailbox_connections) = 1
  and (select refresh_token from mailbox_connections where actor_id = 'a1000000-0000-4000-8000-000000000001') = 'rt_admin',
  'the colleague''s disconnect touched only their own');

-- 3. Reconnecting replaces the grant and starts the sync over.
select pg_temp.as_service();
insert into mailbox_sync_state (actor_id, org_id, history_id) values ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', '12345');
reset role;
select pg_temp.as_member('user_acme_admin', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select * from mailbox_sync_state$q$, '42501'), 'a member reads no sync place, not even their own');
select public.client_connect_mailbox('google', 'admin@acme.test', 'rt_admin_2',
  'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly');
reset role;
select pg_temp.expect((select refresh_token = 'rt_admin_2' and scopes like '%gmail.readonly%'
  from mailbox_connections where actor_id = 'a1000000-0000-4000-8000-000000000001'),
  'a reconnect replaces the token and scopes');
select pg_temp.expect(not exists (select 1 from mailbox_sync_state where actor_id = 'a1000000-0000-4000-8000-000000000001'),
  'and starts the sync over');

-- 3b. A company's Google Workspace: an admin, for their own address's domain only.
update actors set email = 'admin@acme.test' where id = 'a1000000-0000-4000-8000-000000000001';
update actors set email = 'other@acme.test', access_level = 'elevated' where id = 'a1000000-0000-4000-8000-000000000002';
select pg_temp.as_member('user_acme_other', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select public.client_connect_workspace('acme.test')$q$, '42501'), 'only an admin connects the Workspace');
select pg_temp.as_member('user_acme_admin', 'org_acme');
select pg_temp.expect(pg_temp.raises($q$select public.client_connect_workspace('globex.test')$q$, '22023'), 'and only their own address''s domain');
select pg_temp.expect(pg_temp.raises(
  $q$insert into google_workspace_connections (org_id, domain) values ('a0000000-0000-4000-8000-00000000000a', 'acme.test')$q$, '42501'),
  'never by writing the row');
select public.client_connect_workspace(' ACME.test ');
select pg_temp.as_member('user_acme_other', 'org_acme');
select pg_temp.expect((select domain from google_workspace_connections) = 'acme.test', 'every member reads it');
select pg_temp.expect(pg_temp.raises($q$select public.client_disconnect_workspace()$q$, '42501'), 'only an admin disconnects it');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from google_workspace_connections) = 0, 'another company reads none of it');

-- 3c. Each member's own sync switch.
select pg_temp.as_member('user_acme_other', 'org_acme');
select public.client_set_mailbox_sync(false);
select public.client_set_mailbox_sync(false);
select pg_temp.expect((select count(*) from mailbox_sync_optouts) = 1, 'a member turns their own sync off, once');
select pg_temp.expect(pg_temp.raises(
  $q$insert into mailbox_sync_optouts (actor_id, org_id) values ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a')$q$, '42501'),
  'and never someone else''s');
select pg_temp.as_member('user_acme_admin', 'org_acme');
select pg_temp.expect((select count(*) from mailbox_sync_optouts) = 0, 'nobody else reads it');
select pg_temp.as_member('user_acme_other', 'org_acme');
select public.client_set_mailbox_sync(true);
select pg_temp.expect((select count(*) from mailbox_sync_optouts) = 0, 'and turns it back on');
reset role;

-- 3d. Synced mail: written by the service role, read where the candidate is, never by an interviewer.
insert into actors (id, slug, display_name, org_id, access_level, auth_subject) values
  ('a1000000-0000-4000-8000-000000000003', 'acme-int-mb', 'Acme Interviewer', 'a0000000-0000-4000-8000-00000000000a', 'limited', 'user_acme_int_mb');
select pg_temp.as_service();
insert into candidate_mail (person_id, actor_id, direction, from_email, to_emails, subject, body, provider_id, sent_at) values
  ('ac200000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'in', 'ada@example.com', '{admin@acme.test}', 'Re: hi', 'Tuesday', 'gmail:x:1', now());
select pg_temp.expect((select org_id = 'a0000000-0000-4000-8000-00000000000a' from candidate_mail where provider_id = 'gmail:x:1'), 'synced mail lands in the candidate''s company');
reset role;
select pg_temp.as_member('user_acme_admin', 'org_acme');
select pg_temp.expect((select count(*) from candidate_mail) = 1, 'an admin reads it on the candidate');
select pg_temp.expect(pg_temp.raises(
  $q$insert into candidate_mail (person_id, direction, from_email, provider_id, sent_at) values ('ac200000-0000-4000-8000-000000000001', 'in', 'x@y.test', 'p', now())$q$, '42501'),
  'and writes none');
select pg_temp.as_member('user_acme_int_mb', 'org_acme');
select pg_temp.expect((select count(*) from candidate_mail) = 0, 'an interviewer reads none');
select pg_temp.as_member('user_globex', 'org_globex');
select pg_temp.expect((select count(*) from candidate_mail) = 0, 'another company reads none');
reset role;
select pg_temp.expect('candidate_mail.person_id' = any (public.client_merge_person_fks()), 'a merge and an erasure know it');
update people set anonymized_at = now() where id = 'ac200000-0000-4000-8000-000000000001';
select pg_temp.expect(not exists (select 1 from candidate_mail where provider_id = 'gmail:x:1'), 'erasing the candidate deletes their synced mail');
update people set anonymized_at = null where id = 'ac200000-0000-4000-8000-000000000001';

-- 4. How an email went out is set once, on sending -> sent.
select pg_temp.as_member('user_acme_admin', 'org_acme');
insert into candidate_emails (id, person_id, to_email, subject, body, sent_via, thread_id) values
  ('ae200000-0000-4000-8000-000000000001', 'ac200000-0000-4000-8000-000000000001', 'ada@example.com', 'Hi', 'Hello', 'gmail', 'forged');
select pg_temp.expect((select sent_via is null and thread_id is null from candidate_emails where id = 'ae200000-0000-4000-8000-000000000001'),
  'a draft carries no way it went out');
update candidate_emails set sent_via = 'gmail', thread_id = 'early' where id = 'ae200000-0000-4000-8000-000000000001';
select pg_temp.expect((select sent_via is null and thread_id is null from candidate_emails where id = 'ae200000-0000-4000-8000-000000000001'),
  'nor does a draft take one');
update candidate_emails set status = 'sending', thread_id = 'early' where id = 'ae200000-0000-4000-8000-000000000001';
select pg_temp.expect((select thread_id is null from candidate_emails where id = 'ae200000-0000-4000-8000-000000000001'),
  'nor does sending');
select pg_temp.expect(pg_temp.raises(
  $q$update candidate_emails set status = 'sent', provider_id = 'm1', sent_via = 'resend', thread_id = 't1' where id = 'ae200000-0000-4000-8000-000000000001'$q$, '22023'),
  'only an email sent through Gmail has a thread');
select pg_temp.expect(pg_temp.raises(
  $q$update candidate_emails set status = 'sent', provider_id = 'm1', sent_via = 'carrier pigeon' where id = 'ae200000-0000-4000-8000-000000000001'$q$, '23514'),
  'and it went out through Resend or Gmail');
update candidate_emails set status = 'sent', provider_id = 'gm_1', sent_via = 'gmail', thread_id = 'th_1' where id = 'ae200000-0000-4000-8000-000000000001';
select pg_temp.expect((select sent_via = 'gmail' and thread_id = 'th_1' and provider_id = 'gm_1'
  from candidate_emails where id = 'ae200000-0000-4000-8000-000000000001'), 'the sender records it on sending -> sent');
update candidate_emails set thread_id = 'someone-elses-thread', sent_via = 'resend' where id = 'ae200000-0000-4000-8000-000000000001';
select pg_temp.expect((select sent_via = 'gmail' and thread_id = 'th_1' from candidate_emails where id = 'ae200000-0000-4000-8000-000000000001'),
  'and it never changes after');
reset role;

-- 5. A member who leaves takes their grant with them.
delete from actors where id = 'a1000000-0000-4000-8000-000000000001';
select pg_temp.expect(not exists (select 1 from mailbox_connections where actor_id = 'a1000000-0000-4000-8000-000000000001'),
  'no grant outlives its member');

select 'client mailbox: all checks passed';
rollback;
