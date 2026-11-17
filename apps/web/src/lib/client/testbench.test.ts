import { beforeEach, describe, expect, test, vi } from "vitest";

// The client area's Testbench reads and writes against a fake of the member's
// own client and a mocked Testbench: where the company and the role come from
// (the session's own org id and the job's row, never a form or a stored
// Testbench id), each refusal, and what is recorded. The policies themselves are supabase/tests'.

const tb = vi.hoisted(() => ({ testbenchConfigured: vi.fn(), listTestbenchRoles: vi.fn(), createTestbenchInvite: vi.fn() }));
const core = vi.hoisted(() => ({ addressesOnFile: vi.fn() }));
vi.mock("@/lib/testbench/client", () => tb);
vi.mock("@tacit-ats/core", () => ({ clientTools: core }));

import type { Db } from "@tacit/db";
import { inviteRequestId } from "@/lib/testbench/request-id";
import { mintTestbenchLink, readJobTestbench, readTestbenchOffered, saveJobTestbenchRole } from "./testbench";

const ORG = "a0000000-0000-4000-8000-00000000000a";
const ACTOR = "a1000000-0000-4000-8000-000000000001";
const JOB = "a3000000-0000-4000-8000-000000000001";
const PERSON = "a4000000-0000-4000-8000-000000000001";
const APP = "a5000000-0000-4000-8000-000000000001";
const TB_ROLE = "eeeeeeee-0000-4000-8000-000000000001";
const LINK = "https://testbench.example/invite/abc123";
const member = { actorId: ACTOR, org: { id: ORG } };
const input = { applicationId: APP, candidateId: PERSON };

type Row = Record<string, unknown>;
type World = {
  roles: Row | null;
  applications: Row | null;
  people: Row | null;
  rpc: Record<string, unknown>;
  fail: Set<string>;
  updated: Row[];
  /** Rows an update of roles matches: none when the policy refuses. */
  updates: number;
  writes: { table: string; row: Row; opts?: unknown }[];
  asked: { table: string; filters: Row }[];
};

let world: World;

function fakeDb(): Db {
  const from = (table: string) => {
    const filters: Row = {};
    let write: "update" | null = null;
    const answer = () => {
      world.asked.push({ table, filters });
      if (world.fail.has(table)) return { data: null, error: { message: `${table} is down` } };
      return { data: world[table as "roles" | "applications" | "people"] ?? null, error: null };
    };
    const q = {
      select: () => (write ? Promise.resolve(world.fail.has(table) ? { data: null, error: { message: "down" } } : { data: Array.from({ length: world.updates }, () => ({ id: filters.id })), error: null }) : q),
      eq: (col: string, v: unknown) => ((filters[col] = v), q),
      maybeSingle: () => Promise.resolve(answer()),
      update: (row: Row) => ((write = "update"), world.updated.push(row), q),
      upsert: (row: Row, opts: unknown) => {
        world.writes.push({ table, row, opts });
        return Promise.resolve({ error: world.fail.has(table) ? { message: "refused by policy" } : null });
      },
    };
    return q;
  };
  const rpc = (fn: string) => Promise.resolve(world.fail.has(fn) ? { data: null, error: { message: "down" } } : { data: world.rpc[fn] ?? false, error: null });
  return { from, rpc } as unknown as Db;
}

beforeEach(() => {
  vi.clearAllMocks();
  world = {
    roles: { testbench_role_id: TB_ROLE },
    applications: { id: APP, role_id: JOB, person_id: PERSON },
    people: { display_name: " Nia Okafor ", email: "Nia@Example.com" },
    rpc: { can_edit_person: true, can_on_role: true },
    fail: new Set(),
    updated: [],
    updates: 1,
    writes: [],
    asked: [],
  };
  tb.testbenchConfigured.mockReturnValue(true);
  tb.listTestbenchRoles.mockResolvedValue({ ok: true, value: [{ id: TB_ROLE, title: "Engineer", status: "open", invitable: true }] });
  tb.createTestbenchInvite.mockResolvedValue({ ok: true, value: { applicationId: "dddddddd-0000-4000-8000-000000000001", attemptId: "cccccccc-0000-4000-8000-000000000001", invitationUrl: LINK, outcome: "created" } });
  core.addressesOnFile.mockResolvedValue(["nia@example.com"]);
});

describe("mintTestbenchLink", () => {
  test("invites as the session's own org and into the job's own role, under a request id of its own, and records Testbench's ids", async () => {
    expect(await mintTestbenchLink(fakeDb(), member, input)).toEqual({ ok: true, url: LINK });
    expect(tb.createTestbenchInvite).toHaveBeenCalledExactlyOnceWith({
      orgId: ORG,
      roleId: TB_ROLE,
      requestId: inviteRequestId({ applicationId: APP, testbenchRoleId: TB_ROLE, email: "nia@example.com" }),
      email: "nia@example.com",
      name: "Nia Okafor",
    });
    // The role is the application's job's; no Testbench company id is read from anywhere.
    expect(world.asked.map((a) => a.table)).not.toContain("orgs");
    expect(world.asked).toContainEqual({ table: "roles", filters: { id: JOB } });
    expect(world.writes).toEqual([
      {
        table: "testbench_invites",
        row: {
          application_id: APP,
          org_id: ORG,
          testbench_role_id: TB_ROLE,
          testbench_application_id: "dddddddd-0000-4000-8000-000000000001",
          testbench_attempt_id: "cccccccc-0000-4000-8000-000000000001",
          invited_by_actor_id: ACTOR,
        },
        opts: { onConflict: "application_id" },
      },
    ]);
    // The link is a credential: handed back, never kept.
    expect(JSON.stringify(world.writes)).not.toContain(LINK);
  });

  test("someone with no name is invited under their address", async () => {
    world.people = { display_name: null, email: "nia@example.com" };
    await mintTestbenchLink(fakeDb(), member, input);
    expect(tb.createTestbenchInvite).toHaveBeenCalledWith(expect.objectContaining({ name: "nia@example.com" }));
  });

  const refusals: [string, () => void, RegExp][] = [
    ["Testbench not set up", () => tb.testbenchConfigured.mockReturnValue(false), /isn't set up/],
    ["an application they can't read", () => (world.applications = null), /isn't one you can see/],
    ["an application that is someone else's", () => (world.applications = { id: APP, role_id: JOB, person_id: "a4000000-0000-4000-8000-000000000009" }), /isn't one you can see/],
    ["a candidate they may not email", () => (world.rpc.can_edit_person = false), /can't email/],
    ["a job with no Testbench role", () => (world.roles = { testbench_role_id: null }), /no Testbench role yet/],
    ["no address on file", () => core.addressesOnFile.mockResolvedValue([]), /No email address on file/],
  ];
  test.each(refusals)("%s: no invitation, no row, and it says no draft was written", async (_, arrange, sentence) => {
    arrange();
    const out = await mintTestbenchLink(fakeDb(), member, input);
    expect(out).toEqual({ ok: false, error: expect.stringMatching(sentence) });
    if (!out.ok) expect(out.error).toMatch(/No draft was written\.$/);
    expect(tb.createTestbenchInvite).not.toHaveBeenCalled();
    expect(world.writes).toEqual([]);
  });

  test.each([
    ["role_closed", "This job's Testbench role is closed."],
    ["org_not_linked", "Testbench isn't connected for your company yet. Ask Tacit to connect it."],
    ["org_link_unavailable", "Testbench isn't ready to take invitations yet. Try again later."],
    ["invite_service_expired", "The connection to Testbench has expired."],
    ["invite_service_unavailable", "Testbench isn't ready to take invitations yet."],
    ["timeout", "Testbench didn't answer in time."],
  ])("Testbench refusing (%s) is its sentence, and nothing is recorded", async (code, error) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    tb.createTestbenchInvite.mockResolvedValue({ ok: false, code, error });
    expect(await mintTestbenchLink(fakeDb(), member, input)).toEqual({ ok: false, error: `${error} No draft was written.` });
    expect(world.writes).toEqual([]);
    expect(log).toHaveBeenCalledWith("[client-testbench] invite refused:", code);
    log.mockRestore();
  });

  test("a row the policy refuses fails the whole thing, so no draft carries a link nobody recorded", async () => {
    world.fail.add("testbench_invites");
    await expect(mintTestbenchLink(fakeDb(), member, input)).rejects.toThrow("refused by policy");
  });

  test("a read that fails throws rather than inviting on a guess", async () => {
    world.fail.add("roles");
    await expect(mintTestbenchLink(fakeDb(), member, input)).rejects.toThrow("roles is down");
    expect(tb.createTestbenchInvite).not.toHaveBeenCalled();
  });
});

describe("readTestbenchOffered", () => {
  test("offered when configured and the job has a role, with no call to Testbench", async () => {
    expect(await readTestbenchOffered(fakeDb(), JOB)).toBe(true);
    world.roles = { testbench_role_id: null };
    expect(await readTestbenchOffered(fakeDb(), JOB)).toBe(false);
    expect(world.asked.every((a) => a.table === "roles")).toBe(true);
    expect(tb.listTestbenchRoles).not.toHaveBeenCalled();
  });

  test("not configured reads nothing", async () => {
    tb.testbenchConfigured.mockReturnValue(false);
    expect(await readTestbenchOffered(fakeDb(), JOB)).toBe(false);
    expect(world.asked).toEqual([]);
  });

  test("a read that fails offers nothing and does not fail the ticket", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    world.fail.add("roles");
    expect(await readTestbenchOffered(fakeDb(), JOB)).toBe(false);
    log.mockRestore();
  });
});

describe("readJobTestbench", () => {
  test("the job's role and the roles of the company linked to the member's org", async () => {
    expect(await readJobTestbench(fakeDb(), ORG, JOB)).toEqual({ jobId: JOB, roleId: TB_ROLE, roles: [{ id: TB_ROLE, title: "Engineer", status: "open", invitable: true }], unavailable: null });
    expect(tb.listTestbenchRoles).toHaveBeenCalledExactlyOnceWith(ORG);
  });

  test("no picker when the org has no Testbench company", async () => {
    tb.listTestbenchRoles.mockResolvedValue({ ok: false, code: "org_not_linked", error: "Testbench isn't connected for your company yet. Ask Tacit to connect it." });
    expect(await readJobTestbench(fakeDb(), ORG, JOB)).toBeNull();
  });

  test("no picker with Testbench off, and Testbench is not asked", async () => {
    tb.testbenchConfigured.mockReturnValue(false);
    expect(await readJobTestbench(fakeDb(), ORG, JOB)).toBeNull();
    expect(tb.listTestbenchRoles).not.toHaveBeenCalled();
  });

  test.each(["timeout", "org_link_unavailable", "invite_service_expired"])("Testbench not answering (%s) still shows the job's pick, and says why there is no list", async (code) => {
    tb.listTestbenchRoles.mockResolvedValue({ ok: false, code, error: "Testbench didn't answer in time. Try again." });
    expect(await readJobTestbench(fakeDb(), ORG, JOB)).toEqual({ jobId: JOB, roleId: TB_ROLE, roles: [], unavailable: "Testbench didn't answer in time. Try again." });
  });
});

describe("saveJobTestbenchRole", () => {
  test("a role Testbench lists for the member's org is saved on the job", async () => {
    expect(await saveJobTestbenchRole(fakeDb(), ORG, { jobId: JOB, roleId: TB_ROLE })).toEqual({ ok: true });
    expect(tb.listTestbenchRoles).toHaveBeenCalledExactlyOnceWith(ORG);
    expect(world.updated).toEqual([{ testbench_role_id: TB_ROLE }]);
  });

  test("clearing it asks Testbench nothing", async () => {
    expect(await saveJobTestbenchRole(fakeDb(), ORG, { jobId: JOB, roleId: null })).toEqual({ ok: true });
    expect(tb.listTestbenchRoles).not.toHaveBeenCalled();
    expect(world.updated).toEqual([{ testbench_role_id: null }]);
  });

  test("a role that is not the company's is refused: a job can't be pointed at another company's test", async () => {
    expect(await saveJobTestbenchRole(fakeDb(), ORG, { jobId: JOB, roleId: "eeeeeeee-0000-4000-8000-000000000009" })).toEqual({ ok: false, error: "bad_role" });
    expect(world.updated).toEqual([]);
  });

  test("someone who may not manage the job is refused before anything is asked or written", async () => {
    world.rpc.can_on_role = false;
    expect(await saveJobTestbenchRole(fakeDb(), ORG, { jobId: JOB, roleId: TB_ROLE })).toEqual({ ok: false, error: "forbidden" });
    expect(tb.listTestbenchRoles).not.toHaveBeenCalled();
    expect(world.updated).toEqual([]);
  });

  test("an update the policy matches no row for is forbidden, not saved", async () => {
    world.updates = 0;
    expect(await saveJobTestbenchRole(fakeDb(), ORG, { jobId: JOB, roleId: TB_ROLE })).toEqual({ ok: false, error: "forbidden" });
  });

  test("an org with no Testbench company, Testbench off or Testbench down saves nothing", async () => {
    tb.listTestbenchRoles.mockResolvedValue({ ok: false, code: "timeout", error: "Testbench didn't answer in time. Try again." });
    expect(await saveJobTestbenchRole(fakeDb(), ORG, { jobId: JOB, roleId: TB_ROLE })).toEqual({ ok: false, error: "unavailable", sentence: "Testbench didn't answer in time. Try again." });
    tb.listTestbenchRoles.mockResolvedValue({ ok: false, code: "org_not_linked", error: "x" });
    expect(await saveJobTestbenchRole(fakeDb(), ORG, { jobId: JOB, roleId: TB_ROLE })).toEqual({ ok: false, error: "off" });
    tb.testbenchConfigured.mockReturnValue(false);
    expect(await saveJobTestbenchRole(fakeDb(), ORG, { jobId: JOB, roleId: TB_ROLE })).toEqual({ ok: false, error: "off" });
    expect(world.updated).toEqual([]);
  });
});
