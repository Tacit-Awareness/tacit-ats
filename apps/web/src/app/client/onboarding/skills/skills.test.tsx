import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The Interview skills step's actions by hand, without the page, and what the step
// renders. What the database decides is in lib/client/onboarding-teams.integration.test.ts.

const { requireClient, saveFocusAreas, addInterviewType, renameInterviewType, archiveInterviewType, assignInterviewType, unassignInterviewType, prioritizeInterviewType, revalidatePath } = vi.hoisted(() => ({
  requireClient: vi.fn(),
  saveFocusAreas: vi.fn(),
  addInterviewType: vi.fn(),
  renameInterviewType: vi.fn(),
  archiveInterviewType: vi.fn(),
  assignInterviewType: vi.fn(),
  unassignInterviewType: vi.fn(),
  prioritizeInterviewType: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/client/session", () => ({ requireClient }));
vi.mock("@/lib/client/onboarding-teams", () => ({ saveFocusAreas }));
vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, addInterviewType, renameInterviewType, archiveInterviewType, assignInterviewType, unassignInterviewType, prioritizeInterviewType } };
});

import { clientTools } from "@tacit-ats/core";
import { addTypeAction, archiveTypeAction, renameTypeAction, saveSkillsAction, setRunAction, setStarAction } from "./actions";
import { SkillsStep } from "./sheet";

const MEMBER = { db: { fake: true }, actorId: "a1", accessLevel: "admin", org: { id: "o1" } };
const TYPE = "e6a00000-0000-4000-8000-0000000000a1";
const PERSON = "e6a00000-0000-4000-8000-0000000000a2";
const CTX = { actorId: "a1", orgId: "o1", accessLevel: "admin", source: "dashboard" };
const SAVE = { memberId: PERSON, version: "v1", skills: ["Go"] };

beforeEach(() => {
  vi.clearAllMocks();
  requireClient.mockResolvedValue(MEMBER);
  saveFocusAreas.mockResolvedValue({ outcome: "changed" });
  addInterviewType.mockResolvedValue({ outcome: "created" });
  renameInterviewType.mockResolvedValue({ outcome: "renamed" });
  archiveInterviewType.mockResolvedValue({ outcome: "changed" });
  assignInterviewType.mockResolvedValue({ outcome: "assigned" });
  unassignInterviewType.mockResolvedValue({ outcome: "unassigned" });
  prioritizeInterviewType.mockResolvedValue({ outcome: "changed" });
});

describe("saveSkillsAction", () => {
  test("nothing runs for someone who is not signed in", async () => {
    requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(saveSkillsAction(SAVE)).rejects.toThrow("unauthenticated");
    expect(saveFocusAreas).not.toHaveBeenCalled();
  });

  test("names the version the page showed", async () => {
    expect(await saveSkillsAction(SAVE)).toEqual({ ok: true, changed: true });
    expect(saveFocusAreas).toHaveBeenCalledWith(MEMBER.db, CTX, { memberId: PERSON, expectedUpdatedAt: "v1", focusAreas: ["Go"] });
    expect(revalidatePath).toHaveBeenCalledWith("/client/onboarding", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/client/interviewers");
  });

  test("this step is an admin's, even for their own, and points at where theirs lives", async () => {
    requireClient.mockResolvedValue({ ...MEMBER, accessLevel: "elevated" });
    expect(await saveSkillsAction({ ...SAVE, memberId: "a1" })).toEqual({ ok: false, error: expect.stringContaining("Interviewers page") });
    expect(saveFocusAreas).not.toHaveBeenCalled();
  });

  test("a stale save says so, and the page refreshes to what it says now", async () => {
    saveFocusAreas.mockResolvedValue({ outcome: "stale" });
    expect(await saveSkillsAction(SAVE)).toEqual({ ok: false, error: expect.stringContaining("Someone else") });
    expect(revalidatePath).toHaveBeenCalled();
  });

  test("the profile's limit is said in this step's words", async () => {
    saveFocusAreas.mockRejectedValue(new clientTools.ClientToolError("invalid", "Keep what they know to 20 areas, one per line.", "focusAreas"));
    expect(await saveSkillsAction(SAVE)).toEqual({ ok: false, error: "Keep it to 20 skills, each 60 characters at most." });
  });

  test("a tampered form reaches no tool", async () => {
    expect(await saveSkillsAction({ ...SAVE, memberId: "x" })).toMatchObject({ ok: false });
    expect(await saveSkillsAction({ ...SAVE, skills: "Go" as unknown as string[] })).toMatchObject({ ok: false });
    expect(await saveSkillsAction({ ...SAVE, skills: [1] as unknown as string[] })).toMatchObject({ ok: false });
    expect(await saveSkillsAction({ ...SAVE, version: 3 as unknown as string })).toMatchObject({ ok: false });
    expect(saveFocusAreas).not.toHaveBeenCalled();
  });
});

describe("the interview type actions", () => {
  test("each starts by checking who is calling", async () => {
    requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    for (const call of [
      () => addTypeAction({ name: "Coding" }),
      () => renameTypeAction({ typeId: TYPE, name: "Coding" }),
      () => archiveTypeAction({ typeId: TYPE }),
      () => setRunAction({ typeId: TYPE, memberId: PERSON, on: true }),
      () => setStarAction({ typeId: TYPE, memberId: PERSON, starred: true }),
    ]) {
      await expect(call()).rejects.toThrow("unauthenticated");
    }
    expect(addInterviewType).not.toHaveBeenCalled();
    expect(assignInterviewType).not.toHaveBeenCalled();
  });

  test("run as the member, source dashboard", async () => {
    await addTypeAction({ name: "Coding" });
    expect(addInterviewType).toHaveBeenCalledWith(MEMBER.db, CTX, { name: "Coding" });
    await renameTypeAction({ typeId: TYPE, name: "Pairing" });
    expect(renameInterviewType).toHaveBeenCalledWith(MEMBER.db, CTX, { type: TYPE, name: "Pairing" });
    await archiveTypeAction({ typeId: TYPE });
    expect(archiveInterviewType).toHaveBeenCalledWith(MEMBER.db, CTX, { type: TYPE });
    await setRunAction({ typeId: TYPE, memberId: PERSON, on: true });
    expect(assignInterviewType).toHaveBeenCalledWith(MEMBER.db, CTX, { type: TYPE, memberId: PERSON });
    await setRunAction({ typeId: TYPE, memberId: PERSON, on: false });
    expect(unassignInterviewType).toHaveBeenCalledWith(MEMBER.db, CTX, { type: TYPE, memberId: PERSON });
    await setStarAction({ typeId: TYPE, memberId: PERSON, starred: true });
    expect(prioritizeInterviewType).toHaveBeenCalledWith(MEMBER.db, CTX, { type: TYPE, memberId: PERSON, prioritized: true });
  });

  test("refusals come back as sentences", async () => {
    addInterviewType.mockRejectedValue(new clientTools.ClientToolError("forbidden", "x"));
    expect(await addTypeAction({ name: "Coding" })).toEqual({ ok: false, error: "Only an admin can change this." });
    renameInterviewType.mockRejectedValue(new clientTools.ClientToolError("invalid", "Another interview type already has that name."));
    expect(await renameTypeAction({ typeId: TYPE, name: "Coding" })).toEqual({ ok: false, error: "Another interview type already has that name." });
    prioritizeInterviewType.mockRejectedValue(new clientTools.ClientToolError("rate_limited", "x"));
    expect(await setStarAction({ typeId: TYPE, memberId: PERSON, starred: true })).toEqual({ ok: false, error: expect.stringContaining("300 changes") });
  });

  test("a tampered id reaches no tool", async () => {
    expect(await archiveTypeAction({ typeId: "Coding" })).toMatchObject({ ok: false });
    expect(await setRunAction({ typeId: TYPE, memberId: "x", on: true })).toMatchObject({ ok: false });
    expect(await setStarAction({ typeId: TYPE, memberId: PERSON, starred: "1" as unknown as boolean })).toMatchObject({ ok: false });
    expect(archiveInterviewType).not.toHaveBeenCalled();
    expect(assignInterviewType).not.toHaveBeenCalled();
    expect(prioritizeInterviewType).not.toHaveBeenCalled();
  });
});

describe("the step", () => {
  const person = { id: "a", name: "Ada", teams: ["Eng › Platform"], skills: ["Go"], version: "v1", runs: { t1: true } };
  const sheet = { people: [person], types: [{ id: "t1", name: "Coding", interviewers: 1 }, { id: "t2", name: "Design", interviewers: 0 }] };

  test("an admin gets the tag input, the types' rename and archive, and the star", () => {
    const html = renderToStaticMarkup(<SkillsStep sheet={sheet} editable />);
    expect(html).toContain("Remove Go");
    expect(html).toContain("Rename Coding");
    expect(html).toContain("Archive Coding");
    expect(html).toContain("Ada is asked first for Coding");
    expect(html).toContain("Ada runs Design");
    expect(html).toContain("No one runs this yet");
  });

  test("anyone else reads it, with nothing to press", () => {
    const html = renderToStaticMarkup(<SkillsStep sheet={sheet} editable={false} />);
    expect(html).toContain("★ Coding");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
  });

  test("nothing is seeded: the empty step offers to add one", () => {
    const html = renderToStaticMarkup(<SkillsStep sheet={{ people: [person], types: [] }} editable />);
    expect(html).toContain("Add an interview type");
    expect(html).not.toContain("Interviews<");
  });
});
