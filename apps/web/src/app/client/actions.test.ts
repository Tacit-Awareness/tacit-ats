import { beforeEach, describe, expect, test, vi } from "vitest";

const { requireClient, setHomeTarget, clearHomeTarget, revalidatePath } = vi.hoisted(() => ({
  requireClient: vi.fn(),
  setHomeTarget: vi.fn(),
  clearHomeTarget: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/client/session", () => ({ requireClient }));
vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, setHomeTarget, clearHomeTarget } };
});

import { clientTools } from "@tacit-ats/core";
import { saveTargetAction } from "./actions";

const DB = { db: true };
const admin = { db: DB, actorId: "actor-1", accessLevel: "admin", org: { id: "org-1" } };
const IDLE = { status: "idle" } as const;
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  for (const m of [requireClient, setHomeTarget, clearHomeTarget, revalidatePath]) m.mockReset();
  requireClient.mockResolvedValue(admin);
  setHomeTarget.mockResolvedValue({ outcome: "changed", previous: null, value: 48 });
  clearHomeTarget.mockResolvedValue({ outcome: "changed", previous: 48, value: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveTargetAction", () => {
  test("nobody signed in stops before anything is read or written", async () => {
    requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(saveTargetAction(IDLE, form({ metric: "review", value: "2", unit: "d" }))).rejects.toThrow("unauthenticated");
    expect(setHomeTarget).not.toHaveBeenCalled();
  });

  test("saves as the member, source dashboard, in hours, and redraws Home", async () => {
    expect(await saveTargetAction(IDLE, form({ metric: "review", value: "2", unit: "d" }))).toEqual({ status: "saved" });
    expect(setHomeTarget).toHaveBeenCalledWith(DB, { actorId: "actor-1", orgId: "org-1", accessLevel: "admin", source: "dashboard" }, { metric: "review", value: 48 });
    expect(revalidatePath).toHaveBeenCalledWith("/client");
  });

  test("Remove clears", async () => {
    expect(await saveTargetAction(IDLE, form({ metric: "review", value: "2", unit: "d", clear: "on" }))).toEqual({ status: "saved" });
    expect(clearHomeTarget).toHaveBeenCalledWith(DB, expect.anything(), { metric: "review" });
    expect(setHomeTarget).not.toHaveBeenCalled();
  });

  test("nothing changed redraws nothing", async () => {
    setHomeTarget.mockResolvedValue({ outcome: "unchanged", previous: 48, value: 48 });
    expect(await saveTargetAction(IDLE, form({ metric: "review", value: "2", unit: "d" }))).toEqual({ status: "saved" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test.each([
    [{ metric: "candidates_in_process", value: "2", unit: "d" }, "invalid"],
    [{ metric: "__proto__", value: "2", unit: "d" }, "invalid"],
    [{ value: "2", unit: "d" }, "invalid"],
    [{ metric: "review", value: "2", unit: "weeks" }, "invalid"],
    [{ metric: "review", value: "2" }, "invalid"],
    [{ metric: "review", value: "-1", unit: "h" }, "not_number"],
    [{ metric: "review", value: "1e3", unit: "h" }, "not_number"],
    [{ metric: "review", value: "NaN", unit: "h" }, "not_number"],
    [{ metric: "new_applications", value: "1.5" }, "not_whole"],
    [{ metric: "workload", value: "1000001" }, "too_big"],
    [{ metric: "review", value: "0.001", unit: "h" }, "too_small"],
  ])("a tampered post %j is the code %s and writes nothing", async (fields, error) => {
    expect(await saveTargetAction(IDLE, form(fields as Record<string, string>))).toEqual({ status: "error", error });
    expect(setHomeTarget).not.toHaveBeenCalled();
    expect(clearHomeTarget).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("an org in the post is ignored: only the token says which", async () => {
    await saveTargetAction(IDLE, form({ metric: "review", value: "2", unit: "d", org_id: "someone-elses", orgId: "someone-elses" }));
    expect(setHomeTarget.mock.calls[0][1].orgId).toBe("org-1");
    expect(setHomeTarget.mock.calls[0][2]).toEqual({ metric: "review", value: 48 });
  });

  test("a refusal is a code, and nothing is redrawn", async () => {
    setHomeTarget.mockRejectedValue(new clientTools.ClientToolError("forbidden", "Only an admin."));
    expect(await saveTargetAction(IDLE, form({ metric: "review", value: "2", unit: "d" }))).toEqual({ status: "error", error: "forbidden" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("a failure says failed and never the database's message", async () => {
    setHomeTarget.mockRejectedValue(new Error("duplicate key home_targets_pkey"));
    expect(await saveTargetAction(IDLE, form({ metric: "review", value: "2", unit: "d" }))).toEqual({ status: "error", error: "failed" });
  });
});
