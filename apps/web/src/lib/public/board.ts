// The public careers board's list (design/careers): roles by team. Pure, and
// free of the database client, so the board's client component can import it.

export type BoardRole = { slug: string; title: string; location: string | null; department: string | null };
export type BoardGroup = { name: string | null; roles: BoardRole[] };

/**
 * Departments by name, roles by title, the ones in no department last under
 * Other. With no departments at all there is one group with no name, so the
 * page draws a plain list.
 */
export function groupBoard(roles: BoardRole[]): BoardGroup[] {
  const byTitle = (a: BoardRole, b: BoardRole) => a.title.localeCompare(b.title);
  const names = [...new Set(roles.flatMap((r) => (r.department ? [r.department] : [])))].sort((a, b) => a.localeCompare(b));
  if (names.length === 0) return roles.length ? [{ name: null, roles: [...roles].sort(byTitle) }] : [];
  const groups: BoardGroup[] = names.map((name) => ({ name, roles: roles.filter((r) => r.department === name).sort(byTitle) }));
  const rest = roles.filter((r) => !r.department).sort(byTitle);
  return rest.length ? [...groups, { name: "Other", roles: rest }] : groups;
}

/** A case-insensitive match on title, team and location. */
export function matchRole(role: BoardRole, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || [role.title, role.department, role.location].some((v) => v?.toLowerCase().includes(q));
}
