import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { decideInboxApplication, decideInboxApproval, readInbox, readIssue } from "./inbox";
import { offerTermLines, parseDecision } from "./inbox-decisions";

/**
 * The Inbox's decisions against the local stack, on members' own tokens: A and
 * R on an approval, O and R on the team's call. The policies and decide_approval
 * have the last word, a reason, a note and an offer's terms stay out of the
 * audit row, and the queue never carries terms. Tokens are signed as in
 * inbox.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e8000000-0000-4000-8000-0000000000f1";
const GLOBEX = "e8100000-0000-4000-8000-0000000000f2";
const ADMIN = "e8a00000-0000-4000-8000-0000000000f1";
const LEAD = "e8a00000-0000-4000-8000-0000000000f2";
const INTERVIEWER = "e8a00000-0000-4000-8000-0000000000f3";
const FINANCE = "e8a00000-0000-4000-8000-0000000000f4";
const GLOBEX_ADMIN = "e8a10000-0000-4000-8000-0000000000f1";
const ENGINEER = "e8b00000-0000-4000-8000-0000000000f1";
const DESIGNER = "e8b00000-0000-4000-8000-0000000000f2";
const GLOBEX_ROLE = "e8b10000-0000-4000-8000-0000000000f1";
const app = (n: number) => `e8d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `e8c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const iv = (n: number) => `e8e00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_APP = "e8d10000-0000-4000-8000-0000000000f1";
const GLOBEX_PERSON = "e8c10000-0000-4000-8000-0000000000f1";
const OFFER = "e8f00000-0000-4000-8000-0000000000f1";
const OFFER_REQUEST = "e8f10000-0000-4000-8000-0000000000f1";
const JOB_REQUEST = "e8f10000-0000-4000-8000-0000000000f2";
const SKILLS = "e8f20000-0000-4000-8000-0000000000f1";
const WITHDREW = "e8f20000-0000-4000-8000-0000000000f2";
const GLOBEX_REASON = "e8f20000-0000-4000-8000-0000000000f3";
const SECRET_SALARY = 987654;

const ACME_WORKOS = "org_itest_decide_acme";
const GLOBEX_WORKOS = "org_itest_decide_globex";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of [
    "approval_decisions", "approval_requests", "approval_flow_approvers", "approval_flows", "offers", "rejection_reasons",
    "application_events", "interviews", "applications", "hiring_team", "people", "roles", "companies",
  ] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("audit_log").delete().in("org_id", ids);
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const token = (subject: string, workosOrgId = ACME_WORKOS) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};

const ada = { actorId: ADMIN, orgId: ACME, accessLevel: "admin" as const };
const lee = { actorId: LEAD, orgId: ACME, accessLevel: "elevated" as const };
const fin = { actorId: FINANCE, orgId: ACME, accessLevel: "elevated" as const };
const ivan = { actorId: INTERVIEWER, orgId: ACME, accessLevel: "limited" as const };
const gina = { actorId: GLOBEX_ADMIN, orgId: GLOBEX, accessLevel: "admin" as const };
const dashboard = <T extends typeof ada | typeof lee | typeof ivan | typeof gina>(who: T) => ({ ...who, source: "dashboard" as const });

const NOW = new Date();
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-decide-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-decide-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-dc-admin", display_name: "Ada Admin", email: "ada@dc.test", access_level: "admin", auth_subject: "user_dc_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-dc-lead", display_name: "Lee Lead", email: "lee@dc.test", access_level: "elevated", auth_subject: "user_dc_lee" },
    { id: FINANCE, org_id: ACME, slug: "itest-dc-fin", display_name: "Fin Approver", email: "fin@dc.test", access_level: "elevated", auth_subject: "user_dc_fin" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-dc-ivan", display_name: "Ivan Interviewer", email: "ivan@dc.test", access_level: "limited", auth_subject: "user_dc_ivan" },
    { id: GLOBEX_ADMIN, org_id: GLOBEX, slug: "itest-dc-gina", display_name: "Gina Globex", email: "gina@dc.test", access_level: "admin", auth_subject: "user_dc_gina" },
  ]));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer"], [DESIGNER, "Designer"]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role"]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title]) => ({ id, org_id: org, company_id: company!.id, title, status: "open" }))));
  }
  must(await db().from("hiring_team").insert([
    { org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" },
    { org_id: ACME, role_id: ENGINEER, actor_id: INTERVIEWER, team_role: "interviewer" },
  ]));
  must(await db().from("rejection_reasons").insert([
    { id: SKILLS, org_id: ACME, kind: "rejected", name: "Skills" },
    { id: WITHDREW, org_id: ACME, kind: "withdrew", name: "Took another job" },
    { id: GLOBEX_REASON, org_id: GLOBEX, kind: "rejected", name: "Globex's reason" },
  ]));

  // 1 and 2 engineers interviewed, the team's call; 3 a designer the same; 4 in offer, its terms waiting on approval.
  const apps: [number, string, string][] = [[1, ENGINEER, "interviewing"], [2, ENGINEER, "interviewing"], [3, DESIGNER, "interviewing"], [4, ENGINEER, "offer"]];
  must(await db().from("people").insert([
    ...apps.map(([n]) => ({ id: person(n), org_id: ACME, display_name: `Candidate ${n}`, email: `c${n}@dc.test` })),
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@dc.test" },
  ]));
  for (const [n, role, stage] of apps) must(await db().from("applications").insert({ id: app(n), org_id: ACME, person_id: person(n), role_id: role, stage, source: "sourced" }));
  must(await db().from("applications").insert({ id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "interviewing", source: "sourced" }));
  must(await db().from("interviews").insert([1, 2, 3].map((n) => ({
    id: iv(n), org_id: ACME, application_id: app(n), starts_at: at(-49), ends_at: at(-48), status: "scheduled", step: "Onsite", interviewer_actor_ids: [],
  }))));
  must(await db().from("offers").insert({ id: OFFER, org_id: ACME, application_id: app(4), salary: SECRET_SALARY, currency: "USD", equity: "0.5%", created_by_actor_id: LEAD }));

  // The offer: Ada, then Fin. Opening the designer job: Ada alone.
  const flows = must(await db().from("approval_flows").insert([{ org_id: ACME, role_id: ENGINEER, kind: "offer" }, { org_id: ACME, role_id: DESIGNER, kind: "job_open" }]).select("id, kind"));
  const flow = (kind: string) => flows.data!.find((f) => f.kind === kind)!.id;
  must(await db().from("approval_flow_approvers").insert([
    { org_id: ACME, flow_id: flow("offer"), step: 1, actor_id: ADMIN },
    { org_id: ACME, flow_id: flow("offer"), step: 2, actor_id: FINANCE },
    { org_id: ACME, flow_id: flow("job_open"), step: 1, actor_id: ADMIN },
  ]));
  must(await db().from("approval_requests").insert([
    { id: OFFER_REQUEST, org_id: ACME, role_id: ENGINEER, kind: "offer", offer_id: OFFER, current_step: 1, requested_by_actor_id: LEAD },
    { id: JOB_REQUEST, org_id: ACME, role_id: DESIGNER, kind: "job_open", current_step: 1, requested_by_actor_id: LEAD },
  ]));
});

afterAll(clear);

const audit = async (action: string) => (await db().from("audit_log").select("source, action, entity_id, before, after").eq("org_id", ACME).eq("action", action)).data ?? [];
const stageOf = async (n: number) => must(await db().from("applications").select("stage, rejection_reason_id, rejection_note").eq("id", app(n)).single()).data!;
const requestOf = async (id: string) => must(await db().from("approval_requests").select("status, current_step").eq("id", id).single()).data!;
const keysFor = async (client: ReturnType<typeof token>, member: Parameters<typeof readInbox>[1]) => (await readInbox(client, member, NOW)).issues.map((i) => i.key);
const move = (n: number, stage: "offer" | "rejected", over: Record<string, string | null> = {}) => ({ applicationId: app(n), stage, expectedStage: "interviewing" as const, reasonId: null, note: null, ...over });

describe("deciding an approval", () => {
  test("A on the last step approves, audited as the dashboard, and the issue leaves", async () => {
    const client = token("user_dc_ada");
    expect(await keysFor(client, ada)).toContain(`appr-${JOB_REQUEST}`);
    expect(await decideInboxApproval(client, dashboard(ada), { requestId: JOB_REQUEST, decision: "approve", reason: null })).toEqual({ ok: true, outcome: "approved", kind: "job_open" });
    expect(await requestOf(JOB_REQUEST)).toMatchObject({ status: "approved" });
    expect(await keysFor(client, ada)).not.toContain(`appr-${JOB_REQUEST}`);
    expect(await audit("approval.approve")).toMatchObject([{ source: "dashboard", entity_id: JOB_REQUEST }]);
  });

  test("A on an early step hands it to the next approver", async () => {
    expect(await decideInboxApproval(token("user_dc_ada"), dashboard(ada), { requestId: OFFER_REQUEST, decision: "approve", reason: null })).toEqual({ ok: true, outcome: "advanced", kind: "offer" });
    expect(await requestOf(OFFER_REQUEST)).toMatchObject({ status: "pending", current_step: 2 });
    expect(await keysFor(token("user_dc_ada"), ada)).not.toContain(`appr-${OFFER_REQUEST}`);
    expect(await keysFor(token("user_dc_fin"), fin)).toContain(`appr-${OFFER_REQUEST}`);
  });

  test("R needs a reason, and it stays with the decision, out of the audit row", async () => {
    const client = token("user_dc_ada");
    expect(await decideInboxApproval(client, dashboard(ada), { requestId: JOB_REQUEST, decision: "reject", reason: "   " })).toEqual({ ok: false, error: "reason_required" });
    expect(await requestOf(JOB_REQUEST)).toMatchObject({ status: "pending" });

    const reason = "Budget frozen until the spring";
    expect(await decideInboxApproval(client, dashboard(ada), { requestId: JOB_REQUEST, decision: "reject", reason })).toEqual({ ok: true, outcome: "rejected", kind: "job_open" });
    expect(await requestOf(JOB_REQUEST)).toMatchObject({ status: "rejected" });
    const decisions = must(await db().from("approval_decisions").select("decision, reason, actor_id").eq("request_id", JOB_REQUEST)).data;
    expect(decisions).toEqual([{ decision: "rejected", reason, actor_id: ADMIN }]);
    const rows = await audit("approval.reject");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("Budget");
  });

  test("a second press, or someone quicker, changes nothing", async () => {
    const client = token("user_dc_ada");
    await decideInboxApproval(client, dashboard(ada), { requestId: JOB_REQUEST, decision: "approve", reason: null });
    expect(await decideInboxApproval(client, dashboard(ada), { requestId: JOB_REQUEST, decision: "reject", reason: "Too late" })).toEqual({ ok: true, outcome: "not_pending", kind: "job_open" });
    expect(await requestOf(JOB_REQUEST)).toMatchObject({ status: "approved" });
    expect(await audit("approval.reject")).toEqual([]);
  });

  test("the request's approver only: a step that isn't theirs, an interviewer, another company", async () => {
    expect(await decideInboxApproval(token("user_dc_fin"), dashboard(fin), { requestId: OFFER_REQUEST, decision: "approve", reason: null })).toEqual({ ok: false, error: "not_approver" });
    expect(await requestOf(OFFER_REQUEST)).toMatchObject({ current_step: 1 });

    const leeTry = await decideInboxApproval(token("user_dc_lee"), dashboard(lee), { requestId: OFFER_REQUEST, decision: "approve", reason: null });
    expect(leeTry).toEqual({ ok: false, error: "not_approver" });

    const ivanTry = await decideInboxApproval(token("user_dc_ivan"), dashboard(ivan), { requestId: OFFER_REQUEST, decision: "approve", reason: null });
    expect(ivanTry.ok).toBe(false);

    expect(await decideInboxApproval(token("user_dc_gina", GLOBEX_WORKOS), dashboard(gina), { requestId: OFFER_REQUEST, decision: "approve", reason: null })).toEqual({ ok: false, error: "not_found" });
    expect(await requestOf(OFFER_REQUEST)).toMatchObject({ status: "pending", current_step: 1 });
  });

  test("a read-only connector doesn't stop the page", async () => {
    must(await db().from("orgs").update({ connector_access: "read_only" }).eq("id", ACME));
    expect(await decideInboxApproval(token("user_dc_ada"), dashboard(ada), { requestId: JOB_REQUEST, decision: "approve", reason: null })).toMatchObject({ ok: true, outcome: "approved" });
  });

  test("an offer's terms reach the approver's reader, and neither the queue nor the audit row", async () => {
    const client = token("user_dc_ada");
    const { issues } = await readInbox(client, ada, NOW);
    expect(JSON.stringify(issues)).not.toContain(String(SECRET_SALARY));
    const issue = issues.find((i) => i.key === `appr-${OFFER_REQUEST}`)!;
    expect(issue.approval).toEqual({ requestId: OFFER_REQUEST, kind: "offer" });

    const { terms } = await readIssue(client, ada, issue);
    expect(offerTermLines(terms!)).toEqual([{ label: "Salary", value: "987,654 USD" }, { label: "Equity", value: "0.5%" }]);

    await decideInboxApproval(client, dashboard(ada), { requestId: OFFER_REQUEST, decision: "approve", reason: null });
    const row = JSON.stringify(await audit("approval.approve"));
    expect(row).not.toContain(String(SECRET_SALARY));
    expect(row).not.toContain("0.5%");
  });

  test("a job's approval has no terms, and the reader's reasons are only for the team's call", async () => {
    const client = token("user_dc_ada");
    const { issues } = await readInbox(client, ada, NOW);
    const job = await readIssue(client, ada, issues.find((i) => i.key === `appr-${JOB_REQUEST}`)!);
    expect(job.terms).toBeNull();
    expect(job.reasons).toEqual([]);
    const call = await readIssue(client, ada, issues.find((i) => i.key === `app-${app(1)}`)!);
    expect(call.canEdit).toBe(true);
    expect(call.reasons.map((r) => r.name)).toContain("Skills");
    expect(call.reasons.map((r) => r.name)).not.toContain("Took another job");
  });
});

describe("deciding the team's call", () => {
  test("O moves to offer, audited, and the issue leaves", async () => {
    const client = token("user_dc_lee");
    expect(await keysFor(client, lee)).toContain(`app-${app(1)}`);
    expect(await decideInboxApplication(client, dashboard(lee), move(1, "offer"))).toMatchObject({ ok: true, changed: true });
    expect(await stageOf(1)).toMatchObject({ stage: "offer" });
    expect(await keysFor(client, lee)).not.toContain(`app-${app(1)}`);
    expect(await audit("application.stage_change")).toMatchObject([{ source: "dashboard", entity_id: app(1) }]);
    const events = must(await db().from("application_events").select("to_stage").eq("application_id", app(1)).eq("kind", "stage_changed")).data;
    expect(events).toEqual([{ to_stage: "offer" }]);
  });

  test("R closes with one of the org's reasons, the note kept out of the audit row", async () => {
    const client = token("user_dc_lee");
    expect(await decideInboxApplication(client, dashboard(lee), move(2, "rejected"))).toEqual({ ok: false, error: "reason_required" });
    expect(await decideInboxApplication(client, dashboard(lee), move(2, "rejected", { reasonId: WITHDREW }))).toEqual({ ok: false, error: "reason_required" });
    expect(await decideInboxApplication(client, dashboard(lee), move(2, "rejected", { reasonId: GLOBEX_REASON }))).toEqual({ ok: false, error: "reason_required" });
    expect(await stageOf(2)).toMatchObject({ stage: "interviewing" });

    expect(await decideInboxApplication(client, dashboard(lee), move(2, "rejected", { reasonId: SKILLS, note: "Private words" }))).toMatchObject({ ok: true, changed: true });
    expect(await stageOf(2)).toEqual({ stage: "rejected", rejection_reason_id: SKILLS, rejection_note: "Private words" });
    expect(JSON.stringify(await audit("application.stage_change"))).not.toContain("Private words");
  });

  test("a stale page moves nothing: a second press, or someone quicker", async () => {
    const client = token("user_dc_lee");
    await decideInboxApplication(client, dashboard(lee), move(1, "offer"));
    expect(await decideInboxApplication(client, dashboard(lee), move(1, "rejected", { reasonId: SKILLS }))).toEqual({ ok: false, error: "changed" });
    expect(await decideInboxApplication(client, dashboard(lee), move(1, "offer"))).toEqual({ ok: false, error: "changed" });
    expect(await stageOf(1)).toMatchObject({ stage: "offer" });
  });

  test("only whoever may edit that job: a hiring manager elsewhere, an interviewer, another company", async () => {
    expect(await decideInboxApplication(token("user_dc_lee"), dashboard(lee), move(3, "offer"))).toEqual({ ok: false, error: "not_found" });
    expect((await decideInboxApplication(token("user_dc_ivan"), dashboard(ivan), move(1, "offer"))).ok).toBe(false);
    expect(await decideInboxApplication(token("user_dc_ada"), dashboard(ada), { ...move(1, "offer"), applicationId: GLOBEX_APP })).toEqual({ ok: false, error: "not_found" });
    expect(await stageOf(1)).toMatchObject({ stage: "interviewing" });
    expect(await stageOf(3)).toMatchObject({ stage: "interviewing" });
  });

  test("the form's fields reach the write as posted", async () => {
    const parsed = parseDecision({ get: (k) => ({ decision: "close", applicationId: app(1), reasonId: SKILLS, note: " Why " })[k as "decision"] ?? null });
    expect(parsed?.on).toBe("application");
    if (parsed?.on !== "application") return;
    expect(await decideInboxApplication(token("user_dc_lee"), dashboard(lee), parsed.move)).toMatchObject({ ok: true, changed: true });
    expect(await stageOf(1)).toEqual({ stage: "rejected", rejection_reason_id: SKILLS, rejection_note: "Why" });
  });
});
