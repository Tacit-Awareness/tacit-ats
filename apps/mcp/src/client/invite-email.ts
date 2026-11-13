import type { IdentityProvider } from "@tacit/core";
import type { InvitationRevoker } from "@tacit-ats/core";
import { getSupabaseServiceClient } from "@tacit/db";

/**
 * invite_member's email when Supabase Auth signs members in
 * (CLIENT_AUTH_PROVIDER=supabase), in place of client/workos.ts. The same as
 * apps/web's lib/client/invite-email.ts: the actor is written first on the
 * admin's own token by invite_org_member, then this sends Supabase's invite
 * email (supabase/templates/invite.html) to that address. Someone who already
 * has an account gets none: they sign in as they do and choose the company.
 * Functions only, never the client (src/client-connector.test.ts).
 */
export function supabaseInvitations(): IdentityProvider & InvitationRevoker {
  return {
    createOrganization: async () => {
      throw new Error("a client member cannot create an organization");
    },
    sendInvitation: async ({ email }) => {
      const { data, error } = await getSupabaseServiceClient().auth.admin.inviteUserByEmail(email);
      if (error) {
        if (error.code === "email_exists" || /already been registered/i.test(error.message)) return { id: "existing-account" };
        throw new Error(error.message);
      }
      return { id: data.user.id };
    },
    // Supabase can't recall an invitation email; withdrawing deletes the unbound actor, so the link binds nobody.
    revokeInvitations: async () => {},
  };
}
