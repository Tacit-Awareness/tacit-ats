import { beforeEach, describe, expect, test, vi } from "vitest";

// The route by hand: what gets past its door, and what it hands on. What
// happens after that is schedule-ops.test.ts and schedule-writes.integration.test.ts.

const { resolveClient, runScheduleRequest, memberCalendar, revalidatePath } = vi.hoisted(() => ({
  resolveClient: vi.fn(),
  runScheduleRequest: vi.fn(),
  memberCalendar: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/client/session", () => ({ resolveClient }));
vi.mock("@/lib/client/schedule-ops", () => ({ runScheduleRequest }));
vi.mock("@/lib/member-calendar/grants", () => ({ memberCalendar }));

import { POST } from "./route";

const ID = "d1a00000-0000-4000-8000-0000000000e1";
const CTX = { db: { fake: true }, actorId: "a1", accessLevel: "elevated", org: { id: "o1", name: "Acme", slug: "acme", workosOrgId: "w" }, user: {} };
const CANCEL = { op: "cancel", confirmed: true, interviewId: ID, timezone: "UTC" };

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://ats.test/client/schedule/api", {
    method: "POST",
    body,
    headers: { origin: "https://ats.test", host: "ats.test", "content-type": "application/json", ...headers },
  });

beforeEach(() => {
  vi.clearAllMocks();
  resolveClient.mockResolvedValue({ status: "ok", ctx: CTX });
  memberCalendar.mockReturnValue({ fake: "calendar" });
  runScheduleRequest.mockResolvedValue({ ok: true, kind: "changed", op: "cancel", calendar: "cancelled" });
});

const nothingRan = () => {
  expect(runScheduleRequest).not.toHaveBeenCalled();
  expect(memberCalendar).not.toHaveBeenCalled();
};

describe("POST /client/schedule/api", () => {
  test("someone not signed in reaches neither the grants nor the write", async () => {
    resolveClient.mockResolvedValue({ status: "forbidden", reason: "signed_out" });
    const res = await POST(post(JSON.stringify(CANCEL)));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: "signed_out" });
    nothingRan();
  });

  test("another site's request is refused", async () => {
    expect((await POST(post(JSON.stringify(CANCEL), { origin: "https://evil.test" }))).status).toBe(403);
    nothingRan();
  });

  test("a request with no Origin is refused", async () => {
    const request = new Request("https://ats.test/client/schedule/api", { method: "POST", body: JSON.stringify(CANCEL), headers: { host: "ats.test", "content-type": "application/json" } });
    expect((await POST(request)).status).toBe(403);
    nothingRan();
  });

  test("a form's content type is refused, whatever its body says", async () => {
    expect((await POST(post(JSON.stringify(CANCEL), { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(post(JSON.stringify(CANCEL), { "content-type": "application/x-www-form-urlencoded" }))).status).toBe(415);
    nothingRan();
  });

  test("a body that is too long, not JSON, or the wrong shape is refused", async () => {
    expect((await POST(post(`"${"x".repeat(17_000)}"`))).status).toBe(413);
    expect((await POST(post("{nope"))).status).toBe(400);
    expect((await POST(post(JSON.stringify({ op: "delete", timezone: "UTC" })))).status).toBe(400);
    nothingRan();
  });

  test("acts as the member, source dashboard, on the member's own client", async () => {
    await POST(post(JSON.stringify(CANCEL)));
    const [db, ctx, request, deps] = runScheduleRequest.mock.calls[0]!;
    expect(db).toBe(CTX.db);
    expect(ctx).toEqual({ actorId: "a1", orgId: "o1", accessLevel: "elevated", source: "dashboard" });
    expect(request).toMatchObject({ op: "cancel", confirmed: true, interviewId: ID });
    expect(deps).toEqual({ calendar: { fake: "calendar" } });
    expect(memberCalendar).toHaveBeenCalledWith("https://ats.test");
  });

  test("who the member is never comes from the body", async () => {
    await POST(post(JSON.stringify({ ...CANCEL, actorId: "someone-else", orgId: "another-org", accessLevel: "admin", source: "claude" })));
    expect(runScheduleRequest.mock.calls[0]![1]).toEqual({ actorId: "a1", orgId: "o1", accessLevel: "elevated", source: "dashboard" });
  });

  test("a change refreshes the pages that show it; a preview or a refusal does not", async () => {
    await POST(post(JSON.stringify(CANCEL)));
    expect(revalidatePath).toHaveBeenCalledWith("/client/schedule");
    revalidatePath.mockClear();

    runScheduleRequest.mockResolvedValue({ ok: true, kind: "change_preview", op: "cancel", preview: {} });
    await POST(post(JSON.stringify({ ...CANCEL, confirmed: false })));
    runScheduleRequest.mockResolvedValue({ ok: false, code: "forbidden", message: "No." });
    await POST(post(JSON.stringify(CANCEL)));
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("an answer is never cached", async () => {
    expect((await POST(post(JSON.stringify(CANCEL)))).headers.get("cache-control")).toBe("no-store");
  });
});
