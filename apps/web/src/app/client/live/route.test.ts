import { beforeEach, describe, expect, test, vi } from "vitest";

const { resolveClient } = vi.hoisted(() => ({ resolveClient: vi.fn() }));
vi.mock("@/lib/client/session", () => ({ resolveClient }));

import { readLiveStamp } from "@/lib/client/live";
import { GET } from "./route";

type Answer = { data: unknown; error: { message: string } | null };

// A client whose newest-row reads answer per table, recording what was asked.
function fakeDb(answers: Record<string, Answer>) {
  const asked: { table: string; select: string; order: string; limit: number }[] = [];
  const db = {
    from: (table: string) => {
      const q = { table, select: "", order: "", limit: 0 };
      const chain = {
        select: (s: string) => ((q.select = s), chain),
        order: (col: string, o: { ascending: boolean }) => ((q.order = `${col} ${o.ascending ? "asc" : "desc"}`), chain),
        limit: (n: number) => ((q.limit = n), chain),
        maybeSingle: async () => (asked.push(q), answers[table]),
      };
      return chain;
    },
  };
  return { db, asked };
}

const member = (db: unknown) => ({
  status: "ok",
  ctx: { db, actorId: "a1", accessLevel: "elevated", org: { id: "o1", name: "Acme", slug: "acme" } },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("readLiveStamp", () => {
  test("the newest event and the latest-changed application, one row each", async () => {
    const { db, asked } = fakeDb({
      application_events: { data: { id: "e9" }, error: null },
      applications: { data: { id: "a3", updated_at: "2026-11-02T10:00:00Z" }, error: null },
    });
    expect(await readLiveStamp(db as never)).toBe("e9:a3:2026-11-02T10:00:00Z");
    expect(asked).toEqual([
      { table: "application_events", select: "id", order: "created_at desc", limit: 1 },
      { table: "applications", select: "id, updated_at", order: "updated_at desc", limit: 1 },
    ]);
  });

  test("nothing readable yet is still a stamp, so the first application moves it", async () => {
    const { db } = fakeDb({ application_events: { data: null, error: null }, applications: { data: null, error: null } });
    expect(await readLiveStamp(db as never)).toBe("-:-:-");
  });

  test("a failed read is no answer", async () => {
    const { db } = fakeDb({ application_events: { data: null, error: { message: "boom" } }, applications: { data: null, error: null } });
    expect(await readLiveStamp(db as never)).toBeNull();
  });
});

describe("GET /client/live", () => {
  test("anyone refused gets a 401 that knows nothing", async () => {
    resolveClient.mockResolvedValue({ status: "forbidden", reason: "not_invited" });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ stamp: null });
  });

  test("a member gets the stamp read on their own client, never cached", async () => {
    const { db } = fakeDb({
      application_events: { data: { id: "e1" }, error: null },
      applications: { data: { id: "a1", updated_at: "2026-11-02T09:00:00Z" }, error: null },
    });
    resolveClient.mockResolvedValue(member(db));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ stamp: "e1:a1:2026-11-02T09:00:00Z" });
  });
});
