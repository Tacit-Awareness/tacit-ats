import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { getSupabaseServiceClient } from "@tacit/db";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER, signBridgeRequest } from "@/lib/bridge/signature";

import { POST } from "./route";

/**
 * The staff bridge end to end on the local stack: a signed request through
 * the route, the bridge_* functions on the service role, rows read back. The
 * functions' own rules are pinned in supabase/tests/bridge.test.sql; this is
 * the HTTP half tacit-internal will call.
 */

const db = () => getSupabaseServiceClient();
const SECRET = "i".repeat(48);
const ACME = "e9000000-0000-4000-8000-0000000000a1";
const COMPANY_ON_TACIT = "e9c00000-0000-4000-8000-0000000000a1";
const STAFF_ROLE = "e9e00000-0000-4000-8000-0000000000a1";
const STAFF_PERSON = "e9f00000-0000-4000-8000-0000000000a1";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  for (const table of ["person_notes", "application_events", "applications", "job_access", "openings", "people", "roles", "companies"] as const) {
    must(await db().from(table).delete().eq("org_id", ACME));
  }
  await db().from("person_identifiers").delete().eq("org_id", ACME);
  await db().from("audit_log").delete().eq("org_id", ACME);
  await db().from("actors").delete().eq("org_id", ACME);
  await db().from("orgs").delete().eq("id", ACME);
}

const call = async (endpoint: string, payload: unknown, secret = SECRET) => {
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await POST(
    new Request(`https://ats.test/api/bridge/${endpoint}`, {
      method: "POST", body,
      headers: { [TIMESTAMP_HEADER]: ts, [SIGNATURE_HEADER]: signBridgeRequest(secret, ts, body) },
    }),
    { params: Promise.resolve({ endpoint }) },
  );
  return { status: res.status, json: res.status === 200 || res.headers.get("content-type")?.includes("json") ? await res.json() : null };
};

beforeAll(async () => {
  vi.stubEnv("TACIT_BRIDGE_SECRET", SECRET);
  await clear();
  must(await db().from("orgs").insert({ id: ACME, name: "Acme Bridge", slug: "acme-bridge", kind: "client", company_id: COMPANY_ON_TACIT }));
});

afterAll(async () => {
  await clear();
  vi.unstubAllEnvs();
});

describe("the staff bridge over HTTP", () => {
  test("a wrong secret reaches nothing", async () => {
    expect((await call("jobs", {}, "w".repeat(48))).status).toBe(401);
  });

  test("Tacit's role becomes Acme's job, once; a submission lands at Tacit's stage; the report reads it back", async () => {
    const job = await call("job-for-role", {
      companyId: COMPANY_ON_TACIT, staffRoleId: STAFF_ROLE, title: "Founding engineer", location: "NYC",
    });
    expect(job.status).toBe(200);
    expect(job.json.job).toMatchObject({ orgId: ACME, orgName: "Acme Bridge" });
    const roleId = job.json.job.roleId as string;
    expect((await call("job-for-role", { companyId: COMPANY_ON_TACIT, staffRoleId: STAFF_ROLE, title: "Again" })).json.job.roleId).toBe(roleId);

    const jobs = await call("jobs", { orgId: ACME });
    expect(jobs.json.jobs).toEqual([{ orgId: ACME, orgName: "Acme Bridge", companyId: COMPANY_ON_TACIT, roleId, title: "Founding engineer", location: "NYC" }]);

    const submission = {
      roleId,
      submitter: { email: "mate@tacitawareness.com", name: "Mate" },
      person: { staffPersonId: STAFF_PERSON, email: "tia@example.com", displayName: "Tia Tacit", uniqueAbout: "private Tacit notes" },
      note: "Strong systems background", source: "dashboard", stage: "screening",
    };
    const sent = await call("submit-candidate", submission);
    expect(sent.status).toBe(200);
    expect(sent.json).toMatchObject({ status: "submitted", orgId: ACME });
    const person = must(await db().from("people").select("display_name, staff_person_id, unique_about").eq("id", sent.json.personId).single()).data;
    expect(person).toEqual({ display_name: "Tia Tacit", staff_person_id: STAFF_PERSON, unique_about: null });
    expect((await call("submit-candidate", submission)).json.status).toBe("already_in_job");

    const report = await call("report", { applicationIds: [sent.json.applicationId] });
    expect(report.json.submissions).toEqual([{
      applicationId: sent.json.applicationId, orgId: ACME, orgName: "Acme Bridge", companyId: COMPANY_ON_TACIT,
      roleId, jobTitle: "Founding engineer", stage: "screening",
    }]);
  });

  test("a refusal is the function's sentence and status", async () => {
    const missing = await call("submit-candidate", {
      roleId: "e9b00000-0000-4000-8000-0000000000ff",
      submitter: { email: "mate@tacitawareness.com", name: "Mate" },
      person: { staffPersonId: STAFF_PERSON, email: "x@example.com", displayName: "X" },
      source: "claude",
    });
    expect(missing).toEqual({ status: 404, json: { error: "job not found" } });
  });
});
