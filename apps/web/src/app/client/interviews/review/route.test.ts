import { beforeEach, describe, expect, test, vi } from "vitest";

const { resolveClient, setReviewed } = vi.hoisted(() => ({ resolveClient: vi.fn(), setReviewed: vi.fn() }));
vi.mock("@/lib/client/session", () => ({ resolveClient }));
vi.mock("@/lib/client/interview-reviews", () => ({ setReviewed }));

import { POST } from "./route";

const ID = "d1e00000-0000-4000-8000-000000000001";
const db = { own: "token" };
const member = { status: "ok", ctx: { db, actorId: "a1", accessLevel: "limited", org: { id: "o1", name: "Acme", slug: "acme", workosOrgId: "w1" } } };

const post = (body: unknown, headers: Record<string, string> = { "content-type": "application/json", "sec-fetch-site": "same-origin" }) =>
  POST(new Request("http://x.test/client/interviews/review", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  resolveClient.mockResolvedValue(member);
  setReviewed.mockResolvedValue(true);
});

describe("POST /client/interviews/review", () => {
  test("anyone refused gets a 401 and writes nothing", async () => {
    resolveClient.mockResolvedValue({ status: "forbidden", reason: "not_invited" });
    const res = await post({ interviewId: ID, reviewed: true });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false });
    expect(setReviewed).not.toHaveBeenCalled();
  });

  test("a member's write goes on their own token as themselves, whatever the body says, and is never cached", async () => {
    const res = await post({ interviewId: ID, reviewed: true, actorId: "someone-else", orgId: "other" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
    expect(setReviewed).toHaveBeenCalledWith(db, "a1", { interviewId: ID, reviewed: true });
  });

  test("a bad body is a 400 and writes nothing", async () => {
    for (const bad of ["not json", {}, { interviewId: "1", reviewed: true }, { interviewId: ID }]) {
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(setReviewed).not.toHaveBeenCalled();
  });

  test("an interview they cannot read is a 404", async () => {
    setReviewed.mockResolvedValue(false);
    expect((await post({ interviewId: ID, reviewed: true })).status).toBe(404);
  });

  test("a failed write is a 500 that says nothing, and logs only the message", async () => {
    setReviewed.mockRejectedValue(new Error("connection refused"));
    const res = await post({ interviewId: ID, reviewed: true });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false });
    expect(console.error).toHaveBeenCalledWith("[client-interviews] review failed:", "connection refused");
  });

  test("another site cannot reach it, by the browser's word or by a form's content type", async () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      const res = await post({ interviewId: ID, reviewed: true }, { "content-type": "application/json", "sec-fetch-site": site });
      expect(res.status, site).toBe(403);
    }
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const res = await post({ interviewId: ID, reviewed: true }, { "content-type": type });
      expect(res.status, type).toBe(403);
    }
    expect(resolveClient).not.toHaveBeenCalled();
    expect(setReviewed).not.toHaveBeenCalled();
  });
});
