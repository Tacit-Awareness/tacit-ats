import { clientTools } from "@tacit-ats/core";

/**
 * Whether a company's Google Workspace delegates Calendar to Tacit's service
 * account, for Settings' Google Workspace section: companies connected before
 * Calendar was part of it (2026-11-02) delegated the two Gmail scopes only, and
 * Google says so only when asked. So Settings asks, for an admin, AS that admin
 * (an address at the verified domain): a token for the two calendar scopes,
 * which Google refuses with unauthorized_client until the domain's admin has
 * added them. Nothing is read with the token.
 *
 * "unknown" for anything else (Google or the signer down, too slow): Settings
 * then shows its general note and no warning, since a failure that is not a
 * refusal says nothing about the entry.
 */
export type CalendarDelegation = "delegated" | "missing" | "unknown";

export const CHECK_TIMEOUT_MS = 5_000;

export async function calendarDelegation(
  signer: clientTools.DelegationSigner,
  email: string,
  opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<CalendarDelegation> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<CalendarDelegation>((resolve) => {
    timer = setTimeout(() => resolve("unknown"), opts.timeoutMs ?? CHECK_TIMEOUT_MS);
  });
  const asked = clientTools
    .delegatedAccessToken(signer, email, clientTools.WORKSPACE_CALENDAR_SCOPES, opts.fetch)
    .then((): CalendarDelegation => "delegated")
    .catch((err: unknown): CalendarDelegation => {
      const message = err instanceof Error ? err.message : "";
      if (/^google delegated token failed: \d+ unauthorized_client$/.test(message)) return "missing";
      // Google's status only; the admin's address stays out of the log.
      console.error("[client-workspace] calendar check failed:", message.replace(/\S+@\S+/g, "<address>").slice(0, 200) || "failed");
      return "unknown";
    });
  try {
    return await Promise.race([asked, late]);
  } finally {
    clearTimeout(timer);
  }
}
