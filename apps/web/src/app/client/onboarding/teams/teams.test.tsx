import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The Teams step's actions by hand, without the page, and what the step renders
// for each kind of reader. What the database decides is in
// lib/client/onboarding-teams.integration.test.ts.

const { requireClient, addTeamMember, removeTeamMember, setTeamLead, createDepartment, revalidatePath } = vi.hoisted(() => ({
  requireClient: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  setTeamLead: vi.fn(),
  createDepartment: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/client/session", () => ({ requireClient }));
vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, addTeamMember, removeTeamMember, setTeamLead, createDepartment } };
});

import { clientTools } from "@tacit-ats/core";
import { buildTeamMatrix } from "@/lib/client/team-matrix";
import { createTeamAction, setTeamLeadAction, setTeamMemberAction } from "./actions";
import { TeamsStep } from "./matrix";

const MEMBER = { db: { fake: true }, actorId: "a1", accessLevel: "admin", org: { id: "o1" } };
const TEAM = "e6a00000-0000-4000-8000-0000000000a1";
const PERSON = "e6a00000-0000-4000-8000-0000000000a2";
const CTX = { actorId: "a1", orgId: "o1", accessLevel: "admin", source: "dashboard" };

beforeEach(() => {
  vi.clearAllMocks();
  requireClient.mockResolvedValue(MEMBER);
  addTeamMember.mockResolvedValue({ outcome: "added" });
  removeTeamMember.mockResolvedValue({ outcome: "removed" });
  setTeamLead.mockResolvedValue({ outcome: "changed" });
  createDepartment.mockResolvedValue({ outcome: "created" });
});

describe("the actions", () => {
  test("nothing runs for someone who is not signed in", async () => {
    requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(setTeamMemberAction({ teamId: TEAM, memberId: PERSON, on: true })).rejects.toThrow("unauthenticated");
    await expect(setTeamLeadAction({ teamId: TEAM, memberId: PERSON })).rejects.toThrow("unauthenticated");
    await expect(createTeamAction({ name: "Infra" })).rejects.toThrow("unauthenticated");
    expect(addTeamMember).not.toHaveBeenCalled();
    expect(setTeamLead).not.toHaveBeenCalled();
    expect(createDepartment).not.toHaveBeenCalled();
  });

  test("a tick runs as the member, source dashboard, and refreshes the checklist", async () => {
    expect(await setTeamMemberAction({ teamId: TEAM, memberId: PERSON, on: true })).toEqual({ ok: true, changed: true });
    expect(addTeamMember).toHaveBeenCalledWith(MEMBER.db, CTX, { department: TEAM, memberId: PERSON });
    expect(revalidatePath).toHaveBeenCalledWith("/client/onboarding", "layout");
  });

  test("an untick removes, and clearing a lead sends null", async () => {
    await setTeamMemberAction({ teamId: TEAM, memberId: PERSON, on: false });
    expect(removeTeamMember).toHaveBeenCalledOnce();
    await setTeamLeadAction({ teamId: TEAM, memberId: null });
    expect(setTeamLead).toHaveBeenCalledWith(MEMBER.db, CTX, { department: TEAM, memberId: null });
  });

  test("a tampered id reaches no tool", async () => {
    expect(await setTeamMemberAction({ teamId: "Infra", memberId: PERSON, on: true })).toMatchObject({ ok: false });
    expect(await setTeamLeadAction({ teamId: TEAM, memberId: "someone" })).toMatchObject({ ok: false });
    expect(await setTeamMemberAction({ teamId: TEAM, memberId: PERSON, on: "yes" as unknown as boolean })).toMatchObject({ ok: false });
    expect(addTeamMember).not.toHaveBeenCalled();
    expect(setTeamLead).not.toHaveBeenCalled();
  });

  test("a refusal comes back as a sentence, and the page refreshes", async () => {
    addTeamMember.mockRejectedValue(new clientTools.ClientToolError("forbidden", "x"));
    expect(await setTeamMemberAction({ teamId: TEAM, memberId: PERSON, on: true })).toEqual({ ok: false, error: "Only an admin can change this." });
    expect(revalidatePath).toHaveBeenCalled();
  });

  test("a sentence written for the connector does not reach the page", async () => {
    addTeamMember.mockRejectedValue(new clientTools.ClientToolError("invalid", "That department is archived. Pick another from list_departments."));
    expect(await setTeamMemberAction({ teamId: TEAM, memberId: PERSON, on: true })).toEqual({ ok: false, error: "That department is archived. Reload to see your teams." });
  });

  test("a failure that may have landed does not say nothing changed", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    setTeamLead.mockRejectedValue(new Error("connection reset"));
    expect(await setTeamLeadAction({ teamId: TEAM, memberId: PERSON })).toEqual({ ok: false, error: "That didn't save, and it may not have gone through. Reload and check." });
    quiet.mockRestore();
  });

  test("New team says what happened, and refuses an odd name", async () => {
    createDepartment.mockResolvedValue({ outcome: "restored" });
    expect(await createTeamAction({ name: "Old" })).toEqual({ ok: true, outcome: "restored" });
    createDepartment.mockRejectedValue(new clientTools.ClientToolError("invalid", "A department needs a name."));
    expect(await createTeamAction({ name: 7 as unknown as string })).toEqual({ ok: false, error: "A department needs a name." });
    expect(createDepartment).toHaveBeenLastCalledWith(MEMBER.db, CTX, { name: "" });
  });
});

describe("the step", () => {
  const node = (id: string, name: string, parentId: string | null = null) => ({ id, name, parentId, archived: false });
  const matrix = buildTeamMatrix(
    [{ id: "a", name: "Ada" }, { id: "b", name: "Bo" }],
    [node("eng", "Engineering"), node("plat", "Platform", "eng")],
    [
      { departmentId: "eng", members: [{ memberId: "a", lead: true }] },
      { departmentId: "plat", members: [{ memberId: "a", lead: false }] },
    ],
  );

  test("an admin gets ticks that press, leads, New team and the phone's list", () => {
    const html = renderToStaticMarkup(<TeamsStep matrix={matrix} editable />);
    expect(html).toContain("Engineering › Platform");
    expect(html).toContain("Multidisciplinary");
    expect(html).toContain('aria-label="Bo on Engineering"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Make Ada lead of Engineering › Platform");
    expect(html).toContain("New team");
    expect(html).toContain("md:hidden");
  });

  test("anyone else reads the same ticks, with nothing to press", () => {
    const html = renderToStaticMarkup(<TeamsStep matrix={matrix} editable={false} />);
    expect(html).toContain("Ada on Engineering: yes");
    expect(html).toContain("Bo on Engineering: no");
    expect(html).not.toContain("<button");
  });

  test("with no teams an admin is offered New team, and a reader is told", () => {
    const none = { people: matrix.people, teams: [] };
    expect(renderToStaticMarkup(<TeamsStep matrix={none} editable />)).toContain("New team");
    const read = renderToStaticMarkup(<TeamsStep matrix={none} editable={false} />);
    expect(read).toContain("No teams yet.");
    expect(read).not.toContain("New team");
  });
});
