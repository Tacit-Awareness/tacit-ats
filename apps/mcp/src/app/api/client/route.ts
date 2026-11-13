import { getVercelOidcToken } from "@vercel/oidc";
import { clientTools } from "@tacit-ats/core";
// Relative and without ".js": see apps/mcp/CLAUDE.md.
import { auditClientCall, clientBreadthExceeded } from "../../../client/audit";
import { bindSupabaseMember } from "../../../client/bind";
import { supabaseInvitations } from "../../../client/invite-email";
import { calendarConnections } from "../../../client/calendar";
import { clientGoogleCalendar, clientMailer, clientMcpConfig, granolaConnectUrl } from "../../../client/config";
import { putFile, removeFiles, signFileUrl } from "../../../client/files";
import { granolaAccessToken } from "../../../client/granola";
import { mailboxRefreshToken } from "../../../client/mailbox";
import { handleClientRequest } from "../../../client/handler";

/**
 * The client connector: the MCP server a member of a client org adds to
 * Claude and signs in to with their company's Tacit account, through Supabase
 * Auth's OAuth server on this project. Every tool runs
 * on a database client carrying the member's own token, so RLS decides.
 */
async function handle(request: Request): Promise<Response> {
  return handleClientRequest(request, {
    config: clientMcpConfig(),
    bindSupabase: bindSupabaseMember,
    invitations: supabaseInvitations(),
    audit: auditClientCall,
    breadth: clientBreadthExceeded,
    // Set where the private org-files bucket does not exist yet: the file tools then refuse.
    files: process.env.CLIENT_FILES_DISABLED ? null : { put: putFile, signedUrl: signFileUrl, remove: removeFiles },
    // CLIENT_EMAIL_DISABLED set: draft_email and send_email refuse. No RESEND_API_KEY: drafts only,
    // unless the member has connected Gmail, which send_email then sends through as them.
    // Their company's Google Workspace (keyless through Vercel OIDC, GCP_*; or CLIENT_GOOGLE_SERVICE_ACCOUNT) or their own connection.
    email: (() => {
      const mailer = clientMailer();
      const google = clientGoogleCalendar();
      const delegation = clientTools.delegationFrom(process.env, () => getVercelOidcToken());
      if (!mailer || (!google && !delegation)) return mailer;
      const sources: clientTools.MailboxSources = {
        delegation,
        google: google ? { clientId: google.clientId, clientSecret: google.clientSecret } : null,
        refreshToken: mailboxRefreshToken,
      };
      return { ...mailer, mailbox: { own: (db, ctx) => clientTools.memberMailbox(db, ctx, sources) } };
    })(),
    // No CLIENT_GOOGLE_CLIENT_ID / _SECRET: no availability, interviews recorded in Tacit only.
    // With the service account too, a member their company's Google Workspace covers books through it.
    calendar: (() => {
      const google = clientGoogleCalendar();
      if (!google) return null;
      const delegation = clientTools.delegationFrom(process.env, () => getVercelOidcToken());
      return {
        google: { clientId: google.clientId, clientSecret: google.clientSecret },
        connections: (orgId, actorIds) => calendarConnections(orgId, actorIds, { workspace: !!delegation }),
        delegation,
        connectUrl: google.connectUrl,
      };
    })(),
    // A member's own Granola access token, read (and refreshed) with the service role only for the caller.
    granola: { accessToken: (orgId, actorId) => granolaAccessToken(orgId, actorId), connectUrl: granolaConnectUrl() },
  });
}

export const maxDuration = 60;

export { handle as GET, handle as POST, handle as DELETE };
