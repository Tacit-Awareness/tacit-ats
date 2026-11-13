import type { Db } from "@tacit/db";
import { logTouch } from "@tacit/core";
import { clientTools } from "@tacit-ats/core";

// Adding someone to a job by hand, on the member's OWN client (never a
// privileged one): the intake composer's two doors, "Add applicant" on New
// Applicants (source `sourced`, someone the team recruited or met) and "Add
// referral" (source `referral`, lib/client/referrals.ts). Both are the audited
// clientTools.addCandidate, with audit source `dashboard`; whatever they wrote
// besides the name and addresses goes on the application as its first note
// (core's logTouch), and a resume on their file (core's addFile). Someone
// already in the job keeps the application and source they had: nothing
// changes, and neither the note nor the file is added.

/** A resume, checked and ready for core's addFile. */
export type IntakeFile = { filename: string; contentType: string; contentBase64: string };

export type IntakeInput = {
  jobId: string;
  name: string;
  email: string | null;
  linkedinUrl: string | null;
  note: string | null;
  file?: IntakeFile | null;
};

export type IntakeStatus = "added" | "added_existing" | "added_no_note" | "added_no_file" | "added_no_extras" | "exists";

export type IntakeOutcome =
  | { ok: true; status: IntakeStatus; applicationId: string; personId: string }
  | { ok: false; error: "forbidden" | "rate_limited" | "invalid_name" | "invalid_email" | "invalid_linkedin" };

const INVALID_FIELD = { name: "invalid_name", email: "invalid_email", linkedin: "invalid_linkedin" } as const;
const isInvalidField = (f: string | undefined): f is keyof typeof INVALID_FIELD => f !== undefined && Object.hasOwn(INVALID_FIELD, f);

/**
 * The add itself, with the source and its detail the caller decided. `log`
 * names the caller in the server log when a note or a file fails.
 */
export async function addToJob(
  db: Db,
  ctx: clientTools.ClientToolCtx,
  input: IntakeInput,
  how: { source: "sourced" | "referral"; sourceDetail: string | null; log: string },
  store: clientTools.FileStore | null = null,
): Promise<IntakeOutcome> {
  // addCandidate checks can_add_people() and can_edit_pipeline first, so a
  // refused add leaves no person row behind; the policies check again on the inserts.
  let added: clientTools.AddCandidateResult;
  try {
    added = await clientTools.addCandidate(db, ctx, {
      jobId: input.jobId,
      name: input.name,
      email: input.email,
      linkedinUrl: input.linkedinUrl,
      source: how.source,
      sourceDetail: how.sourceDetail,
    });
  } catch (err) {
    if (err instanceof clientTools.ClientToolError) {
      if (err.code === "forbidden" || err.code === "rate_limited") return { ok: false, error: err.code };
      if (err.code === "invalid" && isInvalidField(err.field)) return { ok: false, error: INVALID_FIELD[err.field] };
    }
    throw err;
  }
  const { applicationId, candidateId: personId } = added;
  if (added.outcome === "already_in_pipeline") return { ok: true, status: "exists", applicationId, personId };

  // They're in by now, so a note or a file that fails can't say nobody was added.
  let noteSaved = true;
  const note = input.note?.replaceAll("\0", "");
  if (note) {
    try {
      await logTouch(db, { applicationId, actorId: ctx.actorId, note });
    } catch (err) {
      console.error(`[${how.log}] the note failed:`, err instanceof Error ? err.message : err);
      noteSaved = false;
    }
  }
  let fileSaved = true;
  if (input.file) {
    try {
      await clientTools.addFile(db, ctx, store, { candidateId: personId, kind: "resume", ...input.file });
    } catch (err) {
      console.error(`[${how.log}] the file failed:`, err instanceof Error ? err.message : err);
      fileSaved = false;
    }
  }
  if (!noteSaved || !fileSaved) {
    return { ok: true, status: !fileSaved ? (noteSaved ? "added_no_file" : "added_no_extras") : "added_no_note", applicationId, personId };
  }
  return { ok: true, status: added.newCandidate ? "added" : "added_existing", applicationId, personId };
}

/**
 * "Add applicant": someone the team found themselves, into a job at its first
 * stage with source `sourced`, so New Applicants lists them beside the people
 * who applied and the referrals. The member who added them is the
 * application's `added_by_actor_id` (the database sets it); what they wrote
 * about them is the note, so `source_detail` stays empty here.
 */
export function addApplicant(db: Db, ctx: clientTools.ClientToolCtx, input: IntakeInput, store: clientTools.FileStore | null = null): Promise<IntakeOutcome> {
  return addToJob(db, ctx, input, { source: "sourced", sourceDetail: null, log: "client-applicants" }, store);
}

/**
 * Who added each application, by name: `added_by_actor_id` matched to the
 * team (org_members). An application its adder no longer exists for, or one
 * added by someone the member can't see, has no name here.
 */
export async function readAddedBy(db: Db, applicationIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!applicationIds.length) return out;
  const { data: apps, error } = await db.from("applications").select("id, added_by_actor_id").in("id", applicationIds);
  if (error) throw new Error(error.message);
  const actors = [...new Set((apps ?? []).map((a) => a.added_by_actor_id).filter((id): id is string => !!id))];
  if (!actors.length) return out;
  const { data: members, error: membersError } = await db.from("org_members").select("id, display_name").in("id", actors);
  if (membersError) throw new Error(membersError.message);
  const names = new Map((members ?? []).flatMap((m) => (m.id && m.display_name ? [[m.id, m.display_name] as const] : [])));
  for (const a of apps ?? []) {
    const name = a.added_by_actor_id ? names.get(a.added_by_actor_id) : undefined;
    if (name) out.set(a.id, name);
  }
  return out;
}
