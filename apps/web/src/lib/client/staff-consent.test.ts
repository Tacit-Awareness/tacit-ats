import { describe, expect, test, vi } from "vitest";
import { staffConsentRedirect, staffConnector } from "./staff-consent";

const ENV = { SUPABASE_URL: "https://ref.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" };
const consent = (id = "authz-1") => new URL(`https://ats.example/client/oauth/consent?authorization_id=${id}`);
const answering = (body: unknown, ok = true) => vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 })) as unknown as typeof fetch;

describe("staffConsentRedirect", () => {
  test("the staff connector's authorization goes to internal's consent page with its id", async () => {
    const doFetch = answering("https://mcp.tacitawareness.com/api/connector/");
    const to = await staffConsentRedirect(consent("a b"), ENV, doFetch);
    expect(to?.toString()).toBe("https://internal.tacitawareness.com/oauth/consent?authorization_id=a+b");
    const [url, init] = vi.mocked(doFetch).mock.calls[0]!;
    expect(url).toBe("https://ref.supabase.co/rest/v1/rpc/connector_authorization_resource");
    expect(JSON.parse(String(init!.body))).toEqual({ p_authorization_id: "a b" });
    // The anon key only: never a member's token, never a secret.
    expect(init!.headers).toEqual(expect.objectContaining({ apikey: "sb_publishable_x" }));
    expect(init!.headers).not.toHaveProperty("authorization");
  });

  test.each([
    ["the client connector", answering("https://ats-mcp.tacitawareness.com/api/client")],
    ["no pending authorization", answering(null)],
    ["the lookup failing", answering({ message: "x" }, false)],
    ["the network failing", vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch],
  ])("%s: stays on this app's own consent page", async (_, doFetch) => {
    expect(await staffConsentRedirect(consent(), ENV, doFetch)).toBeNull();
  });

  test("only the consent path with an id is looked up", async () => {
    const doFetch = answering("https://mcp.tacitawareness.com/api/connector");
    expect(await staffConsentRedirect(new URL("https://ats.example/client/oauth/consent"), ENV, doFetch)).toBeNull();
    expect(await staffConsentRedirect(new URL("https://ats.example/client/jobs?authorization_id=x"), ENV, doFetch)).toBeNull();
    expect(doFetch).not.toHaveBeenCalled();
  });

  test("the URLs can be set per deployment", async () => {
    const env = { ...ENV, STAFF_CONNECTOR_RESOURCE_URL: "https://mcp-preview.example/api/connector", STAFF_CONSENT_URL: "http://localhost:3000/oauth/consent/" };
    expect(staffConnector(env)).toEqual({ resource: "https://mcp-preview.example/api/connector", consentUrl: "http://localhost:3000/oauth/consent" });
    expect((await staffConsentRedirect(consent(), env, answering("https://mcp-preview.example/api/connector")))?.origin).toBe("http://localhost:3000");
    expect(await staffConsentRedirect(consent(), env, answering("https://mcp.tacitawareness.com/api/connector"))).toBeNull();
  });
});
