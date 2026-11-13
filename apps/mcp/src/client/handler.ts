import type { JWTVerifyGetKey } from "jose";
import { connector, type IdentityProvider } from "@tacit/core";
import { clientTools, type BindSupabaseResult, type InvitationRevoker } from "@tacit-ats/core";

// Relative and without ".js": see apps/mcp/CLAUDE.md.
import { challenge, verifyAccessToken } from "./oauth";
import type { ClientMcpConfig } from "./config";
import { buildClientHandler, type ClientHandlerDeps } from "./server";
import { REFUSAL_TEXT, resolveMember } from "./session";

/**
 * The client connector, request to response. The route (app/api/client)
 * passes the real dependencies; tests pass a local key and a stand-in for
 * binding and invitations.
 *
 *   not configured                        503
 *   no or bad token                       401 + WWW-Authenticate (starts sign-in)
 *   valid token, not an invited member    403, with the reason in a sentence
 *   valid token, member                   the MCP handler, as that member
 */
export type ClientRequestDeps = Omit<ClientHandlerDeps, "invitations" | "files" | "email" | "jobsOrigin"> & {
  /** Sends invitations: Supabase Auth's invite email (client/invite-email.ts), or a stand-in in tests. Absent or null = invite_member refuses. */
  invitations?: (IdentityProvider & InvitationRevoker) | null;
  /** Candidates' files in Storage (client/files.ts, or a stand-in in tests). Absent or null = the file tools refuse. */
  files?: clientTools.FileStore | null;
  /** Candidate email's delivery (config.ts clientMailer, or a stand-in in tests). Absent or null = email is off. */
  email?: clientTools.ClientMailer | null;
  config: ClientMcpConfig | null;
  /** A first sign-in (client/bind.ts's bindSupabaseMember). */
  bindSupabase: (userId: string) => Promise<BindSupabaseResult>;
  /** Verifies against this instead of the issuer's JWKS (tests). */
  keys?: JWTVerifyGetKey;
};

export async function handleClientRequest(request: Request, deps: ClientRequestDeps): Promise<Response> {
  const { config } = deps;
  if (!config) return new Response("The client connector is not configured on this deployment.", { status: 503 });

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return challenge(config);
  const token = authorization.slice("Bearer ".length).trim();

  let claims;
  try {
    claims = deps.keys ? await verifyAccessToken(token, config, deps.keys) : await verifyAccessToken(token, config);
  } catch {
    return challenge(config, { code: "invalid_token", description: "The access token is missing, expired or not valid for this server." });
  }

  const gate = await resolveMember(claims, {
    supabaseUrl: config.supabaseUrl,
    publishableKey: config.publishableKey,
    bindSupabase: deps.bindSupabase,
  });
  if (gate.status === "forbidden") {
    console.warn(`[client-mcp] refused subject ${claims.subject}: ${gate.reason}`);
    return Response.json({ error: "forbidden", error_description: REFUSAL_TEXT[gate.reason] }, { status: 403 });
  }
  // The handler is stateless, so a tool call does not carry initialize's clientInfo: the User-Agent decides.
  const source = clientSource(request.headers.get("user-agent"));
  const invitations = deps.invitations ?? null;
  return buildClientHandler(gate.member, source, { audit: deps.audit, breadth: deps.breadth, invitations, files: deps.files ?? null, email: deps.email ?? null,
    jobsOrigin: config.jobsOrigin ?? null, calendar: deps.calendar ?? null, granola: deps.granola ?? null,
  })(request);
}

/** tats (apps/cli) sends `tats/<version>`; anything else is Claude unless it says ChatGPT. */
export function clientSource(userAgent: string | null): clientTools.ClientToolCtx["source"] {
  if (userAgent?.startsWith("tats/")) return "cli";
  return connector.sourceFromClient(null, userAgent) === "chatgpt" ? "chatgpt" : "claude";
}
