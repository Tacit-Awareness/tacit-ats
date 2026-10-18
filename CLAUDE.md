# Tacit ATS

The client-facing ATS: where a client company's own team works their jobs, candidates, pipeline, interviews, offers and email inside Tacit, the Ashby / Greenhouse model. pnpm workspace monorepo, split out of `Tacit-Awareness/Tacit-Awareness` (now [`Tacit-Awareness/tacit-internal`](https://github.com/Tacit-Awareness/tacit-internal)) on 2026-10-14 with its history (`git log` reaches back to that repo's first commit, filtered to these files).

## How it relates to tacit-internal

One product, one database, two repos.

Three surfaces, named by who uses them:

| | Who | Where |
|---|---|---|
| **Workspace** | Tacit's recruiters | tacit-internal `apps/internal` (internal.tacitawareness.com) and its staff connector |
| **ATS** | a client company's hiring team, on their own token | this repo (ats.tacitawareness.com, ats-mcp) |
| **ATS Admin** | Tacit staff admins operating the ATS: create an org, invite its first admin | tacit-internal `apps/internal`'s `/admin` (service role) |

Nothing staff-only lives in this repo: no staff session, no console.

- **Same Supabase project** (`tacit`, ref `qlqebxtjzcotiwgdnukj`). Each client company is an org; Tacit is org #1. A member's every query runs as the database role `authenticated` on their own token, so RLS decides what they see.
- **tacit-internal owns the schema.** Migrations, RLS policies, the definer functions this repo calls (`invite_org_member`, `client_claim_write`, `my_interviews`, ...) and the generated types all live in its `packages/db`. A feature here that needs a schema change starts there: land the migration (its CI pushes it to production on merge), then `pnpm sync:tacit` here.
- **It also owns the shared domain logic**: the pipeline (`applications` / `application_events`, whose only writer is its `pipeline.ts`), the staff connector's email pieces, `wrapUntrusted`, and staff onboarding of a client org (its ATS Admin page `/admin/orgs` and `createClientOrg` / `inviteOrgMember`: a client org and its first admin are always created from Tacit's side).
- **`vendor/` holds those two packages as built tarballs**, `@tacit/db` and `@tacit/core`, pinned to the commit in `vendor/SOURCE` and named after it: `vendor/tacit-core-<shortsha>.tgz`, `vendor/tacit-db-<shortsha>.tgz`. `pnpm sync:tacit [path]` (default `../tacit-internal`, falling back to `../Tacit-Awareness` for a folder not yet renamed; needs a clean `packages/db` and `packages/core`) rebuilds them, deletes the old ones and rewrites every `file:` specifier (root `pnpm.overrides` and each workspace `package.json`); then `pnpm install`. The name must change with the contents: Vercel restores a cached `node_modules`, and pnpm keeps the stale package when only a tarball's contents change at the same path. Never edit them, and never copy their code here: if this repo needs something `@tacit/core` does not export, export it there first.

## Layout

```
apps/
  web/        Next.js -- the /client area members sign in to (WorkOS AuthKit)
  mcp/        Next.js -- /api/client, the MCP connector members add to Claude (OAuth)
packages/
  core/       @tacit-ats/core -- first sign-in, client invitations, the connector's tools
vendor/       @tacit/db + @tacit/core tarballs from tacit-internal, named by commit (scripts/sync-tacit.mjs)
```

See each folder's own `CLAUDE.md`.

## Hard rules

- **A member reads and writes only through their own token.** Nothing reachable from `apps/web/src/app/client` or `src/lib/client` may name a privileged client (service role, `tacit_internal`) except `lib/client/bind.ts` (first sign-in); `apps/web/src/client-area.test.ts` walks the imports. In `apps/mcp`, only `client/bind.ts`, `client/audit.ts`, `client/files.ts` and `client/calendar.ts` may, each exporting functions and never a client; `src/client-connector.test.ts` walks those imports.
- **A server action starts with `await requireClient()`.** An action is callable by id from any page, so the proxy does not cover it. The same test enforces it.
- **Interview feedback and offer terms stay private.** Feedback notes, rating notes, email subjects and bodies, filenames and source details are kept out of `audit_log` and `mcp_calls`; candidate text comes back fenced.
- **`packages/*` never depends on `apps/*`**, and `@tacit-ats/core` never reads `process.env` or builds a client at module load.

## Commands

Run from the repo root:

- `pnpm install`
- `pnpm typecheck` -- every workspace member, tests included
- `pnpm test` -- unit tests (vitest, no network or Docker)
- `pnpm test:integration` -- against the local Supabase stack, which is started from the tacit-internal checkout: `supabase start` and `supabase db reset` in its `packages/db` (Docker). `TACIT_REPO` overrides the default `../tacit-internal` (or `../Tacit-Awareness` if only that exists).
- `pnpm build` -- `@tacit-ats/core`, then both apps
- `pnpm dev` -- web on :3100, mcp on :3101
- `pnpm sync:tacit [path]` -- refresh `vendor/` from tacit-internal

## Deploy

Two Vercel projects, one per app (`apps/web`, `apps/mcp`), each with its own `vercel.json` build command. Env vars are in `.env.example`; the WorkOS redirect URI and the connector's resource URL must name these apps' own domains.

## Conventions

- Workspace members are `@tacit-ats/<folder>`.
- TS configs extend `tsconfig.base.json` and override only `outDir` / `rootDir` / `include`.
