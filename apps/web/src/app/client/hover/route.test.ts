import { beforeEach, describe, expect, test, vi } from "vitest";

const { resolveClient, readCandidateCard, readMemberCard } = vi.hoisted(() => ({
  resolveClient: vi.fn(),
  readCandidateCard: vi.fn(),
  readMemberCard: vi.fn(),
}));
vi.mock("@/lib/client/session", () => ({ resolveClient }));
vi.mock("@/lib/client/hover-card", () => ({ readCandidateCard, readMemberCard }));

import { GET } from "./route";

const ID = "c1000000-0000-4000-8000-0000000000f1";
const ask = (t: string) => GET(new Request(`https://x.test/client/hover?t=${encodeURIComponent(t)}`));
const ok = { status: "ok", ctx: { db: {}, actorId: "a1", accessLevel: "elevated", org: { id: "o1" } } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /client/hover", () => {
  test("anyone refused gets a 401 and reads nothing", async () => {
    resolveClient.mockResolvedValue({ status: "forbidden", reason: "not_invited" });
    const res = await ask(`c:${ID}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ card: null });
    expect(readCandidateCard).not.toHaveBeenCalled();
  });

  test("a tampered target reads nothing", async () => {
    resolveClient.mockResolvedValue(ok);
    expect((await ask("c:not-a-uuid")).status).toBe(400);
    expect(readCandidateCard).not.toHaveBeenCalled();
    expect(readMemberCard).not.toHaveBeenCalled();
  });

  test("each kind reads on the member's own context, never cached", async () => {
    resolveClient.mockResolvedValue(ok);
    readCandidateCard.mockResolvedValue({ name: "Ann" });
    readMemberCard.mockResolvedValue({ name: "Ivy" });
    const candidate = await ask(`c:${ID}`);
    expect(candidate.headers.get("cache-control")).toBe("no-store");
    expect(await candidate.json()).toEqual({ card: { name: "Ann" } });
    expect(readCandidateCard.mock.calls[0]!.slice(0, 2)).toEqual([ok.ctx, ID]);
    expect(await (await ask(`m:${ID}`)).json()).toEqual({ card: { name: "Ivy" } });
    expect(readMemberCard.mock.calls[0]!.slice(0, 2)).toEqual([ok.ctx, ID]);
  });

  test("someone they can't see is a 404, and a failed read says nothing", async () => {
    resolveClient.mockResolvedValue(ok);
    readCandidateCard.mockResolvedValue(null);
    expect((await ask(`c:${ID}`)).status).toBe(404);
    readCandidateCard.mockRejectedValue(new Error("permission denied for table people"));
    const res = await ask(`c:${ID}`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"card":null}');
  });
});
