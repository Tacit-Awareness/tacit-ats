import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { scanRows } from "./interviewers";
import { isAccessLevel } from "./levels";

// Changing a member's access from the team list: clientTools' audited
// setMemberAccess on the member's own client, the same write as the connector's
// set_member_access (audit_log says source `dashboard`). set_org_member_access
// decides: the caller is an admin, the member is in their org, and the org keeps
// an admin who has signed in. This only turns a refusal into a code for the page.

export type ChangeAccessError = "access_forbidden" | "access_invalid" | "last_admin" | "member_gone" | "rate_limited";
export type ChangeAccessOutcome = { ok: true; changed: boolean } | { ok: false; error: ChangeAccessError };

export async function changeMemberAccess(
  db: Db,
  ctx: clientTools.ClientToolCtx,
  input: { actorId: string; level: unknown },
): Promise<ChangeAccessOutcome> {
  // Checked here so that `invalid` from the tool below can only mean the last admin.
  if (!isAccessLevel(input.level)) return { ok: false, error: "access_invalid" };
  try {
    const { outcome } = await clientTools.setMemberAccess(db, ctx, { userId: input.actorId, access: input.level });
    return { ok: true, changed: outcome === "changed" };
  } catch (err) {
    if (err instanceof clientTools.ClientToolError) {
      if (err.code === "forbidden") return { ok: false, error: "access_forbidden" };
      if (err.code === "invalid") return { ok: false, error: "last_admin" };
      if (err.code === "not_found") return { ok: false, error: "member_gone" };
      if (err.code === "rate_limited") return { ok: false, error: "rate_limited" };
    }
    throw err;
  }
}

/**
 * The team list: org_members on the member's own client, every page of it. One
 * read stops at the database's 1000 rows, which would lose whoever sorts last,
 * a second admin included. Ordered by id too, so no one is lost between pages.
 */
export const readMembers = (db: Db) =>
  scanRows((from, to) => db.from("org_members").select("id, display_name, email, access_level").order("display_name").order("id").range(from, to));

/**
 * The member a change could not lower, when there is exactly one admin: the
 * page shows them no picker. Only a hint, and set_org_member_access refuses
 * regardless: an admin who cannot sign in (a Tacit submitter raised by hand,
 * who is listed here and is no invitation) counts as one here and not there,
 * so that admin's colleague gets a picker and `last_admin` from it. A list that
 * stopped short names nobody, since another admin may be past its end.
 */
export function soleAdmin(members: ReadonlyArray<{ id: string; access_level: string }>, truncated = false): string | null {
  if (truncated) return null;
  const admins = members.filter((m) => m.access_level === "admin");
  return admins.length === 1 ? admins[0].id : null;
}
