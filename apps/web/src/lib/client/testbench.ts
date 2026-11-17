import type { SupabaseClient } from "@supabase/supabase-js";
import { clientTools } from "@tacit-ats/core";
import type { Db } from "@tacit/db";
import { createTestbenchInvite, listTestbenchRoles, testbenchConfigured, type TestbenchRole } from "@/lib/testbench/client";
import { inviteRequestId } from "@/lib/testbench/request-id";

// Tacit Testbench in the client area: which Testbench role a job's test comes
// from, and a candidate's own invite link for the New Applicants reply. The
// Testbench company is never named here by a Testbench id: every request
// carries the member's own org id, from their verified session, and Testbench
// resolves it to the one company linked to that org. lib/testbench/client.ts
// holds one credential for every company, so passing the session's org (never
// a form's) is what keeps a member to their own. Every database read and write
// is on the member's OWN token, so the policies decide: roles.testbench_role_id
// takes can_on_role(job, 'can_manage_job'), and a testbench_invites row takes
// can_edit_person. (supabase/migrations/20261116000000_testbench_invites.sql.)
// orgs.testbench_client_id, that migration's hand-set mapping, is superseded
// by the org link and no longer read; a later migration drops it.

/** The columns and the table are this track's own, which the vendored @tacit/db types do not know yet. */
const untyped = (db: Db) => db as unknown as SupabaseClient;

async function jobRoleId(db: Db, jobId: string): Promise<string | null> {
  const { data, error } = await untyped(db).from("roles").select("testbench_role_id").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  const id = (data as { testbench_role_id?: unknown } | null)?.testbench_role_id;
  return typeof id === "string" ? id : null;
}

/**
 * Whether the Testbench reply is offered on this job's tickets: configured,
 * and the job has a Testbench role. No call to Testbench on a ticket's render:
 * a role is only ever saved from the org's own Testbench company, and a
 * company no longer linked is a sentence at Review draft. A read that fails
 * offers nothing rather than failing the ticket.
 */
export async function readTestbenchOffered(db: Db, jobId: string): Promise<boolean> {
  if (!testbenchConfigured()) return false;
  try {
    return (await jobRoleId(db, jobId)) !== null;
  } catch (err) {
    console.error("[client-testbench] read failed:", err instanceof Error ? err.message : "read failed");
    return false;
  }
}

export type JobTestbench = {
  jobId: string;
  /** The job's Testbench role now, whether or not Testbench still lists it. */
  roleId: string | null;
  roles: TestbenchRole[];
  /** Why the roles could not be listed, in a sentence. */
  unavailable: string | null;
};

/** The job's Testbench picker, or null when there is none to show: Testbench off, or no Testbench company linked to the org. */
export async function readJobTestbench(db: Db, orgId: string, jobId: string): Promise<JobTestbench | null> {
  if (!testbenchConfigured()) return null;
  try {
    const [roleId, roles] = await Promise.all([jobRoleId(db, jobId), listTestbenchRoles(orgId)]);
    if (!roles.ok && roles.code === "org_not_linked") return null;
    return { jobId, roleId, roles: roles.ok ? roles.value : [], unavailable: roles.ok ? null : roles.error };
  } catch (err) {
    console.error("[client-testbench] job read failed:", err instanceof Error ? err.message : "read failed");
    return null;
  }
}

export type TestbenchRoleError = "forbidden" | "off" | "bad_role" | "unavailable";
export type TestbenchRoleOutcome = { ok: true } | { ok: false; error: TestbenchRoleError; sentence?: string };

/**
 * Sets or clears a job's Testbench role. Whoever may manage the job (asked
 * first, and roles' update policy decides again); a role is taken only when
 * Testbench lists it for the company linked to the member's own org.
 */
export async function saveJobTestbenchRole(db: Db, orgId: string, input: { jobId: string; roleId: string | null }): Promise<TestbenchRoleOutcome> {
  const allowed = await db.rpc("can_on_role", { p_role: input.jobId, perm: "can_manage_job" });
  if (allowed.error) throw new Error(allowed.error.message);
  if (allowed.data !== true) return { ok: false, error: "forbidden" };

  if (input.roleId !== null) {
    if (!testbenchConfigured()) return { ok: false, error: "off" };
    const roles = await listTestbenchRoles(orgId);
    if (!roles.ok) return roles.code === "org_not_linked" ? { ok: false, error: "off" } : { ok: false, error: "unavailable", sentence: roles.error };
    if (!roles.value.some((r) => r.id === input.roleId)) return { ok: false, error: "bad_role" };
  }

  const { data, error } = await untyped(db).from("roles").update({ testbench_role_id: input.roleId }).eq("id", input.jobId).select("id");
  if (error) throw new Error(error.message);
  return data?.length ? { ok: true } : { ok: false, error: "forbidden" };
}

const NONE = " No draft was written.";
export type InviteLinkOutcome = { ok: true; url: string } | { ok: false; error: string };

/**
 * A candidate's own Testbench invite link, for a reply about to be drafted.
 * Asked of Testbench under an id made from the application, the role and the
 * address, so asking again returns the same invitation. Records Testbench's
 * application and attempt on the member's token; the link itself is a
 * credential and is handed back, never stored or logged. Any refusal is a
 * sentence for the reply box, and nothing was drafted.
 */
export async function mintTestbenchLink(
  db: Db,
  member: { actorId: string; org: { id: string } },
  input: { applicationId: string; candidateId: string },
): Promise<InviteLinkOutcome> {
  const refuse = (sentence: string): InviteLinkOutcome => ({ ok: false, error: sentence + NONE });
  if (!testbenchConfigured()) return refuse("Testbench isn't set up on this deployment.");

  const app = await db.from("applications").select("id, role_id, person_id").eq("id", input.applicationId).maybeSingle();
  if (app.error) throw new Error(app.error.message);
  if (!app.data || app.data.person_id !== input.candidateId) return refuse("That application isn't one you can see any more.");
  const allowed = await db.rpc("can_edit_person", { p_person: input.candidateId });
  if (allowed.error) throw new Error(allowed.error.message);
  if (allowed.data !== true) return refuse("You can't email this candidate.");

  const roleId = await jobRoleId(db, app.data.role_id);
  if (!roleId) return refuse("This job has no Testbench role yet. Pick one on the job's posting, under The job.");

  const person = await db.from("people").select("display_name, email").eq("id", input.candidateId).maybeSingle();
  if (person.error) throw new Error(person.error.message);
  // The address the draft itself goes to, as core picks it.
  const email = (await clientTools.addressesOnFile(db, input.candidateId, person.data?.email ?? null))[0];
  if (!email) return refuse("No email address on file, so there's nobody to invite.");

  const invite = await createTestbenchInvite({
    // The session's own org: Testbench invites into the company linked to it, and no other.
    orgId: member.org.id,
    roleId,
    requestId: inviteRequestId({ applicationId: input.applicationId, testbenchRoleId: roleId, email }),
    email,
    name: person.data?.display_name?.trim() || email,
  });
  if (!invite.ok) {
    console.error("[client-testbench] invite refused:", invite.code);
    return refuse(invite.error);
  }

  const kept = await untyped(db)
    .from("testbench_invites")
    .upsert(
      {
        application_id: input.applicationId,
        org_id: member.org.id,
        testbench_role_id: roleId,
        testbench_application_id: invite.value.applicationId,
        testbench_attempt_id: invite.value.attemptId,
        invited_by_actor_id: member.actorId,
      },
      { onConflict: "application_id" },
    );
  if (kept.error) throw new Error(kept.error.message);
  return { ok: true, url: invite.value.invitationUrl };
}
