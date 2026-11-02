import { describe, expect, test, vi } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import {
  createEmailTemplate, draftEmail, listEmailReplies, listEmailTemplates, listEmails, sendEmail, updateEmailTemplate, type ClientMailer,
} from "./email.js";

/**
 * What the email tools add on top of the policies and the
 * validate_candidate_email trigger (pinned against real Postgres in the SQL
 * suite and apps/mcp's client.integration.test.ts): a sentence before a
 * refused write, placeholders filled or refused, the audit claim around each
 * write with no subject or body in it, and a send that delivers exactly the
 * stored draft, once, From the Tacit address under the member's name.
 */

const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "admin"): ClientToolCtx => ({
  actorId: "actor-1", orgId: "org-1", accessLevel, source: "claude",
});
const rpcs = (fake: FakeSupabase) => fake.calls.filter((c) => c.op === "rpc").map((c) => c.table);

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

const mailer = (send: ClientMailer["send"] = vi.fn(async () => ({ id: "re_1" }))): ClientMailer => ({
  send, fromAddress: "hiring@tacitawareness.com",
});

const SCREEN = {
  id: "7e000000-0000-4000-8000-000000000001", name: "Screen invite",
  subject: "{{job_title}} at {{company_name}}", body: "Hi {{candidate_first_name}},\n\nCould we talk this week?\n\n{{sender_first_name}}",
  archived_at: null, updated_at: "2026-10-15T00:00:00Z",
};
const OLD = { ...SCREEN, id: "7e000000-0000-4000-8000-000000000002", name: "Old", archived_at: "2026-10-01T00:00:00Z" };
const PAT = { id: "p-1", display_name: "Pat Candidate", email: "Pat@Cand.test" };
const ME = { data: { display_name: "Ada Admin", email: "ada@acme.test" } };
const ACME = { data: { name: "Acme" } };

describe("templates", () => {
  test("an interviewer reads none; only live ones unless archived are asked for", async () => {
    const none = new FakeSupabase();
    expect((await refusal(listEmailTemplates(none.asDb(), ctx("limited")))).code).toBe("forbidden");
    expect(none.calls).toEqual([]);
    const fake = new FakeSupabase([{ data: [SCREEN] }]);
    expect(await listEmailTemplates(fake.asDb(), ctx("elevated"))).toEqual([{
      templateId: SCREEN.id, name: "Screen invite", subject: SCREEN.subject, body: SCREEN.body, archived: false, updatedAt: SCREEN.updated_at,
    }]);
    expect(fake.calls[0].filters).toEqual([{ method: "is", column: "archived_at", value: null }]);
  });

  test("only admins make one, and a placeholder Tacit cannot fill is refused before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(createEmailTemplate(fake.asDb(), ctx("elevated"), { name: "x", subject: "s", body: "b" }))).code).toBe("forbidden");
    const err = await refusal(createEmailTemplate(fake.asDb(), ctx(), { name: "x", subject: "Hi {{salary}}", body: "b" }));
    expect(err.message).toContain("{{candidate_first_name}}");
    expect(fake.calls).toEqual([]);
  });

  test("a name already there, ignoring case, is refused without naming it, and nothing is claimed", async () => {
    const fake = new FakeSupabase([{ data: [SCREEN] }]);
    const err = await refusal(createEmailTemplate(fake.asDb(), ctx(), { name: "screen  INVITE", subject: "s", body: "b" }));
    expect(err.message).toMatch(/already exists/);
    expect(err.message).not.toContain("Screen");
    expect(rpcs(fake)).toEqual([]);
  });

  test("a new one gets its id in code; the audit row keeps its name and not its words", async () => {
    const fake = new FakeSupabase([{ data: [] }, { data: "audit-1" }, { data: null }, { data: null }]);
    const r = await createEmailTemplate(fake.asDb(), ctx(), { name: " Screen   invite ", subject: "Hello\r\nthere", body: "Secret words" });
    expect(r.name).toBe("Screen invite");
    expect(fake.calls.find((c) => c.op === "insert")).toMatchObject({
      table: "email_templates",
      args: { id: r.templateId, name: "Screen invite", subject: "Hello there", body: "Secret words", created_by_actor_id: "actor-1" },
    });
    const finish = fake.calls.at(-1)!;
    expect(finish).toMatchObject({ table: "client_finish_write", args: { p_after: { name: "Screen invite" }, p_keep: true } });
    expect(JSON.stringify(finish.args)).not.toContain("Secret");
  });

  test("archiving is an update, never a delete; the same values again claim nothing", async () => {
    const same = new FakeSupabase([{ data: [SCREEN] }]);
    expect(await updateEmailTemplate(same.asDb(), ctx(), { template: "screen invite", subject: SCREEN.subject, archived: false }))
      .toMatchObject({ outcome: "unchanged", changed: [] });
    expect(rpcs(same)).toEqual([]);

    const fake = new FakeSupabase([{ data: [SCREEN] }, { data: "audit-1" }, { data: [{ id: SCREEN.id }] }, { data: null }]);
    const r = await updateEmailTemplate(fake.asDb(), ctx(), { template: SCREEN.id, archived: true, body: "New words" });
    expect(r).toMatchObject({ outcome: "updated", archived: true, changed: ["body", "archived"] });
    const update = fake.calls.find((c) => c.op === "update")!;
    expect((update.args as { archived_at: string }).archived_at).toEqual(expect.any(String));
    expect(fake.calls.some((c) => c.op === "delete")).toBe(false);
    expect(JSON.stringify(fake.calls.at(-1)!.args)).not.toContain("New words");
  });

  test("renaming onto another template's name is refused", async () => {
    const fake = new FakeSupabase([{ data: [SCREEN, OLD] }, { data: [SCREEN, OLD] }]);
    expect((await refusal(updateEmailTemplate(fake.asDb(), ctx(), { template: "Old", name: "SCREEN INVITE" }))).message).toMatch(/Another template/);
  });
});

describe("draftEmail", () => {
  test("turned off, an interviewer, or nothing to say: refused before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(draftEmail(fake.asDb(), ctx(), null, { candidateId: "p-1", subject: "s", body: "b" }))).message).toMatch(/turned off/);
    expect((await refusal(draftEmail(fake.asDb(), ctx("limited"), mailer(), { candidateId: "p-1", subject: "s", body: "b" }))).message)
      .toMatch(/Interviewers do not email/);
    expect((await refusal(draftEmail(fake.asDb(), ctx(), mailer(), { candidateId: "p-1", subject: "s" }))).message).toMatch(/template/);
    expect(fake.calls).toEqual([]);
  });

  test("a candidate the member can see but not change is told so, and nothing is claimed", async () => {
    const fake = new FakeSupabase([{ data: PAT }, { data: false }]);
    expect((await refusal(draftEmail(fake.asDb(), ctx("elevated"), mailer(), { candidateId: "p-1", subject: "s", body: "b" }))).code).toBe("forbidden");
    expect(rpcs(fake)).toEqual(["can_edit_person"]);
  });

  test("a template needing {{job_title}} without an application is refused, and says what to pass", async () => {
    const fake = new FakeSupabase([{ data: PAT }, { data: true }, { data: [SCREEN] }, { data: [] }, ME, ACME]);
    const err = await refusal(draftEmail(fake.asDb(), ctx(), mailer(), { candidateId: "p-1", template: "Screen invite" }));
    expect(err.message).toMatch(/\{\{job_title\}\}.*application_id/);
    expect(rpcs(fake)).toEqual(["can_edit_person"]);
  });

  test("an archived template, or another candidate's application, is refused", async () => {
    const archived = new FakeSupabase([{ data: PAT }, { data: true }, { data: [OLD] }]);
    expect((await refusal(draftEmail(archived.asDb(), ctx(), mailer(), { candidateId: "p-1", template: "old" }))).message).toMatch(/archived/);
    const app = new FakeSupabase([{ data: PAT }, { data: true }, { data: { id: "app-9", person_id: "p-2", roles: { title: "X" } } }]);
    expect((await refusal(draftEmail(app.asDb(), ctx(), mailer(), { candidateId: "p-1", applicationId: "app-9", subject: "s", body: "b" }))).message)
      .toMatch(/not one of this candidate's/);
  });

  test("from a template: filled in, to the address on file, From the Tacit address under the member's name, audited without its words", async () => {
    const fake = new FakeSupabase([
      { data: PAT }, { data: true }, { data: { id: "app-1", person_id: "p-1", roles: { title: "Founding Engineer" } } },
      { data: [SCREEN] }, { data: [{ value: "pat@work.test" }] }, ME, ACME,
      { data: "audit-1" }, { data: null }, { data: null },
    ]);
    const r = await draftEmail(fake.asDb(), ctx("elevated"), mailer(), { candidateId: "p-1", applicationId: "app-1", template: "SCREEN INVITE" });
    expect(r).toMatchObject({
      candidateId: "p-1", applicationId: "app-1", templateId: SCREEN.id,
      from: '"Ada Admin at Acme" <hiring@tacitawareness.com>', replyTo: "ada@acme.test", to: "pat@cand.test",
      subject: "Founding Engineer at Acme", body: "Hi Pat,\n\nCould we talk this week?\n\nAda",
    });
    expect(fake.calls.find((c) => c.op === "insert")).toMatchObject({
      table: "candidate_emails",
      args: {
        id: r.draftId, person_id: "p-1", application_id: "app-1", template_id: SCREEN.id, author_actor_id: "actor-1",
        to_email: "pat@cand.test", subject: "Founding Engineer at Acme",
      },
    });
    expect(fake.calls.find((c) => c.table === "client_claim_write")?.args).toMatchObject({ p_action: "email.draft", p_entity: "candidate_email" });
    const finish = fake.calls.at(-1)!;
    expect(finish).toMatchObject({ table: "client_finish_write", args: { p_entity_id: r.draftId, p_keep: true } });
    expect(JSON.stringify(finish.args)).not.toMatch(/Founding|Could we talk/);
    expect(fake.calls.some((c) => c.op === "update")).toBe(false);
  });

  test("to_email must be another address on file; the sentence lists them", async () => {
    const fake = new FakeSupabase([{ data: PAT }, { data: true }, { data: [{ value: "pat@work.test" }] }]);
    const err = await refusal(draftEmail(fake.asDb(), ctx(), mailer(), { candidateId: "p-1", subject: "s", body: "b", toEmail: "boss@evil.test" }));
    expect(err.message).toBe("That address is not on file for this candidate. On file: pat@cand.test, pat@work.test.");
  });

  test("someone with no address on file cannot be written to", async () => {
    const fake = new FakeSupabase([{ data: { ...PAT, email: "not an email" } }, { data: true }, { data: [] }]);
    expect((await refusal(draftEmail(fake.asDb(), ctx(), mailer(), { candidateId: "p-1", subject: "s", body: "b" }))).message).toMatch(/no email address/);
  });
});

const DRAFT = {
  id: "d-1", person_id: "p-1", application_id: "app-1", author_actor_id: "actor-1", to_email: "pat@cand.test",
  subject: "Founding Engineer at Acme", body: "Hi Pat", status: "draft", people: { email: "pat@cand.test" },
};

describe("sendEmail", () => {
  test("turned off, no provider, or an interviewer: refused before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(sendEmail(fake.asDb(), ctx(), null, { draftId: "d-1" }))).message).toMatch(/turned off/);
    expect((await refusal(sendEmail(fake.asDb(), ctx(), mailer(null), { draftId: "d-1" }))).message).toMatch(/not set up/);
    expect((await refusal(sendEmail(fake.asDb(), ctx("limited"), mailer(), { draftId: "d-1" }))).message).toMatch(/Interviewers/);
    expect(fake.calls).toEqual([]);
  });

  test("someone else's draft, or one already sent, is not sent", async () => {
    const send = vi.fn(async () => ({ id: "re_1" }));
    const theirs = new FakeSupabase([{ data: { ...DRAFT, author_actor_id: "actor-2" } }]);
    expect((await refusal(sendEmail(theirs.asDb(), ctx(), mailer(send), { draftId: "d-1" }))).message).toMatch(/only its author/);
    const sent = new FakeSupabase([{ data: { ...DRAFT, status: "sent" } }]);
    expect((await refusal(sendEmail(sent.asDb(), ctx(), mailer(send), { draftId: "d-1" }))).message).toMatch(/already sent/);
    expect(send).not.toHaveBeenCalled();
  });

  test("an address no longer on file is not sent to", async () => {
    const send = vi.fn(async () => ({ id: "re_1" }));
    const fake = new FakeSupabase([{ data: { ...DRAFT, people: { email: "new@cand.test" } } }, { data: [] }]);
    expect((await refusal(sendEmail(fake.asDb(), ctx(), mailer(send), { draftId: "d-1" }))).message).toMatch(/has changed/);
    expect(send).not.toHaveBeenCalled();
  });

  test("the stored draft goes out once, keyed by its id, and is recorded sent with the application touched", async () => {
    const send = vi.fn(async () => ({ id: "re_1" }));
    const fake = new FakeSupabase([
      { data: DRAFT }, { data: [] }, ME, ACME,
      { data: "audit-1" }, { data: [{ id: "d-1" }] }, { data: null },
      { data: [{ id: "app-1" }] }, { data: null }, { data: null },
    ]);
    const r = await sendEmail(fake.asDb(), ctx("elevated"), mailer(send), { draftId: "d-1" });
    expect(r).toMatchObject({ emailId: "d-1", candidateId: "p-1", to: "pat@cand.test", status: "sent" });
    expect(send).toHaveBeenCalledWith({
      from: '"Ada Admin at Acme" <hiring@tacitawareness.com>', replyTo: "ada@acme.test", to: "pat@cand.test",
      subject: DRAFT.subject, text: DRAFT.body, idempotencyKey: "d-1",
    });
    const [claim, sent] = fake.calls.filter((c) => c.op === "update" && c.table === "candidate_emails");
    expect(claim).toMatchObject({
      args: { status: "sending" },
      filters: [{ method: "eq", column: "id", value: "d-1" }, { method: "eq", column: "status", value: "draft" }],
    });
    expect(sent.args).toEqual({ status: "sent", provider_id: "re_1", sent_via: "resend", thread_id: null });
    expect(fake.calls.find((c) => c.table === "application_events")).toMatchObject({ op: "insert", args: { kind: "touched" } });
    const finish = fake.calls.at(-1)!;
    expect(finish).toMatchObject({ table: "client_finish_write", args: { p_keep: true, p_after: { status: "sent", provider_id: "re_1" } } });
    expect(JSON.stringify(finish.args)).not.toMatch(/Founding|Hi Pat/);
  });

  describe("from the member's own Gmail", () => {
    const GRANT = { accountEmail: "ada@acme.test", scopes: "openid https://www.googleapis.com/auth/gmail.send", via: "oauth" as const };
    const SENT = [
      { data: DRAFT }, { data: [] }, ME, ACME,
      { data: "audit-1" }, { data: [{ id: "d-1" }] }, { data: null },
      { data: [{ id: "app-1" }] }, { data: null }, { data: null },
    ];
    /** Google's token endpoint and users.messages.send, as fetch. */
    function google(opts: { token?: number; send?: number } = {}) {
      const calls: Array<{ url: string; body: string }> = [];
      const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), body: String(init?.body ?? "") });
        if (String(url).includes("oauth2")) {
          return new Response(JSON.stringify(opts.token ? { error: "invalid_grant" } : { access_token: "at" }), { status: opts.token ?? 200 });
        }
        return new Response(JSON.stringify({ id: "gm_1", threadId: "th_1" }), { status: opts.send ?? 200 });
      }) as unknown as typeof globalThis.fetch;
      return { calls, fetch };
    }
    // The grant's token comes from Google's token endpoint, as the apps' memberMailbox gets it.
    const withGmail = (send: ClientMailer["send"], fetch: typeof globalThis.fetch, grant: typeof GRANT | null = GRANT): ClientMailer => ({
      ...mailer(send), replyDomain: "in.tacit.test",
      mailbox: {
        fetch,
        own: vi.fn(async () => grant && {
          ...grant,
          accessToken: async () => {
            const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST" });
            if (!res.ok) throw new Error("refused");
            return ((await res.json()) as { access_token: string }).access_token;
          },
        }),
      },
    });
    const raw = (body: string) =>
      Buffer.from((JSON.parse(body) as { raw: string }).raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

    test("goes out through Gmail From their own address, with no Tacit reply address, and records the thread", async () => {
      const send = vi.fn(async () => ({ id: "re_1" }));
      const g = google();
      const fake = new FakeSupabase(SENT);
      const r = await sendEmail(fake.asDb(), ctx("elevated"), withGmail(send, g.fetch), { draftId: "d-1" });
      expect(r).toMatchObject({ emailId: "d-1", status: "sent" });
      expect(send).not.toHaveBeenCalled();
      const message = raw(g.calls.find((c) => c.url.endsWith("/messages/send"))!.body);
      expect(message).toContain("From: Ada Admin <ada@acme.test>");
      expect(message).toContain("To: pat@cand.test");
      expect(message).not.toMatch(/Reply-To|reply\+/);
      const [, sent] = fake.calls.filter((c) => c.op === "update" && c.table === "candidate_emails");
      expect(sent.args).toEqual({ status: "sent", provider_id: "gm_1", sent_via: "gmail", thread_id: "th_1" });
      expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_after: { sent_via: "gmail" } } });
    });

    test("a grant Google no longer accepts leaves the draft a draft, and says to reconnect", async () => {
      const g = google({ token: 400 });
      const fake = new FakeSupabase(SENT);
      const err = await refusal(sendEmail(fake.asDb(), ctx(), withGmail(vi.fn(), g.fetch), { draftId: "d-1" }));
      expect(err.message).toMatch(/Connect Gmail again.*draft is kept/);
      expect(fake.calls.some((c) => c.op === "update")).toBe(false);
      expect(rpcs(fake)).not.toContain("client_claim_write");
    });

    test("Gmail refusing the message records it failed", async () => {
      const g = google({ send: 400 });
      const fake = new FakeSupabase([{ data: DRAFT }, { data: [] }, ME, ACME, { data: "audit-1" }, { data: [{ id: "d-1" }] }, { data: null }, { data: null }]);
      expect((await refusal(sendEmail(fake.asDb(), ctx(), withGmail(vi.fn(), g.fetch), { draftId: "d-1" }))).message).toMatch(/was not sent/);
      expect(fake.calls.filter((c) => c.op === "update").at(-1)?.args).toMatchObject({ status: "failed" });
    });

    test("without a connection, or with one that may not send, it goes through Resend as before", async () => {
      for (const grant of [null, { ...GRANT, scopes: "openid email" }]) {
        const send = vi.fn(async () => ({ id: "re_1" }));
        const g = google();
        await sendEmail(new FakeSupabase(SENT).asDb(), ctx("elevated"), withGmail(send, g.fetch, grant), { draftId: "d-1" });
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ replyTo: "reply+d-1@in.tacit.test" }));
        expect(g.calls).toEqual([]);
      }
    });

    test("needs no Resend key", async () => {
      const g = google();
      await expect(sendEmail(new FakeSupabase(SENT).asDb(), ctx("elevated"), withGmail(null, g.fetch), { draftId: "d-1" })).resolves.toMatchObject({ status: "sent" });
    });
  });

  test("with a receiving domain, a reply comes back to the email's own address", async () => {
    const send = vi.fn(async () => ({ id: "re_1" }));
    const fake = new FakeSupabase([
      { data: DRAFT }, { data: [] }, ME, ACME,
      { data: "audit-1" }, { data: [{ id: "d-1" }] }, { data: null },
      { data: [{ id: "app-1" }] }, { data: null }, { data: null },
    ]);
    await sendEmail(fake.asDb(), ctx("elevated"), { ...mailer(send), replyDomain: "in.tacit.test" }, { draftId: "d-1" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ replyTo: "reply+d-1@in.tacit.test" }));
  });

  test("a draft someone else is sending is not sent twice, and the claim is given back", async () => {
    const send = vi.fn(async () => ({ id: "re_1" }));
    const fake = new FakeSupabase([{ data: DRAFT }, { data: [] }, ME, ACME, { data: "audit-1" }, { data: [] }, { data: true }, { data: null }]);
    expect((await refusal(sendEmail(fake.asDb(), ctx(), mailer(send), { draftId: "d-1" }))).message).toMatch(/already being sent/);
    expect(send).not.toHaveBeenCalled();
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });

  test("no row because the policy refused says so, not that it is on its way", async () => {
    const send = vi.fn(async () => ({ id: "re_1" }));
    const fake = new FakeSupabase([{ data: DRAFT }, { data: [] }, ME, ACME, { data: "audit-1" }, { data: [] }, { data: false }, { data: null }]);
    const err = await refusal(sendEmail(fake.asDb(), ctx(), mailer(send), { draftId: "d-1" }));
    expect(err).toMatchObject({ code: "forbidden", message: expect.stringContaining("no longer email") });
    expect(send).not.toHaveBeenCalled();
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });

  test("the hourly send limit is a sentence, and nothing is sent", async () => {
    const send = vi.fn(async () => ({ id: "re_1" }));
    const fake = new FakeSupabase([
      { data: DRAFT }, { data: [] }, ME, ACME, { data: "audit-1" }, { error: { code: "54000", message: "at most 30" } }, { data: null },
    ]);
    expect((await refusal(sendEmail(fake.asDb(), ctx(), mailer(send), { draftId: "d-1" }))).code).toBe("rate_limited");
    expect(send).not.toHaveBeenCalled();
  });

  test("a provider refusal records the draft failed, keeps the audit row, and says it was not sent", async () => {
    const send = vi.fn(async () => {
      throw new Error("Resend refused the email: domain not verified");
    });
    const fake = new FakeSupabase([
      { data: DRAFT }, { data: [] }, ME, ACME, { data: "audit-1" }, { data: [{ id: "d-1" }] }, { data: null }, { data: null },
    ]);
    expect((await refusal(sendEmail(fake.asDb(), ctx(), mailer(send), { draftId: "d-1" }))).message).toMatch(/was not sent/);
    expect(fake.calls.filter((c) => c.op === "update").at(-1)?.args).toMatchObject({ status: "failed", error: expect.stringContaining("not verified") });
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: true, p_after: { status: "failed" } } });
  });

  test("a member with no address of their own on file cannot send: replies would go nowhere", async () => {
    const fake = new FakeSupabase([{ data: DRAFT }, { data: [] }, { data: { display_name: "Ada", email: null } }, ACME]);
    expect((await refusal(sendEmail(fake.asDb(), ctx(), mailer(), { draftId: "d-1" }))).message).toMatch(/nowhere to go/);
  });
});

describe("listEmailReplies", () => {
  test("an interviewer is refused before any read", async () => {
    const none = new FakeSupabase([]);
    expect((await refusal(listEmailReplies(none.asDb(), ctx("limited"), { candidateId: "p-1" }))).code).toBe("forbidden");
    expect(none.calls).toEqual([]);
  });

  test("the candidate's words, naming the email they answer", async () => {
    const fake = new FakeSupabase([{ data: [{ id: "r-1", email_id: "d-1", from_email: "cam@cand.test", subject: "Re: Hi", body: "6pm works", received_at: "2026-11-01T10:00:00Z", candidate_emails: { person_id: "p-1" } }] }]);
    expect(await listEmailReplies(fake.asDb(), ctx(), { candidateId: "p-1" })).toEqual([{ replyId: "r-1", emailId: "d-1", from: "cam@cand.test", subject: "Re: Hi", body: "6pm works", receivedAt: "2026-11-01T10:00:00Z" }]);
    expect(fake.calls[0]).toMatchObject({ table: "candidate_email_replies" });
  });
});

describe("listEmails", () => {
  test("an interviewer is refused; nobody there is not found; the rows come back named, with bodies", async () => {
    const none = new FakeSupabase();
    expect((await refusal(listEmails(none.asDb(), ctx("limited"), { candidateId: "p-1" }))).code).toBe("forbidden");
    const missing = new FakeSupabase([{ data: [] }, { data: null }]);
    expect((await refusal(listEmails(missing.asDb(), ctx(), { candidateId: "p-x" }))).code).toBe("not_found");

    const fake = new FakeSupabase([
      { data: [{ id: "d-1", application_id: null, template_id: null, author_actor_id: "actor-2", to_email: "pat@cand.test", subject: "Hi", status: "sent", created_at: "t1", sent_at: "t2", body: "Hello" }] },
      { data: [{ id: "actor-2", display_name: "Hana Manager" }] },
    ]);
    expect(await listEmails(fake.asDb(), ctx(), { candidateId: "p-1" })).toEqual([{
      emailId: "d-1", applicationId: null, templateId: null, author: "Hana Manager", mine: false, to: "pat@cand.test",
      subject: "Hi", status: "sent", createdAt: "t1", sentAt: "t2", body: "Hello",
    }]);
    expect(fake.calls[0].args).toContain("body");
  });
});
