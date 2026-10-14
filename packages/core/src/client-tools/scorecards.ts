import type { Db, TablesUpdate } from "@tacit/db";

import { withAudit } from "./audit.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * Per-job scorecards for the client connector (20261015140000_scorecards).
 * Same rules as the rest of client-tools: the member's own client, and the
 * policies decide. A scorecard is read by anyone who can see the job (an
 * interviewer included, for the jobs they interview on) and set by whoever can
 * manage it. Attributes are archived, never deleted, so a rating filed against
 * one keeps its name; the ratings themselves are filed with feedback
 * (interviews.ts submitFeedback).
 */

const SCORECARD_MAX = 25;
const NAME_MAX = 120;
const DESCRIPTION_MAX = 1000;

export type ScorecardAttribute = {
  attributeId: string;
  name: string;
  description: string | null;
  position: number;
  archived: boolean;
};

export type Scorecard = { jobId: string; jobTitle: string; attributes: ScorecardAttribute[] };

type AttributeRow = { id: string; name: string; description: string | null; position: number; archived_at: string | null };
const ATTRIBUTE_COLUMNS = "id, name, description, position, archived_at";

const toAttribute = (r: AttributeRow): ScorecardAttribute => ({
  attributeId: r.id,
  name: r.name,
  description: r.description,
  position: r.position,
  archived: r.archived_at !== null,
});

/** Names match the way the database's unique index does: trimmed, any case. */
const nameKey = (name: string) => name.trim().toLowerCase();

async function job(db: Db, jobId: string): Promise<{ id: string; title: string }> {
  const { data, error } = await db.from("roles").select("id, title").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientToolError("not_found", "No job with that id that you can see. whoami and list_jobs list them.");
  return data;
}

async function attributes(db: Db, jobId: string, includeArchived: boolean): Promise<AttributeRow[]> {
  let q = db.from("scorecard_attributes").select(ATTRIBUTE_COLUMNS).eq("role_id", jobId);
  if (!includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q.order("position").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as AttributeRow[];
}

export async function getScorecard(
  db: Db,
  _ctx: ClientToolCtx,
  input: { jobId: string; includeArchived?: boolean },
): Promise<Scorecard> {
  const role = await job(db, input.jobId);
  const rows = await attributes(db, role.id, input.includeArchived ?? false);
  return { jobId: role.id, jobTitle: role.title, attributes: rows.map(toAttribute) };
}

export type ScorecardEntry = {
  /** An attribute already on the job, to rename it; otherwise it is matched by name. */
  attributeId?: string;
  name: string;
  /** Omitted: unchanged (empty for a new one). null or "": cleared. */
  description?: string | null;
};

export type ScorecardChange = {
  outcome: "updated" | "unchanged";
  added: string[];
  renamed: Array<{ from: string; to: string }>;
  restored: string[];
  archived: string[];
  reordered: boolean;
  attributes: ScorecardAttribute[];
};

/**
 * Sets a job's live scorecard to exactly `entries`, in order. An entry with
 * an attributeId renames that attribute; one without is matched by name (any
 * case), which brings an archived attribute back, or added. A live attribute
 * left out is archived. Calling it again with the same list changes nothing.
 */
export async function setScorecard(
  db: Db,
  ctx: ClientToolCtx,
  input: { jobId: string; attributes: ScorecardEntry[] },
): Promise<ScorecardChange> {
  if (input.attributes.length > SCORECARD_MAX) {
    throw new ClientToolError("invalid", `A scorecard has at most ${SCORECARD_MAX} attributes.`);
  }
  const entries = input.attributes.map((e) => {
    const name = e.name.trim();
    if (!name || name.length > NAME_MAX) throw new ClientToolError("invalid", `An attribute's name is 1 to ${NAME_MAX} characters.`);
    let description: string | null | undefined;
    if (e.description !== undefined) {
      description = e.description?.trim() || null;
      if (description && description.length > DESCRIPTION_MAX) {
        throw new ClientToolError("invalid", `An attribute's description is at most ${DESCRIPTION_MAX} characters.`);
      }
    }
    return { attributeId: e.attributeId, name, description };
  });
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(nameKey(e.name))) throw new ClientToolError("invalid", `"${e.name}" is in the list twice. Each attribute appears once.`);
    seen.add(nameKey(e.name));
  }
  if (ctx.accessLevel === "limited") {
    throw new ClientToolError("forbidden", "Only the people who manage this job (an admin, its hiring manager or recruiter) set its scorecard.");
  }

  const role = await job(db, input.jobId);
  const { data: allowed, error: permError } = await db.rpc("can_on_role", { p_role: role.id, perm: "can_manage_job" });
  if (permError) throw new Error(permError.message);
  if (allowed !== true) {
    throw new ClientToolError("forbidden", "Only the people who manage this job (an admin, its hiring manager or recruiter) set its scorecard.");
  }
  const existing = await attributes(db, role.id, true);
  const byId = new Map(existing.map((a) => [a.id, a]));
  const byName = new Map(existing.map((a) => [nameKey(a.name), a]));

  const used = new Set<string>();
  const inserts: Array<{ id: string; role_id: string; name: string; description: string | null; position: number }> = [];
  const updates: Array<{ id: string; patch: TablesUpdate<"scorecard_attributes"> }> = [];
  const change: Omit<ScorecardChange, "outcome" | "attributes"> = { added: [], renamed: [], restored: [], archived: [], reordered: false };
  const final: ScorecardAttribute[] = [];

  entries.forEach((e, i) => {
    const position = (i + 1) * 10;
    const current = e.attributeId !== undefined ? byId.get(e.attributeId) : byName.get(nameKey(e.name));
    if (e.attributeId !== undefined && !current) {
      throw new ClientToolError("not_found", "No attribute with that id on this job. get_scorecard lists them.");
    }
    if (!current) {
      const id = globalThis.crypto.randomUUID();
      inserts.push({ id, role_id: role.id, name: e.name, description: e.description ?? null, position });
      change.added.push(e.name);
      final.push({ attributeId: id, name: e.name, description: e.description ?? null, position, archived: false });
      return;
    }
    if (used.has(current.id)) throw new ClientToolError("invalid", `"${current.name}" is in the list twice. Each attribute appears once.`);
    used.add(current.id);
    const patch: TablesUpdate<"scorecard_attributes"> = {};
    if (e.name !== current.name) {
      const holder = byName.get(nameKey(e.name));
      if (holder && holder.id !== current.id) {
        throw new ClientToolError(
          "invalid",
          `Another attribute on this job is already called "${holder.name}"${holder.archived_at ? " (archived)" : ""}. Use that one, or rename it first.`,
        );
      }
      patch.name = e.name;
      change.renamed.push({ from: current.name, to: e.name });
    }
    if (e.description !== undefined && e.description !== current.description) patch.description = e.description;
    if (position !== current.position) {
      patch.position = position;
      if (!current.archived_at) change.reordered = true;
    }
    if (current.archived_at) {
      patch.archived_at = null;
      change.restored.push(e.name);
    }
    if (Object.keys(patch).length) updates.push({ id: current.id, patch });
    final.push({
      attributeId: current.id, name: e.name, description: e.description !== undefined ? e.description : current.description,
      position, archived: false,
    });
  });
  const archive = existing.filter((a) => !a.archived_at && !used.has(a.id));
  change.archived = archive.map((a) => a.name);

  if (!inserts.length && !updates.length && !archive.length) {
    return { outcome: "unchanged", ...change, attributes: final };
  }

  // Names and order only: the descriptions are the scorecard's text, not the record of the change.
  const before = { attributes: existing.filter((a) => !a.archived_at).map((a) => a.name) };
  return withAudit(db, ctx, { action: "scorecard.set", entity: "scorecard" }, async () => {
    for (const u of updates) {
      const { error } = await db.from("scorecard_attributes").update(u.patch).eq("id", u.id);
      if (error) throw scorecardWriteError(error);
    }
    if (archive.length) {
      const { error } = await db
        .from("scorecard_attributes").update({ archived_at: new Date().toISOString() }).in("id", archive.map((a) => a.id));
      if (error) throw scorecardWriteError(error);
    }
    if (inserts.length) {
      // Not read back: each id is made here.
      const { error } = await db.from("scorecard_attributes").insert(inserts);
      if (error) throw scorecardWriteError(error);
    }
    return {
      result: { outcome: "updated" as const, ...change, attributes: final },
      entityId: role.id,
      before,
      after: { attributes: final.map((a) => a.name), ...change },
      changed: true,
    };
  });
}

/** The database's own refusals (23505 for a name the job already has, 22023 from the guard) as sentences. */
function scorecardWriteError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") {
    return new ClientToolError("invalid", "Two attributes on this job would share a name. Call get_scorecard with include_archived and try again.");
  }
  if (error.code === "22023") return new ClientToolError("invalid", `Not saved: ${error.message}.`);
  return new Error(error.message);
}
