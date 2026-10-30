import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { readHomeTargets, saveHomeTarget } from "./home-targets";

const { setHomeTarget, clearHomeTarget, getHomeTargets } = vi.hoisted(() => ({ setHomeTarget: vi.fn(), clearHomeTarget: vi.fn(), getHomeTargets: vi.fn() }));

vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, setHomeTarget, clearHomeTarget, getHomeTargets } };
});

const CTX: clientTools.ClientToolCtx = { actorId: "actor-1", orgId: "org-1", accessLevel: "admin", source: "dashboard" };
const DB = {} as Db;
const SET = { ok: true, metric: "review", value: 48 } as const;
const CLEAR = { ok: true, metric: "review", value: null } as const;
const refused = (code: clientTools.ClientToolError["code"]) => new clientTools.ClientToolError(code, "No.");

beforeEach(() => {
  setHomeTarget.mockReset();
  clearHomeTarget.mockReset();
  getHomeTargets.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveHomeTarget", () => {
  test("a number is clientTools' audited set, on the member's own client", async () => {
    setHomeTarget.mockResolvedValue({ outcome: "changed", previous: null, value: 48 });
    expect(await saveHomeTarget(DB, CTX, SET)).toEqual({ ok: true, changed: true });
    expect(setHomeTarget).toHaveBeenCalledWith(DB, CTX, { metric: "review", value: 48 });
    expect(clearHomeTarget).not.toHaveBeenCalled();
  });

  test("0 sets a target of 0 and does not clear", async () => {
    setHomeTarget.mockResolvedValue({ outcome: "changed", previous: 5, value: 0 });
    await saveHomeTarget(DB, CTX, { ok: true, metric: "review", value: 0 });
    expect(setHomeTarget).toHaveBeenCalledWith(DB, CTX, { metric: "review", value: 0 });
    expect(clearHomeTarget).not.toHaveBeenCalled();
  });

  test("no number clears", async () => {
    clearHomeTarget.mockResolvedValue({ outcome: "changed", previous: 48, value: null });
    expect(await saveHomeTarget(DB, CTX, CLEAR)).toEqual({ ok: true, changed: true });
    expect(clearHomeTarget).toHaveBeenCalledWith(DB, CTX, { metric: "review" });
    expect(setHomeTarget).not.toHaveBeenCalled();
  });

  test("the same number again is said, not treated as a change", async () => {
    setHomeTarget.mockResolvedValue({ outcome: "unchanged", previous: 48, value: 48 });
    expect(await saveHomeTarget(DB, CTX, SET)).toEqual({ ok: true, changed: false });
  });

  test.each([
    ["forbidden", "forbidden"],
    ["rate_limited", "rate_limited"],
    ["invalid", "invalid"],
    ["not_found", "failed"],
  ] as const)("a %s refusal is the code %s", async (code, error) => {
    setHomeTarget.mockRejectedValue(refused(code));
    expect(await saveHomeTarget(DB, CTX, SET)).toEqual({ ok: false, error });
  });

  test("a failure is the code failed, and its message goes no further than the log", async () => {
    clearHomeTarget.mockRejectedValue(new Error("connection lost"));
    expect(await saveHomeTarget(DB, CTX, CLEAR)).toEqual({ ok: false, error: "failed" });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("readHomeTargets", () => {
  test("the targets", async () => {
    getHomeTargets.mockResolvedValue({ review: 48 });
    expect(await readHomeTargets(DB)).toEqual({ review: 48 });
  });

  test("a failed read is null, so Home keeps its numbers and offers no Set a target", async () => {
    getHomeTargets.mockRejectedValue(new Error("relation does not exist"));
    expect(await readHomeTargets(DB)).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});
