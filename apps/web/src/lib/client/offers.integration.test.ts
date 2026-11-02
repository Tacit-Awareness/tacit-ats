import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";

import type { OfferInput } from "./candidate-edit-rules";
import { askOfferApproval, moveOffer, readOffers, saveOffer } from "./offers";

/**
 * The Offer block's reads and writes against the local stack, on members' own
 * tokens, with the policies and the offer triggers deciding. Signed with the
 * stack's JWT secret, as candidate-edits.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e7000000-0000-4000-8000-0000000000c1";
const GLOBEX = "e8000000-0000-4000-8000-0000000000c2";
const ADMIN = "e7a00000-0000-4000-8000-0000000000c1";
const LEAD = "e7a00000-0000-4000-8000-0000000000c2";
const INTERVIEWER = "e7a00000-0000-4000-8000-0000000000c3";
const GLOBEX_ADMIN = "e8a00000-0000-4000-8000-0000000000c1";
const ENGINEER = "e7b00000-0000-4000-8000-0000000000c1";
const DESIGNER = "e7b00000-0000-4000-8000-0000000000c2";
const GLOBEX_ROLE = "e8b00000-0000-4000-8000-0000000000c1";
const PERSON = "e7c00000-0000-4000-8000-0000000000c1";
const GLOBEX_PERSON = "e8c00000-0000-4000-8000-0000000000c1";
const APP = "e7d00000-0000-4000-8000-0000000000c1";
const OTHER_APP = "e7d00000-0000-4000-8000-0000000000c2";
const GLOBEX_APP = "e8d00000-0000-4000-8000-0000000000c1";

const ACME_WORKOS = "org_itest_offers_acme";
const GLOBEX_WORKOS = "org_itest_offers_globex";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  await db().from("audit_log").delete().in("actor_id", [ADMIN, LEAD, INTERVIEWER, GLOBEX_ADMIN]);
  for (const table of ["approval_requests", "approval_flows", "offers", "application_events", "applications", "hiring_team", "people", "roles", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const ctx = (actorId: string, accessLevel: clientTools.ClientToolCtx["accessLevel"], orgId = ACME): clientTools.ClientToolCtx => ({ actorId, orgId, accessLevel, source: "dashboard" });

const member = (subject: string, workosOrgId = ACME_WORKOS) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};

const ada = () => member("user_offers_ada");
const adaCtx = ctx(ADMIN, "admin");

const input = (over: Partial<OfferInput["terms"]> = {}, offerId: string | null = null, applicationId = APP): OfferInput => ({
  applicationId,
  offerId,
  terms: { salary: 185000, currency: "USD", bonus: null, equity: "0.1%", startDate: "2027-03-02", expiresOn: null, notes: "Private note", ...over },
});

const row = async (id: string) => must(await db().from("offers").select("status, salary, notes").eq("id", id).single()).data!;
const onlyOffer = async (applicationId = APP) => must(await db().from("offers").select("id").eq("application_id", applicationId).single()).data!.id;
const audits = async (id: string) => must(await db().from("audit_log").select("source, action, after").eq("entity_id", id).order("created_at")).data!;
const stage = async () => must(await db().from("applications").select("stage").eq("id", APP).single()).data!.stage;

/** A draft by Ada, and its id. */
async function draft(): Promise<string> {
  expect(await saveOffer(ada(), adaCtx, input())).toEqual({ ok: true, notice: "offer_drafted" });
  return onlyOffer();
}

const flow = () => clientTools.setApprovalFlow(ada(), adaCtx, { jobId: ENGINEER, kind: "offer", steps: [[LEAD]] });

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-offers-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-offers-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-offers-admin", display_name: "Ada Admin", email: "ada@offers.test", access_level: "admin", auth_subject: "user_offers_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-offers-lead", display_name: "Lee Lead", email: "lee@offers.test", access_level: "elevated", auth_subject: "user_offers_lee" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-offers-iv", display_name: "Ivy Interviewer", email: "ivy@offers.test", access_level: "limited", auth_subject: "user_offers_ivy" },
    { id: GLOBEX_ADMIN, org_id: GLOBEX, slug: "itest-offers-globex", display_name: "Gil Globex", email: "gil@offers.test", access_level: "admin", auth_subject: "user_offers_gil" },
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
  must(await db().from("people").insert([
    { id: PERSON, org_id: ACME, display_name: "Grace Hopper", email: "grace@offers.test" },
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@offers.test" },
  ]));
  must(await db().from("applications").insert([
    { id: APP, org_id: ACME, person_id: PERSON, role_id: ENGINEER, stage: "interviewing" },
    { id: OTHER_APP, org_id: ACME, person_id: PERSON, role_id: DESIGNER, stage: "screening" },
    { id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "interviewing" },
  ]));
});

afterAll(clear);

describe("who reads offers", () => {
  test("an admin reads every job's; a hiring manager only theirs; an interviewer asks nothing; another company nothing", async () => {
    const id = await draft();
    const all = await readOffers(ada(), adaCtx, [APP, OTHER_APP]);
    expect(all[APP]!.map((o) => o.offerId)).toEqual([id]);
    expect(all[OTHER_APP]).toEqual([]);

    const lee = await readOffers(member("user_offers_lee"), ctx(LEAD, "elevated"), [APP, OTHER_APP]);
    expect(Object.keys(lee)).toEqual([APP]);
    expect(lee[APP]![0]!.salary).toBe(185000);

    expect(await readOffers(member("user_offers_ivy"), ctx(INTERVIEWER, "limited"), [APP])).toEqual({});
    expect(await readOffers(member("user_offers_gil", GLOBEX_WORKOS), ctx(GLOBEX_ADMIN, "admin", GLOBEX), [APP])).toEqual({});
  });
});

describe("drafting", () => {
  test("lands as a draft, audited as dashboard with the notes kept out, and moves no stage", async () => {
    const id = await draft();
    expect(await row(id)).toEqual({ status: "draft", salary: 185000, notes: "Private note" });
    expect(await stage()).toBe("interviewing");
    const [audit] = await audits(id);
    expect(audit).toMatchObject({ source: "dashboard", action: "offer.create" });
    expect(JSON.stringify(audit)).not.toContain("Private note");
  });

  test("a second open offer is refused, and a closed application takes none", async () => {
    await draft();
    expect(await saveOffer(ada(), adaCtx, input())).toEqual({ ok: false, error: "offer_exists" });
    must(await db().from("applications").update({ stage: "rejected" }).eq("id", OTHER_APP));
    expect(await saveOffer(ada(), adaCtx, input({}, null, OTHER_APP))).toEqual({ ok: false, error: "offer_changed" });
  });

  test("a hiring manager on their job and not another; an interviewer and another company never", async () => {
    const lee = member("user_offers_lee");
    // Lee's token reads no application on the other job, so it's nobody's rather than refused.
    expect(await saveOffer(lee, ctx(LEAD, "elevated"), input({}, null, OTHER_APP))).toEqual({ ok: false, error: "offer_gone" });
    expect(await saveOffer(lee, ctx(LEAD, "elevated"), input())).toEqual({ ok: true, notice: "offer_drafted" });
    expect(await saveOffer(member("user_offers_ivy"), ctx(INTERVIEWER, "limited"), input({}, null, OTHER_APP))).toEqual({ ok: false, error: "offer_gone" });
    expect(await saveOffer(member("user_offers_gil", GLOBEX_WORKOS), ctx(GLOBEX_ADMIN, "admin", GLOBEX), input({}, null, OTHER_APP))).toEqual({ ok: false, error: "offer_gone" });
    expect(must(await db().from("offers").select("id").eq("application_id", OTHER_APP)).data).toEqual([]);
  });
});

describe("changing a draft", () => {
  test("saves the terms; the same terms change nothing", async () => {
    const id = await draft();
    expect(await saveOffer(ada(), adaCtx, input({ salary: 190000 }, id))).toEqual({ ok: true, notice: "offer_saved" });
    expect((await row(id)).salary).toBe(190000);
    expect(await saveOffer(ada(), adaCtx, input({ salary: 190000 }, id))).toEqual({ ok: true, notice: "unchanged" });
  });

  test("an offer someone extended since isn't changed", async () => {
    const id = await draft();
    expect(await moveOffer(ada(), adaCtx, { offerId: id, from: "draft", status: "extended" })).toEqual({ ok: true, notice: "offer_extended" });
    expect(await saveOffer(ada(), adaCtx, input({ salary: 1 }, id))).toEqual({ ok: false, error: "offer_changed" });
    expect((await row(id)).salary).toBe(185000);
  });
});

describe("moving an offer on", () => {
  test("extended, then accepted, leaves the stage alone", async () => {
    const id = await draft();
    await moveOffer(ada(), adaCtx, { offerId: id, from: "draft", status: "extended" });
    expect(await moveOffer(ada(), adaCtx, { offerId: id, from: "extended", status: "accepted" })).toEqual({ ok: true, notice: "offer_accepted" });
    expect((await row(id)).status).toBe("accepted");
    expect(await stage()).toBe("interviewing");
  });

  test("a stale page's press is refused, not applied to the offer as it now stands", async () => {
    const id = await draft();
    await moveOffer(ada(), adaCtx, { offerId: id, from: "draft", status: "extended" });
    expect(await moveOffer(ada(), adaCtx, { offerId: id, from: "draft", status: "withdrawn" })).toEqual({ ok: false, error: "offer_changed" });
    expect((await row(id)).status).toBe("extended");
  });

  test("ten presses at once record one outcome", async () => {
    const id = await draft();
    const answers = await Promise.all(Array.from({ length: 10 }, () => moveOffer(ada(), adaCtx, { offerId: id, from: "draft", status: "extended" })));
    expect(answers.filter((a) => a.ok)).toHaveLength(1);
    expect((await audits(id)).filter((a) => a.action === "offer.update")).toHaveLength(1);
  });

  test("a withdrawn offer leaves room for a new draft", async () => {
    const id = await draft();
    await moveOffer(ada(), adaCtx, { offerId: id, from: "draft", status: "withdrawn" });
    expect(await saveOffer(ada(), adaCtx, input({ salary: 200000 }))).toEqual({ ok: true, notice: "offer_drafted" });
  });

  test("someone off the job can't, and another company's offer is nobody's", async () => {
    const id = await draft();
    must(await db().from("hiring_team").delete().eq("role_id", ENGINEER));
    expect(await moveOffer(member("user_offers_lee"), ctx(LEAD, "elevated"), { offerId: id, from: "draft", status: "withdrawn" })).toEqual({ ok: false, error: "offer_gone" });
    expect(await moveOffer(member("user_offers_gil", GLOBEX_WORKOS), ctx(GLOBEX_ADMIN, "admin", GLOBEX), { offerId: id, from: "draft", status: "withdrawn" })).toEqual({ ok: false, error: "offer_gone" });
    expect((await row(id)).status).toBe("draft");
  });
});

describe("a job with an approval flow", () => {
  test("a draft can't go out until it's approved, and asking twice is one request", async () => {
    await flow();
    const id = await draft();
    expect(await moveOffer(ada(), adaCtx, { offerId: id, from: "draft", status: "extended" })).toEqual({ ok: false, error: "offer_approval" });

    expect((await readOffers(ada(), adaCtx, [APP]))[APP]![0]!.approval).toMatchObject({ required: true, status: "not_requested" });
    expect(await askOfferApproval(ada(), adaCtx, id)).toEqual({ ok: true, notice: "offer_asked" });
    expect(await askOfferApproval(ada(), adaCtx, id)).toEqual({ ok: true, notice: "unchanged" });

    const [waiting] = await clientTools.listMyApprovals(member("user_offers_lee"), ctx(LEAD, "elevated"));
    await clientTools.decideApproval(member("user_offers_lee"), ctx(LEAD, "elevated"), { requestId: waiting!.requestId, decision: "approve" });
    expect(await moveOffer(ada(), adaCtx, { offerId: id, from: "draft", status: "extended" })).toEqual({ ok: true, notice: "offer_extended" });
  });

  test("changing approved terms means asking again", async () => {
    await flow();
    const id = await draft();
    await askOfferApproval(ada(), adaCtx, id);
    const [waiting] = await clientTools.listMyApprovals(member("user_offers_lee"), ctx(LEAD, "elevated"));
    await clientTools.decideApproval(member("user_offers_lee"), ctx(LEAD, "elevated"), { requestId: waiting!.requestId, decision: "approve" });

    expect(await saveOffer(ada(), adaCtx, input({ salary: 999999 }, id))).toEqual({ ok: true, notice: "offer_saved" });
    expect((await readOffers(ada(), adaCtx, [APP]))[APP]![0]!.approval?.status).toBe("reset");
    expect(await moveOffer(ada(), adaCtx, { offerId: id, from: "draft", status: "extended" })).toEqual({ ok: false, error: "offer_approval" });
  });
});
