// Relative and without ".js": see the note in api/mcp/route.ts.
import { clientMcpConfig } from "../../../../client/config";
import { connectorConfig, resourceMetadata } from "../../../../connector/auth";

/**
 * OAuth protected resource metadata (RFC 9728): tells an MCP client which
 * authorization server to sign in with. Two resources live on this host, each
 * with its own WorkOS environment, and RFC 9728 puts the resource's path after
 * the well-known segment, so the path picks: `/api/client` is the client
 * connector, anything else (the root, `/api/connector`) the staff connector.
 * Each 401 challenge points at its own path-suffixed URL.
 */
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
};

export async function GET(_request: Request, ctx: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  const path = ((await ctx.params).path ?? []).join("/");
  const config = path === "api/client" ? clientMcpConfig() : connectorConfig();
  if (!config) return new Response(null, { status: 404 });
  return Response.json(resourceMetadata(config), { headers: { ...cors, "cache-control": "max-age=3600" } });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: cors });
}
