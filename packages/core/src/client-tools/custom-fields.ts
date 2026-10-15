import type { Db, Json, TablesInsert, TablesUpdate } from "@tacit/db";

import { parseDueDate } from "../pipeline/pipeline.js";
import { withAudit } from "./audit.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * Custom fields for the client connector (20261016120000_client_custom_fields).
 * Same rules as the rest of client-tools: the member's own client, and the
 * policies decide. An org's admins define fields on candidates, jobs and
 * offers (and their options); a value is read and written with the object it
 * hangs on, a private field's only by admins and the people who manage the
 * job, and an offer's only while the offer is a draft. The database checks
 * every value against its field's type; the checks here say so first, in a
 * sentence, and turn option names into the ids the column holds.
 *
 * A field is named by its id or its name, ignoring case, within its object.
 * An org has tens of fields, so they are read whole and matched here.
 */

export const CUSTOM_FIELD_OBJECTS = ["candidate", "job", "offer"] as const;
export type CustomFieldObject = (typeof CUSTOM_FIELD_OBJECTS)[number];
export const CUSTOM_FIELD_TYPES = [
  "short_text", "long_text", "number", "date", "yes_no", "single_select", "multi_select", "url",
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_NAME_MAX = 80;
export const CUSTOM_FIELD_OPTION_MAX = 120;
export const CUSTOM_FIELD_OPTIONS_MAX = 50;
export const SHORT_TEXT_MAX = 255;
export const LONG_TEXT_MAX = 10_000;
const URL_MAX = 2000;
const NUMBER_LIMIT = 1e15;
const FIELDS_READ_MAX = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECTS: readonly CustomFieldType[] = ["single_select", "multi_select"];
/** The column a value hangs on, and the audit entity it is recorded under. */
const OBJECT_COLUMN = { candidate: "person_id", job: "role_id", offer: "offer_id" } as const;
const OBJECT_ENTITY = { candidate: "person", job: "role", offer: "offer" } as const;

export type CustomFieldOption = { optionId: string; name: string; archived: boolean };

export type CustomField = {
  fieldId: string;
  object: CustomFieldObject;
  name: string;
  type: CustomFieldType;
  /** Read and written only by admins and the people who manage the job. */
  private: boolean;
  archived: boolean;
  /** For single_select and multi_select, in order; empty otherwise. */
  options: CustomFieldOption[];
};

/** One field's value on one object, as the member reads it. Selects carry option names. */
export type CustomFieldValue = {
  fieldId: string;
  name: string;
  type: CustomFieldType;
  private: boolean;
  value: string | number | boolean | string[];
};

/** What a caller passes as a value: null clears it. */
export type CustomFieldInput = string | number | boolean | string[] | null;

type OptionRow = { id: string; name: string; position: number; archived_at: string | null };
type FieldRow = {
  id: string; object: string; name: string; field_type: string; private: boolean; position: number;
  archived_at: string | null; custom_field_options: OptionRow[] | null;
};
const FIELD_COLUMNS = "id, object, name, field_type, private, position, archived_at, custom_field_options(id, name, position, archived_at)";

const notForInterviewers = () => new ClientToolError("forbidden", "Interviewers do not see or use your company's custom fields.");
const adminsOnly = () => new ClientToolError("forbidden", "Only an admin at your company defines custom fields.");

/** Collapses inner whitespace; the columns refuse surrounding spaces. */
function cleanName(raw: string, max: number, what: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new ClientToolError("invalid", `${what} needs a name.`);
  if (name.length > max) throw new ClientToolError("invalid", `${what}'s name is at most ${max} characters.`);
  return name;
}
const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

function checkObject(object: string): CustomFieldObject {
  if (!(CUSTOM_FIELD_OBJECTS as readonly string[]).includes(object)) {
    throw new ClientToolError("invalid", `A custom field is on one of ${CUSTOM_FIELD_OBJECTS.join(", ")}.`);
  }
  return object as CustomFieldObject;
}

const byPosition = <T extends { position: number; name: string }>(a: T, b: T) => a.position - b.position || a.name.localeCompare(b.name);

function toField(r: FieldRow, includeArchivedOptions: boolean): CustomField {
  const type = r.field_type as CustomFieldType;
  return {
    fieldId: r.id,
    object: r.object as CustomFieldObject,
    name: r.name,
    type,
    private: r.private,
    archived: r.archived_at !== null,
    options: SELECTS.includes(type)
      ? [...(r.custom_field_options ?? [])]
          .filter((o) => includeArchivedOptions || o.archived_at === null)
          .sort(byPosition)
          .map((o) => ({ optionId: o.id, name: o.name, archived: o.archived_at !== null }))
      : [],
  };
}

async function readFields(db: Db, object?: CustomFieldObject): Promise<FieldRow[]> {
  let q = db.from("custom_fields").select(FIELD_COLUMNS);
  if (object) q = q.eq("object", object);
  const { data, error } = await q.order("position").order("name").limit(FIELDS_READ_MAX)
    .overrideTypes<FieldRow[], { merge: false }>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * The field a member named, by id or by name ignoring case, archived ones
 * included. Without an object, a name found on two objects is a question.
 */
async function findField(db: Db, field: string, object?: CustomFieldObject): Promise<FieldRow> {
  const wanted = field.trim();
  const rows = wanted ? await readFields(db, object) : [];
  const hits = UUID.test(wanted)
    ? rows.filter((r) => r.id === wanted.toLowerCase())
    : rows.filter((r) => key(r.name) === key(wanted));
  if (!hits.length) {
    throw new ClientToolError("not_found", "No custom field by that name or id. list_custom_fields has them.");
  }
  if (hits.length > 1) {
    throw new ClientToolError("invalid", "Fields by that name are on more than one object: say which (candidate, job or offer), or use the field_id.");
  }
  return hits[0];
}

export async function listCustomFields(
  db: Db,
  ctx: ClientToolCtx,
  input: { object?: string; includeArchived?: boolean } = {},
): Promise<CustomField[]> {
  const object = input.object === undefined ? undefined : checkObject(input.object);
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const rows = await readFields(db, object);
  return rows
    .filter((r) => input.includeArchived || r.archived_at === null)
    .map((r) => toField(r, !!input.includeArchived));
}

// ---------------------------------------------------------------------------
// Definitions (admins)
// ---------------------------------------------------------------------------

function checkType(type: string): CustomFieldType {
  if (!(CUSTOM_FIELD_TYPES as readonly string[]).includes(type)) {
    throw new ClientToolError("invalid", `A custom field's type is one of ${CUSTOM_FIELD_TYPES.join(", ")}.`);
  }
  return type as CustomFieldType;
}

function optionNames(raw: string[]): string[] {
  const names = raw.map((n) => cleanName(n, CUSTOM_FIELD_OPTION_MAX, "An option"));
  if (!names.length) throw new ClientToolError("invalid", "A select field needs at least one option.");
  if (names.length > CUSTOM_FIELD_OPTIONS_MAX) throw new ClientToolError("invalid", `A field has at most ${CUSTOM_FIELD_OPTIONS_MAX} options.`);
  if (new Set(names.map(key)).size !== names.length) throw new ClientToolError("invalid", "Each option is named once.");
  return names;
}

/** The database's own refusals as sentences. */
function writeError(error: { code?: string; message: string }): Error {
  if (error.code === "22023") return new ClientToolError("invalid", `Not saved: ${error.message}.`);
  if (error.code === "42501") return new ClientToolError("forbidden", "Your access does not allow that change.");
  return new Error(error.message);
}

export type CreateCustomFieldResult = { outcome: "created" | "exists"; fieldId: string; name: string };

/**
 * Defines a field (admins). One already there under that name on that
 * object, of the same type, is answered with; another type, or an archived
 * one, is a sentence.
 */
export async function createCustomField(
  db: Db,
  ctx: ClientToolCtx,
  input: { object: string; name: string; type: string; private?: boolean; options?: string[] },
): Promise<CreateCustomFieldResult> {
  const object = checkObject(input.object);
  const type = checkType(input.type);
  const name = cleanName(input.name, CUSTOM_FIELD_NAME_MAX, "A field");
  const isSelect = SELECTS.includes(type);
  if (!isSelect && input.options?.length) throw new ClientToolError("invalid", "Only a single_select or multi_select field has options.");
  const options = isSelect ? optionNames(input.options ?? []) : [];
  if (ctx.accessLevel !== "admin") throw adminsOnly();

  const rows = await readFields(db, object);
  const existing = rows.find((r) => key(r.name) === key(name));
  if (existing) {
    if (existing.archived_at) {
      throw new ClientToolError("invalid", "A field by that name was archived. Bring it back with update_custom_field (archived: false).");
    }
    if (existing.field_type !== type) {
      throw new ClientToolError("invalid", `A ${object} field by that name already exists, as ${existing.field_type}.`);
    }
    return { outcome: "exists", fieldId: existing.id, name: existing.name };
  }

  return withAudit<CreateCustomFieldResult>(db, ctx, { action: "custom_field.create", entity: "custom_field" }, async () => {
    // Made here and not read back, as every new row a member inserts.
    const fieldId = globalThis.crypto.randomUUID();
    const position = rows.reduce((max, r) => Math.max(max, r.position), 0) + 1;
    const { error } = await db.from("custom_fields").insert({
      id: fieldId, object, name, field_type: type, private: input.private ?? false, position,
    });
    if (error?.code === "23505") {
      // Someone made it between the read and the insert.
      const raced = (await readFields(db, object)).find((r) => key(r.name) === key(name));
      if (raced) return { result: { outcome: "exists" as const, fieldId: raced.id, name: raced.name }, entityId: raced.id, changed: false };
    }
    if (error) throw writeError(error);
    if (options.length) {
      const { error: optionsError } = await db.from("custom_field_options").insert(
        options.map((o, i) => ({ id: globalThis.crypto.randomUUID(), field_id: fieldId, name: o, position: i + 1 })),
      );
      if (optionsError) throw writeError(optionsError);
    }
    return {
      result: { outcome: "created" as const, fieldId, name },
      entityId: fieldId,
      after: { object, name, type, private: input.private ?? false, options },
      changed: true,
    };
  });
}

export type CustomFieldChange = {
  outcome: "updated" | "unchanged";
  fieldId: string;
  name: string;
  /** What changed: name, private, archived, options. */
  changed: string[];
  added: string[];
  renamed: Array<{ from: string; to: string }>;
  restored: string[];
  archivedOptions: string[];
};

/**
 * Renames, makes private or public, archives or restores a field (admins),
 * and for a select field sets its options: the list given becomes the live
 * options in that order, matched by option_id (a rename) or by name, new
 * names added, and the live ones left out archived, never deleted, so a value
 * that chose one keeps it.
 */
export async function updateCustomField(
  db: Db,
  ctx: ClientToolCtx,
  input: {
    field: string;
    object?: string;
    name?: string;
    private?: boolean;
    archived?: boolean;
    options?: Array<{ optionId?: string; name: string }>;
  },
): Promise<CustomFieldChange> {
  const object = input.object === undefined ? undefined : checkObject(input.object);
  const name = input.name === undefined ? undefined : cleanName(input.name, CUSTOM_FIELD_NAME_MAX, "A field");
  if (ctx.accessLevel !== "admin") throw adminsOnly();
  const field = await findField(db, input.field, object);
  const type = field.field_type as CustomFieldType;

  const patch: TablesUpdate<"custom_fields"> = {};
  if (name !== undefined && name !== field.name) {
    const siblings = await readFields(db, field.object as CustomFieldObject);
    if (siblings.some((r) => r.id !== field.id && key(r.name) === key(name))) {
      throw new ClientToolError("invalid", `Another ${field.object} field has that name (perhaps archived). Pick another.`);
    }
    patch.name = name;
  }
  if (input.private !== undefined && input.private !== field.private) patch.private = input.private;
  if (input.archived !== undefined && input.archived !== (field.archived_at !== null)) {
    patch.archived_at = input.archived ? new Date().toISOString() : null;
  }

  // Options: the list given becomes the live set, in order.
  const added: Array<{ id: string; name: string; position: number }> = [];
  const optionUpdates: Array<{ id: string; patch: TablesUpdate<"custom_field_options"> }> = [];
  const renamed: Array<{ from: string; to: string }> = [];
  const restored: string[] = [];
  const archivedOptions: string[] = [];
  if (input.options !== undefined) {
    if (!SELECTS.includes(type)) throw new ClientToolError("invalid", "Only a single_select or multi_select field has options.");
    const wanted = input.options.map((o) => ({ optionId: o.optionId?.toLowerCase(), name: cleanName(o.name, CUSTOM_FIELD_OPTION_MAX, "An option") }));
    optionNames(wanted.map((o) => o.name));
    const ids = wanted.map((o) => o.optionId).filter((id): id is string => !!id);
    if (new Set(ids).size !== ids.length) throw new ClientToolError("invalid", "Each option_id is given once.");
    const current = [...(field.custom_field_options ?? [])];
    const matched = new Set<string>();
    wanted.forEach((w, i) => {
      const position = i + 1;
      const row = w.optionId
        ? current.find((o) => o.id === w.optionId)
        : current.find((o) => key(o.name) === key(w.name) && !ids.includes(o.id));
      if (w.optionId && !row) throw new ClientToolError("invalid", "An option_id given is not one of this field's options. list_custom_fields has them.");
      if (!row) {
        added.push({ id: globalThis.crypto.randomUUID(), name: w.name, position });
        return;
      }
      matched.add(row.id);
      const p: TablesUpdate<"custom_field_options"> = {};
      if (row.name !== w.name) {
        // The unique index counts archived options too: a rename onto another option's name is refused.
        if (current.some((o) => o.id !== row.id && key(o.name) === key(w.name))) {
          throw new ClientToolError("invalid", "An option already has that name. Use its option_id instead of renaming another onto it.");
        }
        p.name = w.name;
        renamed.push({ from: row.name, to: w.name });
      }
      if (row.archived_at) {
        p.archived_at = null;
        restored.push(w.name);
      }
      if (row.position !== position) p.position = position;
      if (Object.keys(p).length) optionUpdates.push({ id: row.id, patch: p });
    });
    for (const o of current) {
      if (!matched.has(o.id) && o.archived_at === null) {
        optionUpdates.push({ id: o.id, patch: { archived_at: new Date().toISOString() } });
        archivedOptions.push(o.name);
      }
    }
  }

  const changed = [
    ...Object.keys(patch).map((k) => (k === "archived_at" ? "archived" : k)),
    ...(added.length || optionUpdates.length ? ["options"] : []),
  ];
  const result = (outcome: CustomFieldChange["outcome"]): CustomFieldChange => ({
    outcome, fieldId: field.id, name: (patch.name as string | undefined) ?? field.name, changed,
    added: added.map((a) => a.name), renamed, restored, archivedOptions,
  });
  if (!changed.length) return result("unchanged");

  return withAudit(db, ctx, { action: "custom_field.update", entity: "custom_field" }, async () => {
    if (Object.keys(patch).length) {
      const { error } = await db.from("custom_fields").update(patch).eq("id", field.id);
      if (error) throw writeError(error);
    }
    for (const u of optionUpdates) {
      const { error } = await db.from("custom_field_options").update(u.patch).eq("id", u.id);
      if (error) throw writeError(error);
    }
    if (added.length) {
      const { error } = await db.from("custom_field_options").insert(added.map((a) => ({ ...a, field_id: field.id })));
      if (error) throw writeError(error);
    }
    return {
      result: result("updated"),
      entityId: field.id,
      before: { name: field.name, private: field.private, archived: field.archived_at !== null },
      after: {
        ...patch,
        ...(changed.includes("options")
          ? { options_added: added.map((a) => a.name), options_renamed: renamed, options_restored: restored, options_archived: archivedOptions }
          : {}),
      },
      changed: true,
    };
  });
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** A value in the column's shape, checked against the field's type; option names become ids. */
function toStored(field: FieldRow, raw: Exclude<CustomFieldInput, null>, current: Json | null): Json {
  const type = field.field_type as CustomFieldType;
  const text = (max: number, label: string): string => {
    if (typeof raw !== "string") throw new ClientToolError("invalid", `A ${label} value is text.`);
    const s = raw.trim();
    if (!s) throw new ClientToolError("invalid", "Pass null to clear a value.");
    if (s.length > max) throw new ClientToolError("invalid", `A ${label} value is at most ${max} characters.`);
    return s;
  };
  switch (type) {
    case "short_text":
      return text(SHORT_TEXT_MAX, "short_text");
    case "long_text":
      return text(LONG_TEXT_MAX, "long_text");
    case "url": {
      const s = text(URL_MAX, "url");
      if (!/^https?:\/\/\S+$/i.test(s)) throw new ClientToolError("invalid", "A url value starts with http:// or https://.");
      return s;
    }
    case "date": {
      const d = typeof raw === "string" ? parseDueDate(raw) : null;
      if (!d) throw new ClientToolError("invalid", "A date value is YYYY-MM-DD.");
      return d;
    }
    case "number": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : NaN;
      if (!Number.isFinite(n) || Math.abs(n) >= NUMBER_LIMIT) throw new ClientToolError("invalid", "A number value is a number.");
      return n;
    }
    case "yes_no": {
      if (typeof raw === "boolean") return raw;
      const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (["yes", "true"].includes(s)) return true;
      if (["no", "false"].includes(s)) return false;
      throw new ClientToolError("invalid", "A yes_no value is true or false.");
    }
    case "single_select":
    case "multi_select": {
      const wanted = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : null;
      if (!wanted || wanted.some((w) => typeof w !== "string")) {
        throw new ClientToolError("invalid", "A select value is an option's name or option_id (a list of them for multi_select).");
      }
      if (type === "single_select" && wanted.length !== 1) throw new ClientToolError("invalid", "A single_select value is one option.");
      if (!wanted.length) throw new ClientToolError("invalid", "Pass null to clear a value.");
      const kept = new Set(Array.isArray(current) ? (current as string[]) : typeof current === "string" ? [current] : []);
      const options = field.custom_field_options ?? [];
      const ids = wanted.map((w) => {
        const o = UUID.test(w.trim())
          ? options.find((x) => x.id === w.trim().toLowerCase())
          : options.find((x) => key(x.name) === key(w));
        if (!o) throw new ClientToolError("invalid", "That is not one of this field's options. list_custom_fields has them.");
        if (o.archived_at && !kept.has(o.id)) throw new ClientToolError("invalid", "That option is archived and is chosen by no one new.");
        return o.id;
      });
      if (new Set(ids).size !== ids.length) throw new ClientToolError("invalid", "Each option is chosen once.");
      if (ids.length > CUSTOM_FIELD_OPTIONS_MAX) throw new ClientToolError("invalid", `At most ${CUSTOM_FIELD_OPTIONS_MAX} options.`);
      return type === "single_select" ? ids[0] : ids;
    }
  }
}

/** A stored value as the member reads it: option ids become names. */
function toDisplay(type: CustomFieldType, options: OptionRow[], value: Json): CustomFieldValue["value"] {
  const nameOf = (id: string) => options.find((o) => o.id === id)?.name ?? id;
  if (type === "single_select" && typeof value === "string") return nameOf(value);
  if (type === "multi_select" && Array.isArray(value)) return (value as string[]).map(nameOf);
  return value as string | number | boolean;
}

const sameValue = (a: Json, b: Json) =>
  JSON.stringify(Array.isArray(a) ? [...(a as string[])].sort() : a) === JSON.stringify(Array.isArray(b) ? [...(b as string[])].sort() : b);

const can = async (db: Db, fn: "can_edit_person", args: { p_person: string }) => {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data === true;
};
const canManage = async (db: Db, roleId: string) => {
  const { data, error } = await db.rpc("can_on_role", { p_role: roleId, perm: "can_manage_job" });
  if (error) throw new Error(error.message);
  return data === true;
};

/** The object, if the member can see it and may set this field on it; a sentence otherwise. */
async function writableObject(db: Db, ctx: ClientToolCtx, object: CustomFieldObject, objectId: string, field: FieldRow): Promise<void> {
  if (object === "candidate") {
    const { data, error } = await db.from("people").select("id").eq("id", objectId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new ClientToolError("not_found", "No candidate with that id that you can see. Call search_candidates for the ids.");
    if (!(await can(db, "can_edit_person", { p_person: objectId }))) {
      throw new ClientToolError("forbidden", "You can see that candidate but not change their record, custom fields included.");
    }
    if (field.private && ctx.accessLevel !== "admin") {
      const { data: apps, error: appsError } = await db.from("applications").select("role_id").eq("person_id", objectId);
      if (appsError) throw new Error(appsError.message);
      let manages = false;
      for (const a of apps ?? []) if (!manages) manages = await canManage(db, a.role_id);
      if (!manages) throw new ClientToolError("forbidden", "That field is private: only admins and the people who manage the candidate's job set it.");
    }
    return;
  }
  if (object === "job") {
    const { data, error } = await db.from("roles").select("id").eq("id", objectId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new ClientToolError("not_found", "No job with that id that you can see. whoami and list_jobs list them.");
    if (!(await canManage(db, objectId))) {
      throw new ClientToolError("forbidden", "Only the people who manage this job (an admin, its hiring manager or recruiter) set its fields.");
    }
    return;
  }
  // Offers read only for someone who manages the job.
  const { data, error } = await db.from("offers").select("id, status").eq("id", objectId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientToolError("not_found", "No offer with that id that you can see. get_offers lists them.");
  if (data.status !== "draft") {
    throw new ClientToolError("invalid", `That offer is ${data.status}: only a draft offer's fields change, as its terms do.`);
  }
}

export type SetCustomFieldResult = {
  outcome: "set" | "cleared" | "unchanged";
  fieldId: string;
  field: string;
  type: CustomFieldType;
  /** The value now, as get_candidate and the other reads show it; null when cleared or unset. */
  value: CustomFieldValue["value"] | null;
};

/**
 * Sets one field's value on one candidate, job or offer (value null clears
 * it). A long_text value stays out of the audit row, as notes do.
 */
export async function setCustomField(
  db: Db,
  ctx: ClientToolCtx,
  input: { object: string; objectId: string; field: string; value: CustomFieldInput },
): Promise<SetCustomFieldResult> {
  const object = checkObject(input.object);
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const field = await findField(db, input.field, object);
  const type = field.field_type as CustomFieldType;
  if (field.archived_at) throw new ClientToolError("invalid", "That field is archived and takes no new value.");
  await writableObject(db, ctx, object, input.objectId, field);

  const column = OBJECT_COLUMN[object];
  const { data: there, error } = await db
    .from("custom_field_values").select("id, value").eq("field_id", field.id).eq(column, input.objectId).maybeSingle();
  if (error) throw new Error(error.message);
  const current = (there?.value ?? null) as Json | null;
  const stored = input.value === null ? null : toStored(field, input.value, current);
  const options = field.custom_field_options ?? [];
  const shown = stored === null ? null : toDisplay(type, options, stored);
  const base = { fieldId: field.id, field: field.name, type };

  if (stored === null && !there) return { outcome: "unchanged", ...base, value: null };
  if (stored !== null && current !== null && sameValue(stored, current)) return { outcome: "unchanged", ...base, value: shown };

  // What the audit row may carry: never a long_text body.
  const record = (v: Json | null) => ({ field_id: field.id, field: field.name, ...(type === "long_text" ? {} : { value: v }) });
  const entity = OBJECT_ENTITY[object];

  if (stored === null) {
    return withAudit(db, ctx, { action: "custom_field.clear", entity }, async () => {
      const { data: removed, error: deleteError } = await db.from("custom_field_values").delete().eq("id", there!.id).select("id");
      if (deleteError) throw writeError(deleteError);
      const ok = !!removed?.length;
      return {
        result: { outcome: ok ? ("cleared" as const) : ("unchanged" as const), ...base, value: null },
        entityId: input.objectId,
        before: record(current),
        after: {},
        changed: ok,
      };
    });
  }

  return withAudit(db, ctx, { action: "custom_field.set", entity }, async () => {
    let writeFailed: { code?: string; message: string } | null = null;
    if (there) {
      const { error: updateError } = await db.from("custom_field_values").update({ value: stored }).eq("id", there.id);
      writeFailed = updateError;
    } else {
      const { error: insertError } = await db.from("custom_field_values").insert({
        id: globalThis.crypto.randomUUID(), field_id: field.id, [column]: input.objectId, value: stored,
      } as TablesInsert<"custom_field_values">);
      writeFailed = insertError;
      // Someone set it between the read and the insert: theirs is replaced, as a set would.
      if (insertError?.code === "23505") {
        const { error: updateError } = await db
          .from("custom_field_values").update({ value: stored }).eq("field_id", field.id).eq(column, input.objectId);
        writeFailed = updateError;
      }
    }
    if (writeFailed) throw writeError(writeFailed);
    return {
      result: { outcome: "set" as const, ...base, value: shown },
      entityId: input.objectId,
      before: there ? record(current) : null,
      after: record(stored),
      changed: true,
    };
  });
}

type ValueRow = {
  field_id: string; person_id: string | null; role_id: string | null; offer_id: string | null; value: Json;
  custom_fields: {
    name: string; field_type: string; private: boolean; position: number; archived_at: string | null;
    custom_field_options: Array<{ id: string; name: string }> | null;
  } | null;
};

/**
 * The live fields' values on each of these candidates, jobs or offers, as
 * the member reads them (the policies leave out what they may not), in the
 * fields' order. Empty for an interviewer, who reads no field.
 */
export async function customFieldValuesFor(db: Db, object: CustomFieldObject, ids: string[]): Promise<Map<string, CustomFieldValue[]>> {
  const out = new Map<string, CustomFieldValue[]>();
  if (!ids.length) return out;
  const column = OBJECT_COLUMN[object];
  const { data, error } = await db
    .from("custom_field_values")
    .select(`field_id, person_id, role_id, offer_id, value, custom_fields(name, field_type, private, position, archived_at, custom_field_options(id, name))`)
    .in(column, ids)
    .overrideTypes<ValueRow[], { merge: false }>();
  if (error) throw new Error(error.message);
  const rows = (data ?? [])
    .filter((r) => r.custom_fields && r.custom_fields.archived_at === null)
    .sort((a, b) => byPosition(
      { position: a.custom_fields!.position, name: a.custom_fields!.name },
      { position: b.custom_fields!.position, name: b.custom_fields!.name },
    ));
  for (const r of rows) {
    const id = r[column];
    if (!id) continue;
    const f = r.custom_fields!;
    const type = f.field_type as CustomFieldType;
    const options = (f.custom_field_options ?? []).map((o) => ({ ...o, position: 0, archived_at: null }));
    out.set(id, [...(out.get(id) ?? []), { fieldId: r.field_id, name: f.name, type, private: f.private, value: toDisplay(type, options, r.value) }]);
  }
  return out;
}
