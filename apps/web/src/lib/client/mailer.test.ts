import { afterEach, describe, expect, test, vi } from "vitest";
import { webMailer } from "./mailer";

// Builds the sender and never calls it: nothing here reaches Resend.
const ON = { RESEND_API_KEY: "re_test", CLIENT_EMAIL_FROM: "hiring@example.test" };

afterEach(() => vi.restoreAllMocks());

describe("webMailer", () => {
  test("on with both values: From is CLIENT_EMAIL_FROM, trimmed", () => {
    const m = webMailer({ RESEND_API_KEY: " re_test ", CLIENT_EMAIL_FROM: " hiring@example.test " });
    expect(m?.fromAddress).toBe("hiring@example.test");
    expect(typeof m?.send).toBe("function");
  });

  test.each([
    ["nothing set", {}],
    ["no key", { CLIENT_EMAIL_FROM: "hiring@example.test" }],
    ["a blank key", { ...ON, RESEND_API_KEY: "   " }],
    ["no From", { RESEND_API_KEY: "re_test" }],
    ["a blank From", { ...ON, CLIENT_EMAIL_FROM: "  " }],
  ])("off with %s: there is no default From here, unlike apps/mcp", (_, env) => {
    expect(webMailer(env)).toBeNull();
  });

  test("CLIENT_EMAIL_DISABLED turns it off whatever else is set", () => {
    expect(webMailer({ ...ON, CLIENT_EMAIL_DISABLED: "1" })).toBeNull();
  });

  test("a From that is not a bare address turns it off, and says why in the log", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(webMailer({ ...ON, CLIENT_EMAIL_FROM: "Tacit <hiring@example.test>" })).toBeNull();
    expect(log).toHaveBeenCalledOnce();
  });
});
