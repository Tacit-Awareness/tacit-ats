// Relative and without ".js": see the note in api/mcp/route.ts.
import { connectorConfig, resourceMetadata } from "../../../../connector/auth";

/**
 * OAuth protected resource metadata (RFC 9728) for the connector: tells an
 * MCP client which authorization server to sign in with. Served at the root
 * well-known path and at the path-suffixed one, since clients try both.
 */
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
};

export function GET(): Response {
  const config = connectorConfig();
  if (!config) return new Response(null, { status: 404 });
  return Response.json(resourceMetadata(config), { headers: { ...cors, "cache-control": "max-age=3600" } });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: cors });
}
