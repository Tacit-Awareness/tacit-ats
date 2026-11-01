import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";

import { keepReply } from "../inbound/email-reply";
import { draftReply, readReply, readSender, sendDraft } from "./email";
import { readInbox, readIssue } from "./inbox";

/**
 * Candidate email from the web app against the local stack, on members' own
 * tokens, with a FAKE mailer: nothing here reaches Resend. The policies decide
 * who can draft and send, a draft is what goes out, once, and the audit rows say
 * `dashboard` and hold no words. The member token is signed with the stack's
 * JWT secret, as in pipeline.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "c5000000-0000-4000-8000-0000000000f1";
const GLOBEX = "c5100000-0000-4000-8000-0000000000f2";
const ADMIN = "c5a00000-0000-4000-8000-0000000000f1";
const LEAD = "c5a00000-0000-4000-8000-0000000000f2";
const INTERVIEWER = "c5a00000-0000-4000-8000-0000000000f3";
const OUTSIDER = "c5a10000-0000-4000-8000-0000000000f1";
const ENGINEER = "c5b00000-0000-4000-8000-0000000000f1";
const DESIGNER = "c5b00000-0000-4000-8000-0000000000f2";
const GLOBEX_ROLE = "c5b10000-0000-4000-8000-0000000000f1";
const person = (n: number) => `c5c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const app = (n: number) => `c5d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_PERSON = "c5c10000-0000-4000-8000-0000000000f1";
const GLOBEX_APP = "c5d10000-0000-4000-8000-0000000000f1";

const ACME_WORKOS = "org_itest_email_acme";
const GLOBEX_WORKOS = "org_itest_email_globex";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["candidate_emails", "application_events", "applications", "hiring_team", "person_identifiers", "people", "roles", "companies"] as const) {
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
const ctx = (actorId: string, accessLevel: clientTools.ClientToolCtx["accessLevel"], orgId = ACME): clientTools.ClientToolCtx => ({ actorId, orgId, accessLevel, source: "dashboard" });

const ada = ctx(ADMIN, "admin");
const lee = ctx(LEAD, "elevated");
const ivan = ctx(INTERVIEWER, "limited");
const asAda = () => token("user_em_ada");
const asLee = () => token("user_em_lee");

/** The fake: records what it was handed and sends nothing. */
const fakeMailer = () => {
  const send = vi.fn(async (_: { from: string; replyTo?: string; to: string; subject: string; text: string; idempotencyKey?: string }) => ({ id: `re_fake_${send.mock.calls.length}` }));
  const mailer: clientTools.ClientMailer = { send, fromAddress: "hiring@example.test" };
  return { send, mailer };
};

const reply = { candidateId: person(1), applicationId: app(1), subject: "Your application", body: "Hi Cam,\n\nLet's talk.\n\nAda" };

const drafted = async (over: Partial<typeof reply> = {}, client = asAda(), who = ada) => {
  const out = await draftReply(client, who, fakeMailer().mailer, { ...reply, ...over });
  if (!out.ok) throw new Error(out.error);
  return out.draftId;
};

const row = async (id: string) => (await db().from("candidate_emails").select("*").eq("id", id).single()).data!;
const audit = async () => (await db().from("audit_log").select("source, action, entity, entity_id, before, after").eq("org_id", ACME).like("action", "email.%").order("created_at")).data ?? [];

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-email-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-email-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-em-admin", display_name: "Ada Admin", email: "ada@em.test", access_level: "admin", auth_subject: "user_em_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-em-lead", display_name: "Lee Lead", email: "lee@em.test", access_level: "elevated", auth_subject: "user_em_lee" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-em-ivan", display_name: "Ivan Interviewer", email: "ivan@em.test", access_level: "limited", auth_subject: "user_em_ivan" },
    { id: OUTSIDER, org_id: GLOBEX, slug: "itest-em-gina", display_name: "Gina Globex", email: "gina@em.test", access_level: "admin", auth_subject: "user_em_gina" },
  ]));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer"], [DESIGNER, "Designer"]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role"]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title]) => ({ id, org_id: org, company_id: company!.id, title, status: "open" }))));
  }
  // Lee manages the engineer search only; Ivan interviews for it.
  must(await db().from("hiring_team").insert([
    { org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" },
    { org_id: ACME, role_id: ENGINEER, actor_id: INTERVIEWER, team_role: "interviewer" },
  ]));
  must(await db().from("people").insert([
    { id: person(1), org_id: ACME, display_name: "Cam Candidate", email: "cam@em.test" },
    { id: person(2), org_id: ACME, display_name: "Dee Designer", email: "dee@em.test" },
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@em.test" },
  ]));
  must(await db().from("applications").insert([
    { id: app(1), org_id: ACME, person_id: person(1), role_id: ENGINEER, stage: "sourced", source: "job_board" },
    { id: app(2), org_id: ACME, person_id: person(2), role_id: DESIGNER, stage: "sourced", source: "job_board" },
    { id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "sourced", source: "job_board" },
  ]));
});

afterAll(clear);

describe("writing a draft", () => {
  test("writes exactly what was typed, sends nothing, and the audit row says dashboard with no words in it", async () => {
    const { send, mailer } = fakeMailer();
    const out = await draftReply(asAda(), ada, mailer, reply);
    expect(out.ok).toBe(true);
    expect(send).not.toHaveBeenCalled();
    const id = (out as { draftId: string }).draftId;
    expect(await row(id)).toMatchObject({ status: "draft", to_email: "cam@em.test", subject: reply.subject, body: reply.body, application_id: app(1), author_actor_id: ADMIN });

    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "dashboard", action: "email.draft", entity: "candidate_email", entity_id: id });
    expect(JSON.stringify(rows)).not.toContain("Let's talk");
    expect(JSON.stringify(rows)).not.toContain(reply.subject);
  });

  test("the page shows the stored draft, From and Replies, to its author alone", async () => {
    const id = await drafted();
    const { mailer } = fakeMailer();
    const mine = await readReply(asAda(), ada, mailer, { candidateId: person(1), applicationId: app(1) });
    expect(mine).toMatchObject({
      canEmail: true,
      draft: { draftId: id, to: "cam@em.test", subject: reply.subject, body: reply.body },
      sender: { from: '"Ada Admin at Acme" <hiring@example.test>', replyTo: "ada@em.test" },
      sent: null,
      failed: null,
    });
    expect((await readReply(asLee(), lee, mailer, { candidateId: person(1), applicationId: app(1) })).draft).toBeNull();
  });

  test("with no mailer nothing is written", async () => {
    const out = await draftReply(asAda(), ada, null, reply);
    expect(out).toMatchObject({ ok: false });
    expect((await db().from("candidate_emails").select("id").eq("org_id", ACME)).data).toEqual([]);
    expect(await audit()).toEqual([]);
  });

  test("an interviewer gets no reply box and is refused", async () => {
    const { mailer } = fakeMailer();
    const ivanDb = token("user_em_ivan");
    expect(await readReply(ivanDb, ivan, mailer, { candidateId: person(1), applicationId: app(1) })).toMatchObject({ canEmail: false, draft: null });
    expect(await draftReply(ivanDb, ivan, mailer, reply)).toEqual({ ok: false, error: expect.stringContaining("Interviewers") });
  });

  test("a hiring manager can't write to a candidate on a job that isn't theirs", async () => {
    const { mailer } = fakeMailer();
    const out = await draftReply(asLee(), lee, mailer, { candidateId: person(2), applicationId: app(2), subject: "x", body: "y" });
    expect(out.ok).toBe(false);
    expect((await db().from("candidate_emails").select("id").eq("person_id", person(2))).data).toEqual([]);
  });

  test("another company's candidate is not there at all, and the sentence names no tool", async () => {
    const { mailer } = fakeMailer();
    const out = await draftReply(asAda(), ada, mailer, { candidateId: GLOBEX_PERSON, applicationId: GLOBEX_APP, subject: "x", body: "y" });
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/isn't one you can see/) });
  });

  test("an application that isn't this candidate's is refused in the page's words", async () => {
    const { mailer } = fakeMailer();
    const out = await draftReply(asAda(), ada, mailer, { ...reply, applicationId: app(2) });
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/isn't one you can see/) });
  });

  test.each([
    ["an empty body", { body: "   " }, /needs a body/],
    ["an empty subject", { subject: " " }, /needs a subject/],
    ["a subject too long", { subject: "x".repeat(301) }, /at most 300/],
    ["a body too long", { body: "x".repeat(20001) }, /at most 20000/],
    ["an unknown placeholder", { body: "Hi {{nickname}}" }, /fills only these/],
  ])("%s is refused in a sentence, and nothing is written", async (_, over, sentence) => {
    const { mailer } = fakeMailer();
    expect(await draftReply(asAda(), ada, mailer, { ...reply, ...over })).toEqual({ ok: false, error: expect.stringMatching(sentence) });
    expect((await db().from("candidate_emails").select("id").eq("org_id", ACME)).data).toEqual([]);
  });

  test("a line break in a subject can't add a header: it is one line", async () => {
    const id = await drafted({ subject: "Hello\r\nBcc: everyone@em.test" });
    expect((await row(id)).subject).toBe("Hello Bcc: everyone@em.test");
  });

  test("a read-only connector does not stop the web app", async () => {
    must(await db().from("orgs").update({ connector_access: "read_only" }).eq("id", ACME));
    const { send, mailer } = fakeMailer();
    const id = await drafted();
    expect(await sendDraft(asAda(), ada, mailer, id)).toEqual({ ok: true });
    expect(send).toHaveBeenCalledOnce();
  });
});

describe("Send", () => {
  test("delivers the stored draft through the mailer, once, and marks the application touched", async () => {
    const id = await drafted();
    const before = (await db().from("applications").select("last_touch_at").eq("id", app(1)).single()).data!.last_touch_at;
    const { send, mailer } = fakeMailer();
    expect(await sendDraft(asAda(), ada, mailer, id)).toEqual({ ok: true });

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toEqual({
      from: '"Ada Admin at Acme" <hiring@example.test>', replyTo: "ada@em.test", to: "cam@em.test", subject: reply.subject, text: reply.body, idempotencyKey: id,
    });
    expect(await row(id)).toMatchObject({ status: "sent", provider_id: "re_fake_1" });
    const after = (await db().from("applications").select("last_touch_at").eq("id", app(1)).single()).data!.last_touch_at;
    expect(Date.parse(after!)).toBeGreaterThanOrEqual(Date.parse(before!));

    const rows = await audit();
    expect(rows.map((r) => [r.source, r.action])).toEqual([["dashboard", "email.draft"], ["dashboard", "email.send"]]);
    expect(JSON.stringify(rows)).not.toContain("Let's talk");
    expect(JSON.stringify(rows)).not.toContain(reply.subject);
  });

  test("the page then says who emailed, and nobody has a draft to send", async () => {
    const id = await drafted();
    const { mailer } = fakeMailer();
    await sendDraft(asAda(), ada, mailer, id);
    const seen = await readReply(asLee(), lee, mailer, { candidateId: person(1), applicationId: app(1) });
    expect(seen).toMatchObject({ draft: null, sent: { subject: reply.subject, by: "Ada Admin" } });
    expect((await readReply(asAda(), ada, mailer, { candidateId: person(1), applicationId: app(1) })).sent?.by).toBe("You");
  });

  test("a second press sends nothing", async () => {
    const id = await drafted();
    const { send, mailer } = fakeMailer();
    await sendDraft(asAda(), ada, mailer, id);
    expect(await sendDraft(asAda(), ada, mailer, id)).toEqual({ ok: false, error: "send_already" });
    expect(send).toHaveBeenCalledOnce();
  });

  test("twenty presses at once deliver one email", async () => {
    const id = await drafted();
    const { send, mailer } = fakeMailer();
    const out = await Promise.all(Array.from({ length: 20 }, () => sendDraft(asAda(), ada, mailer, id)));
    expect(send).toHaveBeenCalledOnce();
    expect(out.filter((o) => o.ok)).toHaveLength(1);
    expect(out.filter((o) => !o.ok).every((o) => !o.ok && o.error === "send_already")).toBe(true);
  });

  test("with no mailer, or a mailer that can't send, nothing happens and the draft is kept", async () => {
    const id = await drafted();
    expect(await sendDraft(asAda(), ada, null, id)).toEqual({ ok: false, error: "send_off" });
    expect(await sendDraft(asAda(), ada, { send: null, fromAddress: "hiring@example.test" }, id)).toEqual({ ok: false, error: "send_off" });
    expect((await row(id)).status).toBe("draft");
  });

  test("the provider refusing leaves it failed, out of the box, and its words come back to write again", async () => {
    const id = await drafted();
    const { mailer, send } = fakeMailer();
    send.mockRejectedValueOnce(new Error("Resend said no: cam@em.test"));
    expect(await sendDraft(asAda(), ada, mailer, id)).toEqual({ ok: false, error: "send_refused" });
    expect((await row(id)).status).toBe("failed");
    const seen = await readReply(asAda(), ada, mailer, { candidateId: person(1), applicationId: app(1) });
    expect(seen).toMatchObject({ draft: null, sent: null, failed: { subject: reply.subject, body: reply.body } });
    expect(await sendDraft(asAda(), ada, mailer, id)).toEqual({ ok: false, error: "send_refused" });
    expect(send).toHaveBeenCalledOnce();
  });

  test("only its author can send it, and to anyone else it isn't there", async () => {
    const id = await drafted();
    const { send, mailer } = fakeMailer();
    expect(await sendDraft(asLee(), lee, mailer, id)).toEqual({ ok: false, error: "send_gone" });
    expect(await sendDraft(token("user_em_gina", GLOBEX_WORKOS), ctx(OUTSIDER, "admin", GLOBEX), mailer, id)).toEqual({ ok: false, error: "send_gone" });
    expect(send).not.toHaveBeenCalled();
    expect((await row(id)).status).toBe("draft");
  });

  test("an interviewer can't send, whatever id they post", async () => {
    const id = await drafted();
    const { send, mailer } = fakeMailer();
    expect(await sendDraft(token("user_em_ivan"), ivan, mailer, id)).toEqual({ ok: false, error: "send_forbidden" });
    expect(send).not.toHaveBeenCalled();
  });

  test("an address changed since the draft stops the send", async () => {
    const id = await drafted();
    must(await db().from("people").update({ email: "new@em.test" }).eq("id", person(1)));
    // The old address stays on file as an identifier until someone removes it.
    must(await db().from("person_identifiers").delete().eq("person_id", person(1)).eq("kind", "email").eq("value", "cam@em.test"));
    const { send, mailer } = fakeMailer();
    expect(await sendDraft(asAda(), ada, mailer, id)).toEqual({ ok: false, error: "send_address" });
    expect(send).not.toHaveBeenCalled();
    expect((await row(id)).status).toBe("draft");
  });

  test("someone who lost the job since writing it can't send it", async () => {
    const id = await drafted({}, asLee(), lee);
    must(await db().from("hiring_team").delete().eq("role_id", ENGINEER).eq("actor_id", LEAD));
    const { send, mailer } = fakeMailer();
    const out = await sendDraft(asLee(), lee, mailer, id);
    expect(out.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  test("the thirty-first in an hour is refused before it reaches the provider", async () => {
    const ids = Array.from({ length: 30 }, () => globalThis.crypto.randomUUID());
    must(await db().from("candidate_emails").insert(ids.map((id) => ({ id, org_id: ACME, person_id: person(1), author_actor_id: ADMIN, to_email: "cam@em.test", subject: "Old", body: "Old" }))));
    must(await db().from("candidate_emails").update({ status: "sending" }).in("id", ids));
    const id = await drafted();
    const { send, mailer } = fakeMailer();
    expect(await sendDraft(asAda(), ada, mailer, id)).toEqual({ ok: false, error: "send_rate" });
    expect(send).not.toHaveBeenCalled();
  });

  test("with no address of their own on file the sender can't be said, and the send is refused", async () => {
    const id = await drafted();
    must(await db().from("actors").update({ email: null }).eq("id", ADMIN));
    const { send, mailer } = fakeMailer();
    expect(await readSender(asAda(), ada, mailer)).toBeNull();
    expect(await sendDraft(asAda(), ada, mailer, id)).toEqual({ ok: false, error: "send_no_reply_to" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("the Inbox's unsent drafts", () => {
  const unsent = async (at: Date) => (await readInbox(asAda(), ada, at)).issues.filter((i) => i.reason === "draft");
  const later = () => new Date(Date.now() + 3 * 3_600_000);

  test("a changed draft replaces the old one in the queue, which never comes back once the new one goes", async () => {
    const old = await drafted({ body: "First go" });
    await new Promise((r) => setTimeout(r, 5));
    const current = await drafted({ body: "Second go" });
    expect((await unsent(later())).map((i) => i.key)).toEqual([`draft-${current}`]);

    const { mailer } = fakeMailer();
    await sendDraft(asAda(), ada, mailer, current);
    expect(await unsent(later())).toEqual([]);
    expect((await row(old)).status).toBe("draft");
  });

  test("a draft on no application is never out of date", async () => {
    await drafted();
    must(await db().from("candidate_emails").insert({ org_id: ACME, person_id: person(1), author_actor_id: ADMIN, to_email: "cam@em.test", subject: "Loose", body: "Loose" }));
    expect((await unsent(later())).map((i) => i.draft?.subject).sort()).toEqual(["Loose", reply.subject].sort());
  });

  test("Lee's newer draft doesn't hide Ada's: each member's queue is their own", async () => {
    await drafted();
    await drafted({ subject: "Lee's" }, asLee(), lee);
    expect((await unsent(later())).map((i) => i.draft?.subject)).toEqual([reply.subject]);
  });
});

describe("a candidate's reply", () => {
  const forward = () => {
    const send = vi.fn(async (_: { from: string; replyTo?: string; to: string; subject: string; text: string; idempotencyKey?: string }) => ({ id: "re_forward" }));
    return { send, fromAddress: "hiring@example.test" };
  };
  const sent = async () => {
    const id = await drafted();
    const { send, mailer } = fakeMailer();
    expect(await sendDraft(asAda(), ada, { ...mailer, replyDomain: "in.example.test" }, id)).toEqual({ ok: true });
    return { id, replyTo: send.mock.calls[0]![0].replyTo! };
  };
  const arrives = (replyTo: string, providerId = "em_1", f: ReturnType<typeof forward> | null = null) =>
    keepReply(db(), { providerId, from: "Cam <Cam@Cand.test>", to: [replyTo], subject: "Re: Your application", text: "Yes, Tuesday works.\n" }, f);
  const inbox = async () => (await readInbox(asAda(), ada, new Date())).issues.filter((i) => i.reason === "reply");

  test("goes out on the email's own address, lands in the author's Inbox and reaches their own mail, once", async () => {
    const { id, replyTo } = await sent();
    expect(replyTo).toBe(`reply+${id}@in.example.test`);
    const f = forward();
    expect(await arrives(replyTo, "em_1", f)).toBe("forwarded");
    expect(await arrives(replyTo, "em_1", f)).toBe("duplicate");
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send.mock.calls[0]![0]).toMatchObject({ to: "ada@em.test", replyTo: "cam@cand.test" });

    const [issue, ...rest] = await inbox();
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ kind: "reply", why: "Re: Your application", reply: { fromEmail: "cam@cand.test", applicationId: app(1) } });
    expect(JSON.stringify(issue)).not.toContain("Tuesday");
    expect((await readIssue(asAda(), { actorId: ADMIN, orgId: ACME, accessLevel: "admin" }, issue!)).replyBody).toBe("Yes, Tuesday works.");
    const activity = await clientTools.getActivity(asAda(), ada, { candidateId: person(1) });
    expect(activity.entries.find((e) => e.kind === "email.reply")).toMatchObject({ text: "Re: Your application", applicationId: app(1) });
  });

  test("writing to them again clears it, and a later reply brings it back", async () => {
    const { replyTo } = await sent();
    await arrives(replyTo);
    expect(await inbox()).toHaveLength(1);
    await sent();
    expect(await inbox()).toEqual([]);
    await arrives(replyTo, "em_2");
    expect(await inbox()).toHaveLength(1);
  });

  test("is read with the email: not by an interviewer or another company, and not in a teammate's queue", async () => {
    const { replyTo } = await sent();
    await arrives(replyTo);
    expect((await asLee().from("candidate_email_replies").select("id")).data).toHaveLength(1);
    expect((await readInbox(asLee(), lee, new Date())).issues.filter((i) => i.reason === "reply")).toEqual([]);
    expect((await token("user_em_ivan").from("candidate_email_replies").select("id")).data).toEqual([]);
    expect((await token("user_em_out", GLOBEX_WORKOS).from("candidate_email_replies").select("id")).data).toEqual([]);
  });

  test("a member cannot write one", async () => {
    const { id } = await sent();
    const { error } = await asAda().from("candidate_email_replies").insert({ email_id: id, from_email: "x@y.test", provider_id: "forged" });
    expect(error?.code).toBe("42501");
  });

  test("an address naming no sent email keeps nothing", async () => {
    const draft = await drafted();
    expect(await arrives(`reply+${draft}@in.example.test`)).toBe("no_email");
    expect(await arrives("reply+00000000-0000-4000-8000-000000000000@in.example.test")).toBe("no_email");
    expect(await arrives("calendar@in.example.test")).toBe("not_a_reply");
    expect((await db().from("candidate_email_replies").select("id").eq("org_id", ACME)).data).toEqual([]);
  });

  test("goes with the email when the candidate is erased", async () => {
    const { id, replyTo } = await sent();
    await arrives(replyTo);
    must(await db().from("candidate_emails").delete().eq("id", id));
    expect((await db().from("candidate_email_replies").select("id").eq("org_id", ACME)).data).toEqual([]);
  });
});
