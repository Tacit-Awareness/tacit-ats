import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { Catalog, Registration, Session, Store, Tool } from "../store.js";

/**
 * A stand-in for the connector and its authorization server, answering
 * through a fetch function: protected resource metadata, AuthKit's metadata,
 * client registration, the token endpoint (checking PKCE and the resource),
 * and the MCP route (checking the bearer). The tool list is a trimmed copy of
 * the real connector's tools/list.
 */

export const SERVER = "https://ats-mcp.test/api/client";
export const ISSUER = "https://auth.test";

export const TOOLS: Tool[] = JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));
export const INSTRUCTIONS = "Your company's hiring workspace in Tacit. Call whoami first.";

export function memoryStore(): Store & { sessions: Map<string, Session>; registrations: Map<string, Registration>; catalogs: Map<string, Catalog> } {
  const sessions = new Map<string, Session>();
  const registrations = new Map<string, Registration>();
  const catalogs = new Map<string, Catalog>();
  return {
    sessions,
    registrations,
    catalogs,
    session: async (s) => sessions.get(s) ?? null,
    registration: async (s) => registrations.get(s) ?? null,
    saveSession: async (s, session) => {
      sessions.set(s, session);
      const { tokens: _, ...reg } = session;
      registrations.set(s, reg);
    },
    forgetTokens: async (s) => sessions.delete(s),
    catalog: async (s) => catalogs.get(s) ?? null,
    saveCatalog: async (s, c) => void catalogs.set(s, c),
  };
}

export type ToolCall = { name: string; arguments: Record<string, unknown>; token: string };

export function fakeTacit(opts: { now: () => number }) {
  const state = {
    /** Access tokens the MCP route accepts. */
    valid: new Set<string>(["access-1"]),
    /** refresh token -> the access token it yields (and rotates to `${it}-next`). */
    refreshable: new Map<string, string>(),
    codes: new Map<string, { challenge: string; redirect: string; client: string }>(),
    clients: [] as { client_id: string; redirect_uris: string[] }[],
    calls: [] as ToolCall[],
    requests: [] as { url: string; method: string; body: string }[],
    /** The answer to tools/call, by tool name. */
    results: new Map<string, unknown>(),
    forbidden: false,
    issued: 0,
  };

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const sse = (body: unknown) => new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, { headers: { "content-type": "text/event-stream" } });

  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    state.requests.push({ url: url.href, method, body });
    const headers = new Headers(init?.headers);

    if (url.href === "https://ats-mcp.test/.well-known/oauth-protected-resource/api/client") {
      return json({ resource: SERVER, authorization_servers: [ISSUER], bearer_methods_supported: ["header"] });
    }
    if (url.href === `${ISSUER}/.well-known/oauth-authorization-server`) {
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth2/authorize`,
        token_endpoint: `${ISSUER}/oauth2/token`,
        registration_endpoint: `${ISSUER}/oauth2/register`,
        scopes_supported: ["openid", "profile", "email", "offline_access"],
      });
    }
    if (url.href === `${ISSUER}/oauth2/register` && method === "POST") {
      const req = JSON.parse(body);
      const client = { client_id: `client-${state.clients.length + 1}`, redirect_uris: req.redirect_uris };
      state.clients.push(client);
      return json(client, 201);
    }
    if (url.href === `${ISSUER}/oauth2/token` && method === "POST") {
      const form = new URLSearchParams(body);
      if (form.get("resource") !== SERVER) return json({ error: "invalid_target" }, 400);
      if (form.get("grant_type") === "authorization_code") {
        const code = state.codes.get(form.get("code") ?? "");
        const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
        if (!code || code.challenge !== challenge || code.redirect !== form.get("redirect_uri") || code.client !== form.get("client_id")) {
          return json({ error: "invalid_grant" }, 400);
        }
        state.codes.delete(form.get("code")!);
        const access = `access-login-${++state.issued}`;
        state.valid.add(access);
        state.refreshable.set(`refresh-${access}`, `${access}-r`);
        return json({ access_token: access, refresh_token: `refresh-${access}`, expires_in: 300, token_type: "Bearer" });
      }
      if (form.get("grant_type") === "refresh_token") {
        const next = state.refreshable.get(form.get("refresh_token") ?? "");
        if (!next) return json({ error: "invalid_grant" }, 400);
        state.refreshable.delete(form.get("refresh_token")!);
        state.valid.add(next);
        state.refreshable.set(`refresh-${next}`, `${next}-r`);
        return json({ access_token: next, refresh_token: `refresh-${next}`, expires_in: 300 });
      }
    }
    if (url.href === SERVER && method === "POST") {
      const token = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      if (!state.valid.has(token)) return new Response(null, { status: 401 });
      if (state.forbidden) return json({ error: "forbidden", error_description: "This account is not a member of a company on Tacit." }, 403);
      const rpc = JSON.parse(body);
      if (rpc.method === "initialize") return sse({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18", instructions: INSTRUCTIONS } });
      if (rpc.method === "tools/list") return sse({ jsonrpc: "2.0", id: rpc.id, result: { tools: TOOLS } });
      if (rpc.method === "tools/call") {
        state.calls.push({ name: rpc.params.name, arguments: rpc.params.arguments, token });
        const result = state.results.get(rpc.params.name) ?? {
          content: [{ type: "text", text: `Done: ${rpc.params.name}.\n\n{"ok":true}` }],
          structuredContent: { ok: true },
        };
        return sse({ jsonrpc: "2.0", id: rpc.id, result });
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  /** Plays the browser: signs in at the authorize URL and follows the redirect to the loopback listener. */
  async function browser(authorizeUrl: string): Promise<boolean> {
    const url = new URL(authorizeUrl);
    const p = url.searchParams;
    const code = `code-${state.codes.size + 1}`;
    state.codes.set(code, { challenge: p.get("code_challenge")!, redirect: p.get("redirect_uri")!, client: p.get("client_id")! });
    const back = new URL(p.get("redirect_uri")!);
    back.searchParams.set("code", code);
    back.searchParams.set("state", p.get("state")!);
    // The real network: the listener tats opened on localhost.
    setTimeout(() => void globalThis.fetch(back.href.replace("localhost", "127.0.0.1")).catch(() => {}), 0);
    return true;
  }

  const session = (overrides: Partial<Session["tokens"]> = {}): Session => ({
    issuer: ISSUER,
    resource: SERVER,
    token_endpoint: `${ISSUER}/oauth2/token`,
    client_id: "client-0",
    redirect_uri: "http://localhost:33418/callback",
    tokens: { access_token: "access-1", refresh_token: "refresh-access-1", expires_at: opts.now() + 300_000, ...overrides },
  });
  state.refreshable.set("refresh-access-1", "access-2");

  return { state, fetch: fetchFn, browser, session };
}
