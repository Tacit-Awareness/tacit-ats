import type { Db, Json } from "@tacit/db";

import { withAudit } from "./audit.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * Approval chains for offers and for opening a job
 * (20261016110000_client_approvals), Greenhouse-style. A job can carry one
 * flow per kind: `offer` gates extending its offers, `job_open` gates moving
 * it to open. A flow is ordered steps; any one approver of a step passes it,
 * and the steps run in order. Without a flow nothing is gated.
 *
 * The gates themselves are in the database (validate_offer_approval,
 * validate_job_approval), so update_offer and update_job are refused by
 * Postgres and say so in a sentence; nothing here has to be called for the
 * rule to hold. Every write is a definer function (set_approval_flow,
 * request_approval, decide_approval) that checks the caller itself; the code
 * asks first only to answer with a sentence, and claims the audit row
 * immediately before the call. A rejection's reason is free text and stays
 * out of the audit row.
 */

export const APPROVAL_KINDS = ["offer", "job_open"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
export const APPROVAL_STEPS_MAX = 10;
export const APPROVERS_PER_STEP_MAX = 10;
export const APPROVAL_REASON_MAX = 2000;

export type ApprovalStatus = "pending" | "approved" | "rejected" | "reset" | "cancelled";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND_LABEL: Record<ApprovalKind, string> = { offer: "offer", job_open: "job opening" };

function checkKind(kind: string): ApprovalKind {
  if (!APPROVAL_KINDS.includes(kind as ApprovalKind)) {
    throw new ClientToolError("invalid", "An approval flow is for offer (extending the job's offers) or job_open (opening the job).");
  }
  return kind as ApprovalKind;
}

/** Display names for member ids; anyone no longer active is absent. */
export async function memberNames(db: Db, ids: Array<string | null | undefined>): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const names = new Map<string, string | null>();
  if (!unique.length) return names;
  const { data, error } = await db.from("org_members").select("id, display_name").in("id", unique);
  if (error) throw new Error(error.message);
  for (const m of data ?? []) if (m.id) names.set(m.id, m.display_name);
  return names;
}

type FlowRow = {
  id: string; updated_at: string; updated_by_actor_id: string | null;
  approval_flow_approvers: Array<{ step: number; actor_id: string }>;
};

/** The query, not its result: callers run it beside others in one Promise.all. */
const flowQuery = (db: Db, jobId: string, kind: ApprovalKind) =>
  db.from("approval_flows")
    .select("id, updated_at, updated_by_actor_id, approval_flow_approvers(step, actor_id)")
    .eq("role_id", jobId)
    .eq("kind", kind)
    .maybeSingle() as unknown as PromiseLike<{ data: FlowRow | null; error: { message: string } | null }>;

/** Step numbers in order, each with its approvers' ids. Gaps (an approver deleted) close up. */
function stepsOf(flow: FlowRow | null): string[][] {
  if (!flow) return [];
  const byStep = new Map<number, string[]>();
  for (const a of flow.approval_flow_approvers ?? []) {
    const list = byStep.get(a.step) ?? [];
    list.push(a.actor_id);
    byStep.set(a.step, list);
  }
  return [...byStep.entries()].sort(([a], [b]) => a - b).map(([, ids]) => ids.sort());
}

async function canManage(db: Db, jobId: string): Promise<boolean> {
  const { data, error } = await db.rpc("can_on_role", { p_role: jobId, perm: "can_manage_job" });
  if (error) throw new Error(error.message);
  return data === true;
}

/** The database's refusals (42501, 22023, 22P02) as sentences. */
function approvalError(error: { code?: string; message: string }): Error {
  if (error.code === "42501") return new ClientToolError("forbidden", `Not allowed: ${error.message}.`);
  if (error.code === "22023" || error.code === "22P02") return new ClientToolError("invalid", `Not saved: ${error.message}.`);
  if (error.code === "23505") return new ClientToolError("invalid", "Someone asked for this approval at the same moment. Look again with get_offers or get_approval_flow.");
  return new Error(error.message);
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

export type ApprovalApprover = { userId: string; name: string | null; active: boolean };
export type ApprovalStep = { step: number; approvers: ApprovalApprover[] };

export type JobApproval = {
  requestId: string;
  status: ApprovalStatus;
  waitingStep: number | null;
  requestedBy: string | null;
  requestedAt: string;
  resolvedAt: string | null;
  usedAt: string | null;
  decisions: ApprovalDecision[];
};

export type ApprovalFlow = {
  jobId: string;
  /** Null when the member is an approver who cannot otherwise see the job. */
  title: string | null;
  kind: ApprovalKind;
  steps: ApprovalStep[];
  updatedBy: string | null;
  updatedAt: string | null;
  /** job_open only: the job's latest request to open, if any. */
  latestRequest: JobApproval | null;
};

export async function getApprovalFlow(
  db: Db,
  _ctx: ClientToolCtx,
  input: { jobId: string; kind: ApprovalKind },
): Promise<ApprovalFlow> {
  const kind = checkKind(input.kind);
  const [job, flow] = await Promise.all([
    db.from("roles").select("id, title").eq("id", input.jobId).maybeSingle(),
    flowQuery(db, input.jobId, kind),
  ]);
  if (job.error) throw new Error(job.error.message);
  if (flow.error) throw new Error(flow.error.message);
  if (!job.data && !flow.data) {
    throw new ClientToolError("not_found", "No job with that id that you can see. Call list_jobs for the ids.");
  }
  const steps = stepsOf(flow.data);
  let latest: RequestRow | null = null;
  if (kind === "job_open") {
    const { data, error } = await db
      .from("approval_requests").select(REQUEST_COLUMNS).eq("role_id", input.jobId).eq("kind", "job_open")
      .order("created_at", { ascending: false }).limit(1)
      .overrideTypes<RequestRow[], { merge: false }>();
    if (error) throw new Error(error.message);
    latest = data?.[0] ?? null;
  }
  const names = await memberNames(db, [
    ...steps.flat(), flow.data?.updated_by_actor_id, ...(latest ? requestActorIds(latest) : []),
  ]);
  return {
    jobId: input.jobId,
    title: job.data?.title ?? null,
    kind,
    steps: steps.map((ids, i) => ({
      step: i + 1,
      approvers: ids.map((id) => ({ userId: id, name: names.get(id) ?? null, active: names.has(id) })),
    })),
    updatedBy: flow.data?.updated_by_actor_id ? (names.get(flow.data.updated_by_actor_id) ?? null) : null,
    updatedAt: flow.data?.updated_at ?? null,
    latestRequest: latest ? toJobApproval(latest, names) : null,
  };
}

/** Checked approver ids: at most ten steps of one to ten distinct members, no one twice. */
function checkSteps(steps: string[][]): string[][] {
  if (!Array.isArray(steps) || steps.length > APPROVAL_STEPS_MAX) {
    throw new ClientToolError("invalid", `An approval flow is at most ${APPROVAL_STEPS_MAX} steps. [] removes it.`);
  }
  const seen = new Set<string>();
  return steps.map((group) => {
    if (!Array.isArray(group) || group.length < 1 || group.length > APPROVERS_PER_STEP_MAX) {
      throw new ClientToolError("invalid", `Each step names 1 to ${APPROVERS_PER_STEP_MAX} approvers (any one of them approves the step).`);
    }
    return group.map((id) => {
      const v = String(id).trim().toLowerCase();
      if (!UUID.test(v)) throw new ClientToolError("invalid", "An approver is a user id from list_team.");
      if (seen.has(v)) throw new ClientToolError("invalid", "Each approver appears once in a flow.");
      seen.add(v);
      return v;
    });
  });
}

export async function setApprovalFlow(
  db: Db,
  ctx: ClientToolCtx,
  input: { jobId: string; kind: ApprovalKind; steps: string[][] },
): Promise<{ outcome: "set" | "cleared" | "unchanged"; steps: number; requestsReset: number }> {
  const kind = checkKind(input.kind);
  const steps = checkSteps(input.steps);
  if (ctx.accessLevel === "limited") {
    throw new ClientToolError("forbidden", "Approval flows are set by the people who manage the job, not interviewers.");
  }
  const { data: job, error } = await db.from("roles").select("id").eq("id", input.jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new ClientToolError("not_found", "No job with that id that you can see. Call list_jobs for the ids.");
  if (!(await canManage(db, job.id))) {
    throw new ClientToolError("forbidden", "Only the people who manage this job (an admin, its hiring manager or recruiter) set its approvals.");
  }
  const ids = steps.flat();
  if (ids.length) {
    const names = await memberNames(db, ids);
    const missing = ids.filter((id) => !names.has(id));
    if (missing.length) {
      throw new ClientToolError("not_found", `No one at your company with the user id ${missing.join(", ")}. Call list_team for the ids.`);
    }
  }

  return withAudit(db, ctx, { action: "approval_flow.set", entity: "role" }, async () => {
    const { data, error: rpcError } = await db.rpc("set_approval_flow", {
      p_role: job.id, p_kind: kind, p_steps: steps as unknown as Json,
    });
    if (rpcError) throw approvalError(rpcError);
    const row = (data ?? [])[0];
    const changed = row?.changed === true;
    const outcome = !changed ? ("unchanged" as const) : steps.length ? ("set" as const) : ("cleared" as const);
    return {
      result: { outcome, steps: steps.length, requestsReset: row?.requests_reset ?? 0 },
      entityId: job.id,
      after: { kind, steps, requests_reset: row?.requests_reset ?? 0 },
      changed,
    };
  });
}

// ---------------------------------------------------------------------------
// Requests and decisions
// ---------------------------------------------------------------------------

export type ApprovalDecision = {
  step: number;
  decision: "approved" | "rejected";
  by: string | null;
  at: string;
  /** The approver's own words: free text. */
  reason: string | null;
};

type RequestRow = {
  id: string; offer_id: string | null; status: string; current_step: number | null; requested_by_actor_id: string | null;
  created_at: string; resolved_at: string | null; used_at: string | null;
  approval_decisions: Array<{ step: number; decision: string; actor_id: string | null; reason: string | null; created_at: string }>;
};

const REQUEST_COLUMNS =
  "id, offer_id, status, current_step, requested_by_actor_id, created_at, resolved_at, used_at, " +
  "approval_decisions(step, decision, actor_id, reason, created_at)";

const requestActorIds = (r: RequestRow) => [r.requested_by_actor_id, ...(r.approval_decisions ?? []).map((d) => d.actor_id)];

const toDecisions = (r: RequestRow, names: Map<string, string | null>): ApprovalDecision[] =>
  [...(r.approval_decisions ?? [])]
    .sort((a, b) => a.step - b.step)
    .map((d) => ({
      step: d.step,
      decision: d.decision as ApprovalDecision["decision"],
      by: d.actor_id ? (names.get(d.actor_id) ?? null) : null,
      at: d.created_at,
      reason: d.reason,
    }));

const toJobApproval = (r: RequestRow, names: Map<string, string | null>): JobApproval => ({
  requestId: r.id,
  status: r.status as ApprovalStatus,
  waitingStep: r.current_step,
  requestedBy: r.requested_by_actor_id ? (names.get(r.requested_by_actor_id) ?? null) : null,
  requestedAt: r.created_at,
  resolvedAt: r.resolved_at,
  usedAt: r.used_at,
  decisions: toDecisions(r, names),
});

/** On an offer, for get_offers. Null when the job has no offer flow and the offer was never sent for approval. */
export type OfferApproval = {
  /** The job has an offer flow now: extending needs an approved request. */
  required: boolean;
  /** The latest request's status, or not_requested. */
  status: ApprovalStatus | "not_requested";
  requestId: string | null;
  waitingStep: number | null;
  steps: number;
  requestedBy: string | null;
  requestedAt: string | null;
  decisions: ApprovalDecision[];
};

/**
 * The approval state of a job's offers, read on the member's own client (a
 * manager reads every request and decision on the job). Two reads, side by
 * side; the caller names the actors with the ids it returns.
 */
export async function offerApprovals(db: Db, jobId: string, offerIds: string[]) {
  const [flow, requests] = await Promise.all([
    flowQuery(db, jobId, "offer"),
    db.from("approval_requests").select(REQUEST_COLUMNS).in("offer_id", offerIds).order("created_at", { ascending: false })
      .overrideTypes<RequestRow[], { merge: false }>(),
  ]);
  if (flow.error) throw new Error(flow.error.message);
  if (requests.error) throw new Error(requests.error.message);
  const steps = stepsOf(flow.data).length;
  const rows = requests.data ?? [];
  return {
    actorIds: rows.flatMap(requestActorIds),
    forOffer(offerId: string, names: Map<string, string | null>): OfferApproval | null {
      const latest = rows.find((r) => r.offer_id === offerId) ?? null;
      if (!steps && !latest) return null;
      return {
        required: steps > 0,
        status: latest ? (latest.status as ApprovalStatus) : "not_requested",
        requestId: latest?.id ?? null,
        waitingStep: latest?.current_step ?? null,
        steps,
        requestedBy: latest?.requested_by_actor_id ? (names.get(latest.requested_by_actor_id) ?? null) : null,
        requestedAt: latest?.created_at ?? null,
        decisions: latest ? toDecisions(latest, names) : [],
      };
    },
  };
}

export type RequestApprovalResult = {
  requestId: string;
  kind: ApprovalKind;
  outcome: "requested" | "already_pending" | "already_approved";
  status: ApprovalStatus;
  /** Who can approve the first step (requested) or the flow's steps otherwise. */
  firstStep: string[];
};

export async function requestApproval(
  db: Db,
  ctx: ClientToolCtx,
  input: { offerId?: string; jobId?: string },
): Promise<RequestApprovalResult> {
  if (!!input.offerId === !!input.jobId) {
    throw new ClientToolError("invalid", "Pass offer_id to have an offer approved, or job_id to have a job's opening approved, not both.");
  }
  if (ctx.accessLevel === "limited") {
    throw new ClientToolError("forbidden", "Approvals are asked for by the people who manage the job, not interviewers.");
  }
  const kind: ApprovalKind = input.offerId ? "offer" : "job_open";
  let jobId: string;
  let target: string;
  if (input.offerId) {
    const { data: offer, error } = await db
      .from("offers").select("id, status, application_id").eq("id", input.offerId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!offer) throw new ClientToolError("not_found", "No offer with that id that you can see. get_offers lists them.");
    if (offer.status !== "draft") {
      throw new ClientToolError("invalid", `That offer is ${offer.status}. Only a draft goes for approval.`);
    }
    const { data: app, error: appError } = await db.from("applications").select("role_id").eq("id", offer.application_id).maybeSingle();
    if (appError) throw new Error(appError.message);
    if (!app) throw new ClientToolError("not_found", "No offer with that id that you can see. get_offers lists them.");
    jobId = app.role_id;
    target = offer.id;
  } else {
    const { data: job, error } = await db.from("roles").select("id, status").eq("id", input.jobId!).maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new ClientToolError("not_found", "No job with that id that you can see. Call list_jobs for the ids.");
    if (job.status === "open") throw new ClientToolError("invalid", "That job is already open.");
    jobId = job.id;
    target = job.id;
  }
  if (!(await canManage(db, jobId))) {
    throw new ClientToolError("forbidden", "Only the people who manage this job (an admin, its hiring manager or recruiter) ask for its approvals.");
  }
  const { data: flow, error: flowError } = await flowQuery(db, jobId, kind);
  if (flowError) throw new Error(flowError.message);
  const steps = stepsOf(flow);
  if (!steps.length) {
    throw new ClientToolError(
      "invalid",
      kind === "offer"
        ? "This job has no offer approval flow, so its offers need no approval: update_offer extends one. set_approval_flow adds a flow."
        : "This job has no approval flow for opening it, so update_job opens it without one. set_approval_flow adds a flow.",
    );
  }

  return withAudit(db, ctx, { action: "approval.request", entity: kind === "offer" ? "offer" : "role" }, async () => {
    const { data, error } = await db.rpc("request_approval", { p_kind: kind, p_target: target });
    if (error) throw approvalError(error);
    const row = (data ?? [])[0];
    if (!row) throw new Error("request_approval returned nothing");
    const names = await memberNames(db, steps[0]);
    const outcome = row.outcome as RequestApprovalResult["outcome"];
    return {
      result: {
        requestId: row.request_id, kind, outcome, status: row.request_status as ApprovalStatus,
        firstStep: steps[0].map((id) => names.get(id) ?? id),
      },
      entityId: target,
      after: { kind, request_id: row.request_id, outcome },
      changed: outcome === "requested",
    };
  });
}

export type MyApproval = {
  requestId: string;
  kind: ApprovalKind;
  waitingStep: number;
  steps: number;
  jobId: string;
  jobTitle: string;
  jobStatus: string;
  requestedBy: string | null;
  requestedAt: string;
  /** Offers only: the candidate and the terms to approve. */
  offerId: string | null;
  applicationId: string | null;
  candidateId: string | null;
  candidateName: string | null;
  terms: {
    salary: number | null; currency: string | null; bonus: string | null; equity: string | null;
    startDate: string | null; expiresOn: string | null;
  } | null;
};

export async function listMyApprovals(db: Db, _ctx: ClientToolCtx): Promise<MyApproval[]> {
  const { data, error } = await db.rpc("my_approvals");
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const names = await memberNames(db, rows.map((r) => r.requested_by_actor_id));
  return rows.map((r) => ({
    requestId: r.request_id,
    kind: r.kind as ApprovalKind,
    waitingStep: r.waiting_step,
    steps: r.steps,
    jobId: r.job_id,
    jobTitle: r.job_title,
    jobStatus: r.job_status,
    requestedBy: r.requested_by_actor_id ? (names.get(r.requested_by_actor_id) ?? null) : null,
    requestedAt: r.requested_at,
    offerId: r.offer_id ?? null,
    applicationId: r.application_id ?? null,
    candidateId: r.candidate_id ?? null,
    candidateName: r.candidate_name ?? null,
    terms: r.offer_id
      ? {
          salary: r.salary ?? null, currency: r.currency ?? null, bonus: r.bonus ?? null, equity: r.equity ?? null,
          startDate: r.start_date ?? null, expiresOn: r.expires_on ?? null,
        }
      : null,
  }));
}

export type DecisionResult = {
  outcome: "advanced" | "approved" | "rejected" | "not_pending";
  status: ApprovalStatus;
  /** The step now waiting, when the request moved on. */
  waitingStep: number | null;
  kind: ApprovalKind;
  offerId: string | null;
  jobId: string;
};

export async function decideApproval(
  db: Db,
  ctx: ClientToolCtx,
  input: { requestId: string; decision: "approve" | "reject"; reason?: string | null },
): Promise<DecisionResult> {
  if (input.decision !== "approve" && input.decision !== "reject") {
    throw new ClientToolError("invalid", "A decision is approve or reject.");
  }
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > APPROVAL_REASON_MAX) {
    throw new ClientToolError("invalid", `A reason is at most ${APPROVAL_REASON_MAX} characters.`);
  }
  if (input.decision === "reject" && !reason) {
    throw new ClientToolError("invalid", "A rejection needs a reason, so whoever asked knows what to change.");
  }

  const { data: request, error } = await db
    .from("approval_requests").select("id, kind, role_id, offer_id, status, current_step").eq("id", input.requestId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!request) throw new ClientToolError("not_found", "No approval request with that id that you can see. list_my_approvals lists yours.");
  const kind = request.kind as ApprovalKind;
  const base = { kind, offerId: request.offer_id, jobId: request.role_id };
  if (request.status !== "pending") {
    return { outcome: "not_pending", status: request.status as ApprovalStatus, waitingStep: null, ...base };
  }
  const { data: mine, error: mineError } = await db
    .from("approval_flow_approvers")
    .select("id, approval_flows!inner(role_id, kind)")
    .eq("actor_id", ctx.actorId)
    .eq("step", request.current_step!)
    .eq("approval_flows.role_id", request.role_id)
    .eq("approval_flows.kind", kind)
    .limit(1);
  if (mineError) throw new Error(mineError.message);
  if (!mine?.length) {
    throw new ClientToolError(
      "forbidden",
      `That ${KIND_LABEL[kind]} approval is waiting on step ${request.current_step}, and you are not an approver at that step.`,
    );
  }

  const action = input.decision === "approve" ? "approval.approve" : "approval.reject";
  return withAudit(db, ctx, { action, entity: "approval_request" }, async () => {
    const { data, error: rpcError } = await db.rpc("decide_approval", {
      p_request: request.id, p_approve: input.decision === "approve", ...(reason ? { p_reason: reason } : {}),
    });
    if (rpcError) throw approvalError(rpcError);
    const row = (data ?? [])[0];
    if (!row) throw new Error("decide_approval returned nothing");
    const outcome = row.outcome as DecisionResult["outcome"];
    // The reason is the approver's own words: kept out of the audit row.
    return {
      result: { outcome, status: row.request_status as ApprovalStatus, waitingStep: row.waiting_step ?? null, ...base },
      entityId: request.id,
      before: { status: "pending", step: request.current_step },
      after: { kind, status: row.request_status, step: request.current_step, decision: input.decision },
      changed: outcome !== "not_pending",
    };
  });
}
