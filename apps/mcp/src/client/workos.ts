/**
 * The two things the client connector may ask WorkOS when the access token
 * does not say: a user's verified email (first sign-in only) and which
 * organization they belong to. `doFetch` is injectable for tests.
 */

const API = "https://api.workos.com/user_management";

export type OrganizationLookup =
  | { status: "ok"; organizationId: string }
  /** Several active memberships: the token has to say which one. */
  | { status: "ambiguous" }
  | { status: "none" };

/**
 * The one organization a user is an active member of. More than one is not
 * guessed between: the user signs in again choosing the organization.
 */
export async function soleOrganization(
  userId: string,
  apiKey: string,
  doFetch: typeof fetch = fetch,
): Promise<OrganizationLookup> {
  const url = `${API}/organization_memberships?user_id=${encodeURIComponent(userId)}&statuses=active&limit=10`;
  const res = await doFetch(url, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return { status: "none" };
  const body = (await res.json().catch(() => null)) as { data?: Array<{ organization_id?: unknown; status?: unknown }> } | null;
  const ids = [...new Set((body?.data ?? [])
    .filter((m) => m.status === undefined || m.status === "active")
    .map((m) => m.organization_id)
    .filter((id): id is string => typeof id === "string" && id !== ""))];
  if (ids.length === 1) return { status: "ok", organizationId: ids[0] };
  return ids.length === 0 ? { status: "none" } : { status: "ambiguous" };
}

export { fetchVerifiedEmail } from "../connector/auth";
