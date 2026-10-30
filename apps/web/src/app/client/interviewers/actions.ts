"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ClientInviteError, inviteClientMember, withdrawClientInvite } from "@tacit-ats/core";
import { changeMemberAccess, type ChangeAccessOutcome } from "@/lib/client/member-access";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { clientInvitations } from "@/lib/client/workos";
import type { TeamError, TeamNotice } from "./messages";

// The team's writes. All of them run on the signed-in member's own database
// client: the definer functions behind them decide whether the caller is an
// admin and keep every write inside the org on their token, which is also the
// only org an invitation can be sent into. Nothing from the form names an org.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
};

// Only a code goes in the URL, never a message: a message can carry an email
// address, and a query string ends up in logs and browser history.
const back = (params: { notice?: TeamNotice; error?: TeamError }): never =>
  redirect(`/client/interviewers?${new URLSearchParams(params)}`);

function codeFor(err: unknown, what: string): TeamError {
  if (err instanceof ClientInviteError) return err.code;
  console.error(`[client-team] ${what} failed:`, err instanceof Error ? err.message : err);
  return "failed";
}

export async function inviteAction(form: FormData): Promise<void> {
  const { db, org, user } = await requireClient();
  const level = str(form, "accessLevel");
  let notice: TeamNotice;
  try {
    const invited = await inviteClientMember(db, clientInvitations(), {
      email: str(form, "email"),
      displayName: str(form, "displayName"),
      accessLevel: level === "admin" || level === "elevated" ? level : "limited",
      workosOrgId: org.workosOrgId,
      inviterUserId: user.workosUserId,
    });
    notice = invited.resent ? "resent" : "invited";
  } catch (err) {
    return back({ error: codeFor(err, "the invitation") });
  }
  revalidatePath("/client/interviewers");
  return back({ notice });
}

export async function withdrawAction(form: FormData): Promise<void> {
  const { db, org } = await requireClient();
  const actorId = str(form, "actorId");
  if (!UUID.test(actorId)) return back({ error: "not_found" });
  let withdrawn: boolean;
  try {
    ({ withdrawn } = await withdrawClientInvite(db, clientInvitations(), { actorId, workosOrgId: org.workosOrgId }));
  } catch (err) {
    return back({ error: codeFor(err, "withdrawing an invitation") });
  }
  revalidatePath("/client/interviewers");
  return back(withdrawn ? { notice: "withdrawn" } : { error: "not_found" });
}

// The audited clientTools.setMemberAccess (lib/client/member-access.ts), on the
// member's own client: set_org_member_access checks the caller is an admin,
// keeps the change inside their org and refuses to leave it without an admin.
// The layout too: the sidebar names the level of whoever changed their own.
export async function setAccessAction(form: FormData): Promise<void> {
  const member = await requireClient();
  const actorId = str(form, "actorId");
  if (!UUID.test(actorId)) return back({ error: "member_gone" });
  let outcome: ChangeAccessOutcome;
  try {
    outcome = await changeMemberAccess(member.db, toolCtx(member), { actorId, level: form.get("accessLevel") });
  } catch (err) {
    return back({ error: codeFor(err, "changing someone's access") });
  }
  if (!outcome.ok) return back({ error: outcome.error });
  revalidatePath("/client", "layout");
  return back({ notice: outcome.changed ? "access_changed" : "access_unchanged" });
}
