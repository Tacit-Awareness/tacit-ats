import { describe, expect, test, vi } from "vitest";

// Relative and without ".js": see the note in app/api/mcp/route.ts.
import { clientInvitations } from "./workos";

describe("clientInvitations", () => {
  test("sends into the member's organization, naming the inviter", async () => {
    const doFetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ id: "inv_1" }));
    const out = await clientInvitations("sk_test", doFetch).sendInvitation({ email: "a@acme.test", organizationId: "org_acme", inviterUserId: "user_ada" });
    expect(out).toEqual({ id: "inv_1" });
    const [url, init] = doFetch.mock.calls[0];
    expect(String(url)).toBe("https://api.workos.com/user_management/invitations");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ email: "a@acme.test", organization_id: "org_acme", inviter_user_id: "user_ada" });
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer sk_test");
  });

  test("a refusal from WorkOS is an error carrying its message", async () => {
    const doFetch = vi.fn(async () => Response.json({ message: "Email already invited" }, { status: 400 }));
    await expect(clientInvitations("sk", doFetch).sendInvitation({ email: "a@acme.test", organizationId: "org_acme" }))
      .rejects.toThrow("WorkOS 400: Email already invited");
  });

  test("revoking takes back only pending invitations for that address", async () => {
    const doFetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
      String(url).includes("/revoke")
        ? Response.json({})
        : Response.json({ data: [{ id: "inv_1", state: "pending" }, { id: "inv_2", state: "accepted" }] }));
    await clientInvitations("sk", doFetch).revokeInvitations({ email: "a+b@acme.test", organizationId: "org_acme" });
    const urls = doFetch.mock.calls.map(([u]) => String(u));
    expect(urls[0]).toContain("email=a%2Bb%40acme.test");
    expect(urls[0]).toContain("organization_id=org_acme");
    expect(urls.slice(1)).toEqual(["https://api.workos.com/user_management/invitations/inv_1/revoke"]);
  });

  test("a client member cannot create an organization", async () => {
    await expect(clientInvitations("sk", vi.fn()).createOrganization("Evil")).rejects.toThrow();
  });
});
