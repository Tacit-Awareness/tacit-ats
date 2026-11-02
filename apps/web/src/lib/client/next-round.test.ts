import type { Db } from "@tacit/db";
import { beforeEach, describe, expect, test, vi } from "vitest";

// readNextRound by hand: what the Calendar opens Next round on, from core's
// getInterviewPlan on the member's own token. What a step is next is core's
// (plans.ts's nextStep); here is only that the page asks for the right job and
// that a read the member is refused still opens the dialog.

const { getInterviewPlan } = vi.hoisted(() => ({ getInterviewPlan: vi.fn() }));
vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, getInterviewPlan } };
});

import { clientTools } from "@tacit-ats/core";
import { readNextRound } from "./schedule-choices";

const APP = "11111111-2222-4333-8444-555555555555";
const member = { actorId: "a1", orgId: "o1", accessLevel: "admin" as const };

function dbWith(row: { role_id: string } | null, error: { message: string } | null = null) {
  const q: Record<string, unknown> = {};
  const seen: Array<[string, unknown]> = [];
  q.select = () => q;
  q.eq = (column: string, value: unknown) => {
    seen.push([column, value]);
    return q;
  };
  q.maybeSingle = async () => ({ data: row, error });
  return { seen, db: { from: () => q } as unknown as Db };
}

beforeEach(() => {
  vi.clearAllMocks();
  getInterviewPlan.mockResolvedValue({ jobId: "job-1", title: "Engineer", steps: ["Screen", "Onsite"], candidate: { nextStep: "Onsite" } });
});

describe("readNextRound", () => {
  test("the plan's next step, for the job the application is on", async () => {
    const { db, seen } = dbWith({ role_id: "job-1" });
    expect(await readNextRound(db, member, APP)).toEqual({ applicationId: APP, step: "Onsite" });
    expect(seen).toContainEqual(["id", APP]);
    expect(getInterviewPlan).toHaveBeenCalledWith(db, expect.objectContaining({ actorId: "a1", orgId: "o1" }), { jobId: "job-1", applicationId: APP });
  });

  test("every step booked or held: the candidate alone", async () => {
    getInterviewPlan.mockResolvedValue({ jobId: "job-1", title: "Engineer", steps: [], candidate: { nextStep: null } });
    expect(await readNextRound(dbWith({ role_id: "job-1" }).db, member, APP)).toEqual({ applicationId: APP, step: null });
  });

  test("an application they can't read asks core nothing", async () => {
    expect(await readNextRound(dbWith(null).db, member, APP)).toEqual({ applicationId: APP, step: null });
    expect(getInterviewPlan).not.toHaveBeenCalled();
  });

  test("a job core refuses them still opens the dialog", async () => {
    getInterviewPlan.mockRejectedValue(new clientTools.ClientToolError("not_found", "No job"));
    expect(await readNextRound(dbWith({ role_id: "job-1" }).db, member, APP)).toEqual({ applicationId: APP, step: null });
  });

  test("a database that fails says so", async () => {
    await expect(readNextRound(dbWith(null, { message: "down" }).db, member, APP)).rejects.toThrow("down");
    getInterviewPlan.mockRejectedValue(new Error("boom"));
    await expect(readNextRound(dbWith({ role_id: "job-1" }).db, member, APP)).rejects.toThrow("boom");
  });
});
