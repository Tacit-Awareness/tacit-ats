import { NextResponse, type NextRequest } from "next/server";
import {
  GRANOLA_CALLBACK_PATH, GRANOLA_STATE_COOKIE, GranolaConnectError, exchangeGranolaCode, granolaRedirectUri, unpackPending,
} from "@/lib/client/granola";
import { resolveClient } from "@/lib/client/session";
import type { IntegrationError, IntegrationNotice } from "../../messages";

// Granola sends the browser back here. The state must match the cookie set by
// /connect for this same member, then the code is exchanged (with the PKCE
// verifier) and the grant stored by client_connect_granola on the member's
// own token, which writes only the caller's row.
export async function GET(request: NextRequest): Promise<Response> {
  const back = (params: { notice?: IntegrationNotice; error?: IntegrationError }) => {
    const response = NextResponse.redirect(new URL(`/client/integrations?${new URLSearchParams(params)}`, request.url));
    response.cookies.set(GRANOLA_STATE_COOKIE, "", { path: GRANOLA_CALLBACK_PATH, maxAge: 0 });
    return response;
  };

  const gate = await resolveClient();
  if (gate.status !== "ok") return NextResponse.redirect(new URL("/client", request.url));

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back({ error: "granola_denied" });
  const pending = unpackPending(request.cookies.get(GRANOLA_STATE_COOKIE)?.value);
  const code = params.get("code");
  if (!pending || !code || pending.actorId !== gate.ctx.actorId || pending.state !== params.get("state")) {
    return back({ error: "granola_expired" });
  }

  try {
    const grant = await exchangeGranolaCode(pending, granolaRedirectUri(request.nextUrl.origin), code);
    const { error } = await gate.ctx.db.rpc("client_connect_granola", {
      p_oauth_client_id: pending.clientId,
      p_refresh_token: grant.refreshToken,
      // The function stores a blank token as null; an unknown expiry is stored
      // as long past, so the connector refreshes before its first use.
      p_access_token: grant.accessToken ?? "",
      p_access_token_expires_at: grant.accessTokenExpiresAt ?? new Date(0).toISOString(),
      p_account_email: grant.accountEmail ?? "",
    });
    if (error) {
      console.error("[client-granola] storing the grant failed:", error.message);
      return back({ error: "failed" });
    }
  } catch (err) {
    if (err instanceof GranolaConnectError) return back({ error: err.code === "no_refresh_token" ? "granola_no_refresh_token" : "granola_unreachable" });
    console.error("[client-granola] connect failed:", err instanceof Error ? err.message : err);
    return back({ error: "failed" });
  }
  return back({ notice: "granola_connected" });
}
