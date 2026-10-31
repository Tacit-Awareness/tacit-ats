"use server";

import { revalidatePath } from "next/cache";
import { clientTools } from "@tacit-ats/core";
import { FOCUS_AREAS_MAX, FOCUS_AREA_MAX } from "@/lib/client/interviewer-profile";
import { saveFocusAreas } from "@/lib/client/onboarding-teams";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { GONE, stepRefusal, type Refused, type StepAnswer } from "../step-refusal";

// The Interview skills step's writes: clientTools' audited tools on the member's
// own client, source `dashboard`. Each saves at once and answers the page, which
// stays put. The interview type tools refuse anyone but an admin. A profile's own
// rule is wider, anyone their own, and that stays on the Interviewers page: this
// step is an admin's, so skills are checked for that here.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// A refusal refreshes too: it usually means the page is out of date.
const refresh = () => {
  revalidatePath("/client/onboarding", "layout");
  revalidatePath("/client/interviewers");
};

const STALE = "Someone else just changed this person's profile, so this wasn't saved. Here's what it says now. Add yours again.";
const SKILLS_INVALID = `Keep it to ${FOCUS_AREAS_MAX} skills, each ${FOCUS_AREA_MAX} characters at most.`;

export async function saveSkillsAction(input: { memberId: string; version: string | null; skills: string[] }): Promise<StepAnswer> {
  const member = await requireClient();
  if (member.accessLevel !== "admin") return { ok: false, error: "Only an admin can change skills here. Your own are on the Interviewers page." };
  if (!isId(input?.memberId)) return { ok: false, error: GONE };
  if (!Array.isArray(input.skills) || !input.skills.every((s) => typeof s === "string")) return { ok: false, error: SKILLS_INVALID };
  if (input.version !== null && typeof input.version !== "string") return { ok: false, error: STALE };
  try {
    const { outcome } = await saveFocusAreas(member.db, toolCtx(member), { memberId: input.memberId, expectedUpdatedAt: input.version, focusAreas: input.skills });
    refresh();
    if (outcome === "stale") return { ok: false, error: STALE };
    return { ok: true, changed: outcome === "changed" };
  } catch (err) {
    refresh();
    if (err instanceof clientTools.ClientToolError && err.code === "invalid") return { ok: false, error: SKILLS_INVALID };
    return stepRefusal(err, "saving someone's skills");
  }
}

export async function addTypeAction(input: { name: string }): Promise<{ ok: true; outcome: "created" | "exists" | "restored" } | Refused> {
  const member = await requireClient();
  try {
    const { outcome } = await clientTools.addInterviewType(member.db, toolCtx(member), { name: typeof input?.name === "string" ? input.name : "" });
    refresh();
    return { ok: true, outcome };
  } catch (err) {
    return stepRefusal(err, "adding an interview type");
  }
}

export async function renameTypeAction(input: { typeId: string; name: string }): Promise<StepAnswer> {
  const member = await requireClient();
  if (!isId(input?.typeId)) return { ok: false, error: GONE };
  try {
    const { outcome } = await clientTools.renameInterviewType(member.db, toolCtx(member), { type: input.typeId, name: typeof input.name === "string" ? input.name : "" });
    refresh();
    return { ok: true, changed: outcome === "renamed" };
  } catch (err) {
    return stepRefusal(err, "renaming an interview type");
  }
}

export async function archiveTypeAction(input: { typeId: string }): Promise<StepAnswer> {
  const member = await requireClient();
  if (!isId(input?.typeId)) return { ok: false, error: GONE };
  try {
    const { outcome } = await clientTools.archiveInterviewType(member.db, toolCtx(member), { type: input.typeId });
    refresh();
    return { ok: true, changed: outcome === "changed" };
  } catch (err) {
    return stepRefusal(err, "archiving an interview type");
  }
}

export async function setRunAction(input: { typeId: string; memberId: string; on: boolean }): Promise<StepAnswer> {
  const member = await requireClient();
  if (!isId(input?.typeId) || !isId(input.memberId) || typeof input.on !== "boolean") return { ok: false, error: GONE };
  const change = { type: input.typeId, memberId: input.memberId };
  try {
    const changed = input.on
      ? (await clientTools.assignInterviewType(member.db, toolCtx(member), change)).outcome === "assigned"
      : (await clientTools.unassignInterviewType(member.db, toolCtx(member), change)).outcome === "unassigned";
    refresh();
    return { ok: true, changed };
  } catch (err) {
    refresh();
    return stepRefusal(err, "saying who runs an interview type");
  }
}

export async function setStarAction(input: { typeId: string; memberId: string; starred: boolean }): Promise<StepAnswer> {
  const member = await requireClient();
  if (!isId(input?.typeId) || !isId(input.memberId) || typeof input.starred !== "boolean") return { ok: false, error: GONE };
  try {
    const { outcome } = await clientTools.prioritizeInterviewType(member.db, toolCtx(member), { type: input.typeId, memberId: input.memberId, prioritized: input.starred });
    refresh();
    return { ok: true, changed: outcome === "changed" };
  } catch (err) {
    refresh();
    return stepRefusal(err, "starring an interviewer");
  }
}
