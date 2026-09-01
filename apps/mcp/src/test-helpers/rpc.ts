export function rpc(method: string, params: Record<string, unknown> = {}, id = 1): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

/** A syntactically valid key, so authenticate() reaches the mocked
 * resolveActor rather than short-circuiting on the format check. */
export function withAuth(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.set("authorization", "Bearer tk_abc123_ssshhh");
  headers.set("x-poke-user-id", "test-user");
  return new Request(request, { headers });
}
