import { beforeEach, describe, expect, test, vi } from "vitest";

const core = vi.hoisted(() => ({
  agentDestinationBySecret: vi.fn(),
  reportBotTask: vi.fn(),
}));
const notifier = vi.hoisted(() => ({ notifierDb: () => ({ fake: "db" }), companyBotId: vi.fn() }));
vi.mock("@tacit/core", () => core);
vi.mock("@/lib/notify/notifier", () => notifier);

import { POST } from "./route";

const ACME = "0a000000-0000-4000-8000-00000000000a";
const BOT = "44444444-4444-4444-8444-444444444444";
const TASK = "55555555-5555-4555-8555-555555555555";
const SECRET = `tbs_${"a".repeat(64)}`;

const post = (body: unknown, auth: string | null = `Bearer ${SECRET}`) =>
  POST(new Request("https://ats.test/api/agents/bot-task", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
const body = { ref: "task-1", kind: "get_read", status: "waiting", steps: [{ label: "Asked Daniel", at: "2026-10-30T10:00:00Z" }], needsYou: false };

beforeEach(() => {
  core.agentDestinationBySecret.mockReset().mockImplementation(async (_db: unknown, secret: string) =>
    secret === SECRET ? { orgId: ACME, channel: "grok_bot_webhook" } : null);
  notifier.companyBotId.mockReset().mockResolvedValue(BOT);
  core.reportBotTask.mockReset().mockResolvedValue({ ok: true, taskId: TASK });
});

describe("POST /api/agents/bot-task", () => {
  test("no bearer, or one no company's bot holds: 401, and nothing is written", async () => {
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, `Bearer tbs_${"b".repeat(64)}`)).status).toBe(401);
    expect(core.reportBotTask).not.toHaveBeenCalled();
  });

  test("a company whose bot row has gone: 401", async () => {
    notifier.companyBotId.mockResolvedValue(null);
    expect((await post(body)).status).toBe(401);
    expect(core.reportBotTask).not.toHaveBeenCalled();
  });

  test("reports under the company the secret names, never one from the body", async () => {
    const res = await post({ ...body, orgId: "33333333-3333-4333-8333-333333333333", agentDestinationId: "66666666-6666-4666-8666-666666666666" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, taskId: TASK });
    const [db, input] = core.reportBotTask.mock.calls[0]!;
    expect(db).toEqual({ fake: "db" });
    expect(input).toMatchObject({ ...body, orgId: ACME, agentDestinationId: BOT });
  });

  test("a body that isn't an object: 400", async () => {
    for (const bad of ["not json", "null", "4"]) expect((await post(bad)).status).toBe(400);
    expect(core.reportBotTask).not.toHaveBeenCalled();
  });

  test("an invalid report: 400; an id of another company: 404", async () => {
    core.reportBotTask.mockResolvedValue({ ok: false, reason: "invalid" });
    expect((await post(body)).status).toBe(400);
    core.reportBotTask.mockResolvedValue({ ok: false, reason: "not_found" });
    expect((await post(body)).status).toBe(404);
  });
});
