import { beforeEach, describe, expect, test, vi } from "vitest";

// The team's actions by hand: an action is callable by id from any page, so what
// a tampered form or a failing database gets back is checked here, without the
// page. What the database decides is in member-access.integration.test.ts and
// packages/core's company-setup.integration.test.ts.

const { requireClient, setMemberAccess, setMemberTitle, inviteClientMember, withdrawClientInvite, revalidatePath, redirect } = vi.hoisted(() => ({
  requireClient: vi.fn(),
  setMemberAccess: vi.fn(),
  setMemberTitle: vi.fn(),
  inviteClientMember: vi.fn(),
  withdrawClientInvite: vi.fn(),
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
  return { ...real, inviteClientMember, withdrawClientInvite, clientTools: { ...real.clientTools, setMemberAccess, setMemberTitle } };
});

import { ClientInviteError, clientTools } from "@tacit-ats/core";
import { inviteAction, saveTitleAction, setAccessAction, withdrawAction } from "./actions";
import { TITLE_ERRORS } from "./messages";

const MEMBER = { db: { fake: true }, actorId: "a1", accessLevel: "admin", org: { id: "o1", workosOrgId: "org_1" }, user: { workosUserId: "user_1" } };
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
  setMemberTitle.mockResolvedValue({ outcome: "changed", title: "Lead" });
  inviteClientMember.mockResolvedValue({ resent: false });
  withdrawClientInvite.mockResolvedValue({ withdrawn: true });
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
    expect(url()).toBe("/client/onboarding/people?error=member_gone");
  });

  test("a file where the id should be is refused the same way", async () => {
    await landsOn(form({ actorId: new File(["x"], "x.txt"), accessLevel: "admin" }));
    expect(setMemberAccess).not.toHaveBeenCalled();
    expect(url()).toBe("/client/onboarding/people?error=member_gone");
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
    expect(url()).toBe("/client/onboarding/people?error=access_invalid");
  });

  test("a change revalidates the layout, since the sidebar names the level", async () => {
    await landsOn(form({ actorId: TARGET, accessLevel: "elevated" }));
    expect(revalidatePath).toHaveBeenCalledWith("/client", "layout");
    expect(url()).toBe("/client/onboarding/people?notice=access_changed");
  });

  test("the same level again says so", async () => {
    setMemberAccess.mockResolvedValue({ outcome: "unchanged", previous: "elevated", access: "elevated" });
    await landsOn(form({ actorId: TARGET, accessLevel: "elevated" }));
    expect(url()).toBe("/client/onboarding/people?notice=access_unchanged");
  });

  test.each([
    ["forbidden", "access_forbidden"],
    ["invalid", "last_admin"],
    ["not_found", "member_gone"],
    ["rate_limited", "rate_limited"],
  ] as const)("a %s refusal comes back as %s and only the code rides in the URL", async (code, error) => {
    setMemberAccess.mockRejectedValue(new clientTools.ClientToolError(code, "Refused, lee@acme.test."));
    await landsOn(form({ actorId: TARGET, accessLevel: "limited" }));
    expect(url()).toBe(`/client/onboarding/people?error=${error}`);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("a database failure is a generic error, with no message in the URL", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    setMemberAccess.mockRejectedValue(new Error("connection lost at lee@acme.test"));
    await landsOn(form({ actorId: TARGET, accessLevel: "limited" }));
    expect(url()).toBe("/client/onboarding/people?error=failed");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("inviteAction and withdrawAction", () => {
  test("nothing runs for someone who is not signed in", async () => {
    requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(inviteAction(form({ email: "a@b.co" }))).rejects.toThrow("unauthenticated");
    await expect(withdrawAction(form({ actorId: TARGET }))).rejects.toThrow("unauthenticated");
    expect(inviteClientMember).not.toHaveBeenCalled();
    expect(withdrawClientInvite).not.toHaveBeenCalled();
  });

  test("an invitation lands back on People, with the checklist refreshed, and the org is the token's", async () => {
    await expect(inviteAction(form({ email: "a@b.co", displayName: "A", accessLevel: "admin", workosOrgId: "other" }))).rejects.toThrow("REDIRECT");
    expect(inviteClientMember.mock.calls[0]?.[2]).toMatchObject({ workosOrgId: "org_1", inviterUserId: "user_1", accessLevel: "admin" });
    expect(revalidatePath).toHaveBeenCalledWith("/client/onboarding", "layout");
    expect(url()).toBe("/client/onboarding/people?notice=invited");
  });

  test("a level it does not know invites an interviewer", async () => {
    await expect(inviteAction(form({ email: "a@b.co", displayName: "A", accessLevel: "owner" }))).rejects.toThrow("REDIRECT");
    expect(inviteClientMember.mock.calls[0]?.[2]).toMatchObject({ accessLevel: "limited" });
  });

  test("a refusal rides in the URL as its code, never the address", async () => {
    inviteClientMember.mockRejectedValue(new ClientInviteError("already_member", "a@b.co is on the team"));
    await expect(inviteAction(form({ email: "a@b.co", displayName: "A" }))).rejects.toThrow("REDIRECT");
    expect(url()).toBe("/client/onboarding/people?error=already_member");
  });

  test("withdrawing a bad id runs nothing, and one already gone says so", async () => {
    await expect(withdrawAction(form({ actorId: "nope" }))).rejects.toThrow("REDIRECT");
    expect(withdrawClientInvite).not.toHaveBeenCalled();
    expect(url()).toBe("/client/onboarding/people?error=not_found");
    withdrawClientInvite.mockResolvedValue({ withdrawn: false });
    await expect(withdrawAction(form({ actorId: TARGET }))).rejects.toThrow("REDIRECT");
    expect(url()).toBe("/client/onboarding/people?error=not_found");
  });
});

describe("saveTitleAction", () => {
  test("nothing runs for someone who is not signed in", async () => {
    requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(saveTitleAction(form({ actorId: TARGET, title: "Lead" }))).rejects.toThrow("unauthenticated");
    expect(setMemberTitle).not.toHaveBeenCalled();
  });

  test("who is saving comes from the token, and it answers the form instead of redirecting", async () => {
    requireClient.mockResolvedValue({ ...MEMBER, accessLevel: "limited" });
    expect(await saveTitleAction(form({ actorId: TARGET, title: " Lead ", accessLevel: "admin", source: "claude" }))).toEqual({ ok: true, changed: true });
    expect(setMemberTitle).toHaveBeenCalledWith(MEMBER.db, { actorId: "a1", orgId: "o1", accessLevel: "limited", source: "dashboard" }, { memberId: TARGET, title: "Lead" });
    expect(revalidatePath).toHaveBeenCalledWith("/client/onboarding", "layout");
    expect(redirect).not.toHaveBeenCalled();
  });

  test("a bad id is refused before anything runs", async () => {
    expect(await saveTitleAction(form({ actorId: "nope", title: "Lead" }))).toEqual({ ok: false, error: "member_gone" });
    expect(setMemberTitle).not.toHaveBeenCalled();
  });

  test("the same title says nothing changed", async () => {
    setMemberTitle.mockResolvedValue({ outcome: "unchanged", title: "Lead" });
    expect(await saveTitleAction(form({ actorId: TARGET, title: "Lead" }))).toEqual({ ok: true, changed: false });
  });

  test("an invalid title comes back with its sentence, nothing refreshed", async () => {
    setMemberTitle.mockRejectedValue(new clientTools.ClientToolError("invalid", "A title is one line.", "title"));
    expect(await saveTitleAction(form({ actorId: TARGET, title: "x" }))).toEqual({ ok: false, invalid: "A title is one line." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test.each([
    ["forbidden", "forbidden"],
    ["not_found", "member_gone"],
    ["rate_limited", "rate_limited"],
  ] as const)("a %s refusal comes back as %s", async (code, error) => {
    setMemberTitle.mockRejectedValue(new clientTools.ClientToolError(code, "Refused, lee@acme.test."));
    expect(await saveTitleAction(form({ actorId: TARGET, title: "x" }))).toEqual({ ok: false, error });
  });

  test("a database failure is generic, and does not promise nothing changed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    setMemberTitle.mockRejectedValue(new Error("connection lost at lee@acme.test"));
    expect(await saveTitleAction(form({ actorId: TARGET, title: "x" }))).toEqual({ ok: false, error: "failed" });
    expect(TITLE_ERRORS.failed).toMatch(/may not have gone through/);
    log.mockRestore();
  });
});
