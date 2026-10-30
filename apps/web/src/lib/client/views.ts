import type { Db } from "@tacit/db";
import { rowSource, type ViewRow } from "../saved-views";
import { departmentScope, type DepartmentsRead } from "./department-tree";
import { readDepartments } from "./departments";
import { readPipeline, type PipelineEntry } from "./pipeline";

// The Views page's read and the Pipeline's label filter, on the member's OWN
// client (never a privileged one), so a count is only ever of what their token
// can read. Views themselves are in the browser; the page sends the board's
// rows without a name in them, and the browser counts.

/** People per `person_tags` read, to keep the query string short. */
const IDS_PER_READ = 150;
const PAGE = 1000;
/** The labels New view offers. */
const TAGS_MAX = 1000;

/** Each person's tag ids, of the people given; `onlyTag` narrows the read to one. */
export async function readPersonTags(db: Db, personIds: string[], onlyTag?: string): Promise<Map<string, string[]>> {
  const byPerson = new Map<string, string[]>();
  const unique = [...new Set(personIds)];
  for (let i = 0; i < unique.length; i += IDS_PER_READ) {
    for (let from = 0; ; from += PAGE) {
      let q = db.from("person_tags").select("id, person_id, tag_id").in("person_id", unique.slice(i, i + IDS_PER_READ));
      if (onlyTag) q = q.eq("tag_id", onlyTag);
      const { data, error } = await q.order("id").range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) byPerson.set(row.person_id, [...(byPerson.get(row.person_id) ?? []), row.tag_id]);
      if ((data?.length ?? 0) < PAGE) break;
    }
  }
  return byPerson;
}

export const toViewRows = (entries: PipelineEntry[], tags: Map<string, string[]>): ViewRow[] =>
  entries.map((e) => ({ roleId: e.roleId, column: e.column, source: rowSource(e), tagIds: tags.get(e.personId) ?? [] }));

export type ViewDepartment = { id: string; path: string; roleIds: string[] };
export type ViewsRead = {
  rows: ViewRow[];
  departments: ViewDepartment[];
  tags: { id: string; name: string }[];
  /** A job is past what the board can read, so a count may stop short (PipelineRead's `capped`). */
  capped: boolean;
};

/** The live departments on offer, each with its jobs and those of the departments inside it. */
export function viewDepartments(read: DepartmentsRead): ViewDepartment[] {
  return departmentScope(read, null).options.map((o) => ({
    id: o.id,
    path: o.path,
    roleIds: [...(departmentScope(read, o.id).jobIds ?? [])],
  }));
}

/**
 * The org's live labels. Not core's listTags: it counts each label's candidates
 * through the `person_tags` policy, row by row, which ran a hiring manager's
 * token into the statement timeout at 30,000 tagged rows, for a number no view
 * shows.
 */
async function readLabels(db: Db) {
  const { data, error } = await db.from("tags").select("id, name").is("archived_at", null).order("name").limit(TAGS_MAX);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function readViews(db: Db, now: Date): Promise<ViewsRead> {
  const [pipeline, structure, tags] = await Promise.all([readPipeline(db, now), readDepartments(db), readLabels(db)]);
  const byPerson = await readPersonTags(db, pipeline.entries.map((e) => e.personId));
  return { rows: toViewRows(pipeline.entries, byPerson), departments: viewDepartments(structure), tags, capped: pipeline.capped };
}
