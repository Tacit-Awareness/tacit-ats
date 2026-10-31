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

## Open questions for you

- Do staff need **live** visibility into client pipelines (funnel, support)
  or is a pull/report good enough? (Drives whether the bridge needs events.)
- `tacit-dev` is INACTIVE — revive it as the client staging project, or make
  a fresh one? (Staging on tacit-dev is fine; prod should be its own.)
- Do client candidates' `transcript_entries`/Granola meetings ever matter
  client-side? Today no (staff ingest) — confirms transcript stays.
- Timing: best done before Polymr/real clients accumulate data. Now is the
  cheapest this will ever be.
