import type { Db } from "@tacit/db";

import { activeMember } from "./admin.js";
import { withAudit } from "./audit.js";
import { memberNames, readAllPages, requireSetupAdmin, requireSetupReader } from "./company-setup.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { pickByRef } from "./structure.js";

/**
 * The kinds of interview a company runs and who runs each (interview_types,
 * interviewer_interview_types, tacit-internal 20261031120000_tats_onboarding).
 * Admins write on their own token; admins and the company's own hiring team read
 * (company-setup.ts). A type is archived, never deleted, and its name stays taken
 * while archived, so adding that name again brings the type back under its old
 * id, with who ran it.
 *
 * A row outlives its type being archived and its member leaving, so the list
 * shows a member only while they are active, and an archived type only on request.
 */

export const INTERVIEW_TYPE_NAME_MAX = 100;
const TYPE_READ_MAX = 500;

export type TypeInterviewer = { memberId: string; name: string; prioritized: boolean };

export type InterviewType = {
  typeId: string;
  name: string;
  archived: boolean;
  /** Prioritized first, then by name. */
  interviewers: TypeInterviewer[];
};

type TypeRow = { id: string; name: string; archived_at: string | null };
type AssignmentRow = { actor_id: string; type_id: string; prioritized: boolean };

const typeGone = () => new ClientToolError("not_found", "No interview type by that name or id.");
const nameTaken = () => new ClientToolError("invalid", "Another interview type already has that name, or had it and is archived.");

// With the u flag, the range matches only half of a surrogate pair, which would fail the whole request.
const NOT_ONE_LINE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\ud800-\\udfff]", "u");

/** One line, inner runs of space collapsed. */
export function cleanTypeName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (NOT_ONE_LINE.test(name)) throw new ClientToolError("invalid", "An interview type's name is one line of text.", "name");
  if (!name) throw new ClientToolError("invalid", "An interview type needs a name.", "name");
  if ([...name].length > INTERVIEW_TYPE_NAME_MAX) {
    throw new ClientToolError("invalid", `An interview type's name is at most ${INTERVIEW_TYPE_NAME_MAX} characters.`, "name");
  }
  return name;
}

async function readTypes(db: Db): Promise<TypeRow[]> {
  const { data, error } = await db.from("interview_types").select("id, name, archived_at").order("name").limit(TYPE_READ_MAX);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function findType(db: Db, ref: string): Promise<TypeRow> {
  const row = pickByRef(await readTypes(db), ref);
  if (!row) throw typeGone();
  return row;
}

async function liveType(db: Db, ref: string): Promise<TypeRow> {
  const row = await findType(db, ref);
  if (row.archived_at) throw new ClientToolError("invalid", "That interview type is archived. Bring it back first.");
  return row;
}

export async function listInterviewTypes(db: Db, ctx: ClientToolCtx, input: { includeArchived?: boolean } = {}): Promise<InterviewType[]> {
  await requireSetupReader(db, ctx);
  const [types, rows, names] = await Promise.all([
    readTypes(db),
    readAllPages<AssignmentRow>((from, to) =>
      db.from("interviewer_interview_types").select("actor_id, type_id, prioritized").order("type_id").order("actor_id").range(from, to),
    ),
    memberNames(db),
  ]);
  return types
    .filter((t) => input.includeArchived || !t.archived_at)
    .map((t) => ({
      typeId: t.id,
      name: t.name,
      archived: t.archived_at !== null,
      interviewers: rows
        .filter((r) => r.type_id === t.id && names.has(r.actor_id))
        .map((r) => ({ memberId: r.actor_id, name: names.get(r.actor_id) ?? "", prioritized: r.prioritized }))
        .sort((a, b) => Number(b.prioritized) - Number(a.prioritized) || a.name.localeCompare(b.name)),
    }));
}

export type AddTypeResult = { outcome: "created" | "exists" | "restored"; typeId: string; name: string };

export async function addInterviewType(db: Db, ctx: ClientToolCtx, input: { name: string }): Promise<AddTypeResult> {
  const name = cleanTypeName(input.name);
  requireSetupAdmin(ctx, "add interview types");
  const existing = pickByRef(await readTypes(db), name);
  if (existing && !existing.archived_at) return { outcome: "exists", typeId: existing.id, name: existing.name };
  if (existing) {
    return withAudit(db, ctx, { action: "interview_type.restore", entity: "interview_type" }, async () => {
      const { data, error } = await db
        .from("interview_types").update({ archived_at: null }).eq("id", existing.id).not("archived_at", "is", null).select("id");
      if (error) throw new Error(error.message);
      const ok = !!data?.length;
      return {
        result: { outcome: ok ? ("restored" as const) : ("exists" as const), typeId: existing.id, name: existing.name },
        entityId: existing.id,
        before: { archived: true },
        after: { archived: false },
        changed: ok,
      };
    });
  }
  return withAudit<AddTypeResult>(db, ctx, { action: "interview_type.create", entity: "interview_type" }, async () => {
    const { data, error } = await db.from("interview_types").insert({ name }).select("id").single();
    // JavaScript's and Postgres's lowercase differ on a few letters, and two admins can race.
    if (error?.code === "23505") throw nameTaken();
    if (error) throw new Error(error.message);
    return { result: { outcome: "created", typeId: data.id, name }, entityId: data.id, after: { name }, changed: true };
  });
}

export async function renameInterviewType(
  db: Db,
  ctx: ClientToolCtx,
  input: { type: string; name: string },
): Promise<{ outcome: "renamed" | "unchanged"; typeId: string }> {
  const name = cleanTypeName(input.name);
  requireSetupAdmin(ctx, "rename interview types");
  const types = await readTypes(db);
  const row = pickByRef(types, input.type);
  if (!row) throw typeGone();
  if (row.name === name) return { outcome: "unchanged", typeId: row.id };
  const clash = pickByRef(types, name);
  if (clash && clash.id !== row.id) throw nameTaken();
  return withAudit(db, ctx, { action: "interview_type.update", entity: "interview_type" }, async () => {
    const { data, error } = await db.from("interview_types").update({ name }).eq("id", row.id).select("id");
    if (error?.code === "23505") throw nameTaken();
    if (error) throw new Error(error.message);
    const ok = !!data?.length;
    return {
      result: { outcome: ok ? ("renamed" as const) : ("unchanged" as const), typeId: row.id },
      entityId: row.id,
      before: { name: row.name },
      after: { name },
      changed: ok,
    };
  });
}

/** Archives a type, or with `archived: false` brings it back. Who ran it is kept either way. */
export async function archiveInterviewType(
  db: Db,
  ctx: ClientToolCtx,
  input: { type: string; archived?: boolean },
): Promise<{ outcome: "changed" | "unchanged"; typeId: string; archived: boolean }> {
  requireSetupAdmin(ctx, "archive interview types");
  const archived = input.archived ?? true;
  const row = await findType(db, input.type);
  if ((row.archived_at !== null) === archived) return { outcome: "unchanged", typeId: row.id, archived };
  return withAudit(db, ctx, { action: "interview_type.update", entity: "interview_type" }, async () => {
    const { data, error } = await db
      .from("interview_types").update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", row.id).select("id");
    if (error) throw new Error(error.message);
    const ok = !!data?.length;
    return {
      result: { outcome: ok ? ("changed" as const) : ("unchanged" as const), typeId: row.id, archived },
      entityId: row.id,
      before: { archived: !archived },
      after: { archived },
      changed: ok,
    };
  });
}

export type AssignResult = { outcome: "assigned" | "already_assigned"; typeId: string };

/** Says a member runs a type. A second assign changes nothing, so a star stays. */
export async function assignInterviewType(db: Db, ctx: ClientToolCtx, input: { type: string; memberId: string }): Promise<AssignResult> {
  requireSetupAdmin(ctx, "say who runs an interview type");
  const type = await liveType(db, input.type);
  const who = await activeMember(db, input.memberId);
  return withAudit<AssignResult>(db, ctx, { action: "interview_type.assign", entity: "interview_type" }, async () => {
    const { error } = await db.from("interviewer_interview_types").insert({ actor_id: who.id, type_id: type.id });
    if (error && error.code !== "23505") throw new Error(error.message);
    return {
      result: { outcome: error ? "already_assigned" : "assigned", typeId: type.id },
      entityId: type.id,
      after: { actor_id: who.id },
      changed: !error,
    };
  });
}

/** Takes a member off a type. Works on an archived type, and for someone who has left. */
export async function unassignInterviewType(
  db: Db,
  ctx: ClientToolCtx,
  input: { type: string; memberId: string },
): Promise<{ outcome: "unassigned" | "not_assigned"; typeId: string }> {
  requireSetupAdmin(ctx, "say who runs an interview type");
  const type = await findType(db, input.type);
  return withAudit(db, ctx, { action: "interview_type.unassign", entity: "interview_type" }, async () => {
    const { data, error } = await db
      .from("interviewer_interview_types").delete().eq("type_id", type.id).eq("actor_id", input.memberId).select("actor_id");
    if (error) throw new Error(error.message);
    const removed = !!data?.length;
    return {
      result: { outcome: removed ? ("unassigned" as const) : ("not_assigned" as const), typeId: type.id },
      entityId: type.id,
      after: { actor_id: input.memberId },
      changed: removed,
    };
  });
}

/** Stars or unstars someone who runs the type. Several people may be starred on one type. */
export async function prioritizeInterviewType(
  db: Db,
  ctx: ClientToolCtx,
  input: { type: string; memberId: string; prioritized: boolean },
): Promise<{ outcome: "changed" | "unchanged"; typeId: string }> {
  requireSetupAdmin(ctx, "say who to prefer for an interview type");
  const type = await liveType(db, input.type);
  const { data: row, error: readError } = await db
    .from("interviewer_interview_types").select("prioritized").eq("type_id", type.id).eq("actor_id", input.memberId).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row) throw new ClientToolError("not_found", "They do not run that interview type yet. Assign them first.");
  if (row.prioritized === input.prioritized) return { outcome: "unchanged", typeId: type.id };
  return withAudit(db, ctx, { action: "interview_type.prioritize", entity: "interview_type" }, async () => {
    const { data, error } = await db
      .from("interviewer_interview_types")
      .update({ prioritized: input.prioritized })
      .eq("type_id", type.id)
      .eq("actor_id", input.memberId)
      .select("actor_id");
    if (error) throw new Error(error.message);
    const ok = !!data?.length;
    return {
      result: { outcome: ok ? ("changed" as const) : ("unchanged" as const), typeId: type.id },
      entityId: type.id,
      after: { actor_id: input.memberId, prioritized: input.prioritized },
      changed: ok,
    };
  });
}
