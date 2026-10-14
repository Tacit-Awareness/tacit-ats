import type { IdentityProvider, InvitationRevoker } from "@tacit/core";

/**
 * WorkOS for the client connector: a user's verified email (first sign-in
 * only) and which organization they belong to, when the access token does not
 * say; and, for invite_member / withdraw_invite, sending and revoking an
 * invitation. `doFetch` is injectable for tests.
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

async function workosError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
  return new Error(`WorkOS ${res.status}${typeof body?.message === "string" ? `: ${body.message}` : ""}`);
}

/**
 * Invitations into the member's own WorkOS organization, the same ones the
 * /client portal sends (apps/internal's lib/client/workos.ts, over the SDK).
 * Creating an organization is staff-only and refused here.
 */
export function clientInvitations(apiKey: string, doFetch: typeof fetch = fetch): IdentityProvider & InvitationRevoker {
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  return {
    createOrganization: async () => {
      throw new Error("a client member cannot create an organization");
    },
    sendInvitation: async ({ email, organizationId, inviterUserId }) => {
      const res = await doFetch(`${API}/invitations`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email, organization_id: organizationId, ...(inviterUserId ? { inviter_user_id: inviterUserId } : {}) }),
      });
      if (!res.ok) throw await workosError(res);
      const body = (await res.json()) as { id: string };
      return { id: body.id };
    },
    revokeInvitations: async ({ email, organizationId }) => {
      const url = `${API}/invitations?email=${encodeURIComponent(email)}&organization_id=${encodeURIComponent(organizationId)}&limit=20`;
      const res = await doFetch(url, { headers });
      if (!res.ok) throw await workosError(res);
      const body = (await res.json()) as { data?: Array<{ id: string; state: string }> };
      for (const invitation of body.data ?? []) {
        if (invitation.state !== "pending") continue;
        const revoked = await doFetch(`${API}/invitations/${encodeURIComponent(invitation.id)}/revoke`, { method: "POST", headers });
        if (!revoked.ok) throw await workosError(revoked);
      }
    },
  };
}
