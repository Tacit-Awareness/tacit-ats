"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ClientInviteError, clientTools, inviteClientMember, withdrawClientInvite } from "@tacit-ats/core";
import { changeMemberAccess, type ChangeAccessOutcome } from "@/lib/client/member-access";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { clientAuthProvider } from "@/lib/client/config";
import { supabaseInvitations } from "@/lib/client/invite-email";
import { clientInvitations } from "@/lib/client/workos";
import type { TeamError, TeamNotice, TitleAnswer, TitleError } from "./messages";

// The team's writes, from Onboarding's People step. All of them run on the
// signed-in member's own database client: the definer functions behind them
// decide whether the caller is an admin and keep every write inside the org on
// their token, which is also the only org an invitation can be sent into.
// Nothing from the form names an org.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
};

// Only a code goes in the URL, never a message: a message can carry an email
// address, and a query string ends up in logs and browser history.
const back = (params: { notice?: TeamNotice; error?: TeamError }): never =>
  redirect(`/client/onboarding/people?${new URLSearchParams(params)}`);

// The checklist beside every step counts people, so the layout goes too.
const refresh = () => {
  revalidatePath("/client/onboarding", "layout");
  revalidatePath("/client/interviewers");
};

// Who sends the email: WorkOS until the cutover, then Supabase Auth. Core passes
// the organization to it as is: WorkOS's for WorkOS, our own org id otherwise.
const invitations = () => (clientAuthProvider() === "supabase" ? supabaseInvitations() : clientInvitations());
const invitationOrg = (org: { id: string; workosOrgId: string | null }) =>
  clientAuthProvider() === "supabase" ? org.id : (org.workosOrgId ?? org.id);

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
    const invited = await inviteClientMember(db, invitations(), {
      email: str(form, "email"),
      displayName: str(form, "displayName"),
      accessLevel: level === "admin" || level === "elevated" ? level : "limited",
      workosOrgId: invitationOrg(org),
      inviterUserId: user.workosUserId ?? undefined,
    });
    notice = invited.resent ? "resent" : "invited";
  } catch (err) {
    return back({ error: codeFor(err, "the invitation") });
  }
  refresh();
  return back({ notice });
}

export async function withdrawAction(form: FormData): Promise<void> {
  const { db, org } = await requireClient();
  const actorId = str(form, "actorId");
  if (!UUID.test(actorId)) return back({ error: "not_found" });
  let withdrawn: boolean;
  try {
    ({ withdrawn } = await withdrawClientInvite(db, invitations(), { actorId, workosOrgId: invitationOrg(org) }));
  } catch (err) {
    return back({ error: codeFor(err, "withdrawing an invitation") });
  }
  refresh();
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

const TITLE_REFUSALS: Partial<Record<clientTools.ClientToolErrorCode, TitleError>> = {
  forbidden: "forbidden",
  not_found: "member_gone",
  rate_limited: "rate_limited",
};

// clientTools' audited setMemberTitle on the member's own client, the policies
// decide: their own at any level, anyone's for an admin. It answers the form and
// redirects nowhere, since a refusal has to leave what they typed, and an
// interviewer saves their own from a page that is not this one.
export async function saveTitleAction(form: FormData): Promise<TitleAnswer> {
  const member = await requireClient();
  const actorId = str(form, "actorId");
  if (!UUID.test(actorId)) return { ok: false, error: "member_gone" };
  try {
    const { outcome } = await clientTools.setMemberTitle(member.db, toolCtx(member), { memberId: actorId, title: str(form, "title") });
    refresh();
    return { ok: true, changed: outcome === "changed" };
  } catch (err) {
    if (err instanceof clientTools.ClientToolError) {
      if (err.code === "invalid") return { ok: false, invalid: err.message };
      const error = TITLE_REFUSALS[err.code];
      if (error) return { ok: false, error };
    }
    console.error("[client-team] saving a title failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "failed" };
  }
}
