import type { Db } from "@tacit/db";
import type { DepartmentsRead } from "./department-tree";

// The department filter's read, on the member's OWN client (never a
// privileged one): the org's departments, archived ones too (a job may still
// sit in one, and a live department may sit inside one), and the department
// of every job the member can see, whatever its status (Home counts closed
// jobs' applications too). Read whole, as @tacit-ats/core's structure.ts
// reads them: an org has tens of departments. The policies decide: an
// interviewer reads no departments, so they get no filter.
// lib/client/department-tree.ts does the matching.

/** As structure.ts's STRUCTURE_READ_MAX. */
const DEPARTMENTS_MAX = 500;
/** Rows per request: PostgREST's own maximum. */
const PAGE = 1000;
/** Jobs read at most; a job past it is in no department as far as the filter knows. */
const JOBS_MAX = 5000;

export async function readDepartments(db: Db): Promise<DepartmentsRead> {
  const { data, error } = await db.from("departments").select("id, name, parent_id, archived_at").order("name").limit(DEPARTMENTS_MAX);
  if (error) throw new Error(error.message);
  const departments = (data ?? []).map((d) => ({ id: d.id, name: d.name, parentId: d.parent_id, archived: d.archived_at !== null }));
  // No departments: no filter, so no need to know where the jobs are.
  if (!departments.length) return { departments, jobs: [] };

  const jobs: DepartmentsRead["jobs"] = [];
  for (let from = 0; from < JOBS_MAX; from += PAGE) {
    const { data: roles, error: rolesError } = await db
      .from("roles")
      .select("id, department_id")
      .order("id")
      .range(from, from + PAGE - 1);
    if (rolesError) throw new Error(rolesError.message);
    for (const r of roles ?? []) jobs.push({ jobId: r.id, departmentId: r.department_id });
    if ((roles ?? []).length < PAGE) break;
  }
  return { departments, jobs };
}
