import { beforeEach, describe, expect, test, vi } from "vitest";

// botCommandAction by hand, as anyone can call it by id: the fields tampered
// with, the session gone, the write refused. The URL it answers with carries
// codes and ids only. It queues through lib/client/bot-tasks and never calls a
// bot: fetch throws here, so a stray delivery would fail these.

const session = vi.hoisted(() => ({ requireClient: vi.fn() }));
const bots = vi.hoisted(() => ({ sendBotCommand: vi.fn() }));
const redirected = vi.hoisted(() => ({ to: [] as string[] }));

vi.mock("@/lib/client/session", () => session);
vi.mock("@/lib/client/bot-tasks", () => bots);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirected.to.push(to);
    throw new Error("NEXT_REDIRECT");
  },
}));

import { botCommandAction } from "./actions";

const TASK = "11111111-1111-4111-8111-111111111111";
const NEXT = "app-22222222-2222-4222-8222-222222222222";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const post = async (fields: Record<string, string>) => {
  await expect(botCommandAction(form(fields))).rejects.toThrow("NEXT_REDIRECT");
  return new URL(redirected.to.at(-1)!, "http://x");
};

beforeEach(() => {
  vi.clearAllMocks();
  redirected.to.length = 0;
  vi.stubGlobal("fetch", () => {
    throw new Error("a bot was called");
  });
  session.requireClient.mockResolvedValue({ db: { mine: true }, actorId: "a", accessLevel: "admin", org: { id: "o" } });
  bots.sendBotCommand.mockResolvedValue({ ok: true, changed: true });
});

describe("botCommandAction", () => {
  test("nothing happens without a session", async () => {
    session.requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(botCommandAction(form({ taskId: TASK, command: "retry" }))).rejects.toThrow("unauthenticated");
    expect(bots.sendBotCommand).not.toHaveBeenCalled();
  });

  test.each([
    ["no task", { command: "retry" }],
    ["no command", { taskId: TASK }],
    ["an id that isn't one", { taskId: "1 or 1=1", command: "retry" }],
    ["a command this page doesn't offer", { taskId: TASK, command: "cancel" }],
    ["the other one it doesn't", { taskId: TASK, command: "send_invite" }],
    ["one it never heard of", { taskId: TASK, command: "delete" }],
  ])("%s queues nothing", async (_, fields) => {
    expect((await post(fields as Record<string, string>)).searchParams.get("error")).toBe("bot_gone");
    expect(bots.sendBotCommand).not.toHaveBeenCalled();
  });

  test("a retry from Activity queues on the member's own client and says it is only queued", async () => {
    const url = await post({ taskId: TASK, command: "retry" });
    expect(bots.sendBotCommand).toHaveBeenCalledWith({ mine: true }, "a", { taskId: TASK, command: "retry" }, expect.any(Date));
    expect(url.pathname).toBe("/client/activity");
    expect(url.searchParams.get("notice")).toBe("retry_queued");
    expect(url.searchParams.has("i")).toBe(false);
  });

  test("a nudge from the Inbox goes on to the next issue", async () => {
    const url = await post({ taskId: TASK, command: "nudge", from: "inbox", next: NEXT });
    expect(url.pathname).toBe("/client/inbox");
    expect(url.searchParams.get("notice")).toBe("nudge_queued");
    expect(url.searchParams.get("i")).toBe(NEXT);
  });

  test("a `next` that isn't an issue key is dropped, and `from` can't send you elsewhere", async () => {
    const url = await post({ taskId: TASK, command: "retry", from: "//evil.test", next: "javascript:alert(1)" });
    expect(url.pathname).toBe("/client/activity");
    expect(url.searchParams.has("i")).toBe(false);
  });

  test("already dealt with is said, and nothing more", async () => {
    bots.sendBotCommand.mockResolvedValue({ ok: true, changed: false });
    expect((await post({ taskId: TASK, command: "retry" })).searchParams.get("notice")).toBe("bot_unchanged");
  });

  test.each([
    ["not_found", "bot_gone"],
    ["forbidden", "bot_forbidden"],
    ["closed", "bot_closed"],
  ])("%s answers %s, on the issue it was on", async (error, code) => {
    bots.sendBotCommand.mockResolvedValue({ ok: false, error });
    const url = await post({ taskId: TASK, command: "retry", from: "inbox", next: NEXT });
    expect(url.searchParams.get("error")).toBe(code);
    expect(url.searchParams.get("i")).toBe(`bot-${TASK}`);
  });

  test("a write that throws says nothing was queued, and logs no more than the message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    bots.sendBotCommand.mockRejectedValue(new Error("connection reset"));
    expect((await post({ taskId: TASK, command: "retry" })).searchParams.get("error")).toBe("bot_failed");
    expect(log).toHaveBeenCalledWith("[client-activity] command failed:", "connection reset");
    log.mockRestore();
  });
});
