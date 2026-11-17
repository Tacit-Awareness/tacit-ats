// Tacit Testbench's invite service connection, from the server only
// (tacit-testbench's packages/server/INVITE_INTEGRATION.md). One `tis_`
// credential, Tacit's own Testbench agency, for every ATS company: so this
// module decides nothing about who may invite where. Its callers take the
// Testbench company from the member's own org row and the role from the job's
// row, on the member's own token (lib/client/testbench.ts), never from a form.
//
// Off unless both TESTBENCH_URL (the site's origin, no /api/v1) and
// TESTBENCH_INVITE_TOKEN are set. It holds no database client. The token goes
// in one header and nowhere else: no error, sentence or log line carries it,
// a response body or an invite link.

const TIMEOUT_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TestbenchRole = { id: string; title: string; status: string; invitable: boolean };
export type TestbenchInvite = { applicationId: string; attemptId: string | null; invitationUrl: string; outcome: "created" | "existing" };

/** What went wrong, as a code for tests and logs and a sentence a member can act on. */
export type TestbenchFailure = { ok: false; code: string; error: string };
export type TestbenchResult<T> = { ok: true; value: T } | TestbenchFailure;

function config(): { base: string; token: string } | null {
  const url = process.env.TESTBENCH_URL?.trim().replace(/\/+$/, "");
  const token = process.env.TESTBENCH_INVITE_TOKEN?.trim();
  if (!url || !token || !/^https?:\/\//.test(url)) return null;
  return { base: `${url}/api/v1`, token };
}

export const testbenchConfigured = (): boolean => config() !== null;

const TACIT = "Tell Tacit, who can fix it.";
const SENTENCES: Record<string, string> = {
  not_configured: "Testbench isn't set up on this deployment.",
  role_closed: "This job's Testbench role is closed. Reopen it in Testbench, or pick another for the job.",
  published_assessment_required: "This job's Testbench role has no published test yet. Publish one in Testbench, or pick another role for the job.",
  not_found: "Testbench doesn't have this job's role under your company any more. Pick the job's Testbench role again.",
  invitation_request_conflict: `Testbench has this invitation under different candidate details. ${TACIT}`,
  invite_service_expired: `The connection to Testbench has expired. ${TACIT}`,
  invite_scope_denied: `The connection to Testbench doesn't allow this. ${TACIT}`,
  invite_service_unavailable: "Testbench isn't ready to take invitations yet. Try again later.",
  client_required: `Testbench didn't recognise your company. ${TACIT}`,
  validation: "Testbench didn't accept the candidate's name or email address. Check them on the candidate.",
  rate_limited: "Testbench is taking too many invitations right now. Try again in a minute.",
  timeout: "Testbench didn't answer in time. Try again.",
  unreachable: "Testbench couldn't be reached. Try again.",
  bad_response: "Testbench answered in a way Tacit didn't expect. Try again.",
};

const failure = (code: string): TestbenchFailure => ({ ok: false, code, error: SENTENCES[code] ?? "Testbench refused the request. Try again." });

/** Testbench's own code when it is one this knows, else one for the status. Its message is never passed on. */
function codeOf(status: number, body: unknown): string {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  if (typeof code === "string" && code in SENTENCES) return code;
  if (status === 401) return "invite_service_expired";
  if (status === 403) return "invite_scope_denied";
  if (status === 404) return "not_found";
  if (status === 422) return "validation";
  if (status === 429) return "rate_limited";
  if (status === 503) return "invite_service_unavailable";
  return "refused";
}

async function call(path: string, init: { clientId?: string; body?: unknown }): Promise<TestbenchResult<unknown>> {
  const cfg = config();
  if (!cfg) return failure("not_configured");
  let res: Response;
  try {
    res = await fetch(`${cfg.base}${path}`, {
      method: init.body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/json",
        ...(init.clientId ? { "X-Tacit-Client": init.clientId } : {}),
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return failure(name === "TimeoutError" || name === "AbortError" ? "timeout" : "unreachable");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) return failure(codeOf(res.status, body));
  const data = (body as { data?: unknown } | null)?.data;
  if (!data || typeof data !== "object") return failure("bad_response");
  return { ok: true, value: data };
}

/** The roles of one Testbench company, with whether each can take an invitation now. */
export async function listTestbenchRoles(clientId: string): Promise<TestbenchResult<TestbenchRole[]>> {
  if (!UUID.test(clientId)) return failure("client_required");
  const res = await call("/integration/roles", { clientId });
  if (!res.ok) return res;
  const items = (res.value as { items?: unknown }).items;
  if (!Array.isArray(items)) return failure("bad_response");
  const roles: TestbenchRole[] = [];
  for (const item of items as { id?: unknown; title?: unknown; status?: unknown; invitable?: unknown }[]) {
    if (typeof item?.id !== "string" || !UUID.test(item.id)) return failure("bad_response");
    roles.push({
      id: item.id.toLowerCase(),
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Untitled role",
      status: typeof item.status === "string" ? item.status : "",
      invitable: item.invitable === true,
    });
  }
  return { ok: true, value: roles };
}

/** A link this can put in an email: http(s), one unbroken token, nothing core would read as a placeholder. */
const usableLink = (v: unknown): v is string => typeof v === "string" && /^https?:\/\/[^\s{}<>"']+$/.test(v) && v.length <= 2000;

/**
 * Invites one candidate to a role's test and answers their link. Idempotent
 * on `requestId`: the same request returns the same invitation and link, and
 * Testbench sends no email of its own.
 */
export async function createTestbenchInvite(input: { clientId: string; roleId: string; requestId: string; email: string; name: string }): Promise<TestbenchResult<TestbenchInvite>> {
  if (!UUID.test(input.clientId)) return failure("client_required");
  if (!UUID.test(input.roleId)) return failure("not_found");
  const res = await call(`/integration/roles/${input.roleId}/invites`, {
    clientId: input.clientId,
    body: { requestId: input.requestId, candidate: { email: input.email, name: input.name } },
  });
  if (!res.ok) return res;
  const v = res.value as { applicationId?: unknown; attemptId?: unknown; invitationUrl?: unknown; outcome?: unknown };
  if (typeof v.applicationId !== "string" || !UUID.test(v.applicationId) || !usableLink(v.invitationUrl)) return failure("bad_response");
  return {
    ok: true,
    value: {
      applicationId: v.applicationId,
      attemptId: typeof v.attemptId === "string" && UUID.test(v.attemptId) ? v.attemptId : null,
      invitationUrl: v.invitationUrl,
      outcome: v.outcome === "existing" ? "existing" : "created",
    },
  };
}
