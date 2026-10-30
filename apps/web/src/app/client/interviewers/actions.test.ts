import { beforeEach, describe, expect, test, vi } from "vitest";

// setAccessAction by hand: an action is callable by id from any page, so what
// a tampered form or a failing database gets back is checked here, without the
// page. What the database decides is in member-access.integration.test.ts.

const { requireClient, setMemberAccess, revalidatePath, redirect } = vi.hoisted(() => ({
  requireClient: vi.fn(),
  setMemberAccess: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/client/session", () => ({ requireClient }));
vi.mock("@/lib/client/workos", () => ({ clientInvitations: vi.fn() }));
vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, setMemberAccess } };
});

import { clientTools } from "@tacit-ats/core";
import { setAccessAction } from "./actions";

const MEMBER = { db: { fake: true }, actorId: "a1", accessLevel: "admin", org: { id: "o1" } };
const TARGET = "e6a00000-0000-4000-8000-0000000000a2";

const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const landsOn = (f: FormData) => expect(setAccessAction(f)).rejects.toThrow(/^REDIRECT /);
const url = () => String(redirect.mock.calls.at(-1)?.[0]);

beforeEach(() => {
  vi.clearAllMocks();
  requireClient.mockResolvedValue(MEMBER);
  setMemberAccess.mockResolvedValue({ outcome: "changed", previous: "limited", access: "elevated" });
});

describe("setAccessAction", () => {
  test("nothing runs for someone who is not signed in", async () => {
    requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(setAccessAction(form({ actorId: TARGET, accessLevel: "admin" }))).rejects.toThrow("unauthenticated");
    expect(setMemberAccess).not.toHaveBeenCalled();
  });

  test("source is dashboard and the level comes from the token, not the form", async () => {
    requireClient.mockResolvedValue({ ...MEMBER, accessLevel: "elevated" });
    await landsOn(form({ actorId: TARGET, accessLevel: "admin", accessLevelOfCaller: "admin", orgId: "other", source: "claude" }));
    expect(setMemberAccess).toHaveBeenCalledWith(MEMBER.db, { actorId: "a1", orgId: "o1", accessLevel: "elevated", source: "dashboard" }, { userId: TARGET, access: "admin" });
  });

  test.each([
    ["empty", ""],
    ["not a uuid", "nope"],
    ["markup", "<script>alert(1)</script>"],
    ["a uuid with more after it", `${TARGET}' or 1=1`],
    ["huge", "a".repeat(200_000)],
    ["unicode", "名前-💥"],
  ])("a member id that is %s is refused before anything runs", async (_name, actorId) => {
    await landsOn(form({ actorId, accessLevel: "admin" }));
    expect(setMemberAccess).not.toHaveBeenCalled();
    expect(url()).toBe("/client/interviewers?error=member_gone");
  });

  test("a file where the id should be is refused the same way", async () => {
    await landsOn(form({ actorId: new File(["x"], "x.txt"), accessLevel: "admin" }));
    expect(setMemberAccess).not.toHaveBeenCalled();
    expect(url()).toBe("/client/interviewers?error=member_gone");
  });

  test.each([
    ["missing", null],
    ["empty", ""],
    ["unknown", "owner"],
    ["cased", "ADMIN"],
    ["padded", " admin"],
    ["markup", "<b>admin</b>"],
    ["huge", "admin".repeat(50_000)],
    ["a file", new File(["admin"], "admin")],
  ])("a level that is %s is refused before anything runs", async (_name, level) => {
    await landsOn(form({ actorId: TARGET, ...(level === null ? {} : { accessLevel: level }) }));
    expect(setMemberAccess).not.toHaveBeenCalled();
    expect(url()).toBe("/client/interviewers?error=access_invalid");
  });

  test("a change revalidates the layout, since the sidebar names the level", async () => {
    await landsOn(form({ actorId: TARGET, accessLevel: "elevated" }));
    expect(revalidatePath).toHaveBeenCalledWith("/client", "layout");
    expect(url()).toBe("/client/interviewers?notice=access_changed");
  });

  test("the same level again says so", async () => {
    setMemberAccess.mockResolvedValue({ outcome: "unchanged", previous: "elevated", access: "elevated" });
    await landsOn(form({ actorId: TARGET, accessLevel: "elevated" }));
    expect(url()).toBe("/client/interviewers?notice=access_unchanged");
  });

  test.each([
    ["forbidden", "access_forbidden"],
    ["invalid", "last_admin"],
    ["not_found", "member_gone"],
    ["rate_limited", "rate_limited"],
  ] as const)("a %s refusal comes back as %s and only the code rides in the URL", async (code, error) => {
    setMemberAccess.mockRejectedValue(new clientTools.ClientToolError(code, "Refused, lee@acme.test."));
    await landsOn(form({ actorId: TARGET, accessLevel: "limited" }));
    expect(url()).toBe(`/client/interviewers?error=${error}`);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("a database failure is a generic error, with no message in the URL", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    setMemberAccess.mockRejectedValue(new Error("connection lost at lee@acme.test"));
    await landsOn(form({ actorId: TARGET, accessLevel: "limited" }));
    expect(url()).toBe("/client/interviewers?error=failed");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
