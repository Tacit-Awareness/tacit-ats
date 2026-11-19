import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ outcome: { ok: true } as { ok: true } | { ok: false; error: string }, calls: [] as unknown[][] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));
vi.mock("@/lib/client/session", () => ({ requireClient: async () => ({ db: "member-db" }) }));
vi.mock("@/lib/client/bot-tasks", () => ({
  commandTicket: async (...args: unknown[]) => {
    state.calls.push(args);
    return state.outcome;
  },
}));

import { ticketCommandAction } from "./actions";

const TASK = "11111111-2222-4333-8444-555555555555";
const post = async (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  try {
    await ticketCommandAction(form);
  } catch (e) {
    return (e as { to: string }).to;
  }
  throw new Error("expected a redirect");
};

beforeEach(() => {
  state.outcome = { ok: true };
  state.calls = [];
});

test("a command is queued on the member's own client and said back by its code", async () => {
  expect(await post({ taskId: TASK, command: "nudge" })).toBe(`/client/tickets?t=${TASK}&notice=nudge`);
  expect(state.calls).toEqual([["member-db", TASK, "nudge"]]);
});

test("a refusal comes back as its code on the ticket", async () => {
  state.outcome = { ok: false, error: "forbidden" };
  expect(await post({ taskId: TASK, command: "cancel" })).toBe(`/client/tickets?t=${TASK}&error=forbidden`);
});

test("a tampered id or a command the page never offers writes nothing", async () => {
  expect(await post({ taskId: "not-a-uuid", command: "nudge" })).toBe("/client/tickets?error=not_found");
  expect(await post({ taskId: TASK, command: "send_invite" })).toBe("/client/tickets?error=not_found");
  expect(await post({ taskId: TASK, command: "delete" })).toBe("/client/tickets?error=not_found");
  expect(state.calls).toEqual([]);
});
