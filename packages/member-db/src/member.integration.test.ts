import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, test } from "vitest";

import { closeMemberPool, memberPool } from "./connection.js";
import { MemberClaimsError, withMember, type MemberClaims } from "./index.js";

/**
 * withMember against the local stack's real policies (tacit-internal's
 * migrations): one company's member reads and writes nothing of another's, an
 * interviewer sees only what the policies give them, and a transaction is
 * all-or-nothing across tables. The fixtures are written as the stack's
 * superuser on their own connection; everything under test goes through
 * withMember on SUPABASE_POOLER_URL (test/integration-setup.ts points it at the
 * local database, with prepared statements off as on the real pooler).
 */

const admin = postgres(process.env.SUPABASE_DB_URL!, { prepare: false, max: 1, onnotice: () => {} });

const ACME = "f7000000-0000-4000-8000-0000000000a1";
const GLOBEX = "f7000000-0000-4000-8000-0000000000a2";
const ADA = "f7a00000-0000-4000-8000-0000000000a1"; // Acme admin
const IVAN = "f7a00000-0000-4000-8000-0000000000a2"; // Acme interviewer
const GUS = "f7a00000-0000-4000-8000-0000000000a3"; // Globex admin
const ENGINEER = "f7b00000-0000-4000-8000-0000000000a1";
const DESIGNER = "f7b00000-0000-4000-8000-0000000000a2";
const GLOBEX_ROLE = "f7b00000-0000-4000-8000-0000000000a3";
const PAT = "f7c00000-0000-4000-8000-0000000000a1";
const PAT_APP = "f7d00000-0000-4000-8000-0000000000a1";
const ACME_TAG = "f7e00000-0000-4000-8000-0000000000a1";
const GLOBEX_TAG = "f7e00000-0000-4000-8000-0000000000a2";

const claims = (sub: string, org_id = "org_itest_mdb_acme"): MemberClaims => ({
  role: "authenticated",
  aud: "authenticated",
  iss: "tacit-client-mcp",
  sub,
  org_id,
});
const ADA_CLAIMS = claims("user_mdb_ada");
const IVAN_CLAIMS = claims("user_mdb_ivan");
const GUS_CLAIMS = claims("user_mdb_gus", "org_itest_mdb_globex");

async function clear() {
  const orgs = [ACME, GLOBEX];
  for (const table of ["interviews", "applications", "people", "tags", "departments", "roles", "companies", "audit_log", "actors"]) {
    await admin`delete from ${admin(table)} where org_id = any(${orgs})`;
  }
  await admin`delete from orgs where id = any(${orgs})`;
}

beforeEach(async () => {
  await clear();
  await admin`insert into orgs ${admin([
    { id: ACME, name: "Acme", slug: "itest-mdb-acme", kind: "client", workos_org_id: "org_itest_mdb_acme" },
    { id: GLOBEX, name: "Globex", slug: "itest-mdb-globex", kind: "client", workos_org_id: "org_itest_mdb_globex" },
  ])}`;
  await admin`insert into actors ${admin([
    { id: ADA, org_id: ACME, slug: "itest-mdb-ada", display_name: "Ada Admin", email: "ada@mdb.test", access_level: "admin", auth_subject: "user_mdb_ada" },
    { id: IVAN, org_id: ACME, slug: "itest-mdb-ivan", display_name: "Ivan Interviewer", email: "ivan@mdb.test", access_level: "limited", auth_subject: "user_mdb_ivan" },
    { id: GUS, org_id: GLOBEX, slug: "itest-mdb-gus", display_name: "Gus Globex", email: "gus@mdb.test", access_level: "admin", auth_subject: "user_mdb_gus" },
  ])}`;
  const [acmeCo] = await admin`insert into companies (org_id, name) values (${ACME}, 'Acme') returning id`;
  const [globexCo] = await admin`insert into companies (org_id, name) values (${GLOBEX}, 'Globex') returning id`;
  await admin`insert into roles ${admin([
    { id: ENGINEER, org_id: ACME, company_id: acmeCo!.id, title: "Founding Engineer", status: "open" },
    { id: DESIGNER, org_id: ACME, company_id: acmeCo!.id, title: "Designer", status: "open" },
    { id: GLOBEX_ROLE, org_id: GLOBEX, company_id: globexCo!.id, title: "Globex Secret Role", status: "open" },
  ])}`;
  await admin`insert into people (id, org_id, display_name, email) values (${PAT}, ${ACME}, 'Pat Candidate', 'pat@mdb-cand.test')`;
  await admin`insert into applications (id, org_id, person_id, role_id, stage) values (${PAT_APP}, ${ACME}, ${PAT}, ${ENGINEER}, 'screening')`;
  const soon = Date.now() + 86_400_000;
  await admin`insert into interviews (org_id, application_id, interviewer_actor_ids, starts_at, ends_at)
    values (${ACME}, ${PAT_APP}, ${[IVAN]}, ${new Date(soon)}, ${new Date(soon + 3_600_000)})`;
  await admin`insert into tags ${admin([
    { id: ACME_TAG, org_id: ACME, name: "acme-only", created_by_actor_id: ADA },
    { id: GLOBEX_TAG, org_id: GLOBEX, name: "globex-only", created_by_actor_id: GUS },
  ])}`;
});

afterAll(async () => {
  await clear();
  await admin.end();
  await closeMemberPool();
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();
const tagNames = async (org: string) => (await admin<{ name: string }[]>`select name from tags where org_id = ${org} order by name`).map((r) => r.name);

describe("the database sees the member's claims", () => {
  test("auth.jwt(), current_actor_id() and current_access_level() answer from the claims passed", async () => {
    const [who] = await withMember(ADA_CLAIMS, (sql) => sql`
      select current_user::text as role, auth.jwt() ->> 'sub' as sub, current_actor_id() as actor, current_access_level() as level`);
    expect(who).toEqual({ role: "authenticated", sub: "user_mdb_ada", actor: ADA, level: "admin" });
  });

  test("a sub at the wrong company is nobody, and reads nothing", async () => {
    const out = await withMember(claims("user_mdb_ada", "org_itest_mdb_globex"), async (sql) => ({
      who: (await sql`select current_actor_id() as actor`)[0]!.actor,
      roles: await sql`select id from roles where id = any(${[ENGINEER, GLOBEX_ROLE]})`,
    }));
    expect(out).toEqual({ who: null, roles: [] });
  });

  test("nothing is left on the connection after the transaction", async () => {
    for (let i = 0; i < 6; i++) await withMember(i % 2 ? ADA_CLAIMS : GUS_CLAIMS, (sql) => sql`select 1`);
    // Every pooled connection, as it is between transactions.
    const states = await Promise.all(
      Array.from({ length: 5 }, () => memberPool()`select current_user::text as role, coalesce(current_setting('request.jwt.claims', true), '') as claims`),
    );
    for (const [state] of states) expect(state).toEqual({ role: "postgres", claims: "" });
  });

  test("claims that are not a member's are refused before anything runs", async () => {
    const bad = [
      { role: "service_role", sub: "user_mdb_ada", org_id: "org_itest_mdb_acme" },
      { role: "authenticated", sub: "", org_id: "org_itest_mdb_acme" },
      { role: "authenticated", sub: "user_mdb_ada", org_id: 7 },
    ] as unknown as MemberClaims[];
    for (const c of bad) await expect(withMember(c, (sql) => sql`select 1`)).rejects.toBeInstanceOf(MemberClaimsError);
  });
});

describe("one company's member reaches nothing of another's", () => {
  test("reads: Acme's admin sees Acme's jobs and tags, none of Globex's, even by id", async () => {
    const out = await withMember(ADA_CLAIMS, async (sql) => ({
      roles: titles(await sql<{ title: string }[]>`select title from roles`),
      byId: await sql`select id from roles where id = ${GLOBEX_ROLE}`,
      tags: (await sql<{ name: string }[]>`select name from tags order by name`).map((t) => t.name),
      orgs: await sql`select name from orgs`,
    }));
    expect(out).toEqual({ roles: ["Designer", "Founding Engineer"], byId: [], tags: ["acme-only"], orgs: [{ name: "Acme" }] });
  });

  test("writes: Globex's admin updates and deletes nothing of Acme's, and cannot insert into it", async () => {
    const changed = await withMember(GUS_CLAIMS, async (sql) => ({
      updated: (await sql`update roles set title = 'Pwned' where id = ${ENGINEER}`).count,
      tagRenamed: (await sql`update tags set name = 'pwned' where id = ${ACME_TAG}`).count,
      deleted: (await sql`delete from roles where id = ${DESIGNER}`).count,
    }));
    expect(changed).toEqual({ updated: 0, tagRenamed: 0, deleted: 0 });

    await expect(
      withMember(GUS_CLAIMS, (sql) => sql`insert into tags (org_id, name, created_by_actor_id) values (${ACME}, 'planted', ${GUS})`),
    ).rejects.toMatchObject({ code: "42501" });

    expect(titles(await admin<{ title: string }[]>`select title from roles where org_id = ${ACME}`)).toEqual(["Designer", "Founding Engineer"]);
    expect(await tagNames(ACME)).toEqual(["acme-only"]);
  });
});

describe("an interviewer sees only what the policies allow", () => {
  test("only the job they interview for, no tags, and their own interview", async () => {
    const out = await withMember(IVAN_CLAIMS, async (sql) => ({
      level: (await sql`select current_access_level() as level`)[0]!.level,
      roles: titles(await sql<{ title: string }[]>`select title from roles`),
      tags: await sql`select id from tags`,
      interviews: (await sql`select application_id from interviews`).map((r) => r.application_id),
    }));
    expect(out).toEqual({ level: "limited", roles: ["Founding Engineer"], tags: [], interviews: [PAT_APP] });
  });

  test("and cannot write what an admin can", async () => {
    await expect(
      withMember(IVAN_CLAIMS, async (sql) => {
        const [co] = await sql`select id from companies limit 1`;
        return sql`insert into roles (org_id, company_id, title, status) values (${ACME}, ${co?.id ?? null}, 'Sneaky', 'open')`;
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|23502)$/) });
    expect((await withMember(IVAN_CLAIMS, (sql) => sql`update roles set title = 'Renamed' where id = ${ENGINEER}`)).count).toBe(0);
    expect(titles(await admin<{ title: string }[]>`select title from roles where org_id = ${ACME}`)).toEqual(["Designer", "Founding Engineer"]);
  });
});

describe("a transaction is all or nothing", () => {
  test("an error after writes to two tables leaves neither", async () => {
    await expect(
      withMember(ADA_CLAIMS, async (sql) => {
        await sql`insert into tags (org_id, name, created_by_actor_id) values (${ACME}, 'half-done', ${ADA})`;
        await sql`insert into departments (org_id, name, created_by_actor_id) values (${ACME}, 'Half Done', ${ADA})`;
        await sql`update roles set title = 'Renamed' where id = ${ENGINEER}`;
        throw new Error("changed my mind");
      }),
    ).rejects.toThrow("changed my mind");
    expect(await tagNames(ACME)).toEqual(["acme-only"]);
    expect(await admin`select name from departments where org_id = ${ACME}`).toEqual([]);
    expect(titles(await admin<{ title: string }[]>`select title from roles where org_id = ${ACME}`)).toEqual(["Designer", "Founding Engineer"]);
  });

  test("a statement the policies refuse undoes the writes before it", async () => {
    await expect(
      withMember(ADA_CLAIMS, async (sql) => {
        await sql`insert into departments (org_id, name, created_by_actor_id) values (${ACME}, 'Before', ${ADA})`;
        await sql`insert into tags (org_id, name, created_by_actor_id) values (${GLOBEX}, 'cross-org', ${ADA})`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await admin`select name from departments where org_id = ${ACME}`).toEqual([]);
    expect(await tagNames(GLOBEX)).toEqual(["globex-only"]);
  });

  test("the same writes commit together when nothing fails", async () => {
    await withMember(ADA_CLAIMS, async (sql) => {
      await sql`insert into tags (org_id, name, created_by_actor_id) values (${ACME}, 'kept', ${ADA})`;
      await sql`insert into departments (org_id, name, created_by_actor_id) values (${ACME}, 'Kept', ${ADA})`;
    });
    expect(await tagNames(ACME)).toEqual(["acme-only", "kept"]);
    expect(await admin`select name from departments where org_id = ${ACME}`).toEqual([{ name: "Kept" }]);
  });

  test("stepping out of the member's role is caught before commit, and what it wrote is undone", async () => {
    await expect(
      withMember(ADA_CLAIMS, async (sql) => {
        await sql`reset role`;
        await sql`insert into tags (org_id, name, created_by_actor_id) values (${GLOBEX}, 'escaped', ${GUS})`;
      }),
    ).rejects.toThrow(/stopped acting as the member/);
    expect(await tagNames(GLOBEX)).toEqual(["globex-only"]);
  });
});
