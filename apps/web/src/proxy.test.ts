import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Supabase's SSR client is the identity provider's library; what is under test
// here is which requests are let through and where the rest are sent.
const getClaims = vi.hoisted(() => vi.fn());
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims } }),
}));

const CONFIGURED = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

const req = (path: string) => new NextRequest(`https://ats.test${path}`);
const signedIn = () => getClaims.mockResolvedValue({ data: { claims: { sub: "5a000000-0000-4000-8000-000000000001" } }, error: null });
const signedOut = () => getClaims.mockResolvedValue({ data: null, error: null });

describe("proxy", () => {
  beforeEach(() => {
    for (const k of Object.keys(CONFIGURED)) vi.stubEnv(k, "");
    getClaims.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  const load = async () => (await import("./proxy")).proxy;
  const configure = () => Object.entries(CONFIGURED).forEach(([k, v]) => vi.stubEnv(k, v));

  describe("the client area", () => {
    test("is 404 until client sign-in is configured, without consulting Supabase", async () => {
      for (const path of ["/client", "/client/sign-in", "/client/anything/else"]) {
        expect((await (await load())(req(path))).status, path).toBe(404);
      }
      expect(getClaims).not.toHaveBeenCalled();
    });

    test("no session is sent to sign in, keeping where they were going", async () => {
      configure();
      signedOut();
      const res = await (await load())(req("/client/jobs?tab=open"));
      expect(res.status).toBe(307);
      const to = new URL(res.headers.get("location")!);
      expect(to.pathname).toBe("/client/sign-in");
      expect(to.searchParams.get("next")).toBe("/client/jobs?tab=open");
    });

    test("/client itself goes to sign in with no `next`", async () => {
      configure();
      signedOut();
      const to = new URL((await (await load())(req("/client"))).headers.get("location")!);
      expect(to.pathname).toBe("/client/sign-in");
      expect(to.search).toBe("");
    });

    test("the sign-in screens, the email link and the sign-in route are reachable signed out", async () => {
      configure();
      signedOut();
      for (const path of ["/client/sign-in", "/client/forgot-password", "/client/link-expired", "/client/auth/confirm", "/client/auth/sign-in"]) {
        expect((await (await load())(req(path))).status, path).toBe(200);
      }
    });

    test("a session passes", async () => {
      configure();
      signedIn();
      expect((await (await load())(req("/client/jobs"))).status).toBe(200);
    });
  });
});

describe("the matcher", () => {
  test("covers the client area and nothing else, so the public job posts need no sign-in", async () => {
    expect((await import("./proxy")).config.matcher).toEqual(["/client", "/client/:path*"]);
  });
});
