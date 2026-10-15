import { connector } from "@tacit/core";
import type { clientTools } from "@tacit-ats/core";
import { parseTacitSigningKey, type MemberTokenSigner } from "@tacit/db";

/**
 * The client connector's settings (/api/client). Separate from the staff
 * connector's (Tacit-Awareness's apps/mcp/src/connector/auth.ts) on purpose:
 * clients sign in through the WorkOS environment that holds their organizations (the same one the /client
 * portal uses), teammates through another, and the two must never share a
 * token audience.
 */
export type ClientMcpConfig = {
  /** The AuthKit domain of the clients' WorkOS environment: the token issuer. */
  issuer: string;
  /** This server's public URL, e.g. https://mcp.tacitawareness.com/api/client: the token audience. */
  resource: string;
  /**
   * That environment's API key. Looks up a verified email on a first sign-in
   * whose token has none, and the user's organization when the token names
   * none. Null = both are taken from the token alone.
   */
  workosApiKey: string | null;
  supabaseUrl: string;
  publishableKey: string;
  /** Signs the per-request database token (@tacit/db's mintClientMemberToken). */
  signer: MemberTokenSigner;
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
  const issuer = env.CLIENT_MCP_AUTHKIT_DOMAIN?.trim();
  const resource = env.CLIENT_MCP_RESOURCE_URL?.trim();
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const rawKey = env.SUPABASE_TACIT_SIGNING_KEY?.trim();
  if (!issuer || !resource || !supabaseUrl || !publishableKey || !rawKey) return null;
  return {
    issuer: trimSlash(issuer.startsWith("http") ? issuer : `https://${issuer}`),
    resource: trimSlash(resource),
    workosApiKey: env.CLIENT_WORKOS_API_KEY?.trim() || null,
    supabaseUrl,
    publishableKey,
    signer: parseTacitSigningKey(rawKey, env.SUPABASE_TACIT_SIGNING_KEY_ID?.trim() || undefined),
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
 * the member's name, with Reply-To the member's own address.
 */
export function clientMailer(env: Record<string, string | undefined> = process.env): clientTools.ClientMailer | null {
  if (env.CLIENT_EMAIL_DISABLED?.trim()) return null;
  const fromAddress = env.CLIENT_EMAIL_FROM?.trim() || DEFAULT_CLIENT_EMAIL_FROM;
  if (!PLAIN_EMAIL.test(fromAddress)) {
    console.error("[client-mcp] CLIENT_EMAIL_FROM is not an email address; candidate email is off");
    return null;
  }
  const apiKey = env.RESEND_API_KEY?.trim();
  return { send: apiKey ? connector.makeResendSender({ apiKey }) : null, fromAddress };
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
