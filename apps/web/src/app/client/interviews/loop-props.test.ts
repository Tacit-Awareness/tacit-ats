import { describe, expect, test } from "vitest";
import type { clientTools } from "@tacit-ats/core";
import { loopProps } from "./loop-props";

const progress: clientTools.PlanProgress = {
  applicationId: "app",
  seesAllInterviews: true,
  steps: [{ position: 1, step: "Screen", state: "done", interviews: [] }],
  offPlan: [],
  nextStep: null,
};

const props = (isAdmin: boolean) =>
  loopProps({ candidate: "Ada", jobTitle: "Engineer", progress, selectedId: "i1", listed: new Set(), href: (id) => id, stage: null, routing: null, isAdmin, now: 0 });

describe("Edit the process", () => {
  test("an admin has it even with no process drawn or a plan that doesn't match", () => {
    const p = props(true);
    expect(p.route).toBeNull();
    expect(p.editProcess).toBe("/client/onboarding/process");
  });

  test("nobody else does", () => {
    expect(props(false).editProcess).toBeNull();
  });
});
