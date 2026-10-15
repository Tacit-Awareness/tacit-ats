import type { Db } from "@tacit/db";

import { withAudit } from "./audit.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * Departments and offices for the client connector
 * (20261016130000_client_org_structure). Same rules as the rest of
 * client-tools: the member's own client, and the policies decide. Both are
 * read by every member above interviewer and made, renamed and archived by
 * admins; nothing deletes one. A department may sit inside another, never
 * inside itself (the database refuses that too).
 *
 * Each is named by its id or its name, ignoring case: the model usually has
 * the name from the user, and an org has tens of them, so they are read whole
 * and matched here, as tags are.
 */

export const DEPARTMENT_NAME_MAX = 100;
export const OFFICE_NAME_MAX = 100;
export const OFFICE_LOCATION_MAX = 200;
const STRUCTURE_READ_MAX = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Department = {
  departmentId: string;
  name: string;
  parentId: string | null;
  /** Outermost first, ending with this one: "Engineering > Platform". */
  path: string;
  archived: boolean;
  /** How many of the jobs the member can see are in it (not counting sub-departments). */
  jobs: number;
};

export type Office = {
  officeId: string;
  name: string;
  location: string | null;
  archived: boolean;
  /** How many of the jobs the member can see are in it. */
  jobs: number;
};

type DepartmentRow = { id: string; name: string; parent_id: string | null; archived_at: string | null };
type OfficeRow = { id: string; name: string; location: string | null; archived_at: string | null };

const notForInterviewers = () =>
  new ClientToolError("forbidden", "Interviewers do not see your company's departments or offices.");
const notAdmin = (what: string) => new ClientToolError("forbidden", `Only an admin at your company can ${what}.`);

/** Collapses inner whitespace; the columns refuse surrounding spaces. */
function cleanName(raw: string, max: number, what: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new ClientToolError("invalid", `A ${what} needs a name.`);
  if (name.length > max) throw new ClientToolError("invalid", `A ${what}'s name is at most ${max} characters.`);
  return name;
}

function cleanLocation(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  const v = raw?.trim().replace(/\s+/g, " ") || null;
  if (v && v.length > OFFICE_LOCATION_MAX) throw new ClientToolError("invalid", `A location is at most ${OFFICE_LOCATION_MAX} characters.`);
  return v;
}

/** The row a member named, by id or by name ignoring case; archived ones included. */
export function pickByRef<T extends { id: string; name: string }>(rows: T[], ref: string): T | null {
  const wanted = ref.trim();
  if (!wanted) return null;
  if (UUID.test(wanted)) return rows.find((r) => r.id === wanted.toLowerCase()) ?? null;
  const key = wanted.replace(/\s+/g, " ").toLowerCase();
  return rows.find((r) => r.name.toLowerCase() === key) ?? null;
}

export async function readDepartments(db: Db): Promise<DepartmentRow[]> {
  const { data, error } = await db
    .from("departments").select("id, name, parent_id, archived_at").order("name").limit(STRUCTURE_READ_MAX);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function readOffices(db: Db): Promise<OfficeRow[]> {
  const { data, error } = await db
    .from("offices").select("id, name, location, archived_at").order("name").limit(STRUCTURE_READ_MAX);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function pathOf(rows: DepartmentRow[], row: DepartmentRow): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const names = [row.name];
  const seen = new Set([row.id]);
  for (let p = row.parent_id; p && !seen.has(p); p = byId.get(p)?.parent_id ?? null) {
    seen.add(p);
    const parent = byId.get(p);
    if (!parent) break;
    names.unshift(parent.name);
  }
  return names.join(" > ");
}

/** This department and every one inside it, at any depth. */
export function departmentAndBelow(rows: DepartmentRow[], id: string): string[] {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of rows) {
      if (r.parent_id && out.has(r.parent_id) && !out.has(r.id)) {
        out.add(r.id);
        grew = true;
      }
    }
  }
  return [...out];
}

/** Would putting `id` inside `parentId` make it sit inside itself? */
function wouldLoop(rows: DepartmentRow[], id: string, parentId: string): boolean {
  return departmentAndBelow(rows, id).includes(parentId);
}

/** A patch as the audit row records it: archived as a flag, not a time. */
function forAudit(patch: Record<string, unknown>): Record<string, unknown> {
  const { archived_at, ...rest } = patch;
  return archived_at === undefined ? rest : { ...rest, archived: archived_at !== null };
}

const departmentNotFound = () =>
  new ClientToolError("not_found", "No department by that name or id. list_departments has them.");
const officeNotFound = () => new ClientToolError("not_found", "No office by that name or id. list_offices has them.");

/** A live department for a job, by id or name; `keep` is the one the job already has, archived or not. */
export async function liveDepartment(db: Db, ref: string, keep?: string | null): Promise<{ id: string; name: string }> {
  const rows = await readDepartments(db);
  const row = pickByRef(rows, ref);
  if (!row) throw departmentNotFound();
  if (row.archived_at && row.id !== keep) {
    throw new ClientToolError("invalid", "That department is archived. Pick another from list_departments.");
  }
  return { id: row.id, name: row.name };
}

/** Live offices for a job, by id or name, each once, in the order given; `keep` are the ones it already has. */
export async function liveOffices(db: Db, refs: string[], keep: string[] = []): Promise<Array<{ id: string; name: string }>> {
  if (!refs.length) return [];
  const rows = await readOffices(db);
  const out = new Map<string, string>();
  for (const ref of refs) {
    const row = pickByRef(rows, ref);
    if (!row) throw officeNotFound();
    if (row.archived_at && !keep.includes(row.id)) {
      throw new ClientToolError("invalid", "That office is archived. Pick another from list_offices.");
    }
    out.set(row.id, row.name);
  }
  return [...out].map(([id, name]) => ({ id, name }));
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export async function listDepartments(db: Db, ctx: ClientToolCtx, input: { includeArchived?: boolean } = {}): Promise<Department[]> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  // The embedded count runs under the roles policy: only jobs the member can see.
  const { data, error } = await db
    .from("departments").select("id, name, parent_id, archived_at, roles(count)").order("name").limit(STRUCTURE_READ_MAX)
    .overrideTypes<Array<DepartmentRow & { roles?: Array<{ count: number }> }>, { merge: false }>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return rows
    .filter((r) => input.includeArchived || !r.archived_at)
    .map((r) => ({
      departmentId: r.id,
      name: r.name,
      parentId: r.parent_id,
      path: pathOf(rows, r),
      archived: r.archived_at !== null,
      jobs: r.roles?.[0]?.count ?? 0,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export type StructureResult = { outcome: "created" | "exists" | "restored"; id: string; name: string };

export async function createDepartment(
  db: Db,
  ctx: ClientToolCtx,
  input: { name: string; parent?: string | null },
): Promise<StructureResult & { parent: string | null }> {
  const name = cleanName(input.name, DEPARTMENT_NAME_MAX, "department");
  if (ctx.accessLevel !== "admin") throw notAdmin("make departments");
  const rows = await readDepartments(db);
  let parent: DepartmentRow | null = null;
  if (input.parent?.trim()) {
    parent = pickByRef(rows, input.parent);
    if (!parent) throw departmentNotFound();
    if (parent.archived_at) throw new ClientToolError("invalid", "That parent department is archived. Bring it back with update_department first.");
  }
  const existing = pickByRef(rows, name);
  if (existing && !existing.archived_at) {
    const parentName = rows.find((r) => r.id === existing.parent_id)?.name ?? null;
    return { outcome: "exists", id: existing.id, name: existing.name, parent: parentName };
  }
  if (existing) {
    return withAudit(db, ctx, { action: "department.restore", entity: "department" }, async () => {
      const { data, error } = await db
        .from("departments").update({ archived_at: null }).eq("id", existing.id).not("archived_at", "is", null).select("id");
      if (error) throw new Error(error.message);
      const ok = !!data?.length;
      return {
        result: { outcome: ok ? ("restored" as const) : ("exists" as const), id: existing.id, name: existing.name, parent: null },
        entityId: existing.id,
        before: { archived: true },
        after: { archived: false },
        changed: ok,
      };
    });
  }
  return withAudit(db, ctx, { action: "department.create", entity: "department" }, async () => {
    // Made here and not read back, as every new row a member inserts.
    const id = globalThis.crypto.randomUUID();
    const { error } = await db.from("departments").insert({ id, name, parent_id: parent?.id ?? null });
    if (error?.code === "23505") throw new ClientToolError("invalid", "A department by that name was made just now. Call list_departments.");
    if (error) throw new Error(error.message);
    return {
      result: { outcome: "created" as const, id, name, parent: parent?.name ?? null },
      entityId: id,
      after: { name, parent_id: parent?.id ?? null },
      changed: true,
    };
  });
}

export async function updateDepartment(
  db: Db,
  ctx: ClientToolCtx,
  input: { department: string; name?: string; parent?: string | null; archived?: boolean },
): Promise<{ outcome: "updated" | "unchanged"; departmentId: string; changed: string[] }> {
  const name = input.name === undefined ? undefined : cleanName(input.name, DEPARTMENT_NAME_MAX, "department");
  if (ctx.accessLevel !== "admin") throw notAdmin("change departments");
  const rows = await readDepartments(db);
  const row = pickByRef(rows, input.department);
  if (!row) throw departmentNotFound();

  const patch: { name?: string; parent_id?: string | null; archived_at?: string | null } = {};
  if (name !== undefined && name !== row.name) {
    const clash = pickByRef(rows, name);
    if (clash && clash.id !== row.id) throw new ClientToolError("invalid", "Another department already has that name.");
    patch.name = name;
  }
  if (input.parent !== undefined) {
    let parentId: string | null = null;
    if (input.parent?.trim()) {
      const parent = pickByRef(rows, input.parent);
      if (!parent) throw departmentNotFound();
      if (parent.archived_at && parent.id !== row.parent_id) {
        throw new ClientToolError("invalid", "That parent department is archived. Bring it back first.");
      }
      if (wouldLoop(rows, row.id, parent.id)) throw new ClientToolError("invalid", "A department cannot sit inside itself or one of its own.");
      parentId = parent.id;
    }
    if (parentId !== row.parent_id) patch.parent_id = parentId;
  }
  if (input.archived !== undefined && input.archived !== (row.archived_at !== null)) {
    patch.archived_at = input.archived ? new Date().toISOString() : null;
  }
  const changed = Object.keys(patch).map((k) => (k === "parent_id" ? "parent" : k === "archived_at" ? "archived" : k));
  if (!changed.length) return { outcome: "unchanged", departmentId: row.id, changed: [] };

  return withAudit(db, ctx, { action: "department.update", entity: "department" }, async () => {
    const { data, error } = await db.from("departments").update(patch).eq("id", row.id).select("id");
    if (error?.code === "23505") throw new ClientToolError("invalid", "Another department already has that name.");
    if (error?.code === "22023") throw new ClientToolError("invalid", "A department cannot sit inside itself or one of its own.");
    if (error) throw new Error(error.message);
    const ok = !!data?.length;
    return {
      result: ok
        ? { outcome: "updated" as const, departmentId: row.id, changed }
        : { outcome: "unchanged" as const, departmentId: row.id, changed: [] },
      entityId: row.id,
      before: { name: row.name, parent_id: row.parent_id, archived: row.archived_at !== null },
      after: forAudit(patch),
      changed: ok,
    };
  });
}

// ---------------------------------------------------------------------------
// Offices
// ---------------------------------------------------------------------------

export async function listOffices(db: Db, ctx: ClientToolCtx, input: { includeArchived?: boolean } = {}): Promise<Office[]> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  // The embedded count runs under the job_offices policy: only jobs the member can see.
  let q = db.from("offices").select("id, name, location, archived_at, job_offices(count)").order("name").limit(STRUCTURE_READ_MAX);
  if (!input.includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q.overrideTypes<Array<OfficeRow & { job_offices?: Array<{ count: number }> }>, { merge: false }>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    officeId: r.id,
    name: r.name,
    location: r.location,
    archived: r.archived_at !== null,
    jobs: r.job_offices?.[0]?.count ?? 0,
  }));
}

export async function createOffice(
  db: Db,
  ctx: ClientToolCtx,
  input: { name: string; location?: string | null },
): Promise<StructureResult> {
  const name = cleanName(input.name, OFFICE_NAME_MAX, "office");
  const location = cleanLocation(input.location) ?? null;
  if (ctx.accessLevel !== "admin") throw notAdmin("make offices");
  const rows = await readOffices(db);
  const existing = pickByRef(rows, name);
  if (existing && !existing.archived_at) return { outcome: "exists", id: existing.id, name: existing.name };
  if (existing) {
    return withAudit(db, ctx, { action: "office.restore", entity: "office" }, async () => {
      const { data, error } = await db
        .from("offices").update({ archived_at: null }).eq("id", existing.id).not("archived_at", "is", null).select("id");
      if (error) throw new Error(error.message);
      const ok = !!data?.length;
      return {
        result: { outcome: ok ? ("restored" as const) : ("exists" as const), id: existing.id, name: existing.name },
        entityId: existing.id,
        before: { archived: true },
        after: { archived: false },
        changed: ok,
      };
    });
  }
  return withAudit<StructureResult>(db, ctx, { action: "office.create", entity: "office" }, async () => {
    const id = globalThis.crypto.randomUUID();
    const { error } = await db.from("offices").insert({ id, name, location });
    if (error?.code === "23505") throw new ClientToolError("invalid", "An office by that name was made just now. Call list_offices.");
    if (error) throw new Error(error.message);
    return { result: { outcome: "created" as const, id, name }, entityId: id, after: { name, location }, changed: true };
  });
}

export async function updateOffice(
  db: Db,
  ctx: ClientToolCtx,
  input: { office: string; name?: string; location?: string | null; archived?: boolean },
): Promise<{ outcome: "updated" | "unchanged"; officeId: string; changed: string[] }> {
  const name = input.name === undefined ? undefined : cleanName(input.name, OFFICE_NAME_MAX, "office");
  const location = cleanLocation(input.location);
  if (ctx.accessLevel !== "admin") throw notAdmin("change offices");
  const rows = await readOffices(db);
  const row = pickByRef(rows, input.office);
  if (!row) throw officeNotFound();

  const patch: { name?: string; location?: string | null; archived_at?: string | null } = {};
  if (name !== undefined && name !== row.name) {
    const clash = pickByRef(rows, name);
    if (clash && clash.id !== row.id) throw new ClientToolError("invalid", "Another office already has that name.");
    patch.name = name;
  }
  if (location !== undefined && location !== row.location) patch.location = location;
  if (input.archived !== undefined && input.archived !== (row.archived_at !== null)) {
    patch.archived_at = input.archived ? new Date().toISOString() : null;
  }
  const changed = Object.keys(patch).map((k) => (k === "archived_at" ? "archived" : k));
  if (!changed.length) return { outcome: "unchanged", officeId: row.id, changed: [] };

  return withAudit(db, ctx, { action: "office.update", entity: "office" }, async () => {
    const { data, error } = await db.from("offices").update(patch).eq("id", row.id).select("id");
    if (error?.code === "23505") throw new ClientToolError("invalid", "Another office already has that name.");
    if (error) throw new Error(error.message);
    const ok = !!data?.length;
    return {
      result: ok ? { outcome: "updated" as const, officeId: row.id, changed } : { outcome: "unchanged" as const, officeId: row.id, changed: [] },
      entityId: row.id,
      before: { name: row.name, location: row.location, archived: row.archived_at !== null },
      after: forAudit(patch),
      changed: ok,
    };
  });
}
