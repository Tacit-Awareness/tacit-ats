import { beforeEach, describe, expect, test, vi } from "vitest";

// decideIssueAction by hand, as anyone can call it by id: the fields tampered
// with, the session gone, the write failing. The URL it answers with carries
// codes and ids only, and nothing a member typed reaches the URL or the log.

const session = vi.hoisted(() => ({ requireClient: vi.fn() }));
const inbox = vi.hoisted(() => ({
  decideInboxApproval: vi.fn(),
  decideInboxApplication: vi.fn(),
  clearOverdueAction: vi.fn(),
  touchApplication: vi.fn(),
  dismissIssue: vi.fn(),
  restoreIssue: vi.fn(),
  noteResolved: vi.fn(),
}));
const feed = vi.hoisted(() => ({ markRead: vi.fn(), readDigest: vi.fn() }));
const email = vi.hoisted(() => ({ sendDraft: vi.fn() }));
const mailer = vi.hoisted(() => ({ webMailer: vi.fn() }));
const redirected = vi.hoisted(() => ({ to: [] as string[] }));

vi.mock("@/lib/client/session", () => session);
vi.mock("@/lib/client/inbox", () => inbox);
vi.mock("@/lib/client/inbox-feed", () => feed);
vi.mock("@/lib/client/email", () => email);
vi.mock("@/lib/client/mailer", () => mailer);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirected.to.push(to);
    throw new Error("NEXT_REDIRECT");
  },
}));

import { decideIssueAction, dismissIssueAction, fixIssueAction, markAllDigestReadAction, markDigestReadAction, restoreIssueAction, sendDraftAction } from "./actions";

const REQUEST = "11111111-1111-4111-8111-111111111111";
const APPLICATION = "22222222-2222-4222-8222-222222222222";
const REASON = "33333333-3333-4333-8333-333333333333";
const NEXT = `app-${APPLICATION}`;
const SECRET = "Budget frozen, do not tell Sam";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const post = async (fields: Record<string, string>) => {
  await expect(decideIssueAction(form(fields))).rejects.toThrow("NEXT_REDIRECT");
  return new URL(redirected.to.at(-1)!, "http://x");
};

beforeEach(() => {
  vi.clearAllMocks();
  redirected.to.length = 0;
  session.requireClient.mockResolvedValue({ db: {}, actorId: "a", accessLevel: "admin", org: { id: "o" } });
});

describe("decideIssueAction", () => {
  test("nothing happens without a session", async () => {
    session.requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(decideIssueAction(form({ decision: "approve", requestId: REQUEST }))).rejects.toThrow("unauthenticated");
    expect(inbox.decideInboxApproval).not.toHaveBeenCalled();
    expect(inbox.decideInboxApplication).not.toHaveBeenCalled();
  });

  test.each([
    ["no decision", { requestId: REQUEST }],
    ["an unknown decision", { decision: "hire", applicationId: APPLICATION }],
    ["a decision with no id", { decision: "approve" }],
    ["an id that isn't one", { decision: "reject", requestId: "1 or 1=1", reason: SECRET }],
    ["the wrong id for the decision", { decision: "offer", requestId: REQUEST }],
  ])("%s writes nothing", async (_, fields) => {
    expect((await post(fields as Record<string, string>)).searchParams.get("error")).toBe("not_found");
    expect(inbox.decideInboxApproval).not.toHaveBeenCalled();
    expect(inbox.decideInboxApplication).not.toHaveBeenCalled();
  });

  test("posted stages are ignored: offer means offer, from the stage the issue stands on", async () => {
    inbox.decideInboxApplication.mockResolvedValue({ ok: true, changed: true, roleId: "r" });
    await post({ decision: "offer", applicationId: APPLICATION, stage: "hired", expectedStage: "offer", reasonId: REASON, note: SECRET });
    expect(inbox.decideInboxApplication.mock.calls[0]![2]).toEqual({ applicationId: APPLICATION, stage: "offer", expectedStage: "interviewing", reasonId: null, note: null });
  });

  test("a next key that isn't one is dropped", async () => {
    inbox.decideInboxApproval.mockResolvedValue({ ok: true, outcome: "approved", kind: "offer" });
    const url = await post({ decision: "approve", requestId: REQUEST, next: "https://evil.example/" });
    expect(url.pathname).toBe("/client/inbox");
    expect(url.searchParams.get("i")).toBeNull();
    expect(url.searchParams.get("notice")).toBe("approved_offer");
  });

  test("a reset request is said to be one, and moves on", async () => {
    inbox.decideInboxApproval.mockResolvedValue({ ok: true, outcome: "reset", kind: "offer" });
    const url = await post({ decision: "approve", requestId: REQUEST, next: NEXT });
    expect(url.searchParams.get("notice")).toBe("approval_reset");
    expect(url.searchParams.get("i")).toBe(NEXT);
  });

  test("a refusal stays on the issue, with its code", async () => {
    inbox.decideInboxApplication.mockResolvedValue({ ok: false, error: "changed" });
    const url = await post({ decision: "close", applicationId: APPLICATION, reasonId: REASON, note: SECRET, next: NEXT });
    expect(url.searchParams.get("error")).toBe("changed");
    expect(url.searchParams.get("i")).toBe(NEXT);
    expect(url.search).not.toContain("Budget");
  });

  test("a failure stays on the issue, and what was typed reaches neither the URL nor the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    inbox.decideInboxApproval.mockRejectedValue(new Error("the database went away"));
    const url = await post({ decision: "reject", requestId: REQUEST, reason: SECRET, next: NEXT });
    expect(url.searchParams.get("error")).toBe("failed");
    expect(url.searchParams.get("i")).toBe(`appr-${REQUEST}`);
    expect(url.search).not.toContain("Budget");
    expect(JSON.stringify(log.mock.calls)).not.toContain("Budget");
    log.mockRestore();
  });

  const INSTANCE = { issueReason: "decide", issueAt: "2026-10-28T10:00:00.000Z" };

  test("a decision that changed something leaves a resolved row, under the id it acted on", async () => {
    inbox.decideInboxApplication.mockResolvedValue({ ok: true, changed: true, roleId: "r" });
    await post({ decision: "offer", applicationId: APPLICATION, issueKey: `draft-${REQUEST}`, ...INSTANCE });
    expect(inbox.noteResolved.mock.calls[0]![1]).toEqual({ key: `app-${APPLICATION}`, reason: "decide", at: INSTANCE.issueAt });
  });

  test.each([
    ["an approval someone else decided", "not_pending"],
    ["a reset request", "reset"],
  ])("%s isn't resolved by this member", async (_, outcome) => {
    inbox.decideInboxApproval.mockResolvedValue({ ok: true, outcome, kind: "offer" });
    await post({ decision: "approve", requestId: REQUEST, ...INSTANCE, issueReason: "approval" });
    expect(inbox.noteResolved).not.toHaveBeenCalled();
  });

  test("a move that changed nothing, or was refused, isn't resolved", async () => {
    inbox.decideInboxApplication.mockResolvedValue({ ok: true, changed: false, roleId: "r" });
    await post({ decision: "offer", applicationId: APPLICATION, ...INSTANCE });
    inbox.decideInboxApplication.mockResolvedValue({ ok: false, error: "changed" });
    await post({ decision: "offer", applicationId: APPLICATION, ...INSTANCE });
    expect(inbox.noteResolved).not.toHaveBeenCalled();
  });
});

describe("fixIssueAction", () => {
  const FIX = { applicationId: APPLICATION, write: "done", expected: "Ring", issueReason: "overdue", issueAt: "2026-10-27T00:00:00Z" };
  const fix = async (fields: Record<string, string>) => {
    await expect(fixIssueAction(form(fields))).rejects.toThrow("NEXT_REDIRECT");
    return new URL(redirected.to.at(-1)!, "http://x");
  };

  test("a fix that changed something leaves a resolved row", async () => {
    inbox.clearOverdueAction.mockResolvedValue({ ok: true, changed: true, roleId: "r" });
    await fix(FIX);
    expect(inbox.noteResolved.mock.calls[0]![1]).toEqual({ key: `app-${APPLICATION}`, reason: "overdue", at: FIX.issueAt });
  });

  test("one that changed nothing doesn't", async () => {
    inbox.clearOverdueAction.mockResolvedValue({ ok: true, changed: false, roleId: "r" });
    expect((await fix(FIX)).searchParams.get("notice")).toBe("unchanged");
    expect(inbox.noteResolved).not.toHaveBeenCalled();
  });

  test("the record can fail without saying the fix did", async () => {
    inbox.touchApplication.mockResolvedValue({ ok: true, changed: true, roleId: "r" });
    expect((await fix({ applicationId: APPLICATION, write: "touch" })).searchParams.get("notice")).toBe("touched");
    expect(inbox.noteResolved.mock.calls[0]![1]).toBeNull();
  });
});

describe("dismissIssueAction", () => {
  const FIELDS = { issueKey: NEXT, issueReason: "quiet", issueAt: "2026-10-20T10:00:00.123456+00:00" };
  const OTHER = `appr-${REQUEST}`;
  const ROW = "44444444-4444-4444-8444-444444444444";
  const dismiss = async (fields: Record<string, string>) => {
    await expect(dismissIssueAction(form(fields))).rejects.toThrow("NEXT_REDIRECT");
    return new URL(redirected.to.at(-1)!, "http://x");
  };

  test("nothing happens without a session", async () => {
    session.requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(dismissIssueAction(form(FIELDS))).rejects.toThrow("unauthenticated");
    expect(inbox.dismissIssue).not.toHaveBeenCalled();
  });

  test.each([
    ["no key", { ...FIELDS, issueKey: "" }],
    ["a key with words in it", { ...FIELDS, issueKey: "app-Sam Lee" }],
    ["an unknown reason", { ...FIELDS, issueReason: "bored" }],
    ["a date that isn't one", { ...FIELDS, issueAt: "tomorrow" }],
  ])("%s writes nothing", async (_, fields) => {
    expect((await dismiss(fields)).searchParams.get("error")).toBe("not_found");
    expect(inbox.dismissIssue).not.toHaveBeenCalled();
  });

  test("from a row it stays on the card, with the notice and its Undo", async () => {
    inbox.dismissIssue.mockResolvedValue({ ok: true, changed: true, id: ROW });
    const url = await dismiss({ ...FIELDS, from: "row", next: OTHER });
    expect(url.searchParams.get("i")).toBeNull();
    expect(url.searchParams.get("notice")).toBe("dismissed");
    expect(url.searchParams.get("undo")).toBe(ROW);
  });

  test("from a row, a refusal says so on the card too", async () => {
    inbox.dismissIssue.mockResolvedValue({ ok: false });
    const url = await dismiss({ ...FIELDS, from: "row" });
    expect(url.searchParams.get("i")).toBeNull();
    expect(url.searchParams.get("error")).toBe("dismiss_refused");
  });

  test("only key, reason and date reach the write: no org, actor or how", async () => {
    inbox.dismissIssue.mockResolvedValue({ ok: true, changed: true, id: ROW });
    await dismiss({ ...FIELDS, org_id: "x", actor_id: "y", how: "resolved" });
    expect(inbox.dismissIssue.mock.calls[0]![1]).toEqual({ key: NEXT, reason: "quiet", at: FIELDS.issueAt });
  });

  test("on to the next issue, with Undo", async () => {
    inbox.dismissIssue.mockResolvedValue({ ok: true, changed: true, id: ROW });
    const url = await dismiss({ ...FIELDS, next: OTHER });
    expect(url.pathname).toBe("/client/inbox");
    expect(Object.fromEntries(url.searchParams)).toEqual({ i: OTHER, notice: "dismissed", undo: ROW });
  });

  test("with nothing below it, the reader stays on this application, so a phone still shows the Undo", async () => {
    inbox.dismissIssue.mockResolvedValue({ ok: true, changed: true, id: ROW });
    expect(Object.fromEntries((await dismiss(FIELDS)).searchParams)).toEqual({ i: NEXT, notice: "dismissed", undo: ROW });
  });

  test("a second press moves on with no Undo", async () => {
    inbox.dismissIssue.mockResolvedValue({ ok: true, changed: false });
    expect(Object.fromEntries((await dismiss({ ...FIELDS, next: OTHER })).searchParams)).toEqual({ i: OTHER, notice: "unchanged" });
  });

  test("a refusal stays on the issue", async () => {
    inbox.dismissIssue.mockResolvedValue({ ok: false, error: "refused" });
    expect(Object.fromEntries((await dismiss({ ...FIELDS, next: OTHER })).searchParams)).toEqual({ i: NEXT, error: "dismiss_refused" });
  });

  test("a failure stays on the issue and logs only the message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    inbox.dismissIssue.mockRejectedValue(new Error("the database went away"));
    expect(Object.fromEntries((await dismiss({ ...FIELDS, next: OTHER })).searchParams)).toEqual({ i: NEXT, error: "dismiss_failed" });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});

describe("restoreIssueAction", () => {
  const ROW = "44444444-4444-4444-8444-444444444444";
  const restore = async (fields: Record<string, string>) => {
    await expect(restoreIssueAction(form(fields))).rejects.toThrow("NEXT_REDIRECT");
    return new URL(redirected.to.at(-1)!, "http://x");
  };

  test("nothing happens without a session", async () => {
    session.requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(restoreIssueAction(form({ id: ROW }))).rejects.toThrow("unauthenticated");
    expect(inbox.restoreIssue).not.toHaveBeenCalled();
  });

  test("an id that isn't one reaches no query", async () => {
    await restore({ id: "1 or 1=1" });
    expect(inbox.restoreIssue).not.toHaveBeenCalled();
  });

  test("back on the issue it was", async () => {
    inbox.restoreIssue.mockResolvedValue({ key: NEXT });
    expect(Object.fromEntries((await restore({ id: ROW })).searchParams)).toEqual({ i: NEXT, notice: "restored" });
  });

  test("a row that isn't there, or isn't theirs, says so and changes nothing", async () => {
    inbox.restoreIssue.mockResolvedValue(null);
    expect(Object.fromEntries((await restore({ id: ROW })).searchParams)).toEqual({ notice: "restore_gone" });
  });

  test("a failure stays on Done", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    inbox.restoreIssue.mockRejectedValue(new Error("the database went away"));
    expect(Object.fromEntries((await restore({ id: ROW })).searchParams)).toEqual({ tab: "done", i: ROW, error: "restore_failed" });
    log.mockRestore();
  });
});

describe("sendDraftAction", () => {
  const DRAFT = "44444444-4444-4444-8444-444444444444";
  const FAKE = { send: vi.fn(), fromAddress: "hiring@example.test" };
  const send = async (fields: Record<string, string>) => {
    await expect(sendDraftAction(form(fields))).rejects.toThrow("NEXT_REDIRECT");
    return new URL(redirected.to.at(-1)!, "http://x");
  };

  beforeEach(() => {
    mailer.webMailer.mockReturnValue(FAKE);
    email.sendDraft.mockResolvedValue({ ok: true });
  });

  test("nothing happens without a session", async () => {
    session.requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(sendDraftAction(form({ draftId: DRAFT }))).rejects.toThrow("unauthenticated");
    expect(email.sendDraft).not.toHaveBeenCalled();
  });

  test("sends that draft on the member's client as dashboard, then opens the next issue", async () => {
    const url = await send({ draftId: DRAFT, next: NEXT, subject: SECRET, body: SECRET, to: "evil@example.test" });
    expect(email.sendDraft).toHaveBeenCalledWith({}, { actorId: "a", orgId: "o", accessLevel: "admin", source: "dashboard" }, FAKE, DRAFT);
    expect(url.searchParams.get("i")).toBe(NEXT);
    expect(url.searchParams.get("notice")).toBe("sent");
  });

  test.each([
    ["no draft", {}],
    ["an id that isn't one", { draftId: "1 or 1=1" }],
  ])("%s sends nothing", async (_, fields) => {
    expect((await send(fields as Record<string, string>)).searchParams.get("error")).toBe("send_gone");
    expect(email.sendDraft).not.toHaveBeenCalled();
  });

  test("a sent draft leaves a resolved row, under the draft it sent", async () => {
    await send({ draftId: DRAFT, issueKey: `app-${APPLICATION}`, issueReason: "draft", issueAt: "2026-10-30T09:00:00.000Z" });
    expect(inbox.noteResolved).toHaveBeenCalledWith({}, { key: `draft-${DRAFT}`, reason: "draft", at: "2026-10-30T09:00:00.000Z" });
  });

  test("a refusal stays on the draft, as a code", async () => {
    email.sendDraft.mockResolvedValue({ ok: false, error: "send_address" });
    const url = await send({ draftId: DRAFT, next: NEXT, issueReason: "draft", issueAt: "2026-10-30T09:00:00.000Z" });
    expect(url.searchParams.get("i")).toBe(`draft-${DRAFT}`);
    expect(url.searchParams.get("error")).toBe("send_address");
    expect(inbox.noteResolved).not.toHaveBeenCalled();
  });

  test("a failure doesn't claim nothing went out", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    email.sendDraft.mockRejectedValue(new Error("connection reset"));
    expect((await send({ draftId: DRAFT })).searchParams.get("error")).toBe("send_failed");
    log.mockRestore();
  });
});

describe("the digest's read marks", () => {
  const EVENT = `evt-${APPLICATION}`;
  const AT = "2026-10-31T10:00:00.123456+00:00";
  const post = async (action: (f: FormData) => Promise<void>, fields: Record<string, string>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    redirected.to.length = 0;
    await action(form).catch((err: Error) => {
      if (err.message !== "NEXT_REDIRECT") throw err;
    });
    return new URL(redirected.to[0]!, "http://x");
  };

  beforeEach(() => {
    vi.clearAllMocks();
    session.requireClient.mockResolvedValue({ db: {}, actorId: "a", orgId: "o", accessLevel: "admin" });
    feed.markRead.mockResolvedValue({ ok: true });
  });

  test("one row: its mark, re-read, and back to the same range", async () => {
    const url = await post(markDigestReadAction, { markKey: EVENT, markReason: "decided", markAt: AT, range: "7" });
    expect(feed.markRead).toHaveBeenCalledWith({}, [{ key: EVENT, reason: "decided", at: AT }]);
    expect(url.searchParams.get("notice")).toBe("read");
    expect(url.searchParams.get("range")).toBe("7");
  });

  test.each([
    ["an issue's key", { markKey: `app-${APPLICATION}`, markReason: "decided", markAt: AT }],
    ["an issue's reason, which would hide nothing and show on Done", { markKey: EVENT, markReason: "feedback", markAt: AT }],
    ["no time", { markKey: EVENT, markReason: "decided" }],
  ])("%s writes nothing", async (_, fields) => {
    expect((await post(markDigestReadAction, fields as Record<string, string>)).searchParams.get("error")).toBe("read_refused");
    expect(feed.markRead).not.toHaveBeenCalled();
  });

  test("a member the policy stops gets a code, not a claim", async () => {
    feed.markRead.mockResolvedValue({ ok: false, error: "refused" });
    expect((await post(markDigestReadAction, { markKey: EVENT, markReason: "decided", markAt: AT })).searchParams.get("error")).toBe("read_refused");
  });

  test("with no session nothing is read or written", async () => {
    session.requireClient.mockRejectedValue(new Error("no session"));
    await expect(markAllDigestReadAction(new FormData())).rejects.toThrow("no session");
    await expect(markDigestReadAction(new FormData())).rejects.toThrow("no session");
    expect(feed.readDigest).not.toHaveBeenCalled();
    expect(feed.markRead).not.toHaveBeenCalled();
  });

  test("all: what the member's own read finds, up to when the page was read", async () => {
    const seen = { key: EVENT, reason: "decided", at: "2026-10-31T10:00:00.000Z" };
    feed.readDigest.mockResolvedValue({ unread: [seen, { key: `iv-${APPLICATION}`, reason: "booked", at: "2026-10-31T11:30:00.000Z" }] });
    const url = await post(markAllDigestReadAction, { range: "3", asOf: "2026-10-31T11:00:00.000Z", needs: "0", markKey: `evt-${REASON}` });
    expect(feed.readDigest.mock.calls[0]![1]).toBe(3);
    expect(feed.markRead).toHaveBeenCalledWith({}, [seen]);
    expect(url.searchParams.get("notice")).toBe("all_read");
  });

  test("all, with Needs you left, says it stays", async () => {
    feed.readDigest.mockResolvedValue({ unread: [] });
    expect((await post(markAllDigestReadAction, { asOf: AT, needs: "1" })).searchParams.get("notice")).toBe("all_read_needs");
  });

  test("a failure is a code, and only that reaches the URL", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    feed.readDigest.mockRejectedValue(new Error("connection reset"));
    const url = await post(markAllDigestReadAction, { asOf: AT });
    expect(url.searchParams.get("error")).toBe("read_failed");
    expect(url.search).not.toContain("connection");
    log.mockRestore();
  });

  test("a row's Dismiss stays on the range it was pressed at", async () => {
    inbox.dismissIssue.mockResolvedValue({ ok: true, changed: false });
    const url = await post(dismissIssueAction, { issueKey: `app-${APPLICATION}`, issueReason: "quiet", issueAt: AT, from: "row", range: "3" });
    expect(url.searchParams.get("range")).toBe("3");
  });
});
