/**
 * The staff bridge's four endpoints, read from a signed JSON body into one
 * bridge_* call, and the database's answer back into JSON. Pure: the route
 * verifies the signature first, then calls this, then the store.
 *
 *   jobs              { orgId? }                              -> { jobs }
 *   job-for-role      { companyId, staffRoleId, title,        -> { job | null }
 *                       location?, seniority?, description? }
 *   submit-candidate  { roleId, submitter: { email, name },   -> { status, orgId, personId, applicationId, actorId }
 *                       person: { staffPersonId, email, displayName, phone?, linkedinUrl?,
 *                                 currentTitle?, currentCompany?, location? },
 *                       note?, source: dashboard | claude, stage? }
 *   report            { applicationIds: uuid[] (<= 500) }    -> { submissions }
 *
 * Only these fields are read: anything else in a body is ignored, so a
 * person's private Tacit detail can never reach the client by being sent.
 */
/** One bridge_* call: the function and its arguments, as the store runs them. */
export type BridgeCall =
  | { fn: "bridge_client_jobs"; args: { p_org: string | null } }
  | {
      fn: "bridge_job_for_role";
      args: {
        p_company: string; p_staff_role: string; p_title: string;
        p_location: string | null; p_seniority: string | null; p_description: string | null;
      };
    }
  | {
      fn: "bridge_submit_candidate";
      args: {
        p_role: string; p_submitter_email: string; p_submitter_name: string; p_staff_person_id: string;
        p_person: Record<string, string | null>; p_note: string | null; p_source: string; p_stage: string;
      };
    }
  | { fn: "bridge_submission_report"; args: { p_applications: string[] } };

export type BridgeAnswer =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; code: string; message: string };

export const ENDPOINTS = ["jobs", "job-for-role", "submit-candidate", "report"] as const;
export type Endpoint = (typeof ENDPOINTS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPORT_MAX = 500;
const TEXT_MAX = 20_000;

export function isEndpoint(value: string): value is Endpoint {
  return (ENDPOINTS as readonly string[]).includes(value);
}

type Parsed = { ok: true; call: BridgeCall } | { ok: false; error: string };

const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const uuid = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.length <= TEXT_MAX ? v : null);
const optText = (v: unknown): string | null | undefined => (v === undefined || v === null ? null : text(v) ?? undefined);

export function parseBridgeRequest(endpoint: Endpoint, body: unknown): Parsed {
  const b = obj(body);
  if (!b) return { ok: false, error: "the body is a JSON object" };

  if (endpoint === "jobs") {
    const org = b.orgId === undefined || b.orgId === null ? null : uuid(b.orgId);
    if (b.orgId != null && !org) return { ok: false, error: "orgId is a uuid" };
    return { ok: true, call: { fn: "bridge_client_jobs", args: { p_org: org } } };
  }

  if (endpoint === "job-for-role") {
    const company = uuid(b.companyId);
    const role = uuid(b.staffRoleId);
    const title = text(b.title);
    const location = optText(b.location);
    const seniority = optText(b.seniority);
    const description = optText(b.description);
    if (!company || !role || !title) return { ok: false, error: "companyId, staffRoleId and title are required" };
    if (location === undefined || seniority === undefined || description === undefined) {
      return { ok: false, error: "location, seniority and description are text" };
    }
    return {
      ok: true,
      call: {
        fn: "bridge_job_for_role",
        args: { p_company: company, p_staff_role: role, p_title: title, p_location: location, p_seniority: seniority, p_description: description },
      },
    };
  }

  if (endpoint === "submit-candidate") {
    const role = uuid(b.roleId);
    const submitter = obj(b.submitter);
    const person = obj(b.person);
    const staffPerson = uuid(person?.staffPersonId);
    const email = text(submitter?.email);
    const name = text(submitter?.name);
    const note = optText(b.note);
    const source = b.source === "dashboard" || b.source === "claude" ? b.source : null;
    const stage = b.stage === undefined ? "sourced" : typeof b.stage === "string" ? b.stage : null;
    if (!role || !email || !name || !staffPerson || !person) {
      return { ok: false, error: "roleId, submitter { email, name } and person { staffPersonId } are required" };
    }
    if (!source) return { ok: false, error: "source is dashboard or claude" };
    if (note === undefined || stage === null) return { ok: false, error: "note and stage are text" };
    const fields: [string, string][] = [
      ["email", "email"], ["display_name", "displayName"], ["phone", "phone"], ["linkedin_url", "linkedinUrl"],
      ["current_title", "currentTitle"], ["current_company", "currentCompany"], ["location", "location"],
    ];
    const p: Record<string, string | null> = {};
    for (const [column, key] of fields) {
      const value = optText(person[key]);
      if (value === undefined) return { ok: false, error: `person.${key} is text` };
      p[column] = value;
    }
    return {
      ok: true,
      call: {
        fn: "bridge_submit_candidate",
        args: {
          p_role: role, p_submitter_email: email, p_submitter_name: name, p_staff_person_id: staffPerson,
          p_person: p, p_note: note, p_source: source, p_stage: stage,
        },
      },
    };
  }

  const ids = Array.isArray(b.applicationIds) ? b.applicationIds.map(uuid) : null;
  if (!ids || ids.length > REPORT_MAX || ids.some((id) => id === null)) {
    return { ok: false, error: `applicationIds is a list of at most ${REPORT_MAX} uuids` };
  }
  return { ok: true, call: { fn: "bridge_submission_report", args: { p_applications: ids as string[] } } };
}

/** The status a database refusal answers with: the bridge_* functions' own codes. */
export function refusalStatus(code: string): number {
  if (code === "P0002") return 404;
  if (code === "22023") return 400;
  if (code === "42501") return 403;
  return 500;
}

const camel = (row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]));

/** The JSON a successful call answers with. */
export function bridgeResponse(endpoint: Endpoint, answer: Extract<BridgeAnswer, { ok: true }>): unknown {
  const rows = answer.rows.map(camel);
  if (endpoint === "jobs") return { jobs: rows };
  if (endpoint === "job-for-role") return { job: rows[0] ?? null };
  if (endpoint === "submit-candidate") return rows[0] ?? null;
  return { submissions: rows };
}
