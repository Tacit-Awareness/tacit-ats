import type { Db } from "@tacit/db";
import { ACTIVE_STAGES } from "@tacit/core";
import { clientTools } from "@tacit-ats/core";
import type { Member } from "./interviews";

// What the Calendar's Book and Find a time dialogs choose from, on the member's
// OWN client: the people still in process on a job they may schedule on, and
// their company's members. Read when a dialog opens, not with the page, as most
// visits never book anything. Whether they may schedule is the same question a
// write asks (can_on_role), so a job they cannot book on never shows.

/** Applications one dialog reads at most, the most recently touched first. */
const CHOICES_MAX = 1000;

export type ApplicationChoice = {
  applicationId: string;
  candidate: string;
  jobTitle: string;
  stage: string;
  /** The job's interview plan: a step must be one of these. Empty takes any name. */
  steps: string[];
};
export type InterviewerChoice = { actorId: string; name: string };

export type BookingChoices = {
  applications: ApplicationChoice[];
  interviewers: InterviewerChoice[];
  /** There were more than the read's cap: the least recently touched are left off. */
  truncated: boolean;
};

export const NO_CHOICES: BookingChoices = { applications: [], interviewers: [], truncated: false };

/** The jobs out of these the member may schedule on, by the same check a write makes. */
export async function schedulableRoles(db: Db, roleIds: string[]): Promise<Set<string>> {
  const roles = [...new Set(roleIds)];
  const answers = await Promise.all(
    roles.map(async (role) => {
      const r = await db.rpc("can_on_role", { p_role: role, perm: "can_schedule" });
      if (r.error) throw new Error(r.error.message);
      return r.data === true;
    }),
  );
  return new Set(roles.filter((_, i) => answers[i]));
}

/** Nothing for an interviewer: they do not schedule. */
export async function readBookingChoices(db: Db, member: Member): Promise<BookingChoices> {
  if (member.accessLevel === "limited") return NO_CHOICES;
  const [apps, people] = await Promise.all([
    db
      .from("applications")
      .select("id, role_id, stage, people(display_name), roles(title, status, interview_steps)")
      .in("stage", [...ACTIVE_STAGES])
      .is("merged_into_id", null)
      .order("last_touch_at", { ascending: false })
      .order("id")
      .limit(CHOICES_MAX + 1),
    db.from("org_members").select("id, display_name").order("display_name"),
  ]);
  if (apps.error) throw new Error(apps.error.message);
  if (people.error) throw new Error(people.error.message);

  const open = (apps.data ?? []).slice(0, CHOICES_MAX).filter((a) => a.roles?.status === "open");
  const allowed = await schedulableRoles(db, open.map((a) => a.role_id));
  return {
    applications: open
      .filter((a) => allowed.has(a.role_id))
      .map((a) => ({
        applicationId: a.id,
        candidate: a.people?.display_name ?? "Candidate",
        jobTitle: a.roles?.title ?? "",
        stage: a.stage,
        steps: clientTools.stepsOf(a.roles?.interview_steps),
      })),
    interviewers: (people.data ?? []).flatMap((p) => (p.id && p.display_name ? [{ actorId: p.id, name: p.display_name }] : [])),
    truncated: (apps.data ?? []).length > CHOICES_MAX,
  };
}
