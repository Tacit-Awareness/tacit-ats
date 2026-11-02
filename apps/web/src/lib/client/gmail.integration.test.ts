import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";

import { readGmailReplies } from "../inbound/gmail-replies";
import { draftReply, readSender, sendDraft } from "./email";
import { memberMailbox } from "./mailbox";

/**
 * Candidate email from a member's own Gmail, against the local stack on
 * members' own tokens, with Gmail and Google's token endpoint faked as fetch:
 * nothing here reaches Google or Resend. Connecting writes only the caller's
 * row; sending goes out through their Gmail, From their address, recording the
 * thread; the reply reader keeps only messages in threads Tacit started, from
 * mailboxes that allowed reading, once each.
 */

const db = () => getSupabaseServiceClient();

const ACME = "c6000000-0000-4000-8000-0000000000f1";
const ADMIN = "c6a00000-0000-4000-8000-0000000000f1";
const LEAD = "c6a00000-0000-4000-8000-0000000000f2";
const ENGINEER = "c6b00000-0000-4000-8000-0000000000f1";
const PERSON = "c6c00000-0000-4000-8000-0000000000f1";
const APP = "c6d00000-0000-4000-8000-0000000000f1";
const ACME_WORKOS = "org_itest_gmail_acme";

const SEND = clientTools.GMAIL_SEND_SCOPE;
const READ = clientTools.GMAIL_READ_SCOPE;
const ENV = { CLIENT_GOOGLE_CLIENT_ID: "cid", CLIENT_GOOGLE_CLIENT_SECRET: "cs", SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY };

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  for (const table of ["candidate_emails", "mailbox_connections", "application_events", "applications", "hiring_team", "people", "roles", "companies"] as const) {
    must(await db().from(table).delete().eq("org_id", ACME));
  }
  await db().from("audit_log").delete().eq("org_id", ACME);
  await db().from("actors").delete().eq("org_id", ACME);
  await db().from("orgs").delete().eq("id", ACME);
}

const token = (subject: string) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId: ACME_WORKOS }));
};
const ctx = (actorId: string, accessLevel: clientTools.ClientToolCtx["accessLevel"]): clientTools.ClientToolCtx => ({ actorId, orgId: ACME, accessLevel, source: "dashboard" });
const ada = ctx(ADMIN, "admin");
const asAda = () => token("user_gm_ada");
const asLee = () => token("user_gm_lee");

type Message = { id: string; threadId: string; labelIds: string[]; from: string; subject: string; text: string; at: number };

/** Gmail for one or more refresh tokens: sends, and serves its mailbox's history, messages and threads. */
function fakeGmail() {
  const mailbox: Message[] = [];
  let history = 100;
  const added: Array<{ history: number; message: Message }> = [];
  const fetched: string[] = [];
  const sent: string[] = [];
  const put = (m: Message) => {
    mailbox.push(m);
    added.push({ history: ++history, message: m });
  };
  const full = (m: Message) => ({
    id: m.id, threadId: m.threadId, labelIds: m.labelIds, internalDate: String(m.at),
    payload: {
      mimeType: "text/plain",
      headers: [{ name: "From", value: m.from }, { name: "Subject", value: m.subject }],
      body: { data: Buffer.from(m.text).toString("base64url") },
    },
  });
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.hostname === "oauth2.googleapis.com") return json({ access_token: "at" });
    const path = url.pathname.replace("/gmail/v1/users/me", "");
    if (path === "/messages/send") {
      const raw = Buffer.from(String((JSON.parse(String(init?.body)) as { raw: string }).raw), "base64url").toString("utf8");
      sent.push(raw);
      const m: Message = { id: `sent${sent.length}`, threadId: `thread${sent.length}`, labelIds: ["SENT"], from: "", subject: "", text: "", at: Date.now() };
      put(m);
      return json({ id: m.id, threadId: m.threadId });
    }
    if (path === "/profile") return json({ emailAddress: "ada@acme.test", historyId: String(history) });
    if (path === "/history") {
      const start = Number(url.searchParams.get("startHistoryId"));
      return json({
        history: added.filter((a) => a.history > start).map((a) => ({ messagesAdded: [{ message: { id: a.message.id, threadId: a.message.threadId, labelIds: a.message.labelIds } }] })),
        historyId: String(history),
      });
    }
    const message = /^\/messages\/(\w+)$/.exec(path);
    if (message) {
      fetched.push(message[1]);
      const m = mailbox.find((x) => x.id === message[1]);
      return m ? json(full(m)) : json({}, 404);
    }
    const thread = /^\/threads\/(\w+)$/.exec(path);
    if (thread) {
      fetched.push(thread[1]);
      return json({ messages: mailbox.filter((x) => x.threadId === thread[1]).map(full) });
    }
    return json({ error: "unexpected" }, 500);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent, fetched, put };
}

const resend = () => vi.fn(async () => ({ id: "re_1" }));
const mailerWith = (gmail: ReturnType<typeof fakeGmail>, send = resend()): clientTools.ClientMailer => ({
  send, fromAddress: "hiring@example.test", replyDomain: "in.example.test", mailbox: memberMailbox(ENV, gmail.fetch),
});

const connect = async (client: ReturnType<typeof asAda>, scopes: string, account = "ada@acme.test") =>
  must(await client.rpc("client_connect_mailbox", { p_provider: "google", p_account_email: account, p_refresh_token: "rt", p_scopes: scopes }));

const sendOne = async (mailer: clientTools.ClientMailer) => {
  const out = await draftReply(asAda(), ada, mailer, { candidateId: PERSON, applicationId: APP, subject: "Your application", body: "Hi Cam, let's talk." });
  if (!out.ok) throw new Error(out.error);
  expect(await sendDraft(asAda(), ada, mailer, out.draftId)).toEqual({ ok: true });
  return out.draftId;
};
const replies = async () => (await db().from("candidate_email_replies").select("email_id, from_email, subject, body, provider_id").eq("org_id", ACME)).data ?? [];

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert({ id: ACME, name: "Acme", slug: "itest-gmail-acme", kind: "client", workos_org_id: ACME_WORKOS }));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-gm-admin", display_name: "Ada Admin", email: "ada@gm.test", access_level: "admin", auth_subject: "user_gm_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-gm-lead", display_name: "Lee Lead", email: "lee@gm.test", access_level: "admin", auth_subject: "user_gm_lee" },
  ]));
  const { data: company } = must(await db().from("companies").insert({ org_id: ACME, name: "Acme" }).select("id").single());
  must(await db().from("roles").insert({ id: ENGINEER, org_id: ACME, company_id: company!.id, title: "Founding Engineer", status: "open" }));
  must(await db().from("people").insert({ id: PERSON, org_id: ACME, display_name: "Cam Candidate", email: "cam@gm.test" }));
  must(await db().from("applications").insert({ id: APP, org_id: ACME, person_id: PERSON, role_id: ENGINEER, stage: "sourced", source: "job_board" }));
});

afterAll(clear);

describe("sending from a member's own Gmail", () => {
  test("goes out through their Gmail, From their address, and records the thread", async () => {
    const gmail = fakeGmail();
    const send = resend();
    await connect(asAda(), `openid email ${SEND} ${READ}`);
    const mailer = mailerWith(gmail, send);
    expect(await readSender(asAda(), ada, mailer)).toEqual({ from: '"Ada Admin" <ada@acme.test>', replyTo: "ada@acme.test" });

    const id = await sendOne(mailer);
    expect(send).not.toHaveBeenCalled();
    expect(gmail.sent).toHaveLength(1);
    expect(gmail.sent[0]).toContain("From: Ada Admin <ada@acme.test>");
    expect(gmail.sent[0]).toContain("To: cam@gm.test");
    expect(gmail.sent[0]).not.toMatch(/reply\+/);
    const { data } = await db().from("candidate_emails").select("status, provider_id, sent_via, thread_id").eq("id", id).single();
    expect(data).toEqual({ status: "sent", provider_id: "sent1", sent_via: "gmail", thread_id: "thread1" });
  });

  test("a member reads only their own connection, and someone else's never sends their email", async () => {
    const gmail = fakeGmail();
    const send = resend();
    await connect(asLee(), `${SEND} ${READ}`, "lee@acme.test");
    expect((await asAda().from("mailbox_connections").select("actor_id")).data).toEqual([]);
    expect((await asAda().from("mailbox_connections").select("refresh_token")).error).not.toBeNull();
    const id = await sendOne(mailerWith(gmail, send));
    expect(gmail.sent).toEqual([]);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ replyTo: `reply+${id}@in.example.test` }));
    const { data } = await db().from("candidate_emails").select("sent_via, thread_id").eq("id", id).single();
    expect(data).toEqual({ sent_via: "resend", thread_id: null });
  });

  test("after disconnecting, email goes through Resend again", async () => {
    const gmail = fakeGmail();
    const send = resend();
    await connect(asAda(), SEND);
    expect((await asAda().rpc("client_disconnect_mailbox")).data).toBe(true);
    await sendOne(mailerWith(gmail, send));
    expect(gmail.sent).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("reading the candidate's replies", () => {
  const google = { clientId: "cid", clientSecret: "cs" };

  test("keeps the candidate's reply in a thread Tacit started, once, and nothing else in the mailbox", async () => {
    const gmail = fakeGmail();
    await connect(asAda(), `${SEND} ${READ}`);
    const id = await sendOne(mailerWith(gmail));
    const at = Date.now() + 1000;
    gmail.put({ id: "reply1", threadId: "thread1", labelIds: ["INBOX"], from: "Cam Candidate <cam@gm.test>", subject: "Re: Your application", text: "Tuesday works.\n\nOn Mon, Ada wrote:\n> Hi Cam", at });
    gmail.put({ id: "other1", threadId: "unrelated", labelIds: ["INBOX"], from: "Boss <boss@acme.test>", subject: "Lunch?", text: "private", at });

    // First run: no place in the history yet, so it catches up on the threads Tacit started.
    const first = await readGmailReplies(db(), { google, fetch: gmail.fetch });
    expect(first).toEqual({ mailboxes: 1, kept: 1, failed: 0 });
    expect(await replies()).toEqual([
      { email_id: id, from_email: "cam@gm.test", subject: "Re: Your application", body: "Tuesday works.", provider_id: `gmail:${ADMIN}:reply1` },
    ]);
    expect(gmail.fetched).not.toContain("unrelated");
    expect(gmail.fetched).not.toContain("other1");

    // Later runs read only what the history added, and only Tacit's threads.
    gmail.fetched.length = 0;
    gmail.put({ id: "reply2", threadId: "thread1", labelIds: ["INBOX"], from: "cam@gm.test", subject: "Re: Your application", text: "Or Wednesday.", at: at + 1 });
    gmail.put({ id: "other2", threadId: "unrelated", labelIds: ["INBOX"], from: "boss@acme.test", subject: "Re: Lunch?", text: "private", at: at + 1 });
    gmail.put({ id: "mine1", threadId: "thread1", labelIds: ["SENT"], from: "ada@acme.test", subject: "Re", text: "Great", at: at + 2 });
    expect(await readGmailReplies(db(), { google, fetch: gmail.fetch })).toEqual({ mailboxes: 1, kept: 1, failed: 0 });
    expect(gmail.fetched).toEqual(["reply2"]);
    expect((await replies()).map((r) => r.body).sort()).toEqual(["Or Wednesday.", "Tuesday works."]);

    // Nothing new: nothing kept twice.
    expect(await readGmailReplies(db(), { google, fetch: gmail.fetch })).toEqual({ mailboxes: 1, kept: 0, failed: 0 });
    expect(await replies()).toHaveLength(2);
  });

  test("a send-only connection is never read", async () => {
    const gmail = fakeGmail();
    await connect(asAda(), SEND);
    await sendOne(mailerWith(gmail));
    gmail.put({ id: "reply1", threadId: "thread1", labelIds: ["INBOX"], from: "cam@gm.test", subject: "Re", text: "Yes", at: Date.now() + 1000 });
    const calls = vi.mocked(gmail.fetch).mock.calls.length;
    expect(await readGmailReplies(db(), { google, fetch: gmail.fetch })).toMatchObject({ kept: 0 });
    expect(vi.mocked(gmail.fetch).mock.calls.length).toBe(calls);
    expect(await replies()).toEqual([]);
  });
});
