import type { SupabaseClient } from "@supabase/supabase-js";
import { clientTools } from "@tacit-ats/core";
import type { Db } from "@tacit/db";
import { createTestbenchInvite, listTestbenchRoles, testbenchConfigured, type TestbenchRole } from "@/lib/testbench/client";
import { inviteRequestId } from "@/lib/testbench/request-id";

// Tacit Testbench in the client area: which Testbench company a member's org
// maps to, which Testbench role a job's test comes from, and a candidate's
// own invite link for the New Applicants reply. Every read and write here is
// on the member's OWN token, so the policies decide: orgs.testbench_client_id
// is their org's row and nothing a member can change, roles.testbench_role_id
// takes can_on_role(job, 'can_manage_job'), and a testbench_invites row takes
// can_edit_person. The Testbench company and role only ever come from those
// rows, never from a form: lib/testbench/client.ts holds one credential for
// every company, so this is where a member is kept to their own.
// (supabase/migrations/20261116000000_testbench_invites.sql.)

/** The columns and the table are this track's own, which the vendored @tacit/db types do not know yet. */
const untyped = (db: Db) => db as unknown as SupabaseClient;

async function orgClientId(db: Db, orgId: string): Promise<string | null> {
  const { data, error } = await untyped(db).from("orgs").select("testbench_client_id").eq("id", orgId).maybeSingle();
  if (error) throw new Error(error.message);
  const id = (data as { testbench_client_id?: unknown } | null)?.testbench_client_id;
  return typeof id === "string" ? id : null;
}

async function jobRoleId(db: Db, jobId: string): Promise<string | null> {
  const { data, error } = await untyped(db).from("roles").select("testbench_role_id").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  const id = (data as { testbench_role_id?: unknown } | null)?.testbench_role_id;
  return typeof id === "string" ? id : null;
}

/**
 * Whether the Testbench reply is offered on this job's tickets: configured,
 * the org mapped, and the job has a Testbench role. A read that fails offers
 * nothing rather than failing the ticket.
 */
export async function readTestbenchOffered(db: Db, orgId: string, jobId: string): Promise<boolean> {
  if (!testbenchConfigured()) return false;
  try {
    const [clientId, roleId] = await Promise.all([orgClientId(db, orgId), jobRoleId(db, jobId)]);
    return clientId !== null && roleId !== null;
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

/** The job's Testbench picker, or null when there is none to show: Testbench off, or the org not mapped. */
export async function readJobTestbench(db: Db, orgId: string, jobId: string): Promise<JobTestbench | null> {
  if (!testbenchConfigured()) return null;
  try {
    const clientId = await orgClientId(db, orgId);
    if (!clientId) return null;
    const [roleId, roles] = await Promise.all([jobRoleId(db, jobId), listTestbenchRoles(clientId)]);
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
 * Testbench lists it under the org's own company.
 */
export async function saveJobTestbenchRole(db: Db, orgId: string, input: { jobId: string; roleId: string | null }): Promise<TestbenchRoleOutcome> {
  const allowed = await db.rpc("can_on_role", { p_role: input.jobId, perm: "can_manage_job" });
  if (allowed.error) throw new Error(allowed.error.message);
  if (allowed.data !== true) return { ok: false, error: "forbidden" };

  if (input.roleId !== null) {
    const clientId = testbenchConfigured() ? await orgClientId(db, orgId) : null;
    if (!clientId) return { ok: false, error: "off" };
    const roles = await listTestbenchRoles(clientId);
    if (!roles.ok) return { ok: false, error: "unavailable", sentence: roles.error };
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

  const clientId = await orgClientId(db, member.org.id);
  if (!clientId) return refuse("Testbench isn't connected for your company yet. Ask Tacit to connect it.");
  const roleId = await jobRoleId(db, app.data.role_id);
  if (!roleId) return refuse("This job has no Testbench role yet. Pick one on the job's posting, under The job.");

  const person = await db.from("people").select("display_name, email").eq("id", input.candidateId).maybeSingle();
  if (person.error) throw new Error(person.error.message);
  // The address the draft itself goes to, as core picks it.
  const email = (await clientTools.addressesOnFile(db, input.candidateId, person.data?.email ?? null))[0];
  if (!email) return refuse("No email address on file, so there's nobody to invite.");

  const invite = await createTestbenchInvite({
    clientId,
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
