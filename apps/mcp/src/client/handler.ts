import type { JWTVerifyGetKey } from "jose";
import { connector, type IdentityProvider } from "@tacit/core";
import { clientTools, type BindClientResult, type ClientIdentity, type InvitationRevoker } from "@tacit-ats/core";

// Relative and without ".js": see apps/mcp/CLAUDE.md.
import { challenge, verifyAccessToken } from "./oauth";
import type { ClientMcpConfig } from "./config";
import { buildClientHandler, type ClientHandlerDeps } from "./server";
import { REFUSAL_TEXT, resolveMember } from "./session";
import { clientInvitations, fetchVerifiedEmail, soleOrganization } from "./workos";
import type { BindSupabaseResult } from "@tacit-ats/core";

/**
 * The client connector, request to response. The route (app/api/client)
 * passes the real dependencies; tests pass a local JWKS, an HS256 signer for
 * the local stack, and a fake WorkOS.
 *
 *   not configured                        503
 *   no or bad token                       401 + WWW-Authenticate (starts sign-in)
 *   valid token, not an invited member    403, with the reason in a sentence
 *   valid token, member                   the MCP handler, as that member
 */
export type ClientRequestDeps = Omit<ClientHandlerDeps, "invitations" | "files" | "email" | "jobsOrigin"> & {
  /** Sends and revokes invitations (tests); otherwise WorkOS with CLIENT_WORKOS_API_KEY, or none. */
  invitations?: (IdentityProvider & InvitationRevoker) | null;
  /** Candidates' files in Storage (client/files.ts, or a stand-in in tests). Absent or null = the file tools refuse. */
  files?: clientTools.FileStore | null;
  /** Candidate email's delivery (config.ts clientMailer, or a stand-in in tests). Absent or null = email is off. */
  email?: clientTools.ClientMailer | null;
  config: ClientMcpConfig | null;
  bind: (who: ClientIdentity) => Promise<BindClientResult>;
  /** A Supabase Auth user's first sign-in (client/bind.ts's bindSupabaseMember). Absent = Supabase tokens are refused. */
  bindSupabase?: (userId: string) => Promise<BindSupabaseResult>;
  /** Supabase Auth's invitation email (client/invite-email.ts), used in place of WorkOS's when config.provider is supabase. */
  supabaseInvitations?: () => IdentityProvider & InvitationRevoker;
  /** Verifies against this instead of the issuer's JWKS (tests). */
  keys?: JWTVerifyGetKey;
  /** For the WorkOS API calls (tests). */
  workosFetch?: typeof fetch;
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

  const apiKey = config.workosApiKey;
  const gate = await resolveMember(claims, {
    supabaseUrl: config.supabaseUrl,
    publishableKey: config.publishableKey,
    signer: config.signer,
    bind: deps.bind,
    bindSupabase: deps.bindSupabase,
    soleOrganization: apiKey ? (subject) => soleOrganization(subject, apiKey, deps.workosFetch) : null,
    verifiedEmail: apiKey ? (subject) => fetchVerifiedEmail(subject, apiKey, deps.workosFetch) : null,
  });
  if (gate.status === "forbidden") {
    console.warn(`[client-mcp] refused subject ${claims.subject}: ${gate.reason}`);
    return Response.json({ error: "forbidden", error_description: REFUSAL_TEXT[gate.reason] }, { status: 403 });
  }
  // The handler is stateless, so a tool call does not carry initialize's clientInfo: the User-Agent decides.
  const source = clientSource(request.headers.get("user-agent"));
  const invitations =
    deps.invitations !== undefined ? deps.invitations
    : config.provider === "supabase" ? (deps.supabaseInvitations?.() ?? null)
    : apiKey ? clientInvitations(apiKey, deps.workosFetch) : null;
  return buildClientHandler(gate.member, source, { audit: deps.audit, breadth: deps.breadth, invitations, files: deps.files ?? null, email: deps.email ?? null,
    jobsOrigin: config.jobsOrigin ?? null, calendar: deps.calendar ?? null, granola: deps.granola ?? null,
  })(request);
}

/** tats (apps/cli) sends `tats/<version>`; anything else is Claude unless it says ChatGPT. */
export function clientSource(userAgent: string | null): clientTools.ClientToolCtx["source"] {
  if (userAgent?.startsWith("tats/")) return "cli";
  return connector.sourceFromClient(null, userAgent) === "chatgpt" ? "chatgpt" : "claude";
}
