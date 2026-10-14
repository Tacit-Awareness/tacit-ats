import type { JWTVerifyGetKey } from "jose";
import { connector, type BindClientResult, type ClientIdentity, type IdentityProvider, type InvitationRevoker } from "@tacit/core";

// Relative and without ".js": see the note in app/api/mcp/route.ts.
import { challenge, verifyAccessToken } from "../connector/auth";
import type { ClientMcpConfig } from "./config";
import { buildClientHandler, type ClientHandlerDeps } from "./server";
import { REFUSAL_TEXT, resolveMember } from "./session";
import { clientInvitations, fetchVerifiedEmail, soleOrganization } from "./workos";

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
export type ClientRequestDeps = Omit<ClientHandlerDeps, "invitations"> & {
  /** Sends and revokes invitations (tests); otherwise WorkOS with CLIENT_WORKOS_API_KEY, or none. */
  invitations?: (IdentityProvider & InvitationRevoker) | null;
  config: ClientMcpConfig | null;
  bind: (who: ClientIdentity) => Promise<BindClientResult>;
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
    soleOrganization: apiKey ? (subject) => soleOrganization(subject, apiKey, deps.workosFetch) : null,
    verifiedEmail: apiKey ? (subject) => fetchVerifiedEmail(subject, apiKey, deps.workosFetch) : null,
  });
  if (gate.status === "forbidden") {
    console.warn(`[client-mcp] refused subject ${claims.subject}: ${gate.reason}`);
    return Response.json({ error: "forbidden", error_description: REFUSAL_TEXT[gate.reason] }, { status: 403 });
  }
  // The handler is stateless, so a tool call does not carry initialize's clientInfo: the User-Agent decides.
  const source = connector.sourceFromClient(null, request.headers.get("user-agent")) === "chatgpt" ? "chatgpt" : "claude";
  const invitations = deps.invitations !== undefined ? deps.invitations : apiKey ? clientInvitations(apiKey, deps.workosFetch) : null;
  return buildClientHandler(gate.member, source, { audit: deps.audit, breadth: deps.breadth, invitations })(request);
}
