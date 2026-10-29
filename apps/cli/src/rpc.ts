import { accessToken, AuthRequired, type AuthDeps } from "./oauth.js";
import type { Catalog, Tool } from "./store.js";
import { VERSION } from "./version.js";

/**
 * One JSON-RPC request to the connector per call. The connector is stateless
 * (apps/mcp's mcp-handler), so a tools/call needs no initialize first, and
 * nothing runs between commands: no server process, no session to resume.
 */

export const PROTOCOL_VERSION = "2025-06-18";

export class Refused extends Error {}

export type ToolResult = {
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** mcp-handler answers in an event stream; the payload is the data line. */
function parsePayload(body: string): { result?: unknown; error?: { message?: string } } {
  const line = body.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse((line ?? body).replace(/^data: /, ""));
}

export async function rpc<T>(server: string, method: string, params: Record<string, unknown>, deps: AuthDeps): Promise<T> {
  const send = async (token: string) =>
    deps.fetch(server, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        "mcp-protocol-version": PROTOCOL_VERSION,
        "user-agent": `tats/${VERSION}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });

  let res = await send(await accessToken(server, deps));
  // A token the server no longer takes may still refresh; once, then a new login.
  if (res.status === 401) res = await send(await accessToken(server, deps, true));
  if (res.status === 401) throw new AuthRequired("Tacit did not accept your sign-in. Run: tats login");
  if (res.status === 403) {
    const body = (await res.json().catch(() => null)) as { error_description?: string } | null;
    throw new Refused(body?.error_description ?? "Tacit refused this account.");
  }
  if (!res.ok) throw new Error(`Tacit answered ${res.status}. Try again in a moment.`);
  const payload = parsePayload(await res.text());
  if (payload.error) throw new Error(payload.error.message ?? "The request was not valid.");
  return payload.result as T;
}

export const callTool = (server: string, name: string, args: Record<string, unknown>, deps: AuthDeps) =>
  rpc<ToolResult>(server, "tools/call", { name, arguments: args }, deps);

/** The tool list and the server's instructions, as the connector gives them to Claude. */
export async function fetchCatalog(server: string, deps: AuthDeps): Promise<Catalog> {
  const init = await rpc<{ instructions?: string }>(
    server,
    "initialize",
    { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "tats", version: VERSION } },
    deps,
  );
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await rpc<{ tools: Tool[]; nextCursor?: string }>(server, "tools/list", cursor ? { cursor } : {}, deps);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return { fetched_at: deps.now(), instructions: init.instructions ?? null, tools };
}

const CATALOG_TTL_MS = 6 * 60 * 60_000;

/** The cached catalog while it is fresh, else a new one. `refresh` forces it. */
export async function catalog(server: string, deps: AuthDeps, refresh = false): Promise<Catalog> {
  const cached = refresh ? null : await deps.store.catalog(server);
  if (cached && deps.now() - cached.fetched_at < CATALOG_TTL_MS) return cached;
  const fresh = await fetchCatalog(server, deps);
  await deps.store.saveCatalog(server, fresh);
  return fresh;
}
