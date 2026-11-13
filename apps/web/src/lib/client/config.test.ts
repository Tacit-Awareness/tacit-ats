import { describe, expect, test } from "vitest";
import { clientSignInConfigured, isPublicClientPath, safeClientNext } from "./config";

const DATABASE = { SUPABASE_URL: "http://db", SUPABASE_PUBLISHABLE_KEY: "pk" };
describe("sign-in is configured", () => {
  test("by the database's two values", () => {
    expect(clientSignInConfigured(DATABASE)).toBe(true);
    expect(clientSignInConfigured({ SUPABASE_URL: "http://db" })).toBe(false);
    expect(clientSignInConfigured({})).toBe(false);
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
