import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { readGranolaNotes } from "./granola-notes";
import { readInterviews, type Member } from "./interviews";

/**
 * The Interviews reader's Granola path against the local stack, on members'
 * own tokens, with Granola's server faked as fetch. The point is who decides:
 * granola_connections' policy shows a member only their own row, and the
 * service role is asked only about that row, so nobody reaches another's
 * grant, inside their company or out of it.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e1000000-0000-4000-8000-0000000000a1";
const GLOBEX = "e2000000-0000-4000-8000-0000000000a2";
const ADA = "e1a00000-0000-4000-8000-0000000000a1";
const BEN = "e1a00000-0000-4000-8000-0000000000a2";
const IVY = "e1a00000-0000-4000-8000-0000000000a3";
const GUS = "e2a00000-0000-4000-8000-0000000000a1";
const JOB = "e1b00000-0000-4000-8000-0000000000a1";
const GLOBEX_JOB = "e2b00000-0000-4000-8000-0000000000a1";
const PERSON = "e1c00000-0000-4000-8000-0000000000a1";
const GLOBEX_PERSON = "e2c00000-0000-4000-8000-0000000000a1";
const APP = "e1d00000-0000-4000-8000-0000000000a1";
const GLOBEX_APP = "e2d00000-0000-4000-8000-0000000000a1";
const PAST = "e1e00000-0000-4000-8000-0000000000a1";
const COMING = "e1e00000-0000-4000-8000-0000000000a2";
const GLOBEX_IV = "e2e00000-0000-4000-8000-0000000000a1";
const NOTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["granola_connections", "application_events", "interviews", "applications", "people", "roles", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const client = (subject: string, workosOrgId: string) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const ACME_WORKOS = "org_itest_granola_acme";
const GLOBEX_WORKOS = "org_itest_granola_globex";
const ada = { db: client("user_gr_ada", ACME_WORKOS), accessLevel: "admin" as const };
const ben = { db: client("user_gr_ben", ACME_WORKOS), accessLevel: "elevated" as const };
const ivy = { db: client("user_gr_ivy", ACME_WORKOS), accessLevel: "limited" as const };
const gus = { db: client("user_gr_gus", GLOBEX_WORKOS), accessLevel: "admin" as const };

const H = 3_600_000;
const at = (h: number) => new Date(Date.now() + h * H).toISOString();
const grant = (actor: string, org: string, token: string) => ({
  actor_id: actor, org_id: org, oauth_client_id: "client", refresh_token: `rt_${token}`, access_token: `at_${token}`, access_token_expires_at: at(5),
});

/** Granola's MCP server: remembers whose token asked, and answers with that token's own note. */
function granola() {
  const tokens: string[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    const token = new Headers(init?.headers).get("authorization") ?? "";
    tokens.push(token);
    const msg = JSON.parse(init!.body as string) as { id?: number; method: string; params: { name: string } };
    if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (msg.method === "initialize") return Response.json({ jsonrpc: "2.0", id: msg.id, result: {} });
    return Response.json({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `notes for ${token}` }] } });
  }) as unknown as typeof fetch;
  return { fetchImpl, tokens };
}

const read = (member: Parameters<typeof readGranolaNotes>[0], fetchImpl: typeof fetch, interviewId = PAST) =>
  readGranolaNotes(member, { interviewId, noteId: NOTE, includeTranscript: false }, fetchImpl);

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-granola-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-granola-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADA, org_id: ACME, slug: "itest-gr-ada", display_name: "Ada Admin", email: "ada@gr.test", access_level: "admin", auth_subject: "user_gr_ada" },
    { id: BEN, org_id: ACME, slug: "itest-gr-ben", display_name: "Ben Builder", email: "ben@gr.test", access_level: "elevated", auth_subject: "user_gr_ben" },
    { id: IVY, org_id: ACME, slug: "itest-gr-ivy", display_name: "Ivy Interviewer", email: "ivy@gr.test", access_level: "limited", auth_subject: "user_gr_ivy" },
    { id: GUS, org_id: GLOBEX, slug: "itest-gr-gus", display_name: "Gus Globex", email: "gus@gr.test", access_level: "admin", auth_subject: "user_gr_gus" },
  ]));
  for (const [org, name, role] of [[ACME, "Acme", JOB], [GLOBEX, "Globex", GLOBEX_JOB]] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert({ id: role, org_id: org, company_id: company!.id, title: `${name} role`, status: "open" }));
  }
  must(await db().from("people").insert([
    { id: PERSON, org_id: ACME, display_name: "Pat Candidate", email: "pat@gr.test" },
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@gr.test" },
  ]));
  must(await db().from("applications").insert([
    { id: APP, org_id: ACME, person_id: PERSON, role_id: JOB, stage: "interviewing" },
    { id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_JOB, stage: "interviewing" },
  ]));
  must(await db().from("interviews").insert([
    { id: PAST, org_id: ACME, application_id: APP, starts_at: at(-26), ends_at: at(-25), status: "done", step: "Screen", interviewer_actor_ids: [BEN, IVY] },
    { id: COMING, org_id: ACME, application_id: APP, starts_at: at(24), ends_at: at(25), status: "scheduled", step: "Onsite", interviewer_actor_ids: [BEN] },
    { id: GLOBEX_IV, org_id: GLOBEX, application_id: GLOBEX_APP, starts_at: at(-5), ends_at: at(-4), status: "done", step: "Screen", interviewer_actor_ids: [GUS] },
  ]));
  must(await db().from("granola_connections").insert([grant(BEN, ACME, "ben"), grant(IVY, ACME, "ivy"), grant(ADA, ACME, "ada"), grant(GUS, GLOBEX, "gus")]));
});

afterAll(clear);

describe("a member's Granola notes on their own token", () => {
  test("the member's token reads only its own row, and never a token", async () => {
    const { data } = must(await ben.db.from("granola_connections").select("actor_id, org_id"));
    expect(data).toEqual([{ actor_id: BEN, org_id: ACME }]);
    const { error } = await ben.db.from("granola_connections").select("refresh_token");
    expect(error).not.toBeNull();
  });

  test("two interviewers on one interview each read through their own grant", async () => {
    const forBen = granola();
    expect(await read(ben, forBen.fetchImpl)).toMatchObject({ status: "found", notes: "notes for Bearer at_ben" });
    expect(new Set(forBen.tokens)).toEqual(new Set(["Bearer at_ben"]));

    // `limited` reads no application: the candidate comes from my_interviews().
    const forIvy = granola();
    expect(await read(ivy, forIvy.fetchImpl)).toMatchObject({ status: "found", notes: "notes for Bearer at_ivy" });
    expect(new Set(forIvy.tokens)).toEqual(new Set(["Bearer at_ivy"]));
  });

  test("an admin who reads the interview but did not sit on it gets nothing, connected or not", async () => {
    const g = granola();
    expect(await read(ada, g.fetchImpl)).toEqual({ status: "unavailable", message: "These notes aren't available to you." });
    expect(g.tokens).toEqual([]);
  });

  test("another company's member never reaches this interview", async () => {
    const g = granola();
    expect((await read(gus, g.fetchImpl)).status).toBe("unavailable");
    expect(g.tokens).toEqual([]);
  });

  test("an interview still to come is refused before Granola is asked", async () => {
    const g = granola();
    expect((await read(ben, g.fetchImpl, COMING)).status).toBe("unavailable");
    expect(g.tokens).toEqual([]);
  });

  test("a member who disconnected is not connected, and nothing else is read", async () => {
    must(await db().from("granola_connections").delete().eq("actor_id", BEN));
    const g = granola();
    expect(await read(ben, g.fetchImpl)).toEqual({ status: "not_connected" });
    expect(g.tokens).toEqual([]);
  });

  test("an expired token refreshes, and only the member's own row changes", async () => {
    must(await db().from("granola_connections").update({ access_token: null, access_token_expires_at: null }).eq("actor_id", BEN));
    const g = granola();
    const fetchImpl = (async (url: unknown, init?: RequestInit) =>
      String(url).endsWith("/oauth2/token")
        ? Response.json({ access_token: "at_fresh", refresh_token: "rt_fresh", expires_in: 21600 })
        : g.fetchImpl(url as string, init)) as typeof fetch;
    expect(await read(ben, fetchImpl)).toMatchObject({ status: "found", notes: "notes for Bearer at_fresh" });
    const { data } = must(await db().from("granola_connections").select("actor_id, refresh_token").eq("org_id", ACME).order("actor_id"));
    expect(data!.map((r) => [r.actor_id, r.refresh_token])).toEqual([[ADA, "rt_ada"], [BEN, "rt_fresh"], [IVY, "rt_ivy"]]);
  });

  test("the list marks the interviews the member sat on", async () => {
    const member: Member = { actorId: BEN, orgId: ACME, accessLevel: "elevated" };
    const mine = await readInterviews(ben.db, member, new Date());
    expect(mine.map((i) => [i.interviewId, i.mine]).sort()).toEqual([[PAST, true], [COMING, true]].sort());
    const admin: Member = { actorId: ADA, orgId: ACME, accessLevel: "admin" };
    expect((await readInterviews(ada.db, admin, new Date())).every((i) => !i.mine)).toBe(true);
  });
});
