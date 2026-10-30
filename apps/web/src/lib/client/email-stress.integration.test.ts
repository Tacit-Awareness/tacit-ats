import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";

import { draftReply, readReply, sendDraft } from "./email";
import { readInbox } from "./inbox";

/**
 * Candidate email under stress, on members' own tokens with a FAKE mailer:
 * each kind of member calling the draft and the send directly, as a posted
 * form could, a stale page, odd text, and a draft pile that never shrinks,
 * since a draft can't be discarded.
 */

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const db = () => getSupabaseServiceClient();

const ORG = "e7000000-0000-4000-8000-0000000000a1";
const OTHER = "e7000000-0000-4000-8000-0000000000a2";
const ADMIN = "e7a00000-0000-4000-8000-0000000000a1";
const NIA = "e7a00000-0000-4000-8000-0000000000a2";
const CORA = "e7a00000-0000-4000-8000-0000000000a3";
const REX = "e7a00000-0000-4000-8000-0000000000a4";
const IVY = "e7a00000-0000-4000-8000-0000000000a5";
const RAY = "e7a00000-0000-4000-8000-0000000000a6";
const FAY = "e7a00000-0000-4000-8000-0000000000a7";
const GIL = "e7a00000-0000-4000-8000-0000000000a8";
const STRANGER = "e7a00000-0000-4000-8000-0000000000b1";
const JOB = "e7b00000-0000-4000-8000-0000000000a1";
const JOB2 = "e7b00000-0000-4000-8000-0000000000a2";
const OTHER_JOB = "e7b00000-0000-4000-8000-0000000000a3";
const person = (n: number) => `e7c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const app = (n: number) => `e7d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const OTHER_PERSON = "e7c10000-0000-4000-8000-0000000000a1";
const OTHER_APP = "e7d10000-0000-4000-8000-0000000000a1";

const WORKOS = "org_itest_em_stress";
const OTHER_WORKOS = "org_itest_em_stress_other";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ORG, OTHER];
  for (const table of ["candidate_emails", "application_events", "applications", "hiring_team", "job_access", "person_identifiers", "people", "roles", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("audit_log").delete().in("org_id", ids);
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

type Member = { actorId: string; accessLevel: clientTools.ClientToolCtx["accessLevel"]; sub: string; workos?: string; orgId?: string };
const members = {
  admin: { actorId: ADMIN, accessLevel: "admin", sub: "u_es_ada" },
  hiringManager: { actorId: NIA, accessLevel: "elevated", sub: "u_es_nia" },
  recruiter: { actorId: RAY, accessLevel: "elevated", sub: "u_es_ray" },
  coordinator: { actorId: CORA, accessLevel: "elevated", sub: "u_es_cora" },
  externalRecruiter: { actorId: REX, accessLevel: "elevated", sub: "u_es_rex" },
  interviewerSeat: { actorId: IVY, accessLevel: "elevated", sub: "u_es_ivy" },
  limited: { actorId: GIL, accessLevel: "limited", sub: "u_es_gil" },
  offTheJob: { actorId: FAY, accessLevel: "elevated", sub: "u_es_fay" },
  otherCompany: { actorId: STRANGER, accessLevel: "admin", sub: "u_es_stranger", workos: OTHER_WORKOS, orgId: OTHER },
} satisfies Record<string, Member>;

const client = (m: Member) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject: m.sub, workosOrgId: m.workos ?? WORKOS }));
};
const ctx = (m: Member): clientTools.ClientToolCtx => ({ actorId: m.actorId, orgId: m.orgId ?? ORG, accessLevel: m.accessLevel, source: "dashboard" });

const fakeMailer = (fail = false) => {
  const send = vi.fn(async (_: { from: string; replyTo?: string; to: string; subject: string; text: string; idempotencyKey?: string }) => {
    if (fail) throw new Error("Resend refused the email: nope");
    return { id: `re_fake_${send.mock.calls.length}` };
  });
  const mailer: clientTools.ClientMailer = { send, fromAddress: "hiring@example.test" };
  return { send, mailer };
};

const reply = { candidateId: person(1), applicationId: app(1), subject: "Your application", body: "Hi Cam" };
const write = async (m: Member, over: Partial<typeof reply> = {}) => {
  const out = await draftReply(client(m), ctx(m), fakeMailer().mailer, { ...reply, ...over });
  if (!out.ok) throw new Error(out.error);
  // Every draft has its own moment: created_at is what orders them.
  await new Promise((r) => setTimeout(r, 3));
  return out.draftId;
};
const row = async (id: string) => (await db().from("candidate_emails").select("*").eq("id", id).single()).data!;
const ticket = (m: Member = members.admin) => readReply(client(m), ctx(m), fakeMailer().mailer, { candidateId: person(1), applicationId: app(1) });

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ORG, name: "Acme, Inc", slug: "itest-em-stress", kind: "client", workos_org_id: WORKOS },
    { id: OTHER, name: "Globex", slug: "itest-em-stress-other", kind: "client", workos_org_id: OTHER_WORKOS },
  ]));
  const actor = (id: string, slug: string, access_level: string, auth_subject: string, org_id = ORG) => ({ id, org_id, slug, display_name: `Member ${slug}`, email: `${slug}@es.test`, access_level, auth_subject });
  must(await db().from("actors").insert([
    actor(ADMIN, "es-ada", "admin", members.admin.sub),
    actor(NIA, "es-nia", "elevated", members.hiringManager.sub),
    actor(RAY, "es-ray", "elevated", members.recruiter.sub),
    actor(CORA, "es-cora", "elevated", members.coordinator.sub),
    actor(REX, "es-rex", "elevated", members.externalRecruiter.sub),
    actor(IVY, "es-ivy", "elevated", members.interviewerSeat.sub),
    actor(GIL, "es-gil", "limited", members.limited.sub),
    actor(FAY, "es-fay", "elevated", members.offTheJob.sub),
    actor(STRANGER, "es-stranger", "admin", members.otherCompany.sub, OTHER),
  ]));
  for (const [org, name, roles] of [
    [ORG, "Acme", [[JOB, "Founding Engineer"], [JOB2, "Designer"]]],
    [OTHER, "Globex", [[OTHER_JOB, "Globex Role"]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title]) => ({ id, org_id: org, company_id: company!.id, title, status: "open" }))));
  }
  must(await db().from("hiring_team").insert([
    { org_id: ORG, role_id: JOB, actor_id: NIA, team_role: "hiring_manager" },
    { org_id: ORG, role_id: JOB, actor_id: RAY, team_role: "recruiter" },
    { org_id: ORG, role_id: JOB, actor_id: CORA, team_role: "coordinator" },
    { org_id: ORG, role_id: JOB, actor_id: IVY, team_role: "interviewer" },
    { org_id: ORG, role_id: JOB, actor_id: GIL, team_role: "interviewer" },
  ]));
  const { data: external } = must(await db().from("access_roles").select("id").eq("org_id", ORG).eq("name", "External Recruiter").single());
  must(await db().from("job_access").insert({ org_id: ORG, actor_id: REX, role_id: JOB, access_role_id: external!.id }));
  must(await db().from("people").insert([
    { id: person(1), org_id: ORG, display_name: "Cam Candidate", email: "Cam@ES.test" },
    { id: person(2), org_id: ORG, display_name: "Dee Designer", email: "dee@es.test" },
    { id: person(3), org_id: ORG, display_name: "Rex's Find", email: "find@es.test", added_by_actor_id: REX },
    { id: person(4), org_id: ORG, display_name: "No Address", email: null },
    { id: person(5), org_id: ORG, display_name: "Brace {{oops}} Name", email: "brace@es.test" },
    { id: OTHER_PERSON, org_id: OTHER, display_name: "Their Candidate", email: "their@es.test" },
  ]));
  must(await db().from("applications").insert([
    { id: app(1), org_id: ORG, person_id: person(1), role_id: JOB, stage: "sourced", source: "job_board" },
    { id: app(2), org_id: ORG, person_id: person(2), role_id: JOB2, stage: "sourced", source: "job_board" },
    { id: app(3), org_id: ORG, person_id: person(3), role_id: JOB, stage: "sourced", source: "job_board", added_by_actor_id: REX },
    { id: app(4), org_id: ORG, person_id: person(4), role_id: JOB, stage: "sourced", source: "job_board" },
    { id: app(5), org_id: ORG, person_id: person(5), role_id: JOB, stage: "sourced", source: "job_board" },
    { id: OTHER_APP, org_id: OTHER, person_id: OTHER_PERSON, role_id: OTHER_JOB, stage: "sourced", source: "job_board" },
  ]));
});

afterAll(clear);

describe("each kind of member, calling the writes by hand", () => {
  test.each([
    ["admin", true],
    ["hiringManager", true],
    ["recruiter", true],
    ["coordinator", false],
    ["interviewerSeat", false],
    ["limited", false],
    ["offTheJob", false],
    ["otherCompany", false],
  ] as const)("%s: the box shows only to whoever a draft would land for", async (who, can) => {
    const m = members[who];
    const { send, mailer } = fakeMailer();
    const written = await draftReply(client(m), ctx(m), mailer, reply);
    expect(written.ok).toBe(can);
    if (who !== "limited") expect((await ticket(m)).canEmail).toBe(can);
    if (!written.ok) {
      expect((await db().from("candidate_emails").select("id").eq("person_id", person(1))).data).toEqual([]);
      return;
    }
    expect(await sendDraft(client(m), ctx(m), mailer, written.draftId)).toEqual({ ok: true });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0].to).toBe("cam@es.test");
  });

  test("an external recruiter emails the candidates they added, and no one else", async () => {
    const m = members.externalRecruiter;
    const { send, mailer } = fakeMailer();
    expect((await draftReply(client(m), ctx(m), mailer, reply)).ok).toBe(false);
    const own = await draftReply(client(m), ctx(m), mailer, { ...reply, candidateId: person(3), applicationId: app(3) });
    expect(own.ok).toBe(true);
    expect(await sendDraft(client(m), ctx(m), mailer, (own as { draftId: string }).draftId)).toEqual({ ok: true });
    expect(send).toHaveBeenCalledOnce();
  });

  test("nobody sends another member's draft, whoever they are", async () => {
    const id = await write(members.hiringManager);
    const { send, mailer } = fakeMailer();
    for (const [m, error] of [
      [members.admin, "send_gone"], // A draft is its author's alone: the policy hides it.
      [members.recruiter, "send_gone"],
      [members.coordinator, "send_gone"],
      [members.externalRecruiter, "send_gone"],
      [members.limited, "send_forbidden"],
      [members.otherCompany, "send_gone"],
    ] as const) {
      expect(await sendDraft(client(m), ctx(m), mailer, id)).toEqual({ ok: false, error });
    }
    expect(send).not.toHaveBeenCalled();
    expect((await row(id)).status).toBe("draft");
  });

  test("another company's candidate, application or draft is out of reach, in any mix", async () => {
    const m = members.admin;
    const { mailer } = fakeMailer();
    expect(await draftReply(client(m), ctx(m), mailer, { ...reply, candidateId: OTHER_PERSON })).toMatchObject({ ok: false });
    expect(await draftReply(client(m), ctx(m), mailer, { ...reply, applicationId: OTHER_APP })).toMatchObject({ ok: false });
    expect(await draftReply(client(m), ctx(m), mailer, { ...reply, candidateId: OTHER_PERSON, applicationId: OTHER_APP })).toMatchObject({ ok: false });
    expect(await draftReply(client(m), ctx(m), mailer, { ...reply, applicationId: app(2) })).toMatchObject({ ok: false });
    expect((await db().from("candidate_emails").select("id").in("org_id", [ORG, OTHER])).data).toEqual([]);
  });

  test("a member who can still read the candidate but no longer edit them is told so, not that it already went", async () => {
    const m = members.hiringManager;
    const id = await write(m);
    const { data: coordinator } = must(await db().from("access_roles").select("id").eq("org_id", ORG).eq("name", "Hiring Team Member").single());
    must(await db().from("job_access").update({ access_role_id: coordinator!.id }).eq("role_id", JOB).eq("actor_id", NIA));
    const { send, mailer } = fakeMailer();
    expect(await sendDraft(client(m), ctx(m), mailer, id)).toEqual({ ok: false, error: "send_forbidden" });
    expect(send).not.toHaveBeenCalled();
    expect((await row(id)).status).toBe("draft");
  });
});

describe("a stale page", () => {
  test("a draft replaced by one that went out is never offered on the ticket again", async () => {
    const m = members.admin;
    await write(m, { body: "First go" });
    const second = await write(m, { body: "Second go" });
    const { mailer } = fakeMailer();
    expect(await sendDraft(client(m), ctx(m), mailer, second)).toEqual({ ok: true });

    const read = await ticket();
    expect(read.draft).toBeNull();
    expect(read.sent?.subject).toBe(reply.subject);
  });

  test("a draft replaced by one the provider refused: the box has the refused words, not the old draft", async () => {
    const m = members.admin;
    await write(m, { body: "First go" });
    const second = await write(m, { body: "Second go" });
    const { mailer } = fakeMailer(true);
    expect(await sendDraft(client(m), ctx(m), mailer, second)).toEqual({ ok: false, error: "send_refused" });

    const read = await ticket();
    expect(read.draft).toBeNull();
    expect(read.failed?.body).toBe("Second go");
  });

  test("a page still showing the replaced draft can't send it: another tab changed it", async () => {
    const m = members.admin;
    const first = await write(m, { body: "First go" });
    await write(m, { body: "Second go" });
    const { send, mailer } = fakeMailer();
    expect(await sendDraft(client(m), ctx(m), mailer, first)).toEqual({ ok: false, error: "send_stale" });
    expect(send).not.toHaveBeenCalled();
    expect((await row(first)).status).toBe("draft");
  });

  test("and once the newer one went, the old page's Send delivers nothing second", async () => {
    const m = members.admin;
    const first = await write(m, { body: "First go" });
    const second = await write(m, { body: "Second go" });
    const { send, mailer } = fakeMailer();
    await sendDraft(client(m), ctx(m), mailer, second);
    expect(await sendDraft(client(m), ctx(m), mailer, first)).toEqual({ ok: false, error: "send_stale" });
    expect(send).toHaveBeenCalledOnce();
  });

  test("the newest draft still sends, and so does one on no application", async () => {
    const m = members.admin;
    await write(m, { body: "First go" });
    const newest = await write(m, { body: "Second go" });
    const { send, mailer } = fakeMailer();
    expect(await sendDraft(client(m), ctx(m), mailer, newest)).toEqual({ ok: true });

    const loose = await clientTools.draftEmail(client(m), ctx(m), mailer, { candidateId: person(1), subject: "Loose", body: "Loose" });
    expect(await sendDraft(client(m), ctx(m), mailer, loose.draftId)).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);
  });

  test("a colleague's newer email doesn't stop a member's own draft: the page says who wrote, and it's their call", async () => {
    const own = await write(members.admin, { body: "Mine" });
    const theirs = await write(members.hiringManager, { body: "Theirs" });
    const { mailer } = fakeMailer();
    await sendDraft(client(members.hiringManager), ctx(members.hiringManager), mailer, theirs);
    const read = await ticket();
    expect(read.draft?.draftId).toBe(own);
    expect(read.sent?.by).toBe("Member es-nia");
    expect(await sendDraft(client(members.admin), ctx(members.admin), mailer, own)).toEqual({ ok: true });
  });

  test("twenty Sends on the newest draft in two tabs at once deliver one email", async () => {
    const m = members.admin;
    const id = await write(m);
    const { send, mailer } = fakeMailer();
    const outcomes = await Promise.all(Array.from({ length: 20 }, () => sendDraft(client(m), ctx(m), mailer, id)));
    expect(send).toHaveBeenCalledOnce();
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    for (const o of outcomes.filter((x) => !x.ok)) expect(o).toEqual({ ok: false, error: "send_already" });
  });

  test("twenty Review drafts at once leave one the page shows, the newest", async () => {
    const m = members.admin;
    const outs = await Promise.all(Array.from({ length: 20 }, (_, i) => draftReply(client(m), ctx(m), fakeMailer().mailer, { ...reply, body: `Go ${i}` })));
    expect(outs.every((o) => o.ok)).toBe(true);
    const read = await ticket();
    expect(read.draft).not.toBeNull();
    const newest = (await db().from("candidate_emails").select("id").eq("person_id", person(1)).order("created_at", { ascending: false }).limit(1).single()).data!;
    expect(read.draft?.draftId).toBe(newest.id);
  });
});

describe("what a member can type", () => {
  const m = members.admin;
  const typed = (over: Partial<typeof reply>) => draftReply(client(m), ctx(m), fakeMailer().mailer, { ...reply, ...over });

  test.each([
    ["empty subject", { subject: "" }],
    ["spaces for a subject", { subject: "   \n " }],
    ["empty body", { body: "" }],
    ["spaces for a body", { body: " \n\t " }],
    ["a subject past the limit", { subject: "x".repeat(301) }],
    ["a body past the limit", { body: "x".repeat(20001) }],
    ["an unknown placeholder", { body: "Hello {{ salary }}" }],
    ["a placeholder in the subject", { subject: "{{nope}}" }],
  ])("%s is refused with a sentence and writes nothing", async (_, over) => {
    const out = await typed(over);
    expect(out).toMatchObject({ ok: false, error: expect.any(String) });
    expect((await db().from("candidate_emails").select("id").eq("person_id", person(1))).data).toEqual([]);
  });

  test.each([
    ["a NUL", { body: "before\u0000after" }],
    ["half a surrogate pair", { body: "before\ud83dafter" }],
    ["a NUL in the subject", { subject: "a\u0000b" }],
  ])("%s never reaches the provider, and says nothing went out", async (_, over) => {
    const outcome = await typed(over).catch((err: Error) => ({ ok: false, thrown: err.message }));
    if (outcome.ok) {
      // Stored some other way is fine; what matters is it reads back as what's sent.
      const read = await ticket();
      expect(read.draft).not.toBeNull();
    } else {
      expect((await db().from("candidate_emails").select("id").eq("person_id", person(1))).data).toEqual([]);
    }
  });

  test("the limits themselves land, in emoji too, and markup stays text", async () => {
    expect((await typed({ subject: "x".repeat(300), body: "x".repeat(20000) })).ok).toBe(true);
    expect((await typed({ subject: "🦄".repeat(150), body: "🦄".repeat(10000) })).ok).toBe(true);
    const id = await write(m, { subject: "<b>x</b> & \"y\"", body: "<script>alert(1)</script>\r\n\r\nنعم 日本語 Z͑ͫ̓ͪ̂ͫ̽͏̴̙̤̞͉͚̯̞̠͍" });
    const stored = await row(id);
    expect(stored.subject).toBe("<b>x</b> & \"y\"");
    expect(stored.body).toBe("<script>alert(1)</script>\n\nنعم 日本語 Z͑ͫ̓ͪ̂ͫ̽͏̴̙̤̞͉͚̯̞̠͍");
    const { send, mailer } = fakeMailer();
    await sendDraft(client(m), ctx(m), mailer, id);
    expect(send.mock.calls[0]![0].text).toBe(stored.body);
  });

  test("a placeholder a member typed is filled before they read it, so the page shows what goes out", async () => {
    const id = await write(m, { subject: "{{ job_title }}", body: "Hi {{candidate_first_name}}, {{company_name}} here." });
    expect(await row(id)).toMatchObject({ subject: "Founding Engineer", body: "Hi Cam, Acme, Inc here." });
  });

  test("a candidate whose name carries braces is refused, not filled with something else", async () => {
    const out = await draftReply(client(m), ctx(m), fakeMailer().mailer, { candidateId: person(5), applicationId: app(5), subject: "s", body: "Hi {{candidate_name}}" });
    expect(out.ok).toBe(false);
  });

  test("a candidate with no address is refused with a sentence", async () => {
    const out = await draftReply(client(m), ctx(m), fakeMailer().mailer, { candidateId: person(4), applicationId: app(4), subject: "s", body: "b" });
    expect(out).toEqual({ ok: false, error: expect.stringContaining("no email address on file") });
  });

  test("a comma and quotes in a company or a name stay one From", async () => {
    must(await db().from("actors").update({ display_name: 'Ada "The\nBoss" <admin>' }).eq("id", ADMIN));
    const id = await write(m);
    const { send, mailer } = fakeMailer();
    await sendDraft(client(m), ctx(m), mailer, id);
    expect(send.mock.calls[0]![0].from).toBe('"Ada TheBoss admin at Acme, Inc" <hiring@example.test>');
  });

  test("no words reach the audit rows", async () => {
    const id = await write(m, { subject: "SECRET-SUBJECT", body: "SECRET-BODY" });
    await sendDraft(client(m), ctx(m), fakeMailer(true).mailer, id);
    const rows = (await db().from("audit_log").select("*").eq("org_id", ORG).like("action", "email.%")).data ?? [];
    expect(rows.map((r) => r.source)).toEqual(["dashboard", "dashboard"]);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|Resend refused/);
  });
});

describe("a member with thousands of dead drafts", () => {
  const m = members.admin;
  const unsent = async (at: Date) => (await readInbox(client(m), ctx(m), at)).issues.filter((i) => i.reason === "draft");
  const later = () => new Date(Date.now() + 3 * 3_600_000);

  test("drafts replaced on one application don't push out a current draft on another", async () => {
    const current = await write(m, { candidateId: person(2), applicationId: app(2), subject: "Still current" });
    const rows = Array.from({ length: 150 }, () => ({ org_id: ORG, person_id: person(1), application_id: app(1), author_actor_id: ADMIN, to_email: "cam@es.test", subject: "Old", body: "Old" }));
    must(await db().from("candidate_emails").insert(rows));
    await new Promise((r) => setTimeout(r, 3));
    await write(m, { subject: "Newest" });

    const read = await readInbox(client(m), ctx(m), later());
    const drafts = read.issues.filter((i) => i.reason === "draft");
    expect(drafts.map((i) => i.draft?.subject).sort()).toEqual(["Newest", "Still current"].sort());
    expect(drafts.map((i) => i.draft?.draftId)).toContain(current);
    expect(read.draftsCapped).toBe(false);
  });

  test("more current drafts than the list holds still says so", async () => {
    const rows = Array.from({ length: 105 }, () => ({ org_id: ORG, person_id: person(1), author_actor_id: ADMIN, to_email: "cam@es.test", subject: "Loose", body: "Loose" }));
    must(await db().from("candidate_emails").insert(rows));
    const read = await readInbox(client(m), ctx(m), later());
    expect(read.issues.filter((i) => i.reason === "draft")).toHaveLength(100);
    expect(read.draftsCapped).toBe(true);
  });

  test("an empty org's Inbox has no drafts and no notice", async () => {
    expect(await unsent(later())).toEqual([]);
    expect((await readInbox(client(m), ctx(m), later())).draftsCapped).toBe(false);
  });
});
