// Relative and without ".js": see the note in api/mcp/route.ts.
import { auditClientCall, clientBreadthExceeded } from "../../../client/audit";
import { bindMember } from "../../../client/bind";
import { clientMcpConfig } from "../../../client/config";
import { handleClientRequest } from "../../../client/handler";

/**
 * The client connector: the MCP server a member of a client org adds to
 * Claude and signs in to with their company's Tacit account. Separate from
 * /api/connector (Tacit's own teammates, another WorkOS environment, Tacit's
 * org only) and from /api/mcp (the iMessage bot's static key). Every tool runs
 * on a database client carrying the member's own token, so RLS decides.
 */
async function handle(request: Request): Promise<Response> {
  return handleClientRequest(request, {
    config: clientMcpConfig(),
    bind: bindMember,
    audit: auditClientCall,
    breadth: clientBreadthExceeded,
  });
}

export const maxDuration = 60;

export { handle as GET, handle as POST, handle as DELETE };
