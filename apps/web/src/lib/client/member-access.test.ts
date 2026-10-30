import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { changeMemberAccess, soleAdmin } from "./member-access";

const { setMemberAccess } = vi.hoisted(() => ({ setMemberAccess: vi.fn() }));

vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, setMemberAccess } };
});

const CTX: clientTools.ClientToolCtx = { actorId: "actor-1", orgId: "org-1", accessLevel: "admin", source: "dashboard" };
const DB = {} as Db;
const refused = (code: clientTools.ClientToolError["code"]) => new clientTools.ClientToolError(code, "No.");

beforeEach(() => {
  setMemberAccess.mockReset();
});

describe("changeMemberAccess", () => {
  test("is clientTools' audited write, on the member's own client", async () => {
    setMemberAccess.mockResolvedValue({ outcome: "changed", previous: "limited", access: "elevated" });
    expect(await changeMemberAccess(DB, CTX, { actorId: "actor-2", level: "elevated" })).toEqual({ ok: true, changed: true });
    expect(setMemberAccess).toHaveBeenCalledWith(DB, CTX, { userId: "actor-2", access: "elevated" });
  });

  test("the same level again is said, not treated as a change", async () => {
    setMemberAccess.mockResolvedValue({ outcome: "unchanged", previous: "admin", access: "admin" });
    expect(await changeMemberAccess(DB, CTX, { actorId: "actor-2", level: "admin" })).toEqual({ ok: true, changed: false });
  });

  test.each([[null], [""], ["owner"], ["Admin"], ["__proto__"], [2], [{}]])("%j is refused before anything is written", async (level) => {
    expect(await changeMemberAccess(DB, CTX, { actorId: "actor-2", level })).toEqual({ ok: false, error: "access_invalid" });
    expect(setMemberAccess).not.toHaveBeenCalled();
  });

  test.each([
    ["forbidden", "access_forbidden"],
    ["invalid", "last_admin"],
    ["not_found", "member_gone"],
    ["rate_limited", "rate_limited"],
  ] as const)("a %s refusal is the code %s", async (code, error) => {
    setMemberAccess.mockRejectedValue(refused(code));
    expect(await changeMemberAccess(DB, CTX, { actorId: "actor-2", level: "limited" })).toEqual({ ok: false, error });
  });

  test("anything else is not a refusal and goes up", async () => {
    setMemberAccess.mockRejectedValue(new Error("connection lost"));
    await expect(changeMemberAccess(DB, CTX, { actorId: "actor-2", level: "limited" })).rejects.toThrow("connection lost");
  });
});

describe("soleAdmin", () => {
  const m = (id: string, access_level: string) => ({ id, access_level });

  test("the one admin", () => {
    expect(soleAdmin([m("a", "admin"), m("b", "elevated"), m("c", "limited")])).toBe("a");
  });

  test("nobody when two can cover for each other, or there are none", () => {
    expect(soleAdmin([m("a", "admin"), m("b", "admin")])).toBeNull();
    expect(soleAdmin([m("b", "elevated")])).toBeNull();
    expect(soleAdmin([])).toBeNull();
  });
});
