import { beforeEach, describe, expect, test, vi } from "vitest";

const { resolveClient, searchCandidates } = vi.hoisted(() => ({ resolveClient: vi.fn(), searchCandidates: vi.fn() }));
vi.mock("@/lib/client/session", () => ({ resolveClient }));
vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, searchCandidates } };
});

import { GET } from "./route";

const ask = (q: string) => GET(new Request(`https://x.test/client/search?q=${encodeURIComponent(q)}`));
const ok = { status: "ok", ctx: { db: { mine: true }, actorId: "a1", accessLevel: "limited", org: { id: "o1" } } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /client/search", () => {
  test("anyone refused gets a 401 and nothing is searched", async () => {
    resolveClient.mockResolvedValue({ status: "forbidden", reason: "not_invited" });
    expect((await ask("ann")).status).toBe(401);
    expect(searchCandidates).not.toHaveBeenCalled();
  });

  test("searches on the member's own client and level, and answers ids, names and a line", async () => {
    resolveClient.mockResolvedValue(ok);
    searchCandidates.mockResolvedValue([{ candidateId: "p1", name: "Ann", headline: "Engineer", email: "ann@secret.test", applications: [{ applicationId: "a", jobId: "j", jobTitle: "Founding Engineer", stage: "offer" }] }]);
    const res = await ask("  ann ");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ hits: [{ candidateId: "p1", name: "Ann", line: "Engineer · Founding Engineer" }] });
    const [db, ctx, input] = searchCandidates.mock.calls[0]!;
    expect(db).toBe(ok.ctx.db);
    expect(ctx).toMatchObject({ actorId: "a1", orgId: "o1", accessLevel: "limited" });
    expect(input).toMatchObject({ query: "ann", limit: 8 });
  });

  test("what core would clean to nothing searches nothing, so it never lists everyone", async () => {
    resolveClient.mockResolvedValue(ok);
    for (const q of ["", "a", "***", "%%", " , "]) expect(await (await ask(q)).json()).toEqual({ hits: [] });
    expect(searchCandidates).not.toHaveBeenCalled();
  });

  test("a failed search says nothing of why", async () => {
    resolveClient.mockResolvedValue(ok);
    searchCandidates.mockRejectedValue(new Error("permission denied"));
    const res = await ask("ann");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"hits":[]}');
  });
});
