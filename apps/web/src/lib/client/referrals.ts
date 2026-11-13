import type { Db } from "@tacit/db";
import type { clientTools } from "@tacit-ats/core";
import { RESUME_ACCEPT as SHARED_ACCEPT, checkResume } from "../resume-file";
import { addToJob, type IntakeFile, type IntakeOutcome } from "./intake";
import { cleanReferrer, type Referral } from "./referral-table";

// Referrals' read and its one write, on the member's OWN client (never a
// privileged one). The read is `applications` with source `referral`, the
// person and the job: the policies decide which come back (an admin's whole
// org, a hiring-team member's own jobs, an external recruiter's own adds),
// nothing here filters by org or level. The add is lib/client/intake.ts's
// addToJob, the audited clientTools.addCandidate with audit source
// `dashboard`, here with the application's source `referral` and the referrer
// in `source_detail`, which stays out of the audit row.

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
 * What the intake composer needs, for a referral or an applicant: the open
 * jobs the member may add people to (`can_on_role(job, 'can_edit_pipeline')`),
 * empty when they may not add people at all (`can_add_people()`), and the
 * team's names to suggest as the referrer. Hiding the composer is
 * presentation; the action and the policies check again.
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
export type ReferralFile = IntakeFile;

/** What the composer's file input takes. */
export const RESUME_ACCEPT = SHARED_ACCEPT;

/**
 * The posted file: null when none was picked, "invalid" when core would refuse
 * it, so nobody is added first. An empty file input can reach the server with a
 * name ("blob", "undefined", by browser and runtime), so any zero-byte upload
 * counts as none picked.
 */
export async function referralFile(value: FormDataEntryValue | null): Promise<ReferralFile | null | "invalid"> {
  const checked = await checkResume(value);
  if (checked === null) return null;
  if (checked === "too_big" || checked === "invalid") return "invalid";
  return { filename: checked.filename, contentType: checked.contentType, contentBase64: Buffer.from(checked.bytes).toString("base64") };
}

export type AddReferralOutcome = IntakeOutcome | { ok: false; error: "invalid_referrer" };

/**
 * A referral into a job: the person (found by an email the member can see, or
 * made), their application with source `referral` and `source_detail` the
 * referrer as typed, the note as the application's first note and the file as
 * their resume (lib/client/intake.ts). Someone already in the job keeps the
 * application and source they had: nothing changes, and neither the note nor
 * the file is added.
 */
export async function addReferral(
  db: Db,
  ctx: clientTools.ClientToolCtx,
  input: ReferralInput,
  store: clientTools.FileStore | null = null,
): Promise<AddReferralOutcome> {
  const referredBy = cleanReferrer(input.referredBy);
  if (!referredBy) return { ok: false, error: "invalid_referrer" };
  return addToJob(db, ctx, input, { source: "referral", sourceDetail: referredBy, log: "client-referrals" }, store);
}
