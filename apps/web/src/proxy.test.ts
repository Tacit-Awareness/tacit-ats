import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { USER_HEADER, signSession } from "@/lib/session";

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

const SECRET = "test-session-secret-test-session-secret";
const CONFIGURED = {
  WORKOS_CLIENT_ID: "client_1",
  WORKOS_API_KEY: "sk_test_1",
  WORKOS_COOKIE_PASSWORD: "x".repeat(32),
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

async function staffCookie() {
  return signSession({ sub: "g1", email: "ryan@tacitawareness.com", name: "Ryan", picture: null }, SECRET);
}
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
    vi.stubEnv("SESSION_SECRET", SECRET);
    for (const k of Object.keys(CONFIGURED)) vi.stubEnv(k, "");
    authkit.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  const load = async () => (await import("./proxy")).proxy;
  const configure = () => Object.entries(CONFIGURED).forEach(([k, v]) => vi.stubEnv(k, v));

  describe("staff paths", () => {
    test("a staff session passes, carrying the signed token to the page", async () => {
      const token = await staffCookie();
      const res = await (await load())(req("/people", { cookie: `tacit_session=${token}` }));
      expect(res.status).toBe(200);
      expect(forwarded(res, USER_HEADER)).toBe(token);
      expect(authkit).not.toHaveBeenCalled();
    });

    test("no session is sent to the staff login", async () => {
      const res = await (await load())(req("/people"));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("https://internal.test/login?next=%2Fpeople");
    });

    test("a client session alone opens nothing outside /client", async () => {
      configure();
      // A signed-in client user's cookie is present; the proxy never consults it here.
      for (const path of ["/people", "/people/abc", "/roles/abc", "/pipeline", "/companies", "/network", "/connect", "/api/kg/graph"]) {
        const res = await (await load())(req(path, { cookie: "wos-session=sealed-client-session" }));
        expect(res.status, path).toBe(307);
        expect(res.headers.get("location"), path).toContain("/login");
      }
      expect(authkit).not.toHaveBeenCalled();
    });

    test("a client session cannot invoke a staff server action", async () => {
      configure();
      const res = await (await load())(
        req("/people", { method: "POST", cookie: "wos-session=sealed", headers: { "next-action": "abc123" } }),
      );
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/login");
    });
  });

  describe("the client area", () => {
    test("is 404 until client sign-in is configured, without consulting AuthKit", async () => {
      for (const path of ["/client", "/client/callback", "/client/anything/else"]) {
        const res = await (await load())(req(path, { cookie: `tacit_session=${await staffCookie()}` }));
        expect(res.status, path).toBe(404);
      }
      expect(authkit).not.toHaveBeenCalled();
    });

    test("is 404 when the cookie password is too short to seal a session", async () => {
      configure();
      vi.stubEnv("WORKOS_COOKIE_PASSWORD", "short");
      expect((await (await load())(req("/client"))).status).toBe(404);
    });

    test("no client session is redirected to WorkOS, even with a staff session", async () => {
      configure();
      authkit.mockResolvedValue({ session: { user: null }, headers: new Headers(), authorizationUrl: "https://auth.workos.test/authorize" });
      const res = await (await load())(req("/client", { cookie: `tacit_session=${await staffCookie()}` }));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("https://auth.workos.test/authorize");
      expect(authkit).toHaveBeenCalledWith(expect.anything(), { redirectUri: "https://internal.test/client/callback" });
    });

    test("the callback is reachable signed out, so sign-in can finish", async () => {
      configure();
      authkit.mockResolvedValue({ session: { user: null }, headers: new Headers(), authorizationUrl: "https://auth.workos.test/authorize" });
      expect((await (await load())(req("/client/callback?code=abc"))).status).toBe(200);
    });

    test("a client session passes, and no staff identity rides in with it", async () => {
      configure();
      authkit.mockResolvedValue({
        session: { user: { id: "user_1" }, accessToken: "t" },
        headers: new Headers({ "x-workos-session": "sealed" }),
      });
      const token = await staffCookie();
      const res = await (await load())(
        // Both a real staff cookie and a hand-set staff header.
        req("/client", { cookie: `tacit_session=${token}`, headers: { [USER_HEADER]: token } }),
      );
      expect(res.status).toBe(200);
      expect(forwarded(res, USER_HEADER)).toBeNull();
      expect(forwarded(res, "x-workos-session")).toBe("sealed");
    });

    test("/clients and /client-foo are not the client area", async () => {
      configure();
      for (const path of ["/clients", "/client-foo"]) {
        const res = await (await load())(req(path));
        expect(res.headers.get("location"), path).toContain("/login");
      }
      expect(authkit).not.toHaveBeenCalled();
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
