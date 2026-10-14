import type { Db } from "@tacit/db";

import { withAudit } from "./audit.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * Tags for the client connector (20261015150000_client_sources_tags). Same
 * rules as the rest of client-tools: the member's own client, and the
 * policies decide. Tags are read by every member above interviewer, made by
 * anyone who can add candidates and archived by admins; a tag goes on or
 * comes off a candidate for whoever can change that candidate. The checks
 * here ask the same helpers first only to answer with a sentence.
 *
 * A tag is named by its id or its name, ignoring case: the model usually has
 * the name from the user, and an org has tens of tags, so they are read whole
 * and matched here rather than through a PostgREST filter.
 */

export const TAG_NAME_MAX = 60;
const TAGS_READ_MAX = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Tag = {
  tagId: string;
  name: string;
  archived: boolean;
  /** How many of the candidates the member can see carry it. */
  candidates: number;
};

type TagRow = { id: string; name: string; archived_at: string | null };

const notForInterviewers = () =>
  new ClientToolError("forbidden", "Interviewers do not see or use your company's tags.");

/** Collapses inner whitespace; the column refuses surrounding spaces. */
function tagName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new ClientToolError("invalid", "A tag needs a name.");
  if (name.length > TAG_NAME_MAX) throw new ClientToolError("invalid", `A tag's name is at most ${TAG_NAME_MAX} characters.`);
  return name;
}

async function readTags(db: Db): Promise<TagRow[]> {
  const { data, error } = await db.from("tags").select("id, name, archived_at").order("name").limit(TAGS_READ_MAX);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The tag a member named, by id or by name ignoring case; archived ones included. */
export async function findTag(db: Db, tag: string): Promise<TagRow | null> {
  const wanted = tag.trim();
  if (!wanted) return null;
  const rows = await readTags(db);
  if (UUID.test(wanted)) return rows.find((r) => r.id === wanted.toLowerCase()) ?? null;
  const key = wanted.replace(/\s+/g, " ").toLowerCase();
  return rows.find((r) => r.name.toLowerCase() === key) ?? null;
}

async function can(db: Db, fn: "can_add_people" | "can_edit_person", args?: { p_person: string }): Promise<boolean> {
  const { data, error } = await (args ? db.rpc(fn as "can_edit_person", args) : db.rpc(fn as "can_add_people"));
  if (error) throw new Error(error.message);
  return data === true;
}

export async function listTags(db: Db, ctx: ClientToolCtx, input: { includeArchived?: boolean } = {}): Promise<Tag[]> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  // The embedded count runs under the person_tags policy: only candidates the member can read.
  let q = db.from("tags").select("id, name, archived_at, person_tags(count)").order("name").limit(TAGS_READ_MAX);
  if (!input.includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q.overrideTypes<
    Array<TagRow & { person_tags?: Array<{ count: number }> }>,
    { merge: false }
  >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => ({
    tagId: t.id,
    name: t.name,
    archived: t.archived_at !== null,
    candidates: t.person_tags?.[0]?.count ?? 0,
  }));
}

export type CreateTagResult = { outcome: "created" | "exists" | "restored"; tagId: string; name: string };

/**
 * Makes a tag, for anyone who can add candidates. A tag already there under
 * that name (ignoring case) is answered with, not duplicated; an archived one
 * is brought back by an admin, and anyone else is told to ask one.
 */
export async function createTag(db: Db, ctx: ClientToolCtx, input: { name: string }): Promise<CreateTagResult> {
  const name = tagName(input.name);
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const existing = await findTag(db, name);
  if (existing && !existing.archived_at) return { outcome: "exists", tagId: existing.id, name: existing.name };
  if (existing) {
    if (ctx.accessLevel !== "admin") {
      throw new ClientToolError("invalid", "A tag by that name was archived. An admin at your company can bring it back with create_tag.");
    }
    return withAudit(db, ctx, { action: "tag.restore", entity: "tag" }, async () => {
      const { data, error } = await db
        .from("tags").update({ archived_at: null }).eq("id", existing.id).not("archived_at", "is", null).select("id");
      if (error) throw new Error(error.message);
      const ok = !!data?.length;
      return {
        result: { outcome: ok ? ("restored" as const) : ("exists" as const), tagId: existing.id, name: existing.name },
        entityId: existing.id,
        before: { archived: true },
        after: { archived: false },
        changed: ok,
      };
    });
  }
  if (!(await can(db, "can_add_people"))) {
    throw new ClientToolError("forbidden", "Only admins and people who can add candidates make tags. Use one from list_tags.");
  }
  return withAudit<CreateTagResult>(db, ctx, { action: "tag.create", entity: "tag" }, async () => {
    // Made here and not read back, as every new row a member inserts.
    const tagId = globalThis.crypto.randomUUID();
    const { error } = await db.from("tags").insert({ id: tagId, name });
    if (error?.code === "23505") {
      // Someone made it between the read and the insert.
      const raced = await findTag(db, name);
      if (raced) return { result: { outcome: "exists" as const, tagId: raced.id, name: raced.name }, entityId: raced.id, changed: false };
    }
    if (error) throw new Error(error.message);
    return { result: { outcome: "created" as const, tagId, name }, entityId: tagId, after: { name }, changed: true };
  });
}

/** Archives a tag (admins): it stays on the candidates who carry it, and goes on no one new. */
export async function archiveTag(db: Db, ctx: ClientToolCtx, input: { tag: string }): Promise<{ outcome: "archived" | "unchanged"; tagId: string; name: string }> {
  if (ctx.accessLevel !== "admin") {
    throw new ClientToolError("forbidden", "Only an admin at your company archives tags.");
  }
  const tag = await findTag(db, input.tag);
  if (!tag) throw new ClientToolError("not_found", "No tag by that name or id. list_tags has them.");
  if (tag.archived_at) return { outcome: "unchanged", tagId: tag.id, name: tag.name };
  return withAudit(db, ctx, { action: "tag.archive", entity: "tag" }, async () => {
    const { data, error } = await db
      .from("tags").update({ archived_at: new Date().toISOString() }).eq("id", tag.id).is("archived_at", null).select("id");
    if (error) throw new Error(error.message);
    const ok = !!data?.length;
    return {
      result: { outcome: ok ? ("archived" as const) : ("unchanged" as const), tagId: tag.id, name: tag.name },
      entityId: tag.id,
      before: { archived: false },
      after: { archived: true },
      changed: ok,
    };
  });
}

/** The candidate, if the member can see them and may change them. */
async function editablePerson(db: Db, candidateId: string): Promise<void> {
  const { data, error } = await db.from("people").select("id").eq("id", candidateId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientToolError("not_found", "No candidate with that id that you can see. Call search_candidates for the ids.");
  if (!(await can(db, "can_edit_person", { p_person: candidateId }))) {
    throw new ClientToolError("forbidden", "You can see that candidate but not change their record, tags included.");
  }
}

async function liveTag(db: Db, tag: string): Promise<TagRow> {
  const row = await findTag(db, tag);
  if (!row) throw new ClientToolError("not_found", "No tag by that name or id. list_tags has them; create_tag makes one.");
  return row;
}

export type TagResult = { outcome: "tagged" | "already_tagged" | "untagged" | "not_tagged"; tagId: string; tag: string };

export async function tagCandidate(db: Db, ctx: ClientToolCtx, input: { candidateId: string; tag: string }): Promise<TagResult> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const tag = await liveTag(db, input.tag);
  if (tag.archived_at) {
    // No name in the sentence: a tag's name is member-written, and refusals go back unfenced.
    throw new ClientToolError("invalid", "That tag is archived and goes on no one new. Pick another from list_tags.");
  }
  await editablePerson(db, input.candidateId);
  const { data: there, error } = await db
    .from("person_tags").select("id").eq("person_id", input.candidateId).eq("tag_id", tag.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (there) return { outcome: "already_tagged", tagId: tag.id, tag: tag.name };

  return withAudit<TagResult>(db, ctx, { action: "tag.add", entity: "person" }, async () => {
    const { error: insertError } = await db.from("person_tags").insert({
      id: globalThis.crypto.randomUUID(), person_id: input.candidateId, tag_id: tag.id, added_by_actor_id: ctx.actorId,
    });
    // Someone else tagged them first: the same outcome, and nothing changed.
    if (insertError?.code === "23505") {
      return { result: { outcome: "already_tagged" as const, tagId: tag.id, tag: tag.name }, entityId: input.candidateId, changed: false };
    }
    if (insertError) throw new Error(insertError.message);
    return {
      result: { outcome: "tagged" as const, tagId: tag.id, tag: tag.name },
      entityId: input.candidateId,
      after: { tag_id: tag.id, tag: tag.name },
      changed: true,
    };
  });
}

/** Takes a tag off a candidate; an archived tag can still come off. */
export async function untagCandidate(db: Db, ctx: ClientToolCtx, input: { candidateId: string; tag: string }): Promise<TagResult> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const tag = await liveTag(db, input.tag);
  await editablePerson(db, input.candidateId);
  const { data: there, error } = await db
    .from("person_tags").select("id").eq("person_id", input.candidateId).eq("tag_id", tag.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!there) return { outcome: "not_tagged", tagId: tag.id, tag: tag.name };

  return withAudit(db, ctx, { action: "tag.remove", entity: "person" }, async () => {
    const { data: removed, error: deleteError } = await db.from("person_tags").delete().eq("id", there.id).select("id");
    if (deleteError) throw new Error(deleteError.message);
    const ok = !!removed?.length;
    return {
      result: { outcome: ok ? ("untagged" as const) : ("not_tagged" as const), tagId: tag.id, tag: tag.name },
      entityId: input.candidateId,
      before: { tag_id: tag.id, tag: tag.name },
      after: {},
      changed: ok,
    };
  });
}

/** The live and archived tag names on each of these people, as the member reads them. */
export async function tagsFor(db: Db, personIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!personIds.length) return out;
  const { data, error } = await db
    .from("person_tags")
    .select("person_id, tags(name)")
    .in("person_id", personIds)
    .order("created_at")
    .overrideTypes<Array<{ person_id: string; tags: { name: string } | null }>, { merge: false }>();
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    if (!row.tags) continue;
    out.set(row.person_id, [...(out.get(row.person_id) ?? []), row.tags.name]);
  }
  return out;
}

/** Everyone the member can see who carries this tag (an id or a name). Null when there is no such tag. */
export async function peopleTagged(db: Db, tag: string): Promise<string[] | null> {
  const row = await findTag(db, tag);
  if (!row) return null;
  const { data, error } = await db.from("person_tags").select("person_id").eq("tag_id", row.id).limit(1000);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => r.person_id))];
}
