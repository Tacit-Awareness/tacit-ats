import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// AuthKit is the identity provider's library; what is under test here is
// which requests are handed to it and what happens with its answer.
const authkit = vi.hoisted(() => vi.fn());
vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkit,
  handleAuthkitHeaders: (_req: unknown, _headers: unknown, opts?: { redirect?: string }) =>
    new Response(null, { status: 307, headers: { location: opts?.redirect ?? "" } }),
  partitionAuthkitHeaders: (request: NextRequest, headers: Headers) => {
    const requestHeaders = new Headers(request.headers);
    headers.forEach((v, k) => requestHeaders.set(k, v));
    return { requestHeaders, responseHeaders: new Headers() };
  },
  applyResponseHeaders: (response: Response) => response,
}));

const CONFIGURED = {
  WORKOS_CLIENT_ID: "client_1",
  WORKOS_API_KEY: "sk_test_1",
  WORKOS_COOKIE_PASSWORD: "x".repeat(32),
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

function req(path: string, init: { cookie?: string; headers?: Record<string, string>; method?: string } = {}) {
  return new NextRequest(`https://internal.test${path}`, {
    method: init.method ?? "GET",
    headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers },
  });
}
/** The request headers the proxy forwards to the page. */
function forwarded(res: Response, name: string): string | null {
  return res.headers.get(`x-middleware-request-${name}`);
}

describe("proxy", () => {
  beforeEach(() => {
    for (const k of Object.keys(CONFIGURED)) vi.stubEnv(k, "");
    authkit.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  const load = async () => (await import("./proxy")).proxy;
  const configure = () => Object.entries(CONFIGURED).forEach(([k, v]) => vi.stubEnv(k, v));

  describe("the client area", () => {
    test("is 404 until client sign-in is configured, without consulting AuthKit", async () => {
      for (const path of ["/client", "/client/callback", "/client/anything/else"]) {
        const res = await (await load())(req(path));
        expect(res.status, path).toBe(404);
      }
      expect(authkit).not.toHaveBeenCalled();
    });

    test("is 404 when the cookie password is too short to seal a session", async () => {
      configure();
      vi.stubEnv("WORKOS_COOKIE_PASSWORD", "short");
      expect((await (await load())(req("/client"))).status).toBe(404);
    });

    test("no client session is redirected to WorkOS", async () => {
      configure();
      authkit.mockResolvedValue({ session: { user: null }, headers: new Headers(), authorizationUrl: "https://auth.workos.test/authorize" });
      const res = await (await load())(req("/client"));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("https://auth.workos.test/authorize");
      expect(authkit).toHaveBeenCalledWith(expect.anything(), { redirectUri: "https://internal.test/client/callback" });
    });

    test("the callback is reachable signed out, so sign-in can finish", async () => {
      configure();
      authkit.mockResolvedValue({ session: { user: null }, headers: new Headers(), authorizationUrl: "https://auth.workos.test/authorize" });
      expect((await (await load())(req("/client/callback?code=abc"))).status).toBe(200);
    });

    test("a client session passes, with AuthKit's headers forwarded to the page", async () => {
      configure();
      authkit.mockResolvedValue({
        session: { user: { id: "user_1" }, accessToken: "t" },
        headers: new Headers({ "x-workos-session": "sealed" }),
      });
      const res = await (await load())(req("/client"));
      expect(res.status).toBe(200);
      expect(forwarded(res, "x-workos-session")).toBe("sealed");
    });
  });
});

describe("the matcher", () => {
  // Next anchors the pattern; a path it does not match never reaches proxy() at all.
  const gated = async (path: string) => new RegExp(`^${(await import("./proxy")).config.matcher[0]}$`).test(path);

  test("the public job posts and their form skip the sign-in check, and nothing beside them does", async () => {
    for (const path of ["/jobs/0123456789abcdef0123456789abcdef", "/api/jobs/0123456789abcdef0123456789abcdef/apply"]) {
      expect(await gated(path), path).toBe(false);
    }
    for (const path of ["/jobs", "/jobsx/abc", "/people", "/client/jobs/abc", "/api/jobsx/abc", "/roles/abc"]) {
      expect(await gated(path), path).toBe(true);
    }
  });
});
