/**
 * The client connector's tools (apps/mcp /api/client), the client-org
 * counterpart of ../connector. Every function here takes the MEMBER'S OWN
 * database client: the one apps/mcp builds from a member token, on which the
 * policies (20261013120000_client_permissions) decide every read and write.
 * Nothing here takes or builds another client, and nothing filters by org or
 * access level in code: a function that would need to is reading the wrong
 * way. What the code does check is only what makes an answer clearer, never
 * what makes it safe (whether a write is allowed, to say so before trying).
 */

export type AccessLevel = "limited" | "elevated" | "admin";

/** Who is calling, as the database resolved them. */
export type ClientToolCtx = {
  actorId: string;
  /** Tacit's id for the member's org (orgs.id). */
  orgId: string;
  accessLevel: AccessLevel;
  /**
   * Where the call came from, for the audit row: cli is tats, tacit-ats's
   * command line (tacit-internal 20261029200000_client_cli_source).
   */
  source: "claude" | "chatgpt" | "cli";
};

export type ClientToolErrorCode = "not_found" | "forbidden" | "invalid" | "rate_limited";

/** A refusal with a sentence the calling model can act on. */
export class ClientToolError extends Error {
  constructor(
    readonly code: ClientToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ClientToolError";
  }
}

export const LIST_MAX = 50;
export const NOTE_MAX = 5000;
