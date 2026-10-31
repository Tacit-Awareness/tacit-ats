import { cache } from "react";
import type { Db } from "@tacit/db";
import { clientTools, listPendingInvites } from "@tacit-ats/core";
import { scanRows } from "./interviewers";
import { readMembers } from "./member-access";
import type { AccessLevel } from "./session";
import { processSummary, setupChecklist, type Checklist } from "./setup-checklist";

// What Onboarding reads, on the member's own token. Admins edit; the company's
// own hiring team reads; an interviewer and an external recruiter, who is
// elevated too and is refused these tables by can_see_prospects(), get the
// pointer home, so "nothing set up yet" is never said to someone who may not know.

export type OnboardingAccess = "edit" | "read" | "none";

export const onboardingAccess = cache(async (db: Db, accessLevel: AccessLevel): Promise<OnboardingAccess> => {
  if (!(await clientTools.seesCompanySetup(db, { accessLevel }))) return "none";
  return accessLevel === "admin" ? "edit" : "read";
});

/**
 * The checklist, from what the company has set up. Filtering what a row outlives
 * is the core tools'. A Tacit teammate who submitted into this org is an org_members
 * row like anyone else and no member's token can tell them apart, so they count as
 * a person here: Teams and Interview skills want them placed too.
 */
export async function readChecklist(db: Db, ctx: clientTools.ClientToolCtx): Promise<Checklist> {
  const [members, teams, types, process] = await Promise.all([
    readMembers(db),
    clientTools.listTeams(db, ctx),
    clientTools.listInterviewTypes(db, ctx),
    clientTools.getProcess(db, ctx),
  ]);
  return setupChecklist({
    people: members.rows.flatMap((m) => (m.id ? [m.id] : [])),
    teams: teams.map((t) => ({ members: t.members.map((m) => m.memberId) })),
    types: types.map((t) => ({ interviewers: t.interviewers.map((i) => i.memberId) })),
    process: process ? processSummary(process.graph) : null,
  });
}

/** Whose title the member may read: the policies give an admin and the hiring team everyone's, anyone else their own. */
export async function readTitles(db: Db): Promise<Record<string, string>> {
  const { rows } = await scanRows((from, to) =>
    db.from("interviewer_profiles").select("actor_id, title").not("title", "is", null).order("actor_id").range(from, to),
  );
  return Object.fromEntries(rows.flatMap((r) => (r.title ? [[r.actor_id, r.title]] : [])));
}

export type PeopleList = {
  /** Signed in: invited people are in `pending`, for an admin. */
  members: Array<{ id: string; display_name: string; email: string | null; access_level: string }>;
  truncated: boolean;
  pending: Awaited<ReturnType<typeof listPendingInvites>>;
  titles: Record<string, string>;
};

/** The team list, for People and for the Interviewers page's external recruiter. Only an admin reads who is invited. */
export async function readPeople(db: Db, isAdmin: boolean): Promise<PeopleList> {
  const [team, pending, titles] = await Promise.all([readMembers(db), isAdmin ? listPendingInvites(db) : Promise.resolve([]), readTitles(db)]);
  const invited = new Set(pending.map((p) => p.actorId));
  return { members: team.rows.filter((m) => m.id && !invited.has(m.id)) as PeopleList["members"], truncated: team.truncated, pending, titles };
}
