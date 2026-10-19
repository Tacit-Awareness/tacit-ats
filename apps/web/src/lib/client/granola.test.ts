import { describe, expect, test } from "vitest";

import { checkGranolaKey, cleanGranolaKey } from "./granola";

function granola(status: number, json: unknown) {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return Response.json(json, { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("cleanGranolaKey", () => {
  test("trims, and refuses blanks, spaces and odd lengths", () => {
    expect(cleanGranolaKey("  grn_abc123XYZ \n")).toBe("grn_abc123XYZ");
    expect(cleanGranolaKey("")).toBeNull();
    expect(cleanGranolaKey("grn_ab")).toBeNull();
    expect(cleanGranolaKey("grn_abc 123xyz")).toBeNull();
    expect(cleanGranolaKey(`grn_${"a".repeat(600)}`)).toBeNull();
  });
});

describe("checkGranolaKey", () => {
  test("lists one note with the key and reads its owner", async () => {
    const { calls, fetchImpl } = granola(200, { notes: [{ id: "n1", owner: { name: "Ann", email: " Ann@Co.test " } }], hasMore: true });
    expect(await checkGranolaKey("grn_key", fetchImpl)).toEqual({ ok: true, accountEmail: "ann@co.test" });
    expect(calls).toEqual([{ url: "https://public-api.granola.ai/v1/notes?page_size=1", auth: "Bearer grn_key" }]);
  });

  test("an account with no notes connects without an email", async () => {
    const { fetchImpl } = granola(200, { notes: [], hasMore: false });
    expect(await checkGranolaKey("grn_key", fetchImpl)).toEqual({ ok: true, accountEmail: null });
  });

  test("a refused key is invalid; anything else is unreachable", async () => {
    expect(await checkGranolaKey("k", granola(401, {}).fetchImpl)).toEqual({ ok: false, error: "invalid" });
    expect(await checkGranolaKey("k", granola(403, {}).fetchImpl)).toEqual({ ok: false, error: "invalid" });
    expect(await checkGranolaKey("k", granola(500, {}).fetchImpl)).toEqual({ ok: false, error: "unreachable" });
    const down = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    expect(await checkGranolaKey("k", down)).toEqual({ ok: false, error: "unreachable" });
  });
});
