import type { Db } from "@tacit/db";

import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * What teams.ts, interview-types.ts and process.ts share: who may read a
 * company's setup (tacit-internal 20261031120000_tats_onboarding). The tables
 * are read by whoever can_see_prospects(): admins and the company's own elevated
 * members. That is narrower than the access level, because an external recruiter
 * is elevated too. Their read is not refused, it comes back empty, so without
 * this check a process "not drawn yet" and one they may not see would be the
 * same answer. The check makes the answer honest; the policies still decide.
 */

const PAGE = 1000;

/** Whether this member reads the company's setup. Asks only when the level does not settle it. */
export async function seesCompanySetup(db: Db, ctx: Pick<ClientToolCtx, "accessLevel">): Promise<boolean> {
  if (ctx.accessLevel === "admin") return true;
  if (ctx.accessLevel === "limited") return false;
  const { data, error } = await db.rpc("can_see_prospects");
  if (error) throw new Error(error.message);
  return data === true;
}

export async function requireSetupReader(db: Db, ctx: ClientToolCtx): Promise<void> {
  if (!(await seesCompanySetup(db, ctx))) {
    throw new ClientToolError("forbidden", "Only your company's admins and hiring team read how it is set up.");
  }
}

export function requireSetupAdmin(ctx: ClientToolCtx, what: string): void {
  if (ctx.accessLevel !== "admin") throw new ClientToolError("forbidden", `Only an admin at your company can ${what}.`);
}

/** Every page of a read: one request stops at the database's 1000 rows. Order by something unique. */
export async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

/** The active members of the caller's org, by id: org_members leaves out anyone archived. */
export async function memberNames(db: Db): Promise<Map<string, string>> {
  const rows = await readAllPages((from, to) => db.from("org_members").select("id, display_name").order("id").range(from, to));
  const names = new Map<string, string>();
  for (const r of rows) if (r.id) names.set(r.id, r.display_name ?? "");
  return names;
}
