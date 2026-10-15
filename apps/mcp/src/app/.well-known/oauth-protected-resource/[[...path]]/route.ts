// Relative and without ".js": see apps/mcp/CLAUDE.md.
import { clientMcpConfig } from "../../../../client/config";
import { resourceMetadata } from "../../../../client/oauth";

/**
 * OAuth protected resource metadata (RFC 9728): tells an MCP client which
 * authorization server to sign in with. RFC 9728 puts the resource's path
 * after the well-known segment and clients try both forms, so the root and
 * `/api/client` both answer with the client connector's metadata.
 */
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
};

export function GET(): Response {
  const config = clientMcpConfig();
  if (!config) return new Response(null, { status: 404 });
  return Response.json(resourceMetadata(config), { headers: { ...cors, "cache-control": "max-age=3600" } });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: cors });
}
