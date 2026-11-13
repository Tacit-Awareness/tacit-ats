/**
 * Tacit's staff connector (tacit-internal's apps/mcp /api/connector) signs in
 * through this project's OAuth server too, so Tacit's team uses the same
 * account as in the ATS. Supabase has one consent path per project, this
 * app's /client/oauth/consent, so an authorization for the staff connector
 * lands here first; it is handed over, before any sign-in or ATS screen, to
 * the consent page on internal.tacitawareness.com, which shows it as Tacit
 * Internal and approves there on the person's own token
 * (supabase/migrations/20261114000000_staff_connector_consent.sql).
 *
 * The lookup is the anon key's `connector_authorization_resource`: only the
 * connector URL of a pending authorization whose id the request already
 * carries. Anything else (no id, not pending, another connector, the lookup
 * failing) is left to this app's own consent page, which approves only
 * CLIENT_MCP_RESOURCE_URL.
 */

export const CLIENT_CONSENT_PATH = "/client/oauth/consent";

const trim = (s: string) => s.trim().replace(/\/+$/, "");

/** STAFF_CONNECTOR_RESOURCE_URL and STAFF_CONSENT_URL, production's by default. */
export function staffConnector(env: Record<string, string | undefined> = process.env): { resource: string; consentUrl: string } {
  return {
    resource: trim(env.STAFF_CONNECTOR_RESOURCE_URL || "https://mcp.tacitawareness.com/api/connector"),
    consentUrl: trim(env.STAFF_CONSENT_URL || "https://internal.tacitawareness.com/oauth/consent"),
  };
}

/** Where to send this consent request instead, or null to show this app's own. */
export async function staffConsentRedirect(
  url: URL,
  env: Record<string, string | undefined> = process.env,
  doFetch: typeof fetch = fetch,
): Promise<URL | null> {
  if (url.pathname !== CLIENT_CONSENT_PATH) return null;
  const id = url.searchParams.get("authorization_id");
  if (!id || id.length > 256) return null;
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !key) return null;

  let resource: unknown;
  try {
    const response = await doFetch(`${trim(supabaseUrl)}/rest/v1/rpc/connector_authorization_resource`, {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ p_authorization_id: id }),
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    resource = await response.json();
  } catch {
    return null;
  }
  const staff = staffConnector(env);
  if (typeof resource !== "string" || trim(resource) !== staff.resource) return null;
  const to = new URL(staff.consentUrl);
  to.searchParams.set("authorization_id", id);
  return to;
}
