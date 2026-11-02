// Connecting a member's Gmail (/client/mailbox): Google's OAuth consent and
// code exchange, on the same Google OAuth client as the calendar's
// (CLIENT_GOOGLE_CLIENT_ID / _SECRET). Pure apart from the fetch it is given.
// The refresh token goes straight into the database through
// client_connect_mailbox on the member's own token (mailbox_connections,
// tacit-internal 20261106120000), which no member token can read back;
// core's sendEmail sends with it (lib/client/mailbox.ts), and the reply reader
// (lib/inbound/gmail-replies.ts) reads the threads it started.
//
// gmail.send is required. gmail.readonly is asked for and optional: Google's
// consent lets a member untick it, and they then send from Gmail with their
// replies staying in their own mailbox, out of the Inbox.

import { clientTools } from "@tacit-ats/core";
import { emailFrom, type GoogleCalendarConfig } from "./google-calendar";

export const MAILBOX_CALLBACK_PATH = "/client/mailbox/callback";
/** The state cookie: set by /connect, checked and cleared by /callback. */
export const MAILBOX_STATE_COOKIE = "tacit_mailbox_state";

export const MAILBOX_SCOPES = ["openid", "email", clientTools.GMAIL_SEND_SCOPE, clientTools.GMAIL_READ_SCOPE] as const;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Registered in the Google Cloud console as an authorized redirect URI. */
export const mailboxRedirectUri = (origin: string) => `${origin}${MAILBOX_CALLBACK_PATH}`;

export function mailboxConsentUrl(config: GoogleCalendarConfig, redirectUri: string, state: string, loginHint?: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", MAILBOX_SCOPES.join(" "));
  // A refresh token every time, so connecting again replaces a revoked grant.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", state);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

export type MailboxGrant = { refreshToken: string; accountEmail: string; scopes: string; readsReplies: boolean };

export type MailboxExchangeError = "exchange_failed" | "no_refresh_token" | "missing_scopes" | "no_email";

export class MailboxConnectError extends Error {
  constructor(readonly code: MailboxExchangeError) {
    super(`gmail connect: ${code}`);
    this.name = "MailboxConnectError";
  }
}

/** Trades the consent's code for the grant, refusing one that may not send, or has no refresh token or account. */
export async function exchangeMailboxCode(
  config: GoogleCalendarConfig,
  redirectUri: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MailboxGrant> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: config.clientId, client_secret: config.clientSecret,
    }),
  });
  const json = (await res.json().catch(() => null)) as { refresh_token?: unknown; scope?: unknown; id_token?: unknown } | null;
  if (!res.ok || !json) throw new MailboxConnectError("exchange_failed");
  const scopes = typeof json.scope === "string" ? json.scope : "";
  if (!clientTools.grantsScope({ scopes }, clientTools.GMAIL_SEND_SCOPE)) throw new MailboxConnectError("missing_scopes");
  if (typeof json.refresh_token !== "string" || !json.refresh_token) throw new MailboxConnectError("no_refresh_token");
  const accountEmail = emailFrom(json.id_token);
  if (!accountEmail) throw new MailboxConnectError("no_email");
  return { refreshToken: json.refresh_token, accountEmail, scopes, readsReplies: clientTools.grantsScope({ scopes }, clientTools.GMAIL_READ_SCOPE) };
}
