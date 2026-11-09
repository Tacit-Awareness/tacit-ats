# Splitting the client ATS onto its own Supabase project

Goal (Ryan, 2026-10-30): an internal-side failure must not take down the
client product. Today's outage was exactly that: one wedged GoTrue killed
the staff workspace, the client ATS and the connector at once. Client auth
is WorkOS — a new project trusts the same issuer and members never notice.

## What moves (client project, new: `tacit-ats`)

Tables — the whole client footprint, including the shared-looking ones:
`orgs`, `org_members`, `org_pending_invites`, `departments`, `companies`,
`actors` **(client members only)**, `roles`, `job_posts`, `job_post_views`,
`applications`, `application_events`, `interviews`, `offers`, approvals,
`rejection_reasons`, scorecards/attributes/ratings, `candidate_emails`,
`email_templates`, `person_notes`, `person_files`, `person_identifiers`
(client-candidate identifiers only), `people` **(client-candidate subset)**,
tags, talent pools/prospects, custom fields, `scheduling_prefs`,
`interviewer_profiles`, `home_targets`, `calendar_connections`/`granola`,
`agent_destinations`, `notify_events`/`deliveries`,
`interview_agent_threads`, `bot_tasks`, `bot_task_commands`,
`audit_log` (member actions), `mcp_calls`.

Definer functions — port the client set verbatim:
`current_actor_id`, `current_org_id`, `current_access_level`,
`can_on_role`, `can_read_application`, `can_edit_application`,
`can_see_role`, `can_see_feedback`, `application_role`,
`my_interview_candidates`, `my_interviews`,
`invite_org_member`, `withdraw_org_invite`, `org_pending_invites`,
`client_claim_write`, `client_finish_write`, `set_org_member_access`,
`job_board_public`, `job_post_page`, `submit_job_application`,
`record_job_post_view`, `bot_task_command`, the bot-report upsert.

Dies in the move: every `tacit_internal` policy branch (staff access to the
client project is a service-role/API concern, not a database role), the
staff-only tables (`transcript_entries`, `person_facts`, `identity_links`,
rolodex, `slack_cards`, funnel, club_links, invite_prefills, enrichment).

## What stays (staff project, existing `tacit`)

Everything Tacit-internal: the `people` master graph, ingest, engine,
enrichment, Slack cards, funnel/submission tracking, staff actors.

## The bridge — one direction, three endpoints

All staff → client, signed HMAC like `agent-webhook`, idempotent by key,
audited client-side with source `staff`.

1. `POST /api/bridge/submit-candidate` — the only write that matters today.
   Person (client-side subset fields) + application + optional events/notes.
   Today `addCandidateToRole` writes this on shared tables; it becomes a
   bridge call. Client side creates/links its own `people` row (email-keyed
   dedup, same rule as `addCandidate`) and stamps `staff_person_id`.
2. `POST /api/bridge/candidate-update` (phase 2) — staff-side merges /
   enrichment updates propagate to already-submitted people.
3. `GET  /api/bridge/report` — read-only staff-side pull for funnel /
   submission analytics (aggregates, not row sync). The `tacit_internal`
   debug view becomes "query the client project with a service key from
   internal's admin page", or this.

## Code moves

- `pipeline.ts` (the only writer of applications) moves to `@tacit-ats/core`
  for client orgs — the vendor tarball dependency mostly evaporates for
  client code. Staff keeps its copy for staff-only paths.
- Client migrations get their own track/source of truth — either this repo
  or a `packages/db-client` in tacit-internal. `sync:tacit` shrinks to the
  shared-auth/org-bootstrap surface or goes away.

## Migration + cutover (staged on `tacit-dev` first)

1. New Supabase project `tacit-ats` (us-east-1). Configure third-party auth:
   the same WorkOS JWKS/issuer — members' existing tokens just work.
2. Schema: extract client migrations into the new track, apply, regenerate
   types for a new vendored `@tacit/db`-client.
3. Data: org-scoped copy of the moving tables (~6 orgs, small today).
   `people`/`person_identifiers`: copy only rows reachable from client
   applications/tags/notes; stamp `staff_person_id` for the link.
4. Dual-run: point `TACIT_REPO`-overridable env at tacit-dev, run
   typecheck + the full client suite + a manual member sign-in.
5. Cutover: pause member writes briefly (maintenance flag or just off-hours —
   traffic is tiny), final delta copy, flip `SUPABASE_*` in Vercel for
   apps/web + apps/mcp, verify `whoami` + sign-in + a write.
6. Rollback: env flip back while old tables still exist; keep them 30 days.
7. Later: drop client tables from the staff project once the bridge proves out.

## Decisions (Ryan, 2026-11-06)

- **Staff visibility: a pull report is enough.** The bridge has read endpoints
  (`jobs`, `report`) and no event stream back to tacit.
- **Staging: a fresh project**, `tacit-ats-staging`, not `tacit-dev`.
- **Client candidates' transcripts matter client-side.** `transcript_entries`
  stays in the client track and its client orgs' rows are copied. Carrying
  new ones from staff ingest is the bridge's phase 2 (`candidate-update`).
- **The client migration track lives in this repo** (`supabase/`), not a
  `packages/db-client` in tacit-internal.
- The split comes before the WorkOS -> Supabase Auth move, which then lands
  on `tacit-ats` (accounts, the access token hook, `auth_active_org`, the
  OAuth server). `orgs` and `actors` stay on `tacit-ats` as the company
  directory testbench syncs from.

## Where it stands

1. **Track**: `supabase/` (its `CLAUDE.md`). The baseline is tacit-internal
   at `26e0685` minus 30 staff-only tables, 4 views and 28 functions, identical
   object by object for everything kept; the five SQL suites and the full
   client integration suite (742 tests) pass on it, and CI now runs both.
2. **Project**: `tacit-ats` (ref `ornhtusfsijbukqrxkek`, us-east-2), with its own signing key; WorkOS stays the third-party issuer. `tacit-ats-staging` exists but is unconfigured: the rehearsal ran on `tacit-ats` before anything pointed at it.
3. **Copy**: `scripts/client-track/copy-orgs.mjs`, rehearsed locally from a
   seeded tacit stack (Tacit Test Co, 20 tables, a file and a logo): every row
   matches, a second run replaces the first, a member token reads the rows.
4. **Bridge**: `apps/web`'s `/api/bridge/{jobs,job-for-role,submit-candidate,report}`
   and the `bridge_*` functions. Differences from the plan above: all four are
   signed POSTs (the report takes the application ids Tacit holds), and the
   client's audit rows keep the caller's source (`dashboard` / `claude`, as
   today) rather than a new `staff`, which `audit_log`'s check and the pages'
   labels don't know. `tacit_submit_application`'s auto-submit on every add to
   a Tacit role at a client company is covered too (`job-for-role`, then
   `submit-candidate` with the stage). The staff side is tacit-internal's.
5. **Rehearsal** (2026-11-08, on `tacit-ats`): Test Co copied, the SQL suites and a member token checked there.
6. **Cutover: done 2026-11-09.** All 8 client orgs copied, every row matching; web, mcp and tacit-internal's apps switched; a member sign-in, a write, the connector, a job post and the bridge checked on production. Next: the 30-day cleanup on `tacit` (`docs/client-cutover.md` step 22), from 2026-12-09.
