import { beforeEach, describe, expect, test, vi } from "vitest";

const { resolveClient, readApplicantQueue, readInbox, readBotNeedsYou } = vi.hoisted(() => ({
  resolveClient: vi.fn(),
  readApplicantQueue: vi.fn(),
  readInbox: vi.fn(),
  readBotNeedsYou: vi.fn(),
}));
vi.mock("@/lib/client/session", () => ({ resolveClient }));
vi.mock("@/lib/client/applicants", () => ({ readApplicantQueue }));
vi.mock("@/lib/client/inbox", () => ({ readInbox }));
vi.mock("@/lib/client/bot-tasks", () => ({ readBotNeedsYou }));

import { GET } from "./route";

const member = (accessLevel: "limited" | "elevated" | "admin") => ({
  status: "ok",
  ctx: { db: {}, actorId: "a1", accessLevel, org: { id: "o1", name: "Acme", slug: "acme", workosOrgId: "w1" } },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  readBotNeedsYou.mockResolvedValue({ tasks: [], capped: false });
});

describe("GET /client/marks", () => {
  test("anyone refused gets a 401 that knows nothing, and reads nothing", async () => {
    resolveClient.mockResolvedValue({ status: "forbidden", reason: "not_invited" });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ inbox: null, tickets: null, activity: null });
    expect(readInbox).not.toHaveBeenCalled();
    expect(readApplicantQueue).not.toHaveBeenCalled();
    expect(readBotNeedsYou).not.toHaveBeenCalled();
  });

  test("a member gets ids and nothing else, never cached", async () => {
    resolveClient.mockResolvedValue(member("elevated"));
    readInbox.mockResolvedValue({ issues: [{ key: "app-1", who: "Riley Referred", what: "Overdue", draft: { body: "secret" } }] });
    readApplicantQueue.mockResolvedValue([{ applicationId: "2", name: "Casey Careers", email: "casey@x.test", answers: [] }]);
    readBotNeedsYou.mockResolvedValue({ tasks: [{ id: "t3", error: "secret", candidate: { name: "Ada" } }], capped: false });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe('{"inbox":["app-1"],"tickets":["2"],"activity":["t3"]}');
  });

  test("an interviewer reads neither page, only their own Activity", async () => {
    resolveClient.mockResolvedValue(member("limited"));
    readBotNeedsYou.mockResolvedValue({ tasks: [{ id: "t3" }], capped: false });
    expect(await (await GET()).json()).toEqual({ inbox: [], tickets: [], activity: ["t3"] });
    expect(readInbox).not.toHaveBeenCalled();
    expect(readApplicantQueue).not.toHaveBeenCalled();
  });

  test("a read that fails answers null for that page alone", async () => {
    resolveClient.mockResolvedValue(member("admin"));
    readInbox.mockRejectedValue(new Error("canceling statement due to statement timeout"));
    readApplicantQueue.mockResolvedValue([{ applicationId: "2" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inbox: null, tickets: ["2"], activity: [] });
  });

  test("both failing is still an answer, not a 500", async () => {
    resolveClient.mockResolvedValue(member("admin"));
    readInbox.mockRejectedValue("not even an error");
    readApplicantQueue.mockRejectedValue(new Error("down"));
    readBotNeedsYou.mockRejectedValue(new Error("down"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inbox: null, tickets: null, activity: null });
  });
});
