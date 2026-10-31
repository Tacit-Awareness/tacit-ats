"use server";

import { revalidatePath } from "next/cache";
import { clientTools } from "@tacit-ats/core";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { GONE, stepRefusal, type Refused, type StepAnswer } from "../step-refusal";

// The Teams step's writes: clientTools' audited team tools on the member's own
// client, source `dashboard`. Each tick saves at once and answers the page, which
// stays put. The tools refuse anyone but an admin and the policies decide again.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// The checklist beside every step counts teams, and the Interviewers page names
// them. A refusal refreshes too: it usually means the page is out of date.
const refresh = () => {
  revalidatePath("/client/onboarding", "layout");
  revalidatePath("/client/interviewers");
};

export async function setTeamMemberAction(input: { teamId: string; memberId: string; on: boolean }): Promise<StepAnswer> {
  const member = await requireClient();
  if (!isId(input?.teamId) || !isId(input.memberId) || typeof input.on !== "boolean") return { ok: false, error: GONE };
  const change = { department: input.teamId, memberId: input.memberId };
  try {
    const changed = input.on
      ? (await clientTools.addTeamMember(member.db, toolCtx(member), change)).outcome === "added"
      : (await clientTools.removeTeamMember(member.db, toolCtx(member), change)).outcome === "removed";
    refresh();
    return { ok: true, changed };
  } catch (err) {
    refresh();
    return stepRefusal(err, "changing who is on a team");
  }
}

export async function setTeamLeadAction(input: { teamId: string; memberId: string | null }): Promise<StepAnswer> {
  const member = await requireClient();
  if (!isId(input?.teamId) || (input.memberId !== null && !isId(input.memberId))) return { ok: false, error: GONE };
  try {
    const { outcome } = await clientTools.setTeamLead(member.db, toolCtx(member), { department: input.teamId, memberId: input.memberId });
    refresh();
    return { ok: true, changed: outcome === "changed" };
  } catch (err) {
    refresh();
    return stepRefusal(err, "changing a team's lead");
  }
}

export async function createTeamAction(input: { name: string }): Promise<{ ok: true; outcome: "created" | "exists" | "restored" } | Refused> {
  const member = await requireClient();
  try {
    const { outcome } = await clientTools.createDepartment(member.db, toolCtx(member), { name: typeof input?.name === "string" ? input.name : "" });
    refresh();
    return { ok: true, outcome };
  } catch (err) {
    return stepRefusal(err, "making a team");
  }
}
