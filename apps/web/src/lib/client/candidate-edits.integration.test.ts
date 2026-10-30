import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import type { clientTools } from "@tacit-ats/core";

import { logCandidateTouch, moveCandidate, readEditing, setCandidateNextAction, setCandidateOwner } from "./candidate-edits";

/**
 * The candidate page's writes against the local stack, on members' own
 * tokens, with the policies deciding: the move and the next action through
 * the audited clientTools, the owner and a touch through core's pipeline
 * functions. The member token is signed with the stack's JWT secret, as in
 * pipeline.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e5000000-0000-4000-8000-0000000000c1";
const GLOBEX = "e6000000-0000-4000-8000-0000000000c2";
const ADMIN = "e5a00000-0000-4000-8000-0000000000c1";
const LEAD = "e5a00000-0000-4000-8000-0000000000c2";
const INTERVIEWER = "e5a00000-0000-4000-8000-0000000000c3";
const ENGINEER = "e5b00000-0000-4000-8000-0000000000c1";
const DESIGNER = "e5b00000-0000-4000-8000-0000000000c2";
const GLOBEX_ROLE = "e6b00000-0000-4000-8000-0000000000c1";
const person = (n: number) => `e5c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const app = (n: number) => `e5d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_PERSON = "e6c00000-0000-4000-8000-0000000000c1";
const GLOBEX_APP = "e6d00000-0000-4000-8000-0000000000c1";
const REJECTED_REASON = "e5e00000-0000-4000-8000-0000000000c1";
const WITHDREW_REASON = "e5e00000-0000-4000-8000-0000000000c2";
const GLOBEX_REASON = "e6e00000-0000-4000-8000-0000000000c1";

const ACME_WORKOS = "org_itest_cedit_acme";
const GLOBEX_WORKOS = "org_itest_cedit_globex";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["application_events", "interviews", "applications", "rejection_reasons", "hiring_team", "people", "roles", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("audit_log").delete().in("actor_id", [ADMIN, LEAD, INTERVIEWER]);
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const ctx = (actorId: string, accessLevel: clientTools.ClientToolCtx["accessLevel"]): clientTools.ClientToolCtx => ({ actorId, orgId: ACME, accessLevel, source: "dashboard" });

const member = (subject: string, workosOrgId = ACME_WORKOS) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};

const application = async (id: string) =>
  must(await db().from("applications").select("stage, owner_actor_id, next_action, next_action_due, rejection_reason_id, rejection_note, last_touch_at").eq("id", id).single())
    .data!;
const audits = async (id: string) =>
  must(await db().from("audit_log").select("source, action, entity, before, after").eq("entity_id", id).order("created_at")).data!;
const events = async (id: string) =>
  must(await db().from("application_events").select("kind, from_stage, to_stage, detail, actor_id").eq("application_id", id).order("created_at")).data!;

const OLD = new Date(Date.now() - 72 * 3_600_000).toISOString();

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-cedit-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-cedit-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-cedit-admin", display_name: "Ada Admin", email: "ada@cedit.test", access_level: "admin", auth_subject: "user_cedit_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-cedit-lead", display_name: "Lee Lead", email: "lee@cedit.test", access_level: "elevated", auth_subject: "user_cedit_lee" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-cedit-iv", display_name: "Ivy Interviewer", email: "ivy@cedit.test", access_level: "limited", auth_subject: "user_cedit_ivy" },
  ]));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer"], [DESIGNER, "Designer"]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role"]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title]) => ({ id, org_id: org, company_id: company!.id, title, status: "open" }))));
  }
  // Lee manages the engineer search only.
  must(await db().from("hiring_team").insert({ org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" }));
  must(await db().from("rejection_reasons").insert([
    { id: REJECTED_REASON, org_id: ACME, kind: "rejected", name: "Not enough experience" },
    { id: WITHDREW_REASON, org_id: ACME, kind: "withdrew", name: "Took another offer" },
    { id: GLOBEX_REASON, org_id: GLOBEX, kind: "rejected", name: "Globex reason" },
  ]));

  must(await db().from("people").insert([
    { id: person(1), org_id: ACME, display_name: "Grace Hopper", email: "grace@cedit.test" },
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@cedit.test" },
  ]));
  must(await db().from("applications").insert([
    // Grace: screening for Engineer (Lee's job), sourced for Designer (not Lee's)
    { id: app(1), org_id: ACME, person_id: person(1), role_id: ENGINEER, stage: "screening", owner_actor_id: ADMIN, last_touch_at: OLD },
    { id: app(2), org_id: ACME, person_id: person(1), role_id: DESIGNER, stage: "sourced", last_touch_at: OLD },
    { id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "screening", last_touch_at: OLD },
  ]));
  // Ivy sits on Grace's engineer interview.
  must(await db().from("interviews").insert({
    org_id: ACME, application_id: app(1), starts_at: new Date(Date.now() + 86_400_000).toISOString(),
    ends_at: new Date(Date.now() + 90_000_000).toISOString(), status: "scheduled", step: "Onsite", interviewer_actor_ids: [INTERVIEWER],
  }));
});

afterAll(clear);

describe("the candidate page's controls", () => {
  test("an admin may edit every job, and gets the team and both kinds of reason; a hiring manager only their job", async () => {
    const ada = await readEditing(member("user_cedit_ada"), [app(1), app(2)]);
    expect([...ada.editable.keys()].sort()).toEqual([app(1), app(2)].sort());
    expect(ada.editable.get(app(1))).toEqual({ ownerActorId: ADMIN });
    expect(ada.owners.map((o) => o.actorId).sort()).toEqual([ADMIN, LEAD, INTERVIEWER].sort());
    // a new org is seeded with default reasons too; never another company's
    const reasons = ada.reasons.map((r) => [r.reasonId, r.kind]);
    expect(reasons).toEqual(expect.arrayContaining([[REJECTED_REASON, "rejected"], [WITHDREW_REASON, "withdrew"]]));
    expect(reasons.map(([id]) => id)).not.toContain(GLOBEX_REASON);

    const lee = await readEditing(member("user_cedit_lee"), [app(1), app(2)]);
    expect([...lee.editable.keys()]).toEqual([app(1)]);

    const ivy = await readEditing(member("user_cedit_ivy"), [app(1)]);
    expect(ivy.editable.size).toBe(0);
  });
});

describe("the candidate page's writes", () => {
  test("an admin moves a stage, and the move lands in application_events", async () => {
    const outcome = await moveCandidate(member("user_cedit_ada"), ctx(ADMIN, "admin"), { applicationId: app(1), stage: "interviewing", expectedStage: "screening", reasonId: null, note: null });
    expect(outcome).toEqual({ ok: true, changed: true, roleId: ENGINEER });
    expect((await application(app(1))).stage).toBe("interviewing");
    expect(await events(app(1))).toEqual([{ kind: "stage_changed", from_stage: "screening", to_stage: "interviewing", detail: null, actor_id: ADMIN }]);
  });

  test("a reject needs a rejected reason of the org's; with one it records the reason and the note", async () => {
    const ada = member("user_cedit_ada");
    const reject = (reasonId: string | null) =>
      moveCandidate(ada, ctx(ADMIN, "admin"), { applicationId: app(1), stage: "rejected", expectedStage: "screening", reasonId, note: "Needs more systems work" });
    expect(await reject(null)).toEqual({ ok: false, error: "reason_required" });
    // the wrong kind, and another company's reason
    expect(await reject(WITHDREW_REASON)).toEqual({ ok: false, error: "reason_required" });
    expect(await reject(GLOBEX_REASON)).toEqual({ ok: false, error: "reason_required" });
    expect((await application(app(1))).stage).toBe("screening");
    expect(await events(app(1))).toEqual([]);

    expect(await reject(REJECTED_REASON)).toMatchObject({ ok: true, changed: true });
    expect(await application(app(1))).toMatchObject({ stage: "rejected", rejection_reason_id: REJECTED_REASON, rejection_note: "Needs more systems work" });
    expect(await events(app(1))).toEqual([{ kind: "stage_changed", from_stage: "screening", to_stage: "rejected", detail: "Not enough experience", actor_id: ADMIN }]);

    // and a withdrawal needs a withdrew one
    const withdraw = (reasonId: string) => moveCandidate(ada, ctx(ADMIN, "admin"), { applicationId: app(2), stage: "withdrawn", expectedStage: "sourced", reasonId, note: null });
    expect(await withdraw(REJECTED_REASON)).toEqual({ ok: false, error: "reason_required" });
    expect(await withdraw(WITHDREW_REASON)).toMatchObject({ ok: true, changed: true });
  });

  test("a move from a stage they are no longer at is refused and changes nothing", async () => {
    must(await db().from("applications").update({ stage: "interviewing" }).eq("id", app(1)));
    const outcome = await moveCandidate(member("user_cedit_ada"), ctx(ADMIN, "admin"), { applicationId: app(1), stage: "offer", expectedStage: "screening", reasonId: null, note: null });
    expect(outcome).toEqual({ ok: false, error: "changed" });
    expect((await application(app(1))).stage).toBe("interviewing");
    expect(await events(app(1))).toEqual([]);
  });

  test("a move to the stage it is at changes nothing, even on a closed application", async () => {
    must(await db().from("applications").update({ stage: "rejected", rejection_reason_id: REJECTED_REASON, rejection_note: "First" }).eq("id", app(1)));
    const outcome = await moveCandidate(member("user_cedit_ada"), ctx(ADMIN, "admin"), { applicationId: app(1), stage: "rejected", expectedStage: "rejected", reasonId: REJECTED_REASON, note: "Second" });
    expect(outcome).toEqual({ ok: true, changed: false, roleId: ENGINEER });
    expect((await application(app(1))).rejection_note).toBe("First");
    expect(await audits(app(1))).toEqual([]);
  });

  test("a move and a next action are audited as the web app's, and a close's note stays out of the audit", async () => {
    const ada = member("user_cedit_ada");
    const edits = ctx(ADMIN, "admin");
    await moveCandidate(ada, edits, { applicationId: app(1), stage: "interviewing", expectedStage: "screening", reasonId: null, note: null });
    await setCandidateNextAction(ada, edits, { applicationId: app(1), nextAction: "Send the take-home", due: "2026-11-02" });
    await moveCandidate(ada, edits, { applicationId: app(1), stage: "rejected", expectedStage: "interviewing", reasonId: REJECTED_REASON, note: "Needs more systems work" });
    const rows = await audits(app(1));
    expect(rows).toEqual([
      { source: "dashboard", action: "application.stage_change", entity: "application", before: { stage: "screening" }, after: { stage: "interviewing" } },
      { source: "dashboard", action: "application.next_action", entity: "application", before: null, after: { next_action: "Send the take-home", due: "2026-11-02" } },
      { source: "dashboard", action: "application.stage_change", entity: "application", before: { stage: "interviewing" }, after: { stage: "rejected", rejection_reason: "Not enough experience" } },
    ]);
    expect(JSON.stringify(rows)).not.toContain("systems work");
  });

  test("an edit that changed nothing leaves no audit row", async () => {
    const ada = member("user_cedit_ada");
    expect(await setCandidateNextAction(ada, ctx(ADMIN, "admin"), { applicationId: app(1), nextAction: null, due: null })).toMatchObject({ ok: true, changed: false });
    expect(await audits(app(1))).toEqual([]);
  });

  test("an org that made its connector read-only still works here", async () => {
    must(await db().from("orgs").update({ connector_access: "read_only" }).eq("id", ACME));
    const outcome = await moveCandidate(member("user_cedit_ada"), ctx(ADMIN, "admin"), { applicationId: app(1), stage: "interviewing", expectedStage: "screening", reasonId: null, note: null });
    expect(outcome).toMatchObject({ ok: true, changed: true });
    expect((await application(app(1))).stage).toBe("interviewing");
  });

  test("an admin changes the owner, sets and clears the next action, and logs a touch", async () => {
    const ada = member("user_cedit_ada");
    expect(await setCandidateOwner(ada, ADMIN, { applicationId: app(1), ownerActorId: LEAD })).toMatchObject({ ok: true, changed: true });
    expect(await setCandidateOwner(ada, ADMIN, { applicationId: app(1), ownerActorId: GLOBEX_REASON })).toEqual({ ok: false, error: "not_member" });
    expect((await application(app(1))).owner_actor_id).toBe(LEAD);

    expect(await setCandidateNextAction(ada, ctx(ADMIN, "admin"), { applicationId: app(1), nextAction: "Send the take-home", due: "2026-11-02" })).toMatchObject({ ok: true, changed: true });
    expect(await application(app(1))).toMatchObject({ next_action: "Send the take-home", next_action_due: "2026-11-02" });
    expect(await setCandidateNextAction(ada, ctx(ADMIN, "admin"), { applicationId: app(1), nextAction: null, due: null })).toMatchObject({ ok: true, changed: true });
    expect(await application(app(1))).toMatchObject({ next_action: null, next_action_due: null });

    expect(await logCandidateTouch(ada, ADMIN, { applicationId: app(1), note: "Called about timing" })).toMatchObject({ ok: true });
    expect(Date.parse((await application(app(1))).last_touch_at)).toBeGreaterThan(Date.parse(OLD));
    expect((await events(app(1))).map((e) => [e.kind, e.detail])).toEqual([
      ["owner_changed", "Lee Lead"],
      ["next_action_set", "Send the take-home (by 2026-11-02)"],
      ["next_action_set", null],
      ["note", "Called about timing"],
    ]);
  });

  test("a hiring manager edits their job's application but not another job's", async () => {
    const lee = member("user_cedit_lee");
    expect(await moveCandidate(lee, ctx(LEAD, "elevated"), { applicationId: app(1), stage: "interviewing", expectedStage: "screening", reasonId: null, note: null })).toMatchObject({ ok: true, changed: true });
    expect(await logCandidateTouch(lee, LEAD, { applicationId: app(1), note: null })).toMatchObject({ ok: true });

    const designer = { applicationId: app(2) };
    expect((await moveCandidate(lee, ctx(LEAD, "elevated"), { ...designer, stage: "screening", expectedStage: "sourced", reasonId: null, note: null })).ok).toBe(false);
    expect((await setCandidateOwner(lee, LEAD, { ...designer, ownerActorId: LEAD })).ok).toBe(false);
    expect((await setCandidateNextAction(lee, ctx(LEAD, "elevated"), { ...designer, nextAction: "x", due: null })).ok).toBe(false);
    expect((await logCandidateTouch(lee, LEAD, { ...designer, note: null })).ok).toBe(false);
    expect(await application(app(2))).toMatchObject({ stage: "sourced", owner_actor_id: null, next_action: null, last_touch_at: expect.any(String) });
    expect(await events(app(2))).toEqual([]);
  });

  test("an interviewer is refused, even on the application they interview for", async () => {
    const ivy = member("user_cedit_ivy");
    expect((await moveCandidate(ivy, ctx(INTERVIEWER, "limited"), { applicationId: app(1), stage: "offer", expectedStage: "screening", reasonId: null, note: null })).ok).toBe(false);
    expect((await setCandidateOwner(ivy, INTERVIEWER, { applicationId: app(1), ownerActorId: INTERVIEWER })).ok).toBe(false);
    expect((await setCandidateNextAction(ivy, ctx(INTERVIEWER, "limited"), { applicationId: app(1), nextAction: "x", due: null })).ok).toBe(false);
    expect((await logCandidateTouch(ivy, INTERVIEWER, { applicationId: app(1), note: null })).ok).toBe(false);
    expect(await application(app(1))).toMatchObject({ stage: "screening", owner_actor_id: ADMIN, next_action: null, last_touch_at: expect.any(String) });
    expect(Date.parse((await application(app(1))).last_touch_at)).toBe(Date.parse(OLD));
    expect(await events(app(1))).toEqual([]);
  });

  test("another company's application is nobody's to edit", async () => {
    const ada = member("user_cedit_ada");
    expect(await moveCandidate(ada, ctx(ADMIN, "admin"), { applicationId: GLOBEX_APP, stage: "interviewing", expectedStage: "screening", reasonId: null, note: null })).toEqual({ ok: false, error: "not_found" });
    expect(await setCandidateOwner(ada, ADMIN, { applicationId: GLOBEX_APP, ownerActorId: ADMIN })).toEqual({ ok: false, error: "not_found" });
    expect(await logCandidateTouch(ada, ADMIN, { applicationId: GLOBEX_APP, note: null })).toEqual({ ok: false, error: "not_found" });
    expect((await application(GLOBEX_APP)).stage).toBe("screening");
    expect(await events(GLOBEX_APP)).toEqual([]);
  });
});
