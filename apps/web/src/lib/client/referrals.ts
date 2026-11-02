import type { Db } from "@tacit/db";
import { logTouch } from "@tacit/core";
import { clientTools } from "@tacit-ats/core";
import { cleanReferrer, type Referral } from "./referral-table";

// Referrals' read and its one write, on the member's OWN client (never a
// privileged one). The read is `applications` with source `referral`, the
// person and the job: the policies decide which come back (an admin's whole
// org, a hiring-team member's own jobs, an external recruiter's own adds),
// nothing here filters by org or level. The add is the audited
// clientTools.addCandidate, with audit source `dashboard`, the application's
// source `referral` and the referrer in `source_detail`, which stays out of
// the audit row.

/** Rows per request: PostgREST's own maximum. */
const PAGE = 1000;
/** Referrals read at most; past it the table says so (`truncated`). */
export const REFERRALS_SCAN_MAX = 5000;

type ReferralRow = {
  id: string;
  person_id: string;
  role_id: string;
  stage: string;
  source_detail: string | null;
  created_at: string;
  people: { display_name: string | null } | null;
  roles: { title: string } | null;
};

export async function readReferrals(db: Db): Promise<{ referrals: Referral[]; truncated: boolean }> {
  const rows: ReferralRow[] = [];
  for (let from = 0; from < REFERRALS_SCAN_MAX; from += PAGE) {
    const { data, error } = await db
      .from("applications")
      .select("id, person_id, role_id, stage, source_detail, created_at, people(display_name), roles(title)")
      .eq("source", "referral")
      .order("id")
      .range(from, from + PAGE - 1)
      .overrideTypes<ReferralRow[], { merge: false }>();
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return {
    truncated: rows.length >= REFERRALS_SCAN_MAX,
    referrals: rows.map((r) => ({
      applicationId: r.id,
      candidateId: r.person_id,
      name: r.people?.display_name ?? null,
      referredBy: r.source_detail,
      jobId: r.role_id,
      jobTitle: r.roles?.title ?? null,
      stage: r.stage,
      referredAt: r.created_at,
    })),
  };
}

export type ReferralJob = { jobId: string; title: string };

/**
 * What the add form needs: the open jobs the member may add people to
 * (`can_on_role(job, 'can_edit_pipeline')`), empty when they may not add
 * people at all (`can_add_people()`), and the team's names to suggest as the
 * referrer. Hiding the form is presentation; the action and the policies
 * check again.
 */
export async function readAddForm(db: Db): Promise<{ jobs: ReferralJob[]; teammates: string[] }> {
  const [canAdd, roles, members] = await Promise.all([
    db.rpc("can_add_people"),
    db.from("roles").select("id, title").eq("status", "open").order("title"),
    db.from("org_members").select("display_name").order("display_name"),
  ]);
  if (canAdd.error) throw new Error(canAdd.error.message);
  if (roles.error) throw new Error(roles.error.message);
  if (members.error) throw new Error(members.error.message);
  const teammates = [...new Set((members.data ?? []).map((m) => m.display_name).filter((n): n is string => !!n))];
  if (canAdd.data !== true) return { jobs: [], teammates };

  const checks = await Promise.all(
    (roles.data ?? []).map(async (r) => {
      const ok = await db.rpc("can_on_role", { p_role: r.id, perm: "can_edit_pipeline" });
      if (ok.error) throw new Error(ok.error.message);
      return ok.data === true ? { jobId: r.id, title: r.title } : null;
    }),
  );
  return { jobs: checks.filter((j): j is ReferralJob => j !== null), teammates };
}

export type ReferralInput = {
  jobId: string;
  name: string;
  email: string | null;
  linkedinUrl: string | null;
  referredBy: unknown;
  note: string | null;
  file?: ReferralFile | null;
};

/** A referral's resume, checked and ready for core's addFile. */
export type ReferralFile = { filename: string; contentType: string; contentBase64: string };

/** What the form's file input takes. */
export const RESUME_ACCEPT = Object.values(clientTools.FILE_TYPES).flatMap((t) => t.extensions.map((e) => `.${e}`)).join(",");

/** A name core's addFile takes: anything else in it becomes a space, and the extension stays. */
function resumeName(raw: string, ext: string): string {
  const stem = raw.slice(0, raw.lastIndexOf(".")).replace(/[^\p{L}\p{N} ._()&,+'-]/gu, " ").replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s+/g, " ").trim().slice(0, 150);
  return `${stem || "Resume"}.${ext}`;
}

/** The form's file: null when none was picked, "invalid" when core would refuse it, so nobody is added first. */
export async function referralFile(value: FormDataEntryValue | null): Promise<ReferralFile | null | "invalid"> {
  if (!(value instanceof File) || (value.size === 0 && value.name === "")) return null;
  const ext = value.name.includes(".") ? value.name.slice(value.name.lastIndexOf(".") + 1).toLowerCase() : "";
  const found = Object.entries(clientTools.FILE_TYPES).find(([, t]) => t.extensions.includes(ext));
  if (!found || value.size === 0 || value.size > clientTools.FILE_MAX_BYTES) return "invalid";
  const [contentType, type] = found;
  const bytes = new Uint8Array(await value.arrayBuffer());
  if (!type.looksRight(bytes)) return "invalid";
  return { filename: resumeName(value.name, ext), contentType, contentBase64: Buffer.from(bytes).toString("base64") };
}

export type AddReferralOutcome =
  | { ok: true; status: "added" | "added_existing" | "added_no_note" | "added_no_file" | "added_no_extras" | "exists"; applicationId: string; personId: string }
  | { ok: false; error: "forbidden" | "rate_limited" | "invalid_name" | "invalid_email" | "invalid_linkedin" | "invalid_referrer" };

const INVALID_FIELD = { name: "invalid_name", email: "invalid_email", linkedin: "invalid_linkedin" } as const;
const isInvalidField = (f: string | undefined): f is keyof typeof INVALID_FIELD => f !== undefined && Object.hasOwn(INVALID_FIELD, f);

/**
 * A referral into a job: the person (found by an email the member can see, or
 * made), their application with source `referral` and `source_detail` the
 * referrer as typed, and the note as the application's first note (core's
 * logTouch), and the file as their resume (core's addFile). Someone already in
 * the job keeps the application and source they had: nothing changes, and
 * neither the note nor the file is added.
 */
export async function addReferral(
  db: Db,
  ctx: clientTools.ClientToolCtx,
  input: ReferralInput,
  store: clientTools.FileStore | null = null,
): Promise<AddReferralOutcome> {
  const referredBy = cleanReferrer(input.referredBy);
  if (!referredBy) return { ok: false, error: "invalid_referrer" };

  // addCandidate checks can_add_people() and can_edit_pipeline first, so a
  // refused add leaves no person row behind; the policies check again on the inserts.
  let added: clientTools.AddCandidateResult;
  try {
    added = await clientTools.addCandidate(db, ctx, {
      jobId: input.jobId,
      name: input.name,
      email: input.email,
      linkedinUrl: input.linkedinUrl,
      source: "referral",
      sourceDetail: referredBy,
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
      console.error("[client-referrals] the note failed:", err instanceof Error ? err.message : err);
      noteSaved = false;
    }
  }
  let fileSaved = true;
  if (input.file) {
    try {
      await clientTools.addFile(db, ctx, store, { candidateId: personId, kind: "resume", ...input.file });
    } catch (err) {
      console.error("[client-referrals] the file failed:", err instanceof Error ? err.message : err);
      fileSaved = false;
    }
  }
  if (!noteSaved || !fileSaved) {
    return { ok: true, status: !fileSaved ? (noteSaved ? "added_no_file" : "added_no_extras") : "added_no_note", applicationId, personId };
  }
  return { ok: true, status: added.newCandidate ? "added" : "added_existing", applicationId, personId };
}
