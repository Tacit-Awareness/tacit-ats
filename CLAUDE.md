# Tacit ATS

The client-facing ATS: where a client company's own team works their jobs, candidates, pipeline, interviews, offers and email inside Tacit, the Ashby / Greenhouse model. pnpm workspace monorepo, split out of `Tacit-Awareness/Tacit-Awareness` (now [`Tacit-Awareness/tacit-internal`](https://github.com/Tacit-Awareness/tacit-internal)) on 2026-10-14 with its history (`git log` reaches back to that repo's first commit, filtered to these files).

## How it relates to tacit-internal

One product, two Supabase projects, two repos.

Three surfaces, named by who uses them:

| | Who | Where |
|---|---|---|
| **Workspace** | Tacit's recruiters | tacit-internal `apps/internal` (internal.tacitawareness.com) and its staff connector |
| **ATS** | a client company's hiring team, on their own token | this repo (ats.tacitawareness.com, ats-mcp) |
| **ATS Admin** | Tacit staff admins operating the ATS: create an org, invite its first admin | tacit-internal `apps/internal`'s `/admin` (service role) |

Nothing staff-only lives in this repo: no staff session, no console.

- **The client project is its own** (`docs/client-project-split.md`, decided 2026-11-06): client orgs moved from the shared `tacit` project (ref `qlqebxtjzcotiwgdnukj`) to their own, `tacit-ats` (ref `ornhtusfsijbukqrxkek`), so an internal-side failure cannot take the client product down. Production cut over on 2026-11-09 (`docs/client-cutover.md`). `tacit` keeps its copy of the client rows until 2026-12-09 as the rollback; never delete anything from `tacit` without Ryan's go-ahead. Each client company is an org; Tacit's own org #1 has a row on both (`tacit_org_id()`). A member's every query runs as the database role `authenticated` on their own token, so RLS decides what they see.
- **This repo owns the client schema** (`supabase/`, its own `CLAUDE.md`): migrations, RLS policies, the definer functions the apps call (`invite_org_member`, `client_claim_write`, `my_interviews`, ...). A feature that needs a schema change adds a migration there; merging pushes it to the client projects. tacit-internal's `packages/db` owns only the staff project now, and its copies of the client tables are frozen until they are dropped after the cutover.
- **The staff → client bridge** (`apps/web`'s `/api/bridge/*`, signed with `TACIT_BRIDGE_SECRET`): tacit-internal's one way into client orgs on the new project. Tacit's submissions (the submit page, `addToPipeline` at a client company, its connector's `submit_to_client` / `add_candidate`), the jobs Tacit may submit to, and the stage report. Pull only: no events flow back.
- **tacit-internal still owns the shared domain logic** in `@tacit/core` (the pipeline, `applications` / `application_events`' only writer being its `pipeline.ts`; the email pieces; `wrapUntrusted`; staff onboarding of a client org, `createClientOrg` / `inviteOrgMember`, run from its ATS Admin), and `@tacit/db`'s client factories and generated types, which still type the apps.
- **`vendor/` holds those two packages as built tarballs**, `@tacit/db` and `@tacit/core`, pinned to the commit in `vendor/SOURCE` and named after it: `vendor/tacit-core-<shortsha>.tgz`, `vendor/tacit-db-<shortsha>.tgz`. `pnpm sync:tacit [path]` (default `../tacit-internal`, falling back to `../Tacit-Awareness` for a folder not yet renamed; needs a clean `packages/db` and `packages/core`) rebuilds them, deletes the old ones and rewrites every `file:` specifier (root `pnpm.overrides` and each workspace `package.json`); then `pnpm install`. The name must change with the contents: Vercel restores a cached `node_modules`, and pnpm keeps the stale package when only a tarball's contents change at the same path. Never edit them, and never copy their code here: if this repo needs something `@tacit/core` does not export, export it there first. A sync no longer brings schema: `@tacit/db`'s types describe the staff project, a subset of this one's for client tables.

## Layout

```
apps/
  web/        Next.js -- the /client area members sign in to (WorkOS AuthKit)
  mcp/        Next.js -- /api/client, the MCP connector members add to Claude (OAuth)
  cli/        tats -- the same connector from the terminal, for coding agents and scripts
packages/
  core/       @tacit-ats/core -- first sign-in, client invitations, the connector's tools
  member-db/  @tacit-ats/member-db -- withMember: a member's own direct Postgres transaction, RLS deciding
supabase/     the client migration track: tacit-ats's schema, its SQL tests, the local stack
scripts/client-track/  the baseline's extraction, the org-scoped data copy (copy-orgs.mjs)
vendor/       @tacit/db + @tacit/core tarballs from tacit-internal, named by commit (scripts/sync-tacit.mjs)
```

See each folder's own `CLAUDE.md`.

## Hard rules

- **A member reads and writes only through their own token.** Nothing reachable from `apps/web/src/app/client` or `src/lib/client` may name a privileged client (service role, `tacit_internal`) except `lib/client/bind.ts` (first sign-in), `lib/client/bot.ts` (the signed challenge to the company's bot), `lib/client/granola-notes.ts` (a member's own Granola notes, the grant found from the row their own token reads), `lib/client/file-store.ts` (the bytes of a candidate's file, only after their own token has read or inserted its row) and `lib/client/mailbox.ts` (a member's own Gmail grant to send their email, found from the row their own token reads); `apps/web/src/client-area.test.ts` walks the imports. `apps/web/src/lib/notify/` (the interview notifier, for every company at once) uses the service role outside the client area and is never imported from it. `apps/web/src/lib/applicant-resume/store.ts` (the bytes of a resume uploaded on a public job post, only at the path `submit_job_application` answered) is the one privileged module the public pages reach, and only from `api/jobs/[slug]/apply`; `apps/web/src/lib/bridge/store.ts` (the bridge_* functions, only after a request's signature checks out) is reached only from `api/bridge/[endpoint]`; the same test pins both. In `apps/mcp`, only `client/bind.ts`, `client/audit.ts`, `client/files.ts`, `client/calendar.ts`, `client/granola.ts` and `client/mailbox.ts` may, each exporting functions and never a client; `src/client-connector.test.ts` walks those imports.
- **The pooler's connection string stays in `packages/member-db`.** `SUPABASE_POOLER_URL` can become any role, so only that package's `connection.ts` reads it, and only `withMember` uses it: every transaction is `set local role authenticated` with the member's verified claims in `request.jwt.claims`, so `auth.jwt()`, `current_actor_id()` and every policy decide as over PostgREST. Nothing in either app reads the URL, imports a Postgres driver, imports past the package's entry point or sets a role or claims itself (`client-area.test.ts`, `client-connector.test.ts`, the package's `boundary.test.ts`).
- **A server action starts with `await requireClient()`.** An action is callable by id from any page, so the proxy does not cover it. The same test enforces it.
- **Interview feedback and offer terms stay private.** Feedback notes, rating notes, email subjects and bodies, filenames and source details are kept out of `audit_log` and `mcp_calls`; candidate text comes back fenced.
- **`packages/*` never depends on `apps/*`**, and `@tacit-ats/core` never reads `process.env` or builds a client at module load.

## Testing in production

**Tacit Test Co** is a permanent client company in production for trying the client side end to end after a change merges: its admin is Ryan, its bot is his Grok bot in a test Slack. Setup, the interview notifications run, and where to look: `docs/client-sandbox.md`.

## Commands

Run from the repo root:

- `pnpm install`
- `pnpm typecheck` -- every workspace member, tests included
- `pnpm test` -- unit tests (vitest, no network or Docker)
- `pnpm test:integration` -- against this repo's local Supabase stack: `supabase start` and `supabase db reset` at the repo root (Docker). CI runs it, and `supabase/tests/*.sql`, on every PR.
- `pnpm build` -- `@tacit-ats/core`, then both apps
- `pnpm dev` -- web on :3100, mcp on :3101
- `pnpm sync:tacit [path]` -- refresh `vendor/` from tacit-internal
- `pnpm --filter @tacitawareness/tats build` -- then `node apps/cli/dist/main.js login` (`apps/cli/CLAUDE.md`)

## Deploy

Two Vercel projects, one per app (`apps/web`, `apps/mcp`), each with its own `vercel.json` build command. Env vars are in `.env.example`; the WorkOS redirect URI and the connector's resource URL must name these apps' own domains.

## Conventions

- Workspace members are `@tacit-ats/<folder>`, except `apps/cli`, published to npm as `@tacitawareness/tats` (unscoped `tats` is taken).
- TS configs extend `tsconfig.base.json` and override only `outDir` / `rootDir` / `include`.
