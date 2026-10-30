import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { HOME_TARGET_MAX, clearHomeTarget, getHomeTargets, isHomeTargetMetric, setHomeTarget } from "./targets.js";

/** What the code adds on top of the policies, which home-targets.integration.test.ts pins on real tokens. */

const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "admin"): ClientToolCtx => ({ actorId: "actor-1", orgId: "org-1", accessLevel, source: "dashboard" });
const rpcs = (fake: FakeSupabase) => fake.calls.filter((c) => c.op === "rpc").map((c) => c.table);
const CLAIM = { data: "audit-1" };
const FINISH = { data: null };

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

describe("getHomeTargets", () => {
  test("a row is a target, 0 included; no row is none; numbers stay numbers", async () => {
    const fake = new FakeSupabase([{ data: [{ metric: "review", value: 48 }, { metric: "new_applications", value: 0 }, { metric: "workload", value: "12.50" }] }]);
    expect(await getHomeTargets(fake.asDb())).toEqual({ review: 48, new_applications: 0, workload: 12.5 });
  });

  test("a metric this build doesn't know is left out", async () => {
    const fake = new FakeSupabase([{ data: [{ metric: "stale_card", value: 1 }] }]);
    expect(await getHomeTargets(fake.asDb())).toEqual({});
  });

  test("a failed read goes up", async () => {
    const fake = new FakeSupabase([{ error: { message: "connection lost" } }]);
    await expect(getHomeTargets(fake.asDb())).rejects.toThrow("connection lost");
  });
});

describe("setHomeTarget", () => {
  test("a new target is claimed, written on org_id,metric and completed with before and after", async () => {
    const fake = new FakeSupabase([CLAIM, { data: null }, { data: null }, FINISH]);
    expect(await setHomeTarget(fake.asDb(), ctx(), { metric: "review", value: 48 })).toEqual({ outcome: "changed", previous: null, value: 48 });
    expect(rpcs(fake)).toEqual(["client_claim_write", "client_finish_write"]);
    const [claim, finish] = fake.calls.filter((c) => c.op === "rpc");
    expect(claim.args).toEqual({ p_source: "dashboard", p_action: "home_target.set", p_entity: "home_target" });
    expect(finish.args).toMatchObject({ p_entity_id: null, p_before: { metric: "review", value: null }, p_after: { metric: "review", value: 48 }, p_keep: true });
    const upsert = fake.calls.find((c) => c.op === "upsert")!;
    expect(upsert.args).toEqual({ metric: "review", value: 48 });
    expect(upsert.options).toEqual({ onConflict: "org_id,metric" });
  });

  test("the same number again writes nothing and gives the claim back", async () => {
    const fake = new FakeSupabase([CLAIM, { data: { value: 48 } }, FINISH]);
    expect(await setHomeTarget(fake.asDb(), ctx(), { metric: "review", value: 48 })).toEqual({ outcome: "unchanged", previous: 48, value: 48 });
    expect(fake.calls.some((c) => c.op === "upsert")).toBe(false);
    expect(fake.calls.find((c) => c.table === "client_finish_write")?.args).toMatchObject({ p_keep: false });
  });

  test("0 is a target, and differs from none", async () => {
    const fake = new FakeSupabase([CLAIM, { data: null }, { data: null }, FINISH]);
    expect(await setHomeTarget(fake.asDb(), ctx(), { metric: "new_applications", value: 0 })).toEqual({ outcome: "changed", previous: null, value: 0 });
  });

  test("a value is what the column would keep", async () => {
    const fake = new FakeSupabase([CLAIM, { data: null }, { data: null }, FINISH]);
    expect((await setHomeTarget(fake.asDb(), ctx(), { metric: "review", value: 31.992 })).value).toBe(31.99);
  });

  test.each([["elevated"], ["limited"]] as const)("%s is refused before any claim", async (level) => {
    const fake = new FakeSupabase();
    expect((await refusal(setHomeTarget(fake.asDb(), ctx(level), { metric: "review", value: 1 }))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test.each([
    [Number.NaN], [Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY], [-1], [-0.01], [HOME_TARGET_MAX + 1], [HOME_TARGET_MAX + 0.01],
    // Rounds to 0 at two places: what the database would keep is not what was asked for.
    [0.004],
  ])("%s is refused before any claim", async (value) => {
    const fake = new FakeSupabase();
    expect((await refusal(setHomeTarget(fake.asDb(), ctx(), { metric: "review", value }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });

  test("the limit itself is allowed, and a value rounding down onto it", async () => {
    for (const value of [HOME_TARGET_MAX, HOME_TARGET_MAX + 0.004]) {
      const fake = new FakeSupabase([CLAIM, { data: null }, { data: null }, FINISH]);
      expect((await setHomeTarget(fake.asDb(), ctx(), { metric: "workload", value })).value).toBe(HOME_TARGET_MAX);
    }
  });

  test.each([["candidates_in_process"], ["__proto__"], [""]])("metric %j is refused", async (metric) => {
    const fake = new FakeSupabase();
    expect((await refusal(setHomeTarget(fake.asDb(), ctx(), { metric: metric as "review", value: 1 }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });

  test("the policies refusing a level that moved is forbidden, and the claim is given back", async () => {
    const fake = new FakeSupabase([CLAIM, { data: null }, { error: { code: "42501", message: "row-level security" } }, FINISH]);
    expect((await refusal(setHomeTarget(fake.asDb(), ctx(), { metric: "review", value: 1 }))).code).toBe("forbidden");
    expect(fake.calls.find((c) => c.table === "client_finish_write")?.args).toMatchObject({ p_keep: false });
  });

  test("the hourly limit is rate_limited, and nothing is written", async () => {
    const fake = new FakeSupabase([{ data: null }]);
    expect((await refusal(setHomeTarget(fake.asDb(), ctx(), { metric: "review", value: 1 }))).code).toBe("rate_limited");
    expect(fake.calls.some((c) => c.op === "upsert")).toBe(false);
  });

  test("any other failure goes up and leaves the claim open", async () => {
    const fake = new FakeSupabase([CLAIM, { data: null }, { error: { code: "XX000", message: "connection lost" } }]);
    await expect(setHomeTarget(fake.asDb(), ctx(), { metric: "review", value: 1 })).rejects.toThrow("connection lost");
    expect(rpcs(fake)).toEqual(["client_claim_write"]);
  });
});

describe("clearHomeTarget", () => {
  test("a target is removed, with what it was", async () => {
    const fake = new FakeSupabase([CLAIM, { data: [{ value: 48 }] }, FINISH]);
    expect(await clearHomeTarget(fake.asDb(), ctx(), { metric: "review" })).toEqual({ outcome: "changed", previous: 48, value: null });
    expect(fake.calls.find((c) => c.op === "delete")?.filters).toEqual([{ method: "eq", column: "metric", value: "review" }]);
    expect(fake.calls.find((c) => c.table === "client_claim_write")?.args).toMatchObject({ p_action: "home_target.clear" });
    expect(fake.calls.find((c) => c.table === "client_finish_write")?.args).toMatchObject({ p_keep: true, p_before: { metric: "review", value: 48 }, p_after: { metric: "review", value: null } });
  });

  test("nothing to remove gives the claim back", async () => {
    const fake = new FakeSupabase([CLAIM, { data: [] }, FINISH]);
    expect(await clearHomeTarget(fake.asDb(), ctx(), { metric: "review" })).toEqual({ outcome: "unchanged", previous: null, value: null });
    expect(fake.calls.find((c) => c.table === "client_finish_write")?.args).toMatchObject({ p_keep: false });
  });

  test("not an admin, refused before any claim", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(clearHomeTarget(fake.asDb(), ctx("elevated"), { metric: "review" }))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });
});

test("isHomeTargetMetric does not walk the prototype", () => {
  expect(isHomeTargetMetric("review")).toBe(true);
  expect(isHomeTargetMetric("constructor")).toBe(false);
  expect(isHomeTargetMetric(undefined)).toBe(false);
});
