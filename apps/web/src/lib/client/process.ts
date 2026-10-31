import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { readMembers } from "./member-access";
import { defaultGraph, readGraph, type ProcessDoc, type ProcessLookup } from "./process-graph";

// Onboarding's Interview process step, on the member's own token: admins and the
// company's own hiring team read (core's getProcess refuses anyone else, and the
// page has asked onboardingAccess first).

export type ProcessRead = {
  graph: ProcessDoc;
  /** False while the company has saved nothing: `graph` is then the neutral start, stored nowhere. */
  drawn: boolean;
  /** What the next save names. Null with nothing saved. */
  updatedAt: string | null;
  lookup: ProcessLookup;
};

/** Every department, archived ones too: a job may sit in one, and the graph outlives them. */
async function readLookup(db: Db, ctx: clientTools.ClientToolCtx): Promise<ProcessLookup> {
  const [departments, members] = await Promise.all([clientTools.listDepartments(db, ctx, { includeArchived: true }), readMembers(db)]);
  return {
    departments: departments.map((d) => ({ id: d.departmentId, name: d.name, parentId: d.parentId, archived: d.archived })),
    members: members.rows.flatMap((m) => (m.id ? [{ id: m.id, name: m.display_name ?? "" }] : [])),
  };
}

export async function readProcess(db: Db, ctx: clientTools.ClientToolCtx): Promise<ProcessRead> {
  const [saved, lookup] = await Promise.all([clientTools.getProcess(db, ctx), readLookup(db, ctx)]);
  if (!saved) return { graph: defaultGraph(), drawn: false, updatedAt: null, lookup };
  return { graph: readGraph(saved.graph), drawn: true, updatedAt: saved.updatedAt, lookup };
}
