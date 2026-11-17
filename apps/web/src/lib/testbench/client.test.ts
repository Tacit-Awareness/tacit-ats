import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestbenchInvite, listTestbenchRoles, testbenchConfigured } from "./client";

// The invite service connection against a mocked fetch: what is sent, what a
// good answer becomes, and every refusal as a sentence with no token, no
// Testbench message and no link in it.

const TOKEN = "tis_secret_do_not_leak";
/** The ATS org's own id: the only name a company goes by here. */
const ORG = "a0000000-0000-4000-8000-00000000000a";
const ROLE = "eeeeeeee-0000-4000-8000-000000000001";
const REQUEST = "c45b02c1-3240-4d76-aeac-f0baf4e0de01";
const LINK = "https://testbench.example/invite/abc123";
const invite = { orgId: ORG, roleId: ROLE, requestId: REQUEST, email: "nia@example.com", name: "Nia Okafor" };
const created = { applicationId: "dddddddd-0000-4000-8000-000000000001", attemptId: "cccccccc-0000-4000-8000-000000000001", outcome: "created", invitationUrl: LINK };

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("TESTBENCH_URL", "https://testbench.example/");
  vi.stubEnv("TESTBENCH_INVITE_TOKEN", TOKEN);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("testbenchConfigured", () => {
  test("needs both the URL and the token", () => {
    expect(testbenchConfigured()).toBe(true);
    vi.stubEnv("TESTBENCH_INVITE_TOKEN", "");
    expect(testbenchConfigured()).toBe(false);
    vi.stubEnv("TESTBENCH_INVITE_TOKEN", TOKEN);
    vi.stubEnv("TESTBENCH_URL", "");
    expect(testbenchConfigured()).toBe(false);
    vi.stubEnv("TESTBENCH_URL", "testbench.example");
    expect(testbenchConfigured()).toBe(false);
  });

  test("unset, nothing is asked of Testbench", async () => {
    vi.stubEnv("TESTBENCH_INVITE_TOKEN", "");
    expect(await listTestbenchRoles(ORG)).toMatchObject({ ok: false, code: "not_configured" });
    expect(await createTestbenchInvite(invite)).toMatchObject({ ok: false, code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("listTestbenchRoles", () => {
  test("asks for the org's company's roles with the bearer token and the org header, and no Testbench company id", async () => {
    fetchMock.mockResolvedValue(json(200, { data: { client: { id: "aaaaaaaa-0000-4000-8000-000000000001" }, items: [
      { id: ROLE, title: "Engineer", status: "open", invitable: true },
      { id: "EEEEEEEE-0000-4000-8000-000000000002", title: " ", status: "closed", invitable: false },
    ] } }));
    expect(await listTestbenchRoles(ORG)).toEqual({ ok: true, value: [
      { id: ROLE, title: "Engineer", status: "open", invitable: true },
      { id: "eeeeeeee-0000-4000-8000-000000000002", title: "Untitled role", status: "closed", invitable: false },
    ] });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://testbench.example/api/v1/integration/roles");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, "X-Tacit-Org": ORG });
    expect(init.headers).not.toHaveProperty("X-Tacit-Client");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("an org with no Testbench company says so by its own code, which hides the picker", async () => {
    fetchMock.mockResolvedValue(json(404, { error: { code: "org_not_linked", message: "no company" } }));
    const out = await listTestbenchRoles(ORG);
    expect(out).toMatchObject({ ok: false, code: "org_not_linked" });
    if (!out.ok) expect(out.error).toMatch(/isn't connected for your company yet\. Ask Tacit/);
  });

  test("an org id that isn't one is refused before any request", async () => {
    expect(await listTestbenchRoles("../clients")).toMatchObject({ ok: false, code: "client_required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("an answer that isn't a list of roles is refused, not guessed at", async () => {
    fetchMock.mockResolvedValue(json(200, { data: { items: [{ id: "not-a-uuid", title: "x" }] } }));
    expect(await listTestbenchRoles(ORG)).toMatchObject({ ok: false, code: "bad_response" });
    fetchMock.mockResolvedValue(json(200, { items: [] }));
    expect(await listTestbenchRoles(ORG)).toMatchObject({ ok: false, code: "bad_response" });
  });
});

describe("createTestbenchInvite", () => {
  test("posts exactly the request id and the candidate, and answers the link and Testbench's ids", async () => {
    fetchMock.mockResolvedValue(json(201, { data: { ...created, invitationStatus: "pending", requestReplayed: false } }));
    expect(await createTestbenchInvite(invite)).toEqual({
      ok: true,
      value: { applicationId: created.applicationId, attemptId: created.attemptId, invitationUrl: LINK, outcome: "created" },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://testbench.example/api/v1/integration/roles/${ROLE}/invites`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, "X-Tacit-Org": ORG, "Content-Type": "application/json" });
    expect(init.headers).not.toHaveProperty("X-Tacit-Client");
    expect(JSON.parse(init.body)).toEqual({ requestId: REQUEST, candidate: { email: "nia@example.com", name: "Nia Okafor" } });
  });

  test("someone already invited comes back as existing, with the same link", async () => {
    fetchMock.mockResolvedValue(json(200, { data: { ...created, outcome: "existing", attemptId: null } }));
    expect(await createTestbenchInvite(invite)).toEqual({
      ok: true,
      value: { applicationId: created.applicationId, attemptId: null, invitationUrl: LINK, outcome: "existing" },
    });
  });

  test.each([
    [409, "role_closed", "role_closed", /closed/],
    [409, "published_assessment_required", "published_assessment_required", /no published test/],
    [409, "invitation_request_conflict", "invitation_request_conflict", /Tell Tacit/],
    [404, "not_found", "not_found", /Pick the job's Testbench role again/],
    [404, "org_not_linked", "org_not_linked", /isn't connected for your company yet/],
    [503, "org_link_unavailable", "org_link_unavailable", /later/],
    [401, "invite_service_expired", "invite_service_expired", /expired/],
    [403, "invite_scope_denied", "invite_scope_denied", /Tell Tacit/],
    [503, "invite_service_unavailable", "invite_service_unavailable", /later/],
    [422, "client_required", "client_required", /Tell Tacit/],
    [422, "validation_failed", "validation", /name or email/],
    [429, "too_many", "rate_limited", /minute/],
    [500, "boom", "refused", /Try again/],
  ])("%i %s is a sentence a member can act on", async (status, theirs, code, sentence) => {
    fetchMock.mockResolvedValue(json(status, { error: { code: theirs, message: `internal detail ${TOKEN} ${LINK}` } }));
    const out = await createTestbenchInvite(invite);
    expect(out).toMatchObject({ ok: false, code });
    if (out.ok) throw new Error("unreachable");
    expect(out.error).toMatch(sentence);
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(JSON.stringify(out)).not.toContain("internal detail");
  });

  test("an error with no body is read by its status", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 503 }));
    expect(await createTestbenchInvite(invite)).toMatchObject({ ok: false, code: "invite_service_unavailable" });
  });

  test("no answer in time, or none at all, says so and nothing of the token", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(Object.assign(new Error(`timed out calling with ${TOKEN}`), { name: "TimeoutError" }));
    const slow = await createTestbenchInvite(invite);
    expect(slow).toMatchObject({ ok: false, code: "timeout" });
    fetchMock.mockRejectedValue(new TypeError(`fetch failed ${TOKEN}`));
    const down = await createTestbenchInvite(invite);
    expect(down).toMatchObject({ ok: false, code: "unreachable" });
    expect(JSON.stringify([slow, down, log.mock.calls])).not.toContain(TOKEN);
    log.mockRestore();
  });

  test.each([
    ["no link", { ...created, invitationUrl: undefined }],
    ["a link that isn't http(s)", { ...created, invitationUrl: "javascript:alert(1)" }],
    ["a link with a space in it", { ...created, invitationUrl: `${LINK} and more words` }],
    ["a link that would read as a placeholder", { ...created, invitationUrl: `${LINK}/{{candidate_name}}` }],
    ["no application id", { ...created, applicationId: "nope" }],
  ])("a created answer with %s is refused rather than put in an email", async (_, data) => {
    fetchMock.mockResolvedValue(json(201, { data }));
    expect(await createTestbenchInvite(invite)).toMatchObject({ ok: false, code: "bad_response" });
  });

  test("a role id that isn't one never reaches the URL", async () => {
    expect(await createTestbenchInvite({ ...invite, roleId: "../../clients" })).toMatchObject({ ok: false, code: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
