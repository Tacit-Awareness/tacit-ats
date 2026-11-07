import { describe, expect, test } from "vitest";

import { bridgeResponse, isEndpoint, parseBridgeRequest, refusalStatus } from "./requests";

const ROLE = "ac100000-0000-4000-8000-000000000001";
const PERSON = "70000000-0000-4000-8000-000000000001";
const submit = (over: Record<string, unknown> = {}) => ({
  roleId: ROLE,
  submitter: { email: "mate@tacitawareness.com", name: "Mate" },
  person: { staffPersonId: PERSON, email: "tia@example.com", displayName: "Tia" },
  source: "dashboard",
  ...over,
});

describe("reading a bridge request", () => {
  test("only the four endpoints exist", () => {
    expect(["jobs", "job-for-role", "submit-candidate", "report"].every(isEndpoint)).toBe(true);
    expect(isEndpoint("submit_to_client")).toBe(false);
  });

  test("a submission reads only the fields the client may hold", () => {
    const parsed = parseBridgeRequest("submit-candidate", submit({
      person: { staffPersonId: PERSON, email: "tia@example.com", displayName: "Tia", phone: "+1", uniqueAbout: "private Tacit notes" },
      note: "Great", stage: "screening",
    }));
    expect(parsed).toEqual({
      ok: true,
      call: {
        fn: "bridge_submit_candidate",
        args: {
          p_role: ROLE, p_submitter_email: "mate@tacitawareness.com", p_submitter_name: "Mate", p_staff_person_id: PERSON,
          p_person: { email: "tia@example.com", display_name: "Tia", phone: "+1", linkedin_url: null, current_title: null, current_company: null, location: null },
          p_note: "Great", p_source: "dashboard", p_stage: "screening",
        },
      },
    });
    expect(JSON.stringify(parsed)).not.toContain("private");
  });

  test("a submission's stage defaults to sourced; bad fields are refused", () => {
    const ok = parseBridgeRequest("submit-candidate", submit());
    expect(ok.ok && ok.call.fn === "bridge_submit_candidate" && ok.call.args.p_stage).toBe("sourced");
    expect(parseBridgeRequest("submit-candidate", submit({ roleId: "nope" })).ok).toBe(false);
    expect(parseBridgeRequest("submit-candidate", submit({ source: "slack" })).ok).toBe(false);
    expect(parseBridgeRequest("submit-candidate", submit({ note: 5 })).ok).toBe(false);
    expect(parseBridgeRequest("submit-candidate", submit({ person: { staffPersonId: PERSON, phone: 5 } })).ok).toBe(false);
    expect(parseBridgeRequest("submit-candidate", submit({ submitter: null })).ok).toBe(false);
    expect(parseBridgeRequest("submit-candidate", []).ok).toBe(false);
  });

  test("jobs, job-for-role and report", () => {
    expect(parseBridgeRequest("jobs", {})).toEqual({ ok: true, call: { fn: "bridge_client_jobs", args: { p_org: null } } });
    expect(parseBridgeRequest("jobs", { orgId: "x" }).ok).toBe(false);
    expect(parseBridgeRequest("job-for-role", { companyId: ROLE, staffRoleId: PERSON, title: "Eng" })).toEqual({
      ok: true,
      call: { fn: "bridge_job_for_role", args: { p_company: ROLE, p_staff_role: PERSON, p_title: "Eng", p_location: null, p_seniority: null, p_description: null } },
    });
    expect(parseBridgeRequest("job-for-role", { companyId: ROLE, staffRoleId: PERSON }).ok).toBe(false);
    expect(parseBridgeRequest("report", { applicationIds: [ROLE.toUpperCase()] })).toEqual({
      ok: true, call: { fn: "bridge_submission_report", args: { p_applications: [ROLE] } },
    });
    expect(parseBridgeRequest("report", { applicationIds: Array(501).fill(ROLE) }).ok).toBe(false);
    expect(parseBridgeRequest("report", { applicationIds: [ROLE, "x"] }).ok).toBe(false);
  });

  test("answers: the functions' codes, rows in camelCase", () => {
    expect([refusalStatus("P0002"), refusalStatus("22023"), refusalStatus("42501"), refusalStatus("XX000")]).toEqual([404, 400, 403, 500]);
    expect(bridgeResponse("job-for-role", { ok: true, rows: [] })).toEqual({ job: null });
    expect(bridgeResponse("submit-candidate", { ok: true, rows: [{ status: "submitted", application_id: "a" }] }))
      .toEqual({ status: "submitted", applicationId: "a" });
    expect(bridgeResponse("report", { ok: true, rows: [{ job_title: "Eng" }] })).toEqual({ submissions: [{ jobTitle: "Eng" }] });
  });
});
