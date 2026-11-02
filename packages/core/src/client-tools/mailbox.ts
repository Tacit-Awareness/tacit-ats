import { createSign } from "node:crypto";

import { refreshGoogleAccessToken } from "@tacit/core";
import type { Db } from "@tacit/db";

import type { ClientToolCtx } from "./context.js";

/**
 * Which Gmail a member's candidate email goes through, the way Ashby does it
 * (mailbox tables: tacit-internal 20261106120000_client_mailbox).
 *
 * First the company's Google Workspace: its admin delegated gmail.send and
 * gmail.readonly to Tacit's service account (domain-wide delegation), and one
 * of the company's admins verified it (google_workspace_connections). Then any
 * member above interviewer whose own address is at that domain is covered with
 * nothing to connect: Tacit asks Google for a token AS them. A member who
 * turned their sync off (mailbox_sync_optouts) still sends from Gmail; only the
 * reading stops, so their grant carries the send scope alone.
 *
 * Otherwise the member's own Gmail connected by OAuth (mailbox_connections),
 * whose refresh token no member token can read: the app reads it with the
 * service role, for the ids on the row the member's own token returned.
 *
 * Everything else is read on the MEMBER'S OWN client, so it is always the
 * caller's own company, row and address, and nothing here takes an actor or an
 * org as input.
 */

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
/** Reading a candidate's replies, and the sync, take this too. */
export const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const grantsScope = (grant: { scopes: string }, scope: string) => grant.scopes.split(/\s+/).includes(scope);

/** A member's Gmail: what they send as, what it may do, and a way to an access token. */
export type MailboxGrant = {
  accountEmail: string;
  scopes: string;
  via: "workspace" | "oauth";
  accessToken: () => Promise<string>;
};

/** Tacit's Google service account (its JSON key's fields), with domain-wide delegation. */
export type GoogleServiceAccount = { clientEmail: string; privateKey: string; clientId: string; tokenUri?: string };

export type MailboxSources = {
  /** Null: no company can be connected through its Workspace on this deployment. */
  serviceAccount: GoogleServiceAccount | null;
  /** The OAuth client members' own connections were made to. Null: those are not used. */
  google: { clientId: string; clientSecret: string } | null;
  /** A member's own refresh token, read by the app with the service role. */
  refreshToken: (orgId: string, actorId: string) => Promise<string | null>;
  fetch?: typeof fetch;
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Parses a service account's JSON key, or null when it is not one. */
export function parseServiceAccount(json: string | undefined): GoogleServiceAccount | null {
  if (!json?.trim()) return null;
  try {
    const k = JSON.parse(json) as { client_email?: unknown; private_key?: unknown; client_id?: unknown; token_uri?: unknown };
    if (typeof k.client_email !== "string" || typeof k.private_key !== "string" || typeof k.client_id !== "string") return null;
    return { clientEmail: k.client_email, privateKey: k.private_key, clientId: k.client_id, tokenUri: typeof k.token_uri === "string" ? k.token_uri : undefined };
  } catch {
    return null;
  }
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/**
 * An access token AS `subject`, through the service account's domain-wide
 * delegation (Google's JWT bearer grant). Google refuses unless the subject's
 * Workspace admin delegated these scopes to this service account's client id.
 */
export async function delegatedAccessToken(
  sa: GoogleServiceAccount,
  subject: string,
  scopes: string[],
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<string> {
  const iat = Math.floor(now() / 1000);
  const aud = sa.tokenUri ?? TOKEN_URL;
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: sa.clientEmail, sub: subject, scope: scopes.join(" "), aud, iat, exp: iat + 3600 }),
  )}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.privateKey);
  const res = await fetchImpl(aud, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }),
  });
  const json = (await res.json().catch(() => null)) as { access_token?: unknown; error?: unknown } | null;
  if (!res.ok || typeof json?.access_token !== "string") {
    throw new Error(`google delegated token failed: ${res.status} ${String(json?.error ?? "no access_token")}`);
  }
  return json.access_token;
}

/** The address's domain, lower case, or null. */
export const domainOf = (email: string | null | undefined): string | null => {
  const d = email?.trim().toLowerCase().split("@")[1];
  return d ? d : null;
};

/** The member's own Gmail grant, or null when they have none that may send. */
export async function memberMailbox(db: Db, ctx: ClientToolCtx, sources: MailboxSources): Promise<MailboxGrant | null> {
  if (sources.serviceAccount && ctx.accessLevel !== "limited") {
    const [workspace, me, optout] = await Promise.all([
      db.from("google_workspace_connections").select("domain").maybeSingle(),
      db.from("org_members").select("email").eq("id", ctx.actorId).maybeSingle(),
      db.from("mailbox_sync_optouts").select("actor_id").maybeSingle(),
    ]);
    for (const r of [workspace, me, optout]) if (r.error) throw new Error(r.error.message);
    const email = me.data?.email?.trim().toLowerCase();
    if (workspace.data && email && domainOf(email) === workspace.data.domain) {
      const sa = sources.serviceAccount;
      const scopes = optout.data ? [GMAIL_SEND_SCOPE] : [GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE];
      return {
        accountEmail: email,
        scopes: scopes.join(" "),
        via: "workspace",
        accessToken: () => delegatedAccessToken(sa, email, scopes, sources.fetch),
      };
    }
  }

  if (!sources.google) return null;
  const { data: own, error } = await db.from("mailbox_connections").select("org_id, actor_id, account_email, scopes").maybeSingle();
  if (error) throw new Error(error.message);
  if (!own || !grantsScope(own, GMAIL_SEND_SCOPE)) return null;
  const google = sources.google;
  return {
    accountEmail: own.account_email,
    scopes: own.scopes,
    via: "oauth",
    accessToken: async () => {
      const refreshToken = await sources.refreshToken(own.org_id, own.actor_id);
      if (!refreshToken) throw new Error("the Gmail connection is gone");
      return refreshGoogleAccessToken({ clientId: google.clientId, clientSecret: google.clientSecret, refreshToken, fetchImpl: sources.fetch });
    },
  };
}
