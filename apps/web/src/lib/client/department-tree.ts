// The department filter on Home, the Pipeline and the CRM (design/tats's
// team filter: the data model's teams are departments, which nest). Pure:
// lib/client/departments.ts reads the departments and each job's one, this
// works out which jobs a picked department covers. A department matches
// itself and every department inside it, at any depth, as the client
// connector's list_jobs `department` filter does (@tacit-ats/core's
// structure.ts, departmentAndBelow).

export type DepartmentNode = { id: string; name: string; parentId: string | null; archived: boolean };

/** A department the filter offers: a live one, with its path from the outermost ("Engineering › Platform"). */
export type DepartmentOption = { id: string; name: string; path: string; depth: number };

export type JobDepartment = { jobId: string; departmentId: string | null };

export type DepartmentsRead = { departments: DepartmentNode[]; jobs: JobDepartment[] };

/** What the filter offers and what the picked one covers; `jobIds` is null when nothing narrows. */
export type DepartmentScope = { options: DepartmentOption[]; departmentId: string | null; jobIds: Set<string> | null };

/** The names from the outermost department in to this one; a loop or a missing parent stops the walk. */
function ancestry(byId: Map<string, DepartmentNode>, node: DepartmentNode): string[] {
  const names = [node.name];
  const seen = new Set([node.id]);
  for (let p = node.parentId; p && !seen.has(p); p = byId.get(p)?.parentId ?? null) {
    seen.add(p);
    const parent = byId.get(p);
    if (!parent) break;
    names.unshift(parent.name);
  }
  return names;
}

/** The live departments, each under its parent (ordered by path); archived ones are never offered. */
export function departmentOptions(rows: DepartmentNode[]): DepartmentOption[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows
    .filter((r) => !r.archived)
    .map((r) => {
      const names = ancestry(byId, r);
      return { id: r.id, name: r.name, path: names.join(" › "), depth: names.length - 1, key: names.map((n) => n.toLocaleLowerCase()) };
    })
    .sort((a, b) => {
      for (let i = 0; i < Math.min(a.key.length, b.key.length); i++) {
        const d = a.key[i].localeCompare(b.key[i]);
        if (d) return d;
      }
      return a.key.length - b.key.length;
    })
    .map(({ key: _key, ...o }) => o);
}

/** This department and every one inside it, at any depth, archived ones included (their jobs are still in it). */
export function departmentAndBelow(rows: DepartmentNode[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of rows) {
      if (r.parentId && out.has(r.parentId) && !out.has(r.id)) {
        out.add(r.id);
        grew = true;
      }
    }
  }
  return out;
}

/** The jobs in a department or any department inside it. */
export function jobsInDepartment(read: DepartmentsRead, departmentId: string): Set<string> {
  const ids = departmentAndBelow(read.departments, departmentId);
  return new Set(read.jobs.filter((j) => j.departmentId && ids.has(j.departmentId)).map((j) => j.jobId));
}

/**
 * The URL's `?department=`, checked against the live departments: anything
 * else (an archived one, another org's, garbage) is no filter. An org with no
 * live departments gets no options, so the pages show no filter at all.
 */
export function departmentScope(read: DepartmentsRead, raw: string | null | undefined): DepartmentScope {
  const options = departmentOptions(read.departments);
  const departmentId = options.some((o) => o.id === raw) ? raw! : null;
  return { options, departmentId, jobIds: departmentId ? jobsInDepartment(read, departmentId) : null };
}

/** Whether a job is in scope: every job when nothing narrows. */
export const inScope = (scope: DepartmentScope, jobId: string) => !scope.jobIds || scope.jobIds.has(jobId);

/** The filter's tabs, "All departments" first; none at all for an org with no departments. */
export function departmentTabs(scope: DepartmentScope, href: (departmentId: string | null) => string) {
  if (!scope.options.length) return [];
  return [
    { href: href(null), label: "All departments", active: scope.departmentId === null },
    ...scope.options.map((o) => ({ href: href(o.id), label: o.path, active: scope.departmentId === o.id })),
  ];
}
