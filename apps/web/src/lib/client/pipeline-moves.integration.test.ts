import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import type { clientTools } from "@tacit-ats/core";
import { moveCandidate } from "./candidate-edits";
import { readPipeline } from "./pipeline";

/**
 * A Pipeline card's move for each kind of member, called directly as a posted
 * form could, and under load: what the board offers has to match what a write
 * does, whoever is asking and however many ask at once. On members' own tokens
 * against the local stack.
 */

const db = () => getSupabaseServiceClient();

const ORG = "e6000000-0000-4000-8000-0000000000a1";
const OTHER = "e6000000-0000-4000-8000-0000000000a2";
const ADMIN = "e6a00000-0000-4000-8000-0000000000a1";
const NIA = "e6a00000-0000-4000-8000-0000000000a2";
const CORA = "e6a00000-0000-4000-8000-0000000000a3";
const REX = "e6a00000-0000-4000-8000-0000000000a4";
const IVY = "e6a00000-0000-4000-8000-0000000000a5";
const RAY = "e6a00000-0000-4000-8000-0000000000a6";
const FAY = "e6a00000-0000-4000-8000-0000000000a7";
const JOB = "e6b00000-0000-4000-8000-0000000000a1";
const JOB2 = "e6b00000-0000-4000-8000-0000000000a2";
const OTHER_JOB = "e6b00000-0000-4000-8000-0000000000a3";
const app = (n: number) => `e6d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `e6c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ORG, OTHER];
  for (const table of ["application_events", "interviews", "openings", "applications", "hiring_team", "job_access", "people", "roles", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("audit_log").delete().in("org_id", ids);
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const members = {
  admin: { actorId: ADMIN, accessLevel: "admin", sub: "u_pm_admin" },
  noTeam: { actorId: NIA, accessLevel: "elevated", sub: "u_pm_nia" },
  coordinator: { actorId: CORA, accessLevel: "elevated", sub: "u_pm_cora" },
  externalRecruiter: { actorId: REX, accessLevel: "elevated", sub: "u_pm_rex" },
  interviewer: { actorId: IVY, accessLevel: "limited", sub: "u_pm_ivy" },
  recruiter: { actorId: RAY, accessLevel: "elevated", sub: "u_pm_ray" },
} as const;
type Member = keyof typeof members;

const client = (subject: string, workosOrgId = "org_pm_a") => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};

const move = (who: Member, n: number, stage: "screening" | "contacted" | "interviewing" | "offer" | "hired", expectedStage: "screening" | "offer" | "interviewing" = "screening") => {
  const m = members[who];
  const ctx: clientTools.ClientToolCtx = { actorId: m.actorId, orgId: ORG, accessLevel: m.accessLevel, source: "dashboard" };
  return moveCandidate(client(m.sub), ctx, { applicationId: app(n), stage, expectedStage, reasonId: null, note: null });
};

const stageOf = async (n: number) => must(await db().from("applications").select("stage").eq("id", app(n)).single()).data!.stage;
const stageEvents = async (n: number) => must(await db().from("application_events").select("to_stage").eq("application_id", app(n)).eq("kind", "stage_changed")).data!;
const audits = async (n: number) => must(await db().from("audit_log").select("action").eq("entity_id", app(n))).data!;

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ORG, name: "A", slug: "itest-pmoves-a", kind: "client", workos_org_id: "org_pm_a" },
    { id: OTHER, name: "B", slug: "itest-pmoves-b", kind: "client", workos_org_id: "org_pm_b" },
  ]));
  must(await db().from("actors").insert([
    ...Object.entries(members).map(([k, m]) => ({ id: m.actorId, org_id: ORG, slug: `itest-pm-${k.toLowerCase()}`, display_name: k, email: `${k}@pm.test`, access_level: m.accessLevel, auth_subject: m.sub })),
    { id: FAY, org_id: OTHER, slug: "itest-pm-fay", display_name: "Fay", email: "fay@pm.test", access_level: "admin", auth_subject: "u_pm_fay" },
  ]));
  const { data: company } = must(await db().from("companies").insert({ org_id: ORG, name: "A" }).select("id").single());
  const { data: otherCompany } = must(await db().from("companies").insert({ org_id: OTHER, name: "B" }).select("id").single());
  must(await db().from("roles").insert([
    { id: JOB, org_id: ORG, company_id: company!.id, title: "Job", status: "open" },
    { id: JOB2, org_id: ORG, company_id: company!.id, title: "Other job", status: "open" },
    { id: OTHER_JOB, org_id: OTHER, company_id: otherCompany!.id, title: "Their job", status: "open" },
  ]));
  must(await db().from("hiring_team").insert([
    { org_id: ORG, role_id: JOB, actor_id: CORA, team_role: "coordinator" },
    { org_id: ORG, role_id: JOB, actor_id: RAY, team_role: "recruiter" },
    { org_id: ORG, role_id: JOB, actor_id: IVY, team_role: "interviewer" },
  ]));
  const { data: external } = must(await db().from("access_roles").select("id").eq("org_id", ORG).eq("name", "External Recruiter").single());
  must(await db().from("job_access").insert({ org_id: ORG, actor_id: REX, role_id: JOB, access_role_id: external!.id }));

  const apps = [
    [1, JOB, "screening", ADMIN],
    [2, JOB, "screening", REX],
    [3, JOB2, "screening", ADMIN],
    [4, JOB, "offer", ADMIN],
  ] as const;
  must(await db().from("people").insert([
    ...apps.map(([n]) => ({ id: person(n), org_id: ORG, display_name: `Candidate ${n}`, email: `c${n}@pm.test` })),
    { id: person(90), org_id: OTHER, display_name: "Theirs", email: "theirs@pm.test" },
  ]));
  must(await db().from("applications").insert([
    ...apps.map(([n, role, stage, by]) => ({ id: app(n), org_id: ORG, person_id: person(n), role_id: role, stage, added_by_actor_id: by })),
    { id: app(90), org_id: OTHER, person_id: person(90), role_id: OTHER_JOB, stage: "screening" },
  ]));
});

afterAll(clear);

describe("who may move a card", () => {
  test.each([
    ["admin", 1, { ok: true, changed: true, roleId: JOB }],
    ["recruiter", 1, { ok: true, changed: true, roleId: JOB }],
    ["externalRecruiter", 2, { ok: true, changed: true, roleId: JOB }],
    // Someone else's candidate on the same job: an external recruiter never sees them.
    ["externalRecruiter", 1, { ok: false, error: "not_found" }],
    ["coordinator", 1, { ok: false, error: "forbidden" }],
    ["noTeam", 1, { ok: false, error: "not_found" }],
    ["interviewer", 1, { ok: false, error: "not_found" }],
  ] as const)("%s, application %i", async (who, n, want) => {
    expect(await move(who, n, "interviewing")).toEqual(want);
    expect(await stageOf(n)).toBe(want.ok ? "interviewing" : "screening");
    expect(await stageEvents(n)).toHaveLength(want.ok ? 1 : 0);
    expect(await audits(n)).toHaveLength(want.ok ? 1 : 0);
  });

  test("the board offers moves to exactly those members", async () => {
    const offered = async (who: Member) => {
      const { entries } = await readPipeline(client(members[who].sub), new Date());
      return Object.fromEntries(entries.map((e) => [e.applicationId, e.editable]));
    };
    expect(await offered("recruiter")).toEqual({ [app(1)]: true, [app(2)]: true, [app(4)]: true });
    expect(await offered("coordinator")).toEqual({ [app(1)]: false, [app(2)]: false, [app(4)]: false });
    expect(await offered("externalRecruiter")).toEqual({ [app(2)]: true });
    expect(await offered("interviewer")).toEqual({});
    expect(await offered("noTeam")).toEqual({});
  });

  test("the access level a session claims widens nothing", async () => {
    const ctx: clientTools.ClientToolCtx = { actorId: CORA, orgId: ORG, accessLevel: "admin", source: "dashboard" };
    const outcome = await moveCandidate(client(members.coordinator.sub), ctx, { applicationId: app(1), stage: "offer", expectedStage: "screening", reasonId: null, note: null });
    expect(outcome).toEqual({ ok: false, error: "forbidden" });
  });

  test("another company's admin finds nothing", async () => {
    const ctx: clientTools.ClientToolCtx = { actorId: FAY, orgId: OTHER, accessLevel: "admin", source: "dashboard" };
    const outcome = await moveCandidate(client("u_pm_fay", "org_pm_b"), ctx, { applicationId: app(1), stage: "offer", expectedStage: "screening", reasonId: null, note: null });
    expect(outcome).toEqual({ ok: false, error: "not_found" });
    expect(await stageOf(1)).toBe("screening");
  });
});

describe("moving at once", () => {
  test("ten copies of one move land once, with one event and one audit row", async () => {
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => move("admin", 1, "interviewing")));
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok)).toEqual(Array.from({ length: 9 }, () => ({ ok: false, error: "changed" })));
    expect(await stageEvents(1)).toHaveLength(1);
    expect(await audits(1)).toHaveLength(1);
  });

  test("different moves at once: one wins, and its event is the stage the card has", async () => {
    const outcomes = await Promise.all((["contacted", "interviewing", "offer", "hired"] as const).map((s) => move("admin", 1, s)));
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(await stageEvents(1)).toEqual([{ to_stage: await stageOf(1) }]);
  });
});

describe("a hire from the board", () => {
  test("fills the job's opening on a recruiter's own token, and needs none", async () => {
    must(await db().from("openings").insert({ org_id: ORG, role_id: JOB, status: "open" }));
    expect(await move("recruiter", 4, "hired", "offer")).toMatchObject({ ok: true, changed: true });
    expect(must(await db().from("openings").select("status, filled_by_application_id").eq("role_id", JOB)).data).toEqual([{ status: "filled", filled_by_application_id: app(4) }]);

    expect(await move("recruiter", 1, "hired")).toMatchObject({ ok: true, changed: true });
    expect(await stageOf(1)).toBe("hired");
  });
});

describe("the hourly limit", () => {
  test("the 301st change moves nothing and says so", async () => {
    const claims = Array.from({ length: 300 }, () => ({ org_id: ORG, actor_id: ADMIN, source: "dashboard", action: "application.stage_change", entity: "application", after: {} }));
    must(await db().from("audit_log").insert(claims));
    expect(await move("admin", 1, "offer")).toEqual({ ok: false, error: "rate_limited" });
    expect(await stageOf(1)).toBe("screening");
    expect(await stageEvents(1)).toEqual([]);
  });
});
