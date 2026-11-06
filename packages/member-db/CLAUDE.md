# @tacit-ats/member-db

A member's own **direct Postgres transaction**, with RLS deciding: testbench's ergonomics (a real transaction, plain SQL, many tables in one commit) without moving trust into app code. The database still sees the member's verified claims, exactly as it does through PostgREST, so every existing policy and definer function works unchanged.

```ts
import { withMember } from "@tacit-ats/member-db";

const jobs = await withMember(claims, async (sql) => {
  const [tag] = await sql`insert into tags (org_id, name, created_by_actor_id) values (${orgId}, ${name}, ${actorId}) returning id`;
  await sql`insert into person_tags ${sql({ person_id: personId, tag_id: tag.id })}`;
  return sql`select id, title from roles order by created_at desc`;
});
```

`memberTransaction(claims)` binds the claims once and returns the runner a request context carries (apps/mcp's `member.pg`).

## What one call does

1. Takes a connection from the pool on **`SUPABASE_POOLER_URL`**, the Supabase transaction pooler (port 6543), with prepared statements off (`prepare: false`: the pooler gives each transaction whichever server connection is free).
2. `begin`, then in one statement, as PostgREST does: `set_config('role', 'authenticated', true)` (= `set local role authenticated`), `set_config('request.jwt.claims', <claims>, true)`, and `statement_timeout` 8s (authenticated's own, which `set role` does not apply).
3. Runs your function with the transaction's tagged template (`MemberSql`, postgres.js): values are always parameters.
4. Before commit, checks `current_user` is still `authenticated` and the claims are still the member's; otherwise rolls everything back. Anything your function throws rolls back every table it wrote.

`local` settings end with the transaction, so the server connection goes back to the pool as it came.

## Claims

Pass the claims the caller **already verified**, through unchanged: `role` must be `authenticated`, `sub` is required, `org_id` is optional and a string. Today that is the member token's identity (apps/mcp's `client/session.ts`: `role`, `aud`, `iss`, `sub` = the WorkOS user, `org_id` = the WorkOS organization). After the move to Supabase Auth, the Supabase access token's claims, with `org_id` added by the token hook; the database functions take either org key, and this package needs no change.

## Rules

- **Only `connection.ts` reads the URL**, and only `member.ts` uses the pool; `index.ts` exports `withMember`, `memberTransaction`, `MemberClaimsError` and types, and `package.json`'s `exports` stops a deep import. `src/boundary.test.ts` holds this side, the apps' `client-area.test.ts` / `client-connector.test.ts` the other (no driver, no URL, no deep import, no `set role` / `request.jwt` anywhere in the apps).
- **Never `set role`, `reset role` or set `request.jwt.claims` inside a transaction.** The pre-commit check catches it for writes, but a read made after it would already have left RLS.
- **Never reads `process.env` at module load**; the pool opens on the first transaction.
- **Login role.** The pooler URL's user can `set role authenticated`. `postgres` works; a dedicated login role granted only `authenticated` (noinherit) would be tighter, and is tacit-internal's migration to write.

## Tests

`member.test.ts` (claims), `boundary.test.ts` (the imports), `member.integration.test.ts` on the local stack (`pnpm test:integration`; `test/integration-setup.ts` points `SUPABASE_POOLER_URL` at the local database): another company's rows unread and unwritable, an interviewer's view, rollback across tables, a refused statement undoing what came before, the role escape caught, and the connections clean afterwards.
