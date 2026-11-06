import { describe, expect, test } from "vitest";

import { MemberClaimsError, memberTransaction } from "./index.js";
import { memberClaimsJson, type MemberClaims } from "./member.js";

describe("memberClaimsJson", () => {
  test("passes a member's claims through unchanged", () => {
    const claims = { role: "authenticated", sub: "user_1", org_id: "org_1", iss: "tacit-client-mcp", aud: "authenticated" } as const;
    expect(JSON.parse(memberClaimsJson(claims))).toEqual(claims);
  });

  test("an org is optional (Supabase Auth's hook adds it; the database decides what none means)", () => {
    expect(JSON.parse(memberClaimsJson({ role: "authenticated", sub: "user_1" }))).toEqual({ role: "authenticated", sub: "user_1" });
  });

  test.each([
    ["another role", { role: "service_role", sub: "user_1" }],
    ["no role", { sub: "user_1" }],
    ["no sub", { role: "authenticated" }],
    ["a blank sub", { role: "authenticated", sub: "  " }],
    ["an org that is not a string", { role: "authenticated", sub: "user_1", org_id: 1 }],
    ["a blank org", { role: "authenticated", sub: "user_1", org_id: "" }],
    ["not an object", null],
    ["an array", []],
  ])("refuses %s", (_, claims) => {
    expect(() => memberClaimsJson(claims as unknown as MemberClaims)).toThrow(MemberClaimsError);
  });

  test("memberTransaction refuses bad claims when bound, not on first use", () => {
    expect(() => memberTransaction({ role: "anon", sub: "x" } as unknown as MemberClaims)).toThrow(MemberClaimsError);
  });

  test("binding claims opens no connection", () => {
    const before = process.env.SUPABASE_POOLER_URL;
    delete process.env.SUPABASE_POOLER_URL;
    try {
      expect(typeof memberTransaction({ role: "authenticated", sub: "user_1" })).toBe("function");
    } finally {
      if (before !== undefined) process.env.SUPABASE_POOLER_URL = before;
    }
  });
});
