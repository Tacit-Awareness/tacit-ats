import { getWorkOS } from "@workos-inc/authkit-nextjs";
import type { IdentityProvider, InvitationRevoker } from "@tacit/core";

/**
 * WorkOS for the client area's own invitations (/client/team): send one, and
 * revoke what is still pending for an address. The same WorkOS client AuthKit
 * signs members in with; no database client here. Creating organizations is
 * staff-only (lib/orgs-admin.ts) and is refused from this side.
 */
export function clientInvitations(): IdentityProvider & InvitationRevoker {
  const workos = getWorkOS();
  return {
    createOrganization: async () => {
      throw new Error("a client member cannot create an organization");
    },
    sendInvitation: async ({ email, organizationId, inviterUserId }) => {
      const invitation = await workos.userManagement.sendInvitation({ email, organizationId, inviterUserId });
      return { id: invitation.id };
    },
    revokeInvitations: async ({ email, organizationId }) => {
      const list = await workos.userManagement.listInvitations({ email, organizationId });
      for (const invitation of list.data) {
        if (invitation.state === "pending") await workos.userManagement.revokeInvitation(invitation.id);
      }
    },
  };
}
