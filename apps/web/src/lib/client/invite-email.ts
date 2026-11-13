import type { IdentityProvider } from "@tacit/core";
import type { InvitationRevoker } from "@tacit-ats/core";
import { getSupabaseServiceClient } from "@tacit/db";

/**
 * Invitation emails, from Supabase Auth. The
 * actor is still written first on the admin's own token (`invite_org_member`
 * decides who may invite, and into which company); this only sends the email,
 * which needs Supabase's admin API, so it is one of the client area's
 * privileged modules (src/client-area.test.ts). It hands back functions and
 * never the client, and takes only the address the definer function accepted.
 *
 * The email is supabase/templates/invite.html: its link verifies at
 * /client/auth/confirm and goes on to choose a password; the first sign-in
 * then binds the invited actor by that verified address (core's
 * bindSupabaseUser). Someone who already has an account (another company
 * invited them first) gets no email: they sign in as they do and the new
 * company is there, in the company picker.
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
    // Supabase can't take an invitation email back. Withdrawing deletes the
    // unbound actor (core's withdrawClientInvite), so the link signs into nothing.
    revokeInvitations: async () => {},
  };
}
