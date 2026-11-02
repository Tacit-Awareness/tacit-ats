import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";

import { syncGmail } from "../inbound/gmail-sync";
import { draftReply, readSender, sendDraft } from "./email";
import { memberMailbox } from "./mailbox";

/**
 * Candidate email through members' own Gmail, as Ashby does it, against the
 * local stack on members' own tokens, with Google faked as fetch (the service
 * account's key is real, so the JWT grant is signed for real): nothing here
 * reaches Google or Resend.
 *
 * The company's Google Workspace covers every signed-in member above
 * interviewer at its domain, with nothing to connect; a member at another
 * domain connects their own Gmail. Sending goes out From their address and
 * records the thread. The sync keeps replies in Tacit's threads for the Inbox,
 * and any other email between a member and a candidate on the candidate, and
 * reads no more than the headers of anything else.
 */

const db = () => getSupabaseServiceClient();

const ACME = "c6000000-0000-4000-8000-0000000000f1";
const ADMIN = "c6a00000-0000-4000-8000-0000000000f1";
const LEAD = "c6a00000-0000-4000-8000-0000000000f2";
const IVAN = "c6a00000-0000-4000-8000-0000000000f3";
const ENGINEER = "c6b00000-0000-4000-8000-0000000000f1";
const PERSON = "c6c00000-0000-4000-8000-0000000000f1";
const APP = "c6d00000-0000-4000-8000-0000000000f1";
const ACME_WORKOS = "org_itest_gmail_acme";

const SEND = clientTools.GMAIL_SEND_SCOPE;
const READ = clientTools.GMAIL_READ_SCOPE;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA_JSON = JSON.stringify({ client_email: "tacit@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), client_id: "1234567890" });
const serviceAccount = clientTools.parseServiceAccount(SA_JSON);
const google = { clientId: "cid", clientSecret: "cs" };
const ENV = { CLIENT_GOOGLE_CLIENT_ID: "cid", CLIENT_GOOGLE_CLIENT_SECRET: "cs", SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY };
const WORKSPACE_ENV = { ...ENV, CLIENT_GOOGLE_SERVICE_ACCOUNT: SA_JSON };

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  for (const table of [
    "candidate_mail", "candidate_emails", "mailbox_connections", "mailbox_sync_state", "mailbox_sync_optouts", "google_workspace_connections",
    "application_events", "applications", "hiring_team", "person_identifiers", "people", "roles", "companies",
  ] as const) {
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

type Message = { id: string; threadId: string; labelIds: string[]; from: string; to: string; subject: string; text: string; at: number };

/** One Gmail mailbox: sends, and serves its history, messages (full or headers) and threads, recording each read. */
function fakeGmail() {
  const mailbox: Message[] = [];
  let history = 100;
  const added: Array<{ history: number; message: Message }> = [];
  const reads: string[] = [];
  const sent: string[] = [];
  const subjects: string[] = [];
  const put = (m: Message) => {
    mailbox.push(m);
    added.push({ history: ++history, message: m });
  };
  const full = (m: Message) => ({
    id: m.id, threadId: m.threadId, labelIds: m.labelIds, internalDate: String(m.at),
    payload: {
      mimeType: "text/plain",
      headers: [{ name: "From", value: m.from }, { name: "To", value: m.to }, { name: "Subject", value: m.subject }],
      body: { data: Buffer.from(m.text).toString("base64url") },
    },
  });
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.hostname === "oauth2.googleapis.com") {
      const body = new URLSearchParams(String(init?.body));
      const assertion = body.get("assertion");
      if (assertion) subjects.push((JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString()) as { sub: string }).sub);
      return json({ access_token: "at" });
    }
    const path = url.pathname.replace("/gmail/v1/users/me", "");
    if (path === "/messages/send") {
      sent.push(Buffer.from(String((JSON.parse(String(init?.body)) as { raw: string }).raw), "base64url").toString("utf8"));
      const m: Message = { id: `sent${sent.length}`, threadId: `thread${sent.length}`, labelIds: ["SENT"], from: "", to: "", subject: "", text: "", at: Date.now() };
      put(m);
      return json({ id: m.id, threadId: m.threadId });
    }
    if (path === "/profile") return json({ emailAddress: "ada@gm.test", historyId: String(history) });
    if (path === "/history") {
      const start = Number(url.searchParams.get("startHistoryId"));
      return json({
        history: added.filter((a) => a.history > start).map((a) => ({ messagesAdded: [{ message: { id: a.message.id, threadId: a.message.threadId, labelIds: a.message.labelIds } }] })),
        historyId: String(history),
      });
    }
    const message = /^\/messages\/(\w+)$/.exec(path);
    if (message) {
      reads.push(`${message[1]}:${url.searchParams.get("format")}`);
      const m = mailbox.find((x) => x.id === message[1]);
      return m ? json(full(m)) : json({}, 404);
    }
    const thread = /^\/threads\/(\w+)$/.exec(path);
    if (thread) {
      reads.push(`${thread[1]}:thread`);
      return json({ messages: mailbox.filter((x) => x.threadId === thread[1]).map(full) });
    }
    return json({ error: "unexpected" }, 500);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent, reads, subjects, put };
}

const resend = () => vi.fn(async () => ({ id: "re_1" }));
const mailerWith = (gmail: ReturnType<typeof fakeGmail>, env: Record<string, string | undefined> = ENV, send = resend()): clientTools.ClientMailer => ({
  send, fromAddress: "hiring@example.test", replyDomain: "in.example.test", mailbox: memberMailbox(env, gmail.fetch),
});

const connect = async (client: ReturnType<typeof asAda>, scopes: string, account = "ada@gmail.test") =>
  must(await client.rpc("client_connect_mailbox", { p_provider: "google", p_account_email: account, p_refresh_token: "rt", p_scopes: scopes }));
const connectWorkspace = async () => must(await db().from("google_workspace_connections").insert({ org_id: ACME, domain: "gm.test", connected_by_actor_id: ADMIN }));

const sendOne = async (mailer: clientTools.ClientMailer) => {
  const out = await draftReply(asAda(), ada, mailer, { candidateId: PERSON, applicationId: APP, subject: "Your application", body: "Hi Cam, let's talk." });
  if (!out.ok) throw new Error(out.error);
  expect(await sendDraft(asAda(), ada, mailer, out.draftId)).toEqual({ ok: true });
  return out.draftId;
};
const replies = async () => (await db().from("candidate_email_replies").select("email_id, from_email, subject, body, provider_id").eq("org_id", ACME)).data ?? [];
const synced = async () =>
  (await db().from("candidate_mail").select("person_id, actor_id, direction, from_email, subject, body").eq("org_id", ACME).order("sent_at")).data ?? [];

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert({ id: ACME, name: "Acme", slug: "itest-gmail-acme", kind: "client", workos_org_id: ACME_WORKOS }));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-gm-admin", display_name: "Ada Admin", email: "ada@gm.test", access_level: "admin", auth_subject: "user_gm_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-gm-lead", display_name: "Lee Lead", email: "lee@gm.test", access_level: "admin", auth_subject: "user_gm_lee" },
    { id: IVAN, org_id: ACME, slug: "itest-gm-ivan", display_name: "Ivan Interviewer", email: "ivan@gm.test", access_level: "limited", auth_subject: "user_gm_ivan" },
  ]));
  const { data: company } = must(await db().from("companies").insert({ org_id: ACME, name: "Acme" }).select("id").single());
  must(await db().from("roles").insert({ id: ENGINEER, org_id: ACME, company_id: company!.id, title: "Founding Engineer", status: "open" }));
  must(await db().from("people").insert({ id: PERSON, org_id: ACME, display_name: "Cam Candidate", email: "cam@cand.test" }));
  must(await db().from("applications").insert({ id: APP, org_id: ACME, person_id: PERSON, role_id: ENGINEER, stage: "sourced", source: "job_board" }));
});

afterAll(clear);

describe("through the company's Google Workspace", () => {
  test("a member at its domain sends From their own address with nothing to connect, as themselves", async () => {
    const gmail = fakeGmail();
    const send = resend();
    await connectWorkspace();
    const mailer = mailerWith(gmail, WORKSPACE_ENV, send);
    expect(await readSender(asAda(), ada, mailer)).toEqual({ from: '"Ada Admin" <ada@gm.test>', replyTo: "ada@gm.test" });

    const id = await sendOne(mailer);
    expect(send).not.toHaveBeenCalled();
    expect(gmail.subjects).toEqual(["ada@gm.test"]);
    expect(gmail.sent[0]).toContain("From: Ada Admin <ada@gm.test>");
    expect(gmail.sent[0]).not.toMatch(/reply\+/);
    const { data } = await db().from("candidate_emails").select("sent_via, thread_id").eq("id", id).single();
    expect(data).toEqual({ sent_via: "gmail", thread_id: "thread1" });
  });

  test("without the service account, or before it is verified, email goes through Resend", async () => {
    for (const [env, verified] of [[ENV, true], [WORKSPACE_ENV, false]] as const) {
      await clear();
      await (async () => {
        must(await db().from("orgs").insert({ id: ACME, name: "Acme", slug: "itest-gmail-acme", kind: "client", workos_org_id: ACME_WORKOS }));
        must(await db().from("actors").insert({ id: ADMIN, org_id: ACME, slug: "itest-gm-admin", display_name: "Ada Admin", email: "ada@gm.test", access_level: "admin", auth_subject: "user_gm_ada" }));
        const { data: company } = must(await db().from("companies").insert({ org_id: ACME, name: "Acme" }).select("id").single());
        must(await db().from("roles").insert({ id: ENGINEER, org_id: ACME, company_id: company!.id, title: "Founding Engineer", status: "open" }));
        must(await db().from("people").insert({ id: PERSON, org_id: ACME, display_name: "Cam Candidate", email: "cam@cand.test" }));
        must(await db().from("applications").insert({ id: APP, org_id: ACME, person_id: PERSON, role_id: ENGINEER, stage: "sourced", source: "job_board" }));
      })();
      if (verified) await connectWorkspace();
      const gmail = fakeGmail();
      const send = resend();
      await sendOne(mailerWith(gmail, env, send));
      expect(gmail.sent).toEqual([]);
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  test("an admin connects only their own address's domain, and a member reads whether it is connected", async () => {
    expect((await asAda().rpc("client_connect_workspace", { p_domain: "other.test" })).error?.code).toBe("22023");
    must(await asAda().rpc("client_connect_workspace", { p_domain: "gm.test" }));
    expect((await asLee().from("google_workspace_connections").select("domain")).data).toEqual([{ domain: "gm.test" }]);
  });
});

describe("a member's own Gmail, for a company not on Workspace", () => {
  test("goes out from the account they connected, and nobody else's grant is ever used", async () => {
    const gmail = fakeGmail();
    const send = resend();
    await connect(asLee(), `${SEND} ${READ}`, "lee@gmail.test");
    expect((await asAda().from("mailbox_connections").select("actor_id")).data).toEqual([]);
    expect((await asAda().from("mailbox_connections").select("refresh_token")).error).not.toBeNull();
    await sendOne(mailerWith(gmail, ENV, send));
    expect(gmail.sent).toEqual([]);

    await connect(asAda(), `${SEND} ${READ}`);
    await sendOne(mailerWith(gmail, ENV, send));
    expect(gmail.sent[0]).toContain("From: Ada Admin <ada@gmail.test>");
    expect((await asAda().rpc("client_disconnect_mailbox")).data).toBe(true);
  });
});

describe("the sync", () => {
  test("keeps the reply in Tacit's thread, and other email with the candidate on the candidate, once; nothing else past its headers", async () => {
    const gmail = fakeGmail();
    await connectWorkspace();
    must(await asLee().rpc("client_set_mailbox_sync", { p_on: false }));
    const id = await sendOne(mailerWith(gmail, WORKSPACE_ENV));
    const deps = { google, serviceAccount, fetch: gmail.fetch };

    // First run: no place yet. Only Ada: Lee turned his sync off, Ivan is an interviewer.
    const before = Date.now() + 1000;
    gmail.put({ id: "reply1", threadId: "thread1", labelIds: ["INBOX"], from: "Cam <cam@cand.test>", to: "ada@gm.test", subject: "Re: Your application", text: "Tuesday works.\n\nOn Mon, Ada wrote:\n> Hi Cam", at: before });
    expect(await syncGmail(db(), deps)).toEqual({ mailboxes: 1, replies: 1, synced: 0, failed: 0 });
    expect(await replies()).toEqual([
      { email_id: id, from_email: "cam@cand.test", subject: "Re: Your application", body: "Tuesday works.", provider_id: `gmail:${ADMIN}:reply1` },
    ]);
    expect(gmail.subjects.filter((s) => s !== "ada@gm.test")).toEqual([]);

    // Later: what the history added since.
    gmail.reads.length = 0;
    const at = before + 1000;
    gmail.put({ id: "reply2", threadId: "thread1", labelIds: ["INBOX"], from: "cam@cand.test", to: "ada@gm.test", subject: "Re: Your application", text: "Or Wednesday.", at });
    gmail.put({ id: "out1", threadId: "t-coffee", labelIds: ["SENT"], from: "ada@gm.test", to: "Cam <cam@cand.test>", subject: "Coffee?", text: "Free Friday?", at: at + 1 });
    gmail.put({ id: "in1", threadId: "t-coffee", labelIds: ["INBOX"], from: "cam@cand.test", to: "ada@gm.test", subject: "Re: Coffee?", text: "Yes!", at: at + 2 });
    gmail.put({ id: "boss1", threadId: "t-boss", labelIds: ["INBOX"], from: "boss@else.test", to: "ada@gm.test", subject: "Private", text: "secret", at: at + 3 });
    gmail.put({ id: "lee1", threadId: "t-lee", labelIds: ["SENT"], from: "ada@gm.test", to: "lee@gm.test", subject: "Lunch", text: "secret", at: at + 4 });
    expect(await syncGmail(db(), deps)).toEqual({ mailboxes: 1, replies: 1, synced: 2, failed: 0 });
    expect((await replies()).map((r) => r.body).sort()).toEqual(["Or Wednesday.", "Tuesday works."]);
    expect(await synced()).toEqual([
      { person_id: PERSON, actor_id: ADMIN, direction: "out", from_email: "ada@gm.test", subject: "Coffee?", body: "Free Friday?" },
      { person_id: PERSON, actor_id: ADMIN, direction: "in", from_email: "cam@cand.test", subject: "Re: Coffee?", body: "Yes!" },
    ]);
    // Mail with anyone else is read no further than its headers.
    expect(gmail.reads).toContain("boss1:metadata");
    expect(gmail.reads).not.toContain("boss1:full");
    expect(gmail.reads).not.toContain("lee1:full");

    // Nothing new: nothing kept twice.
    expect(await syncGmail(db(), deps)).toEqual({ mailboxes: 1, replies: 0, synced: 0, failed: 0 });
    expect(await synced()).toHaveLength(2);

    // Synced mail is on the candidate for the team, never an interviewer.
    expect((await asLee().from("candidate_mail").select("subject")).data).toHaveLength(2);
    expect((await token("user_gm_ivan").from("candidate_mail").select("subject")).data).toEqual([]);
    const activity = await clientTools.getActivity(asAda(), ada, { candidateId: PERSON });
    expect(activity.entries.filter((e) => e.kind === "email.in" || e.kind === "email.out").map((e) => [e.kind, e.actor, e.text])).toEqual([
      ["email.in", null, "Re: Coffee?"],
      ["email.out", "Ada Admin", "Coffee?"],
    ]);
  });

  test("a member's own connection is synced only with leave to read", async () => {
    const gmail = fakeGmail();
    await connect(asAda(), SEND);
    await sendOne(mailerWith(gmail));
    gmail.put({ id: "reply1", threadId: "thread1", labelIds: ["INBOX"], from: "cam@cand.test", to: "ada@gmail.test", subject: "Re", text: "Yes", at: Date.now() + 1000 });
    expect(await syncGmail(db(), { google, serviceAccount: null, fetch: gmail.fetch })).toMatchObject({ mailboxes: 0 });
    expect(await replies()).toEqual([]);
  });
});
