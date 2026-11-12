import { describe, expect, test } from "vitest";
import { clientAuthProvider, clientSignInConfigured, isPublicClientPath, safeClientNext } from "./config";

const DATABASE = { SUPABASE_URL: "http://db", SUPABASE_PUBLISHABLE_KEY: "pk" };
const WORKOS = { WORKOS_CLIENT_ID: "c", WORKOS_API_KEY: "k", WORKOS_COOKIE_PASSWORD: "x".repeat(32) };

describe("who signs members in", () => {
  test("WorkOS unless the flag says supabase", () => {
    expect(clientAuthProvider({})).toBe("workos");
    expect(clientAuthProvider({ CLIENT_AUTH_PROVIDER: "workos" })).toBe("workos");
    expect(clientAuthProvider({ CLIENT_AUTH_PROVIDER: "something" })).toBe("workos");
    expect(clientAuthProvider({ CLIENT_AUTH_PROVIDER: " Supabase " })).toBe("supabase");
  });

  test("WorkOS needs its own three values and the database's two", () => {
    expect(clientSignInConfigured({ ...DATABASE, ...WORKOS })).toBe(true);
    expect(clientSignInConfigured(DATABASE)).toBe(false);
    expect(clientSignInConfigured({ ...DATABASE, ...WORKOS, WORKOS_COOKIE_PASSWORD: "short" })).toBe(false);
  });

  test("Supabase needs only the database's two", () => {
    expect(clientSignInConfigured({ ...DATABASE, CLIENT_AUTH_PROVIDER: "supabase" })).toBe(true);
    expect(clientSignInConfigured({ CLIENT_AUTH_PROVIDER: "supabase", SUPABASE_URL: "http://db" })).toBe(false);
  });
});

describe("pages reachable with no session", () => {
  test("the sign-in screens, the email link and the sign-in route", () => {
    for (const path of ["/client/sign-in", "/client/forgot-password", "/client/link-expired", "/client/auth/confirm", "/client/auth/sign-in", "/client/auth/reset", "/client/sign-in/"]) {
      expect(isPublicClientPath(path), path).toBe(true);
    }
  });

  test("nothing else", () => {
    for (const path of ["/client", "/client/jobs", "/client/set-password", "/client/choose-company", "/client/session/refresh", "/client/sign-in-x", "/client/authx"]) {
      expect(isPublicClientPath(path), path).toBe(false);
    }
  });
});

describe("where to go after signing in", () => {
  test("a path under /client, as given", () => {
    expect(safeClientNext("/client/jobs?x=1")).toBe("/client/jobs?x=1");
    expect(safeClientNext("/client")).toBe("/client");
  });

  test("anything else is /client", () => {
    for (const next of [null, undefined, "", "https://evil.example/client", "//evil.example/client", "/\\evil.example", "/jobs/x", "/clientx", "client/jobs"]) {
      expect(safeClientNext(next), String(next)).toBe("/client");
    }
  });
});
