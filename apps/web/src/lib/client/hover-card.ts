import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { HoverCardData, HoverRow } from "@/lib/hover-card";
import { stageLabel } from "./crm-views";
import { readProfiles } from "./interviewers";
import { CHANNEL_LABELS, PREFERENCE_LABELS, awayLabel, type StoredProfile } from "./interviewer-profile";
import { countLoad, weekBounds } from "./interviewer-load";
import { isClosedStage } from "./past-applications";
import { ago } from "./pipeline-columns";
import type { ClientContext } from "./session";
import { toolCtx } from "./tool-ctx";

// What a hover card says, read on the member's OWN client (never a privileged
// one), so a line is there only when the policies gave it: an interviewer
// (`limited`) gets the five-field card and no jobs, an external recruiter their
// own adds, and someone in another company is nobody, the same answer as no such
// person. Nothing is filtered here. The answer is an allow-list: the card never
// carries an email, a note, a file or feedback, and the prototype's Testbench
// and Grokbot rows have nothing behind them, so they are not drawn.

type Member = Pick<ClientContext, "db" | "actorId" | "accessLevel" | "org">;
type Application = clientTools.CandidateDetail["applications"][number];

/** The job a card talks about: a live one before a closed one, the latest touched first. */
export function leadApplication(apps: Application[]): Application | null {
  return [...apps].sort((a, b) => Number(isClosedStage(a.stage)) - Number(isClosedStage(b.stage)) || Date.parse(b.lastTouchAt) - Date.parse(a.lastTouchAt))[0] ?? null;
}

const sourceText = (a: Application) => {
  const source = a.source.replace(/_/g, " ");
  return `${source.charAt(0).toUpperCase()}${source.slice(1)}`;
};

export type LeadFacts = { team: string | null; owner: string | null; interviewer: string | null };

/** The card from what the reads brought back, pure. */
export function candidateCard(c: clientTools.CandidateDetail, facts: LeadFacts, now: number): HoverCardData {
  const lead = leadApplication(c.applications);
  const rows: HoverRow[] = [];
  if (lead) {
    const others = c.applications.length - 1;
    rows.push({ label: "Role", value: lead.jobTitle ?? "Untitled job", ...(others > 0 ? { faint: `+${others} more` } : {}) });
    rows.push({ label: "Source", value: sourceText(lead), ...(lead.sourceDetail ? { faint: lead.sourceDetail } : {}) });
  }
  if (facts.team) rows.push({ label: "Team", value: facts.team });
  if (facts.owner) rows.push({ label: "Owner", value: facts.owner });
  if (facts.interviewer) rows.push({ label: "Interviewer", value: facts.interviewer });
  return {
    kind: "candidate",
    name: c.name?.trim() || "Unnamed",
    line: [c.headline, c.location].filter(Boolean).join(" · ") || null,
    state: lead ? { stage: stageLabel(lead.stage), note: `touched ${ago(lead.lastTouchAt, now)}` } : null,
    rows,
    link: { href: `/client/candidates/${c.candidateId}`, label: "Open" },
  };
}

const memberName = async (db: Db, id: string | null | undefined): Promise<string | null> => {
  if (!id) return null;
  const { data, error } = await db.from("org_members").select("display_name").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.display_name?.trim() || null;
};

/** The lead job's team, owner and interviewer: each is whatever the policies return, and nothing when they return nothing. */
async function leadFacts(db: Db, lead: Application, now: number): Promise<LeadFacts> {
  const [app, job, interviews] = await Promise.all([
    db.from("applications").select("owner_actor_id").eq("id", lead.applicationId).maybeSingle(),
    db.from("roles").select("department_id").eq("id", lead.jobId).maybeSingle(),
    db.from("interviews").select("interviewer_actor_ids, starts_at, status").eq("application_id", lead.applicationId).neq("status", "cancelled").order("starts_at", { ascending: false }).limit(50),
  ]);
  for (const r of [app, job, interviews]) if (r.error) throw new Error(r.error.message);
  const rows = interviews.data ?? [];
  const ahead = rows.filter((i) => i.status === "scheduled" && Date.parse(i.starts_at) >= now);
  // The next one coming up, else the latest.
  const pick = ahead[ahead.length - 1] ?? rows[0];
  const departmentId = job.data?.department_id;
  const [department, owner, interviewer] = await Promise.all([
    departmentId ? db.from("departments").select("name").eq("id", departmentId).maybeSingle() : null,
    memberName(db, app.data?.owner_actor_id),
    memberName(db, pick?.interviewer_actor_ids?.[0]),
  ]);
  if (department?.error) throw new Error(department.error.message);
  return { team: department?.data?.name ?? null, owner, interviewer };
}

/** Null is nobody by that id the member can see. */
export async function readCandidateCard(member: Member, candidateId: string, now: number): Promise<HoverCardData | null> {
  let candidate: clientTools.CandidateDetail;
  try {
    candidate = await clientTools.getCandidate(member.db, toolCtx(member), candidateId);
  } catch (err) {
    if (err instanceof clientTools.ClientToolError && err.code === "not_found") return null;
    throw err;
  }
  const lead = leadApplication(candidate.applications);
  const facts = lead ? await leadFacts(member.db, lead, now) : { team: null, owner: null, interviewer: null };
  return candidateCard(candidate, facts, now);
}

export type MemberFacts = { title: string | null; teams: string[]; profile: StoredProfile | null; thisWeek: number };

/**
 * The card from what the reads brought back, pure. A member with no profile the
 * reader may read has no lines. Its labels are the Interviewers page's words
 * (Skills, Reach on), so the card and the page name a thing the same way.
 */
export function memberCard(name: string | null, facts: MemberFacts, link: HoverCardData["link"], now: Date): HoverCardData {
  const p = facts.profile;
  const rows: HoverRow[] = [];
  if (p) {
    const load = awayLabel(p.awayUntil, now) ?? (p.weeklyCap !== null ? `${facts.thisWeek} of ${p.weeklyCap} this week` : `${facts.thisWeek} this week`);
    rows.push(p.preference ? { label: "Interviews", value: PREFERENCE_LABELS[p.preference], faint: load } : { label: "Interviews", value: load });
    if (p.focusAreas.length) rows.push({ label: "Skills", value: p.focusAreas.join(", ") });
    if (p.channel) rows.push({ label: "Reach on", value: CHANNEL_LABELS[p.channel] });
  }
  return { kind: "member", name: name?.trim() || "Unnamed member", line: [facts.title, ...facts.teams].filter(Boolean).join(" · ") || null, state: null, rows, link };
}

async function teamsOf(db: Db, id: string): Promise<string[]> {
  const { data, error } = await db.from("department_members").select("department_id").eq("actor_id", id);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((r) => r.department_id);
  if (!ids.length) return [];
  const departments = await db.from("departments").select("name").in("id", ids).is("archived_at", null).order("name");
  if (departments.error) throw new Error(departments.error.message);
  return (departments.data ?? []).map((d) => d.name);
}

/** Interviews this calendar week the reader can read: the Interviewers page's count, so a hiring manager's is their own jobs'. */
async function weekCount(db: Db, id: string, now: Date): Promise<number> {
  const { thisWeek, nextWeek } = weekBounds(now);
  const { data, error } = await db
    .from("interviews")
    .select("starts_at, interviewer_actor_ids")
    .contains("interviewer_actor_ids", [id])
    .neq("status", "cancelled")
    .gte("starts_at", new Date(thisWeek).toISOString())
    .lt("starts_at", new Date(nextWeek).toISOString())
    .limit(200);
  if (error) throw new Error(error.message);
  const loads = (data ?? []).map((i) => ({ startsAt: i.starts_at, interviewerIds: i.interviewer_actor_ids ?? [], roleId: "" }));
  return countLoad(loads, now).get(id)?.thisWeek ?? 0;
}

/** Null is nobody by that id on the member's own team. */
export async function readMemberCard(member: Member, id: string, now: Date): Promise<HoverCardData | null> {
  const { db } = member;
  const { data, error } = await db.from("org_members").select("id, display_name").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) return null;
  const [profiles, title, teams] = await Promise.all([
    readProfiles(db, [id]),
    db.from("interviewer_profiles").select("title").eq("actor_id", id).maybeSingle(),
    teamsOf(db, id),
  ]);
  if (title.error) throw new Error(title.error.message);
  const profile = profiles.get(id) ?? null;
  const thisWeek = profile ? await weekCount(db, id, now) : 0;
  const link = member.accessLevel === "limited" ? null : { href: "/client/interviewers", label: "See interviewers" };
  return memberCard(data.display_name, { title: title.data?.title ?? null, teams, profile, thisWeek }, link, now);
}
