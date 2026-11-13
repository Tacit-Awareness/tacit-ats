import { connector } from "@tacit/core";
import { clientTools } from "@tacit-ats/core";
/**
 * The client connector's settings (/api/client). Members sign in through
 * Supabase Auth's OAuth 2.1 server on this project (tacit-ats); the token
 * audience is this connector's own URL, so no other connector's token passes.
 */
export type ClientMcpConfig = {
  /** The token issuer: `<SUPABASE_URL>/auth/v1`. */
  issuer: string;
  /** This server's public URL, e.g. https://ats-mcp.tacitawareness.com/api/client: the token audience. */
  resource: string;
  supabaseUrl: string;
  publishableKey: string;
  /**
   * The origin of the site serving public job posts (apps/web's /jobs/[slug]),
   * for the links the job-post tools return (CLIENT_JOBS_ORIGIN). Null or
   * absent = they return no link.
   */
  jobsOrigin?: string | null;
};

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/**
 * Null when anything required is missing: the route then answers 503. There is
 * no fallback to another database client, since every tool must run as the
 * member and nothing else.
 */
export function clientMcpConfig(env: Record<string, string | undefined> = process.env): ClientMcpConfig | null {
  const resource = env.CLIENT_MCP_RESOURCE_URL?.trim();
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!resource || !supabaseUrl || !publishableKey) return null;
  return {
    issuer: `${trimSlash(supabaseUrl)}/auth/v1`,
    resource: trimSlash(resource),
    supabaseUrl,
    publishableKey,
    jobsOrigin: (() => {
      const origin = env.CLIENT_JOBS_ORIGIN?.trim();
      return origin ? trimSlash(origin) : null;
    })(),
  };
}

/** The address client email goes out From when CLIENT_EMAIL_FROM is unset: Tacit's own domain, verified in Resend. */
export const DEFAULT_CLIENT_EMAIL_FROM = "hiring@tacitawareness.com";
const PLAIN_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/**
 * How the client connector's candidate email is delivered. Null turns it off
 * (CLIENT_EMAIL_DISABLED set, or a CLIENT_EMAIL_FROM that is not an address):
 * draft_email and send_email then refuse in a sentence, and templates still
 * work. Without RESEND_API_KEY drafts are written and send_email says sending
 * is not set up. Every email is From CLIENT_EMAIL_FROM (a Tacit-controlled
 * address, since a client's own domain is not one Tacit can send from) under
 * the member's name, with Reply-To the member's own address, or with
 * CLIENT_EMAIL_REPLY_DOMAIN set that email's own address for replies.
 */
export function clientMailer(env: Record<string, string | undefined> = process.env): clientTools.ClientMailer | null {
  if (env.CLIENT_EMAIL_DISABLED?.trim()) return null;
  const fromAddress = env.CLIENT_EMAIL_FROM?.trim() || DEFAULT_CLIENT_EMAIL_FROM;
  if (!PLAIN_EMAIL.test(fromAddress)) {
    console.error("[client-mcp] CLIENT_EMAIL_FROM is not an email address; candidate email is off");
    return null;
  }
  const apiKey = env.RESEND_API_KEY?.trim();
  return { send: apiKey ? connector.makeResendSender({ apiKey }) : null, fromAddress, replyDomain: clientTools.parseReplyDomain(env.CLIENT_EMAIL_REPLY_DOMAIN) };
}

/** Where a member connects Granola (apps/web /client/settings), from CLIENT_JOBS_ORIGIN, apps/web's origin. */
export function granolaConnectUrl(env: Record<string, string | undefined> = process.env): string | null {
  const origin = env.CLIENT_JOBS_ORIGIN?.trim();
  return origin ? `${trimSlash(origin)}/client/settings` : null;
}

/**
 * The Google OAuth client members connect their calendars to (apps/web's
 * /client/calendar, the same CLIENT_GOOGLE_CLIENT_ID / _SECRET there): the
 * connector refreshes their grants with it. Null when either is unset:
 * find_interview_times refuses and interviews are recorded in Tacit only.
 * The connect page is named from CLIENT_JOBS_ORIGIN, which is apps/web's origin.
 */
export function clientGoogleCalendar(
  env: Record<string, string | undefined> = process.env,
): { clientId: string; clientSecret: string; connectUrl: string | null } | null {
  const clientId = env.CLIENT_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.CLIENT_GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const origin = env.CLIENT_JOBS_ORIGIN?.trim();
  return { clientId, clientSecret, connectUrl: origin ? `${trimSlash(origin)}/client/calendar` : null };
}
