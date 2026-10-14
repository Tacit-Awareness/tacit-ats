import { describe, expect, test, vi } from "vitest";

import { callbackErrorResponse } from "./callback-error";

vi.spyOn(console, "warn").mockImplementation(() => {});

const request = new Request("https://internal.tacitawareness.com/client/callback?code=abc");
/** AuthKit's CallbackError, as the callback hands it over. */
const callbackError = (code: string) => Object.assign(new Error("x"), { name: "CallbackError", code });

describe("the client sign-in callback's error page", () => {
  test("a sign-in started from a WorkOS invitation is sent to sign in again from here", async () => {
    for (const code of ["missing_pkce_cookie", "missing_auth_params", "oauth_state_mismatch"]) {
      const res = callbackErrorResponse({ error: callbackError(code), request });
      expect(res.status, code).toBe(200);
      const html = await res.text();
      expect(html).toContain("Your account is ready");
      expect(html).toContain('href="https://internal.tacitawareness.com/client"');
    }
  });

  test("anything else is a readable failure with a way to retry, never the raw error", async () => {
    for (const error of [new Error("invalid_grant: secret details"), callbackError("missing_tokens"), undefined]) {
      const res = callbackErrorResponse({ error, request });
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Couldn't sign in");
      expect(html).not.toContain("secret details");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
});
