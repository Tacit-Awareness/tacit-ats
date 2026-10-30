// Connecting a member's Google Calendar (/client/calendar): Google's OAuth
// consent and code exchange. Pure apart from the fetch it is given, so the
// unit tests can drive it. The refresh token goes straight into the database
// through client_connect_calendar on the member's own token
// (calendar_connections, tacit-internal migration 20261017120000), which no
// member token can read back; the client connector (apps/mcp) and the Calendar's
// route (lib/member-calendar) book with it.

type Env = Record<string, string | undefined>;

export const CALENDAR_PATH = "/client/calendar";
export const CALENDAR_CALLBACK_PATH = "/client/calendar/callback";
/** The state cookie: set by /connect, checked and cleared by /callback. */
export const CALENDAR_STATE_COOKIE = "tacit_calendar_state";

/** Busy times, and the events Tacit books. Nothing else: not the events' contents, not mail. */
export const CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type GoogleCalendarConfig = { clientId: string; clientSecret: string };

/** Null until both are set: the Calendar page then says it is not set up. */
export function googleCalendarConfig(env: Env = process.env): GoogleCalendarConfig | null {
  const clientId = env.CLIENT_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.CLIENT_GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Registered in the Google Cloud console as an authorized redirect URI. */
export const calendarRedirectUri = (origin: string) => `${origin}${CALENDAR_CALLBACK_PATH}`;

export function calendarConsentUrl(config: GoogleCalendarConfig, redirectUri: string, state: string, loginHint?: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CALENDAR_SCOPES.join(" "));
  // A refresh token every time, so connecting again replaces a revoked grant.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", state);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

export type CalendarGrant = { refreshToken: string; accountEmail: string; scopes: string };

export type CalendarExchangeError = "exchange_failed" | "no_refresh_token" | "missing_scopes" | "no_email";

export class CalendarConnectError extends Error {
  constructor(readonly code: CalendarExchangeError) {
    super(`google calendar connect: ${code}`);
    this.name = "CalendarConnectError";
  }
}

/** The id_token's email claim. It came straight from Google's token endpoint over TLS, so it is not re-verified. */
function emailFrom(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      email?: unknown; email_verified?: unknown;
    };
    return typeof payload.email === "string" && payload.email_verified !== false ? payload.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Trades the consent's code for the grant, refusing one without both calendar scopes or a refresh token. */
export async function exchangeCalendarCode(
  config: GoogleCalendarConfig,
  redirectUri: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CalendarGrant> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: config.clientId, client_secret: config.clientSecret,
    }),
  });
  const json = (await res.json().catch(() => null)) as
    | { refresh_token?: unknown; scope?: unknown; id_token?: unknown }
    | null;
  if (!res.ok || !json) throw new CalendarConnectError("exchange_failed");
  const scopes = typeof json.scope === "string" ? json.scope : "";
  const granted = new Set(scopes.split(/\s+/));
  if (!CALENDAR_SCOPES.filter((s) => s.startsWith("https://")).every((s) => granted.has(s))) {
    throw new CalendarConnectError("missing_scopes");
  }
  if (typeof json.refresh_token !== "string" || !json.refresh_token) throw new CalendarConnectError("no_refresh_token");
  const accountEmail = emailFrom(json.id_token);
  if (!accountEmail) throw new CalendarConnectError("no_email");
  return { refreshToken: json.refresh_token, accountEmail, scopes };
}
