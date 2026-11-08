# Cutover: the client ATS onto tacit-ats

The checklist for moving production's client orgs from the shared `tacit` project to their own, `tacit-ats` (`docs/client-project-split.md`). **[Ryan]** marks a step only Ryan can do (Supabase projects, Vercel env, WorkOS, GitHub settings). Nothing here points a production app at `tacit-ats` or deletes anything from `tacit` until Ryan says go on the day.

Traffic is tiny, so the plan is a short write pause off-hours, not dual writes. Expected window: 30 minutes, most of it checks.

## Before the day

### Projects
1. **[Ryan]** Create `tacit-ats-staging` and `tacit-ats` in the Tacit Supabase org, us-east-1, Postgres 17. Note each ref and database password.
2. **[Ryan]** GitHub (`Tacit-Awareness/tacit-ats`, Settings → Environments): `staging` and `production`, each with variable `SUPABASE_PROJECT_REF` and secret `SUPABASE_DB_PASSWORD`; repository secret `SUPABASE_ACCESS_TOKEN` (a Supabase personal access token). The next merge to main then pushes `supabase/migrations` to staging, then production (`.github/workflows/ci.yml`). To push before a merge: `supabase link --project-ref <ref> && supabase db push` from the repo root.
3. Check each project after its first push: `select count(*) from supabase_migrations.schema_migrations` is the number of files in `supabase/migrations`, and `select name from orgs` is just Tacit.

### Sign-in: the same WorkOS issuer, so members notice nothing
4. **[Ryan]** On each project: Authentication → Sign In / Providers → Third-party auth → add **WorkOS**, with the issuer the `tacit` project trusts today (`https://api.workos.com/user_management/<client WorkOS client id>`, the environment that holds the client organizations). Copy it from `tacit`'s same page.
5. **[Ryan]** A signing key of `tacit-ats`'s own (decided 2026-11-07: `tacit`'s is Sensitive in Vercel and saved nowhere else, and a key per project fits the split). apps/mcp signs the 5-minute member token and the `tacit_internal` audit token with `SUPABASE_TACIT_SIGNING_KEY`, and it is the only app that reads it.
   - `supabase gen signing-key --algorithm ES256` makes the private JWK; its `kid` is the value for `SUPABASE_TACIT_SIGNING_KEY_ID`. Save both in the password manager before anything else: Vercel will not show them again.
   - On each project (`tacit-ats`, and staging with a key of its own if it is used): Project Settings → JWT Keys → Create standby key → Import, paste the JWK, then **Rotate** so it is the current key. Nothing signs in through Supabase Auth on these projects, so the rotation breaks nothing.
   - On `tacit`, for rollback: import the same `tacit-ats` key as a **standby** key and do not rotate. Then `https://qlqebxtjzcotiwgdnukj.supabase.co/auth/v1/.well-known/jwks.json` lists its `kid`, so apps/mcp on the new key still works against `tacit` (step 20). It goes once the 30 days are up (step 22).
   - Check: each project's `/auth/v1/.well-known/jwks.json` lists the new `kid`.
6. Check: a WorkOS access token for a test member, sent as `Authorization: Bearer` to `https://<ref>.supabase.co/rest/v1/rpc/current_actor_id` with the project's publishable key, answers (null before their org is copied, not 401).

### Staging dual run (stage 5)
7. **[Ryan]** Point a **preview** deployment of apps/web and apps/mcp (or a local `pnpm dev` with a `.env` for staging) at `tacit-ats-staging`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_POOLER_URL` (Connect → Transaction pooler, port 6543), and `TACIT_BRIDGE_SECRET` (web; any 32+ characters for staging). `SUPABASE_TACIT_SIGNING_KEY` / `_ID` on apps/mcp: the new key (step 5).
8. Copy Tacit Test Co into staging, from production `tacit` (reads only on `tacit`):
   ```
   SOURCE_DB_URL=<tacit direct URL> TARGET_DB_URL=<staging direct URL> \
   SOURCE_SUPABASE_URL=https://qlqebxtjzcotiwgdnukj.supabase.co SOURCE_SECRET_KEY=<tacit secret key> \
   TARGET_SUPABASE_URL=https://<staging ref>.supabase.co TARGET_SECRET_KEY=<staging secret key> \
   node scripts/client-track/copy-orgs.mjs ./copy-staging --orgs=ddc79886-c318-4e07-89a5-d26d147763a5 --load --storage
   ```
   It ends with "every row matches" per table, then the files and the logo. Direct URLs (Connect → Direct connection, or the session pooler on 5432), as `postgres`.
9. Against staging: `pnpm typecheck`, `pnpm test` and the full client suite. The suite runs on CI's local stack built from the same track; for staging itself, run `supabase/tests/*.sql` with `psql "<staging direct URL>" -v ON_ERROR_STOP=1 -f <file>` (each rolls back).
10. **[Ryan]** Manual member sign-in on the staging preview as Tacit Test Co's admin: `/client` loads with the copied jobs and candidates; connect Claude to the staging connector and run `whoami` (reads through `SUPABASE_POOLER_URL`), then one write (move a candidate) and see it in `audit_log` on staging.
11. Bridge on staging: set tacit-internal's `CLIENT_BRIDGE_URL` (the preview's origin) and `CLIENT_BRIDGE_SECRET` on a tacit-internal preview, submit a Tacit person to a Test Co job, and see the application on staging and the submission in tacit's `tacit_submissions`.

### Ready
12. Every client org's rows copy cleanly into staging: run step 8 without `--orgs` against staging (a full rehearsal), then empty staging again or keep it.
13. Tell the clients (a line in Slack is enough today): a few minutes off-hours where changes may not save.

## On the day

14. **[Ryan]** Pause member writes. There is no maintenance switch (the web app has none, and the connector's per-company read-only setting doesn't stop the web), so the pause is the off-hours window: check `tacit`'s `audit_log` and `mcp_calls` for the last client write, and start when nothing has landed for a few minutes. Anything written between steps 15 and 16 is caught by step 18.
15. Final copy into production `tacit-ats`, every client org:
    ```
    SOURCE_DB_URL=<tacit> TARGET_DB_URL=<tacit-ats> ... node scripts/client-track/copy-orgs.mjs ./copy-prod --load --storage
    ```
    "every row matches", or stop here (nothing has moved yet).
16. **[Ryan]** Vercel, production, **apps/web and apps/mcp both**: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_POOLER_URL` to `tacit-ats`'s; `TACIT_BRIDGE_SECRET` on apps/web. On apps/mcp also `SUPABASE_TACIT_SIGNING_KEY` / `_ID` to `tacit-ats`'s key (step 5). Redeploy both.
17. **[Ryan]** tacit-internal production: `CLIENT_BRIDGE_URL=https://ats.tacitawareness.com`, `CLIENT_BRIDGE_SECRET` (the same value), and `CLIENT_SUPABASE_URL` / `CLIENT_SUPABASE_SECRET_KEY` (tacit-ats's, for ATS Admin's org onboarding). Redeploy apps/internal and its staff connector.
18. Run step 15 once more: it catches anything written between 14 and 16, and must still say "every row matches".
19. Verify on production:
    - a member signs in at ats.tacitawareness.com and sees their jobs;
    - `whoami` on the client connector, and `tats whoami`;
    - one write (move a candidate) lands in `tacit-ats`'s `audit_log`, not `tacit`'s;
    - a public job post loads and an application with a resume lands (`/jobs/<slug>`);
    - the notify cron's next run (`/api/cron/notify`) answers 200 in Vercel's logs;
    - from tacit-internal: the sidebar's companies, a company's submissions panel, and one submission through the bridge.

## Rollback

While `tacit`'s client rows still exist (kept 30 days, step 22), rolling back is the env flip:

20. **[Ryan]** Put steps 16 and 17's old values back and redeploy, except the signing key: apps/mcp keeps `tacit-ats`'s, which `tacit` trusts as a standby key (step 5; `tacit`'s old key cannot be read back out of Vercel). Members are back on `tacit` at once; the WorkOS issuer is trusted by both.
21. Anything written on `tacit-ats` after step 16 is not on `tacit`. List it from `tacit-ats`'s `audit_log` since the flip and redo it by hand, or copy it back with `copy-orgs.mjs` the other way round (source and target swapped, `--orgs` for the companies affected): `tacit`'s schema has every column it copies except `staff_person_id` / `staff_role_id`, which it leaves out.

## After

22. 30 days after a cutover nobody rolled back: remove the `tacit-ats` standby key from `tacit` (step 5); tacit-internal drops its copies of the client orgs' rows, then the client-only tables and functions (`tacit_submit_to_client`, `tacit_client_jobs`, ... and the `tacit_internal` policy branches that only served them), in its own migration. Ryan's go-ahead first.
23. tacit-ats: drop the staff-only tables the baseline still carries (`rubrics`, `person_snapshots`, `tacit_submissions`, `enrichment_*`, ...) once the functions naming them are edited; generate this track's own types and retire `@tacit/db`'s in the apps.
24. Then the WorkOS → Supabase Auth migration lands on `tacit-ats` (the plan doc): accounts, the custom access token hook, `auth_active_org`, the OAuth server for connectors.
