import { beforeEach, describe, expect, test, vi } from "vitest";

// The reply box's two actions by hand, as anyone can call them by id: the
// fields tampered with, the session gone, a write failing. Drafting never
// sends, sending takes a draft id and no words, and the URL carries codes and
// ids only. The mailer is a fake and the writes are mocked: nothing is sent.

const session = vi.hoisted(() => ({ requireClient: vi.fn() }));
const email = vi.hoisted(() => ({ draftReply: vi.fn(), sendDraft: vi.fn() }));
const mailer = vi.hoisted(() => ({ webMailer: vi.fn() }));
const redirected = vi.hoisted(() => ({ to: [] as string[] }));

vi.mock("@/lib/client/session", () => session);
vi.mock("@/lib/client/email", () => email);
vi.mock("@/lib/client/mailer", () => mailer);
vi.mock("@/lib/client/applicants", () => ({ isRoute: () => false, routeApplicant: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirected.to.push(to);
    throw new Error("NEXT_REDIRECT");
  },
}));

import { draftReplyAction, routeApplicantAction, sendReplyAction } from "./actions";

const APPLICATION = "22222222-2222-4222-8222-222222222222";
const CANDIDATE = "33333333-3333-4333-8333-333333333333";
const DRAFT = "44444444-4444-4444-8444-444444444444";
const WORDS = "Budget frozen, do not tell Sam";
const FAKE = { send: vi.fn(), fromAddress: "hiring@example.test" };

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const good = { applicationId: APPLICATION, candidateId: CANDIDATE, subject: "Hello", body: WORDS };
const ctx = { actorId: "a", orgId: "o", accessLevel: "admin", source: "dashboard" };

beforeEach(() => {
  vi.clearAllMocks();
  redirected.to.length = 0;
  session.requireClient.mockResolvedValue({ db: {}, actorId: "a", accessLevel: "admin", org: { id: "o" } });
  mailer.webMailer.mockReturnValue(FAKE);
  email.draftReply.mockResolvedValue({ ok: true, draftId: DRAFT });
  email.sendDraft.mockResolvedValue({ ok: true });
});

describe("draftReplyAction", () => {
  test("nothing happens without a session", async () => {
    session.requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(draftReplyAction({}, form(good))).rejects.toThrow("unauthenticated");
    expect(email.draftReply).not.toHaveBeenCalled();
  });

  test("writes a draft on the member's client as dashboard, sends nothing, and goes back to the ticket", async () => {
    await expect(draftReplyAction({}, form(good))).rejects.toThrow("NEXT_REDIRECT");
    expect(email.draftReply).toHaveBeenCalledWith({}, ctx, FAKE, { candidateId: CANDIDATE, applicationId: APPLICATION, subject: "Hello", body: WORDS });
    expect(email.sendDraft).not.toHaveBeenCalled();
    expect(FAKE.send).not.toHaveBeenCalled();
    expect(redirected.to).toEqual([`/client/applicants?a=${APPLICATION}`]);
  });

  test.each([
    ["no application", { ...good, applicationId: "" }],
    ["an id that isn't one", { ...good, candidateId: "1 or 1=1" }],
    ["no body", { applicationId: APPLICATION, candidateId: CANDIDATE, subject: "Hello" }],
    ["no subject", { applicationId: APPLICATION, candidateId: CANDIDATE, body: WORDS }],
  ])("%s writes nothing", async (_, fields) => {
    expect(await draftReplyAction({}, form(fields as Record<string, string>))).toEqual({ error: expect.any(String) });
    expect(email.draftReply).not.toHaveBeenCalled();
  });

  test("a template it started from goes to core as its id beside the posted words", async () => {
    const TEMPLATE = "55555555-5555-4555-8555-555555555555";
    await expect(draftReplyAction({}, form({ ...good, templateId: TEMPLATE }))).rejects.toThrow("NEXT_REDIRECT");
    expect(email.draftReply).toHaveBeenCalledWith({}, ctx, FAKE, { candidateId: CANDIDATE, applicationId: APPLICATION, subject: "Hello", body: WORDS, template: TEMPLATE });
  });

  test("a template id that isn't one is dropped, and the words still draft", async () => {
    await expect(draftReplyAction({}, form({ ...good, templateId: "Intro call" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(email.draftReply).toHaveBeenCalledWith({}, ctx, FAKE, { candidateId: CANDIDATE, applicationId: APPLICATION, subject: "Hello", body: WORDS });
  });

  test("a refusal stays on the form, not in a URL", async () => {
    email.draftReply.mockResolvedValue({ ok: false, error: "An email needs a body." });
    expect(await draftReplyAction({}, form(good))).toEqual({ error: "An email needs a body." });
    expect(redirected.to).toEqual([]);
  });

  test("a failed write says so, and its words stay out of the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    email.draftReply.mockRejectedValue(new Error("connection reset"));
    expect(await draftReplyAction({}, form(good))).toEqual({ error: expect.stringContaining("No draft was written") });
    expect(JSON.stringify(log.mock.calls)).not.toContain(WORDS);
    log.mockRestore();
  });
});

describe("sendReplyAction", () => {
  const post = async (fields: Record<string, string>) => {
    await expect(sendReplyAction(form(fields))).rejects.toThrow("NEXT_REDIRECT");
    return new URL(redirected.to.at(-1)!, "http://x");
  };

  test("nothing happens without a session", async () => {
    session.requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(sendReplyAction(form({ draftId: DRAFT, applicationId: APPLICATION }))).rejects.toThrow("unauthenticated");
    expect(email.sendDraft).not.toHaveBeenCalled();
  });

  test("sends the posted draft and stays on the ticket: a reply routes nobody", async () => {
    const url = await post({ draftId: DRAFT, applicationId: APPLICATION, subject: "Other", body: "Other words" });
    expect(email.sendDraft).toHaveBeenCalledWith({}, ctx, FAKE, DRAFT);
    expect(url.searchParams.get("a")).toBe(APPLICATION);
    expect(url.searchParams.get("notice")).toBe("sent");
    expect(email.draftReply).not.toHaveBeenCalled();
  });

  test.each([
    ["no draft", { applicationId: APPLICATION }],
    ["an id that isn't one", { draftId: "x", applicationId: APPLICATION }],
    ["no application", { draftId: DRAFT }],
  ])("%s sends nothing", async (_, fields) => {
    expect((await post(fields as Record<string, string>)).searchParams.get("error")).toBe("send_gone");
    expect(email.sendDraft).not.toHaveBeenCalled();
  });

  test("a refusal is a code on the same ticket", async () => {
    email.sendDraft.mockResolvedValue({ ok: false, error: "send_already" });
    const url = await post({ draftId: DRAFT, applicationId: APPLICATION });
    expect(url.searchParams.get("error")).toBe("send_already");
    expect(url.searchParams.get("a")).toBe(APPLICATION);
  });

  test("a failure doesn't claim nothing went out", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    email.sendDraft.mockRejectedValue(new Error("connection reset"));
    expect((await post({ draftId: DRAFT, applicationId: APPLICATION })).searchParams.get("error")).toBe("send_failed");
    log.mockRestore();
  });
});

describe("Home's tab", () => {
  test("a post from the tab comes back to the tab, and the form can name no other place", async () => {
    await expect(routeApplicantAction(form({ home: "1" }))).rejects.toThrow("NEXT_REDIRECT");
    await expect(routeApplicantAction(form({ home: "https://evil.example" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected.to).toEqual(["/client?sub=tickets&error=not_found", "/client/applicants?error=not_found"]);
  });
});
