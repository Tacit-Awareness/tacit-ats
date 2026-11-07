import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const call = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bridge/store", () => ({ callBridge: call }));

import { SIGNATURE_HEADER, TIMESTAMP_HEADER, signBridgeRequest } from "@/lib/bridge/signature";

import { POST } from "./route";

const SECRET = "b".repeat(48);
const post = (endpoint: string, body: string, sign = true) => {
  const ts = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = sign
    ? { [TIMESTAMP_HEADER]: ts, [SIGNATURE_HEADER]: signBridgeRequest(SECRET, ts, body) }
    : {};
  return POST(new Request(`https://ats.test/api/bridge/${endpoint}`, { method: "POST", body, headers }), { params: Promise.resolve({ endpoint }) });
};

beforeEach(() => {
  vi.stubEnv("TACIT_BRIDGE_SECRET", SECRET);
  call.mockReset().mockResolvedValue({ ok: true, rows: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe("the bridge route", () => {
  test("is off, a 404 like any wrong path, until the secret is set", async () => {
    vi.stubEnv("TACIT_BRIDGE_SECRET", "");
    expect((await post("jobs", "{}")).status).toBe(404);
    expect(call).not.toHaveBeenCalled();
  });

  test("an unknown endpoint is a 404, an unsigned or mis-signed request a 401, before any read", async () => {
    expect((await post("people", "{}")).status).toBe(404);
    expect((await post("jobs", "{}", false)).status).toBe(401);
    expect((await post("jobs", "not json", false)).status).toBe(401);
    expect(call).not.toHaveBeenCalled();
  });

  test("a signed request with a bad body is a 400 and reaches nothing", async () => {
    expect((await post("jobs", "not json")).status).toBe(400);
    expect((await post("report", '{"applicationIds":"x"}')).status).toBe(400);
    expect(call).not.toHaveBeenCalled();
  });

  test("a signed request runs its one function and answers its rows", async () => {
    call.mockResolvedValue({ ok: true, rows: [{ org_id: "o", role_id: "r", title: "Eng" }] });
    const res = await post("jobs", "{}");
    expect(call).toHaveBeenCalledWith({ fn: "bridge_client_jobs", args: { p_org: null } });
    expect(await res.json()).toEqual({ jobs: [{ orgId: "o", roleId: "r", title: "Eng" }] });
  });

  test("a refusal answers its sentence; anything else a bare 500", async () => {
    call.mockResolvedValue({ ok: false, code: "P0002", message: "job not found" });
    const refused = await post("jobs", "{}");
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ error: "job not found" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    call.mockResolvedValue({ ok: false, code: "XX000", message: "connection reset" });
    const failed = await post("jobs", "{}");
    expect(failed.status).toBe(500);
    expect(await failed.text()).toBe("");
    log.mockRestore();
  });
});
