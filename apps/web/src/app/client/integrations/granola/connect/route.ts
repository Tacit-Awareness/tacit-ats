import { NextResponse, type NextRequest } from "next/server";
import {
  GRANOLA_CALLBACK_PATH, GRANOLA_STATE_COOKIE, GranolaConnectError, granolaRedirectUri, granolaSignInUrl, newState, packPending, pkce,
  registerGranolaClient,
} from "@/lib/client/granola";
import { resolveClient } from "@/lib/client/session";

// The Integrations page's Connect button: registers a client with Granola for
// this connection, keeps the state and PKCE verifier bound to this member in
// a short-lived cookie, then sends the browser to Granola's sign-in.
export async function GET(request: NextRequest): Promise<Response> {
  const gate = await resolveClient();
  if (gate.status !== "ok") return NextResponse.redirect(new URL("/client", request.url));

  const redirectUri = granolaRedirectUri(request.nextUrl.origin);
  let clientId: string;
  try {
    clientId = await registerGranolaClient(redirectUri);
  } catch (err) {
    if (!(err instanceof GranolaConnectError)) console.error("[client-granola] register failed:", err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL("/client/settings?error=granola_unreachable", request.url));
  }
  const state = newState();
  const { verifier, challenge } = await pkce();
  const response = NextResponse.redirect(granolaSignInUrl(clientId, redirectUri, state, challenge, gate.ctx.user.email));
  response.cookies.set(GRANOLA_STATE_COOKIE, packPending({ actorId: gate.ctx.actorId, state, clientId, verifier }), {
    httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: GRANOLA_CALLBACK_PATH, maxAge: 600,
  });
  return response;
}
