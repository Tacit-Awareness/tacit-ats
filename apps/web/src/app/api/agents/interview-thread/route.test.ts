import { beforeEach, describe, expect, test, vi } from "vitest";

const core = vi.hoisted(() => ({
  agentDestinationBySecret: vi.fn(),
  recordInterviewThread: vi.fn(),
}));
vi.mock("@tacit/core", () => core);
vi.mock("@/lib/notify/notifier", () => ({ notifierDb: () => ({ fake: "db" }) }));

import { POST } from "./route";

const ACME = "0a000000-0000-4000-8000-00000000000a";
const INTERVIEW = "11111111-1111-4111-8111-111111111111";
const CARA = "22222222-2222-4222-8222-222222222222";
const SECRET = `tbs_${"a".repeat(64)}`;

const post = (body: unknown, auth: string | null = `Bearer ${SECRET}`) =>
  POST(new Request("https://ats.test/api/agents/interview-thread", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  }));
const body = { interviewId: INTERVIEW, interviewerUserId: CARA, slack: { channel: "D123", threadTs: "1761580000.000100" } };

beforeEach(() => {
  core.agentDestinationBySecret.mockReset().mockImplementation(async (_db: unknown, secret: string) =>
    secret === SECRET ? { orgId: ACME, channel: "grok_bot_webhook" } : null);
  core.recordInterviewThread.mockReset().mockResolvedValue({ ok: true });
});

describe("POST /api/agents/interview-thread", () => {
  test("no bearer, or one no company's bot holds: 401, and nothing is looked at", async () => {
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, `Bearer tbs_${"b".repeat(64)}`)).status).toBe(401);
    expect(core.recordInterviewThread).not.toHaveBeenCalled();
  });

  test("records the thread under the company the secret names, never one from the body", async () => {
    const res = await post({ ...body, orgId: "33333333-3333-4333-8333-333333333333" });
    expect(res.status).toBe(200);
    expect(core.recordInterviewThread).toHaveBeenCalledWith({ fake: "db" }, {
      interviewId: INTERVIEW, actorId: CARA, channel: "grok_bot_webhook", slackChannelId: "D123", threadTs: "1761580000.000100", orgId: ACME,
    });
  });

  test("ids that are not uuids: 400; an interview of another company: 404", async () => {
    expect((await post({ ...body, interviewId: "nope" })).status).toBe(400);
    core.recordInterviewThread.mockResolvedValue({ ok: false, reason: "not_found" });
    expect((await post(body)).status).toBe(404);
  });
});
