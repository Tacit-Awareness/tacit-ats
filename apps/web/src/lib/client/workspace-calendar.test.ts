import { describe, expect, test, vi } from "vitest";

import { fakeGoogle, fakeSigner } from "../../../../../packages/core/src/test-helpers/fake-google";
import { calendarDelegation } from "./workspace-calendar";

describe("calendarDelegation", () => {
  test("Google gives a calendar token as the admin: delegated, asking only the calendar scopes", async () => {
    const google = fakeGoogle();
    expect(await calendarDelegation(fakeSigner(), "ada@acme.test", { fetch: google.fetchImpl })).toBe("delegated");
    expect(google.delegatedScopes()).toEqual([
      expect.objectContaining({ sub: "ada@acme.test", scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.events.freebusy" }),
    ]);
    // Nothing is read with it.
    expect(google.calls).toHaveLength(1);
  });

  test("unauthorized_client (the entry lists Gmail only): missing", async () => {
    const google = fakeGoogle({ workspaceRefused: ["ada@acme.test"] });
    expect(await calendarDelegation(fakeSigner(), "ada@acme.test", { fetch: google.fetchImpl })).toBe("missing");
  });

  test("anything else, or too slow, is unknown, and the log names no address", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const down = (async () => Response.json({ error: "backendError" }, { status: 503 })) as typeof fetch;
    expect(await calendarDelegation(fakeSigner(), "ada@acme.test", { fetch: down })).toBe("unknown");
    expect(JSON.stringify(error.mock.calls)).not.toContain("ada@acme.test");
    const failing = { ...fakeSigner(), sign: async () => { throw new Error("google signJwt failed: 403 PERMISSION_DENIED"); } };
    expect(await calendarDelegation(failing, "ada@acme.test")).toBe("unknown");
    const hanging = (() => new Promise<Response>(() => {})) as typeof fetch;
    expect(await calendarDelegation(fakeSigner(), "ada@acme.test", { fetch: hanging, timeoutMs: 10 })).toBe("unknown");
    error.mockRestore();
  });
});
