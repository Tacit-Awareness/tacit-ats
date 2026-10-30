import { beforeEach, describe, expect, test, vi } from "vitest";

// decideIssueAction by hand, as anyone can call it by id: the fields tampered
// with, the session gone, the write failing. The URL it answers with carries
// codes and ids only, and nothing a member typed reaches the URL or the log.

const session = vi.hoisted(() => ({ requireClient: vi.fn() }));
const inbox = vi.hoisted(() => ({ decideInboxApproval: vi.fn(), decideInboxApplication: vi.fn(), clearOverdueAction: vi.fn(), touchApplication: vi.fn() }));
const redirected = vi.hoisted(() => ({ to: [] as string[] }));

vi.mock("@/lib/client/session", () => session);
vi.mock("@/lib/client/inbox", () => inbox);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirected.to.push(to);
    throw new Error("NEXT_REDIRECT");
  },
}));

import { decideIssueAction } from "./actions";

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
});
