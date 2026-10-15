import { describe, expect, test, vi } from "vitest";

// Relative and without ".js": see apps/mcp/CLAUDE.md.
import { DEFAULT_CLIENT_EMAIL_FROM, clientMailer } from "./config";

describe("clientMailer", () => {
  test("CLIENT_EMAIL_DISABLED turns candidate email off, whatever else is set", () => {
    expect(clientMailer({ CLIENT_EMAIL_DISABLED: "1", RESEND_API_KEY: "re_x" })).toBeNull();
  });

  test("without a Resend key, drafts work and nothing can be sent", () => {
    expect(clientMailer({})).toEqual({ send: null, fromAddress: DEFAULT_CLIENT_EMAIL_FROM });
  });

  test("with a key, From is CLIENT_EMAIL_FROM, or Tacit's default", () => {
    const m = clientMailer({ RESEND_API_KEY: "re_x", CLIENT_EMAIL_FROM: " candidates@tacitawareness.com " });
    expect(m?.fromAddress).toBe("candidates@tacitawareness.com");
    expect(typeof m?.send).toBe("function");
  });

  test("a From that is not an address turns email off rather than sending under it", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(clientMailer({ RESEND_API_KEY: "re_x", CLIENT_EMAIL_FROM: "Tacit <hiring@tacitawareness.com>" })).toBeNull();
  });
});
