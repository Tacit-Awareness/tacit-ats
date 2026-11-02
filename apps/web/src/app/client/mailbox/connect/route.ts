import { NextResponse, type NextRequest } from "next/server";
import { googleCalendarConfig } from "@/lib/client/google-calendar";
import { MAILBOX_CALLBACK_PATH, MAILBOX_STATE_COOKIE, mailboxConsentUrl, mailboxRedirectUri } from "@/lib/client/google-mailbox";
import { resolveClient } from "@/lib/client/session";

// Starts connecting the member's Gmail: a state bound to this browser in a
// short-lived cookie, then Google's consent screen.
export async function GET(request: NextRequest): Promise<Response> {
  const gate = await resolveClient();
  if (gate.status !== "ok") return NextResponse.redirect(new URL("/client", request.url));
  const config = googleCalendarConfig();
  if (!config) return NextResponse.redirect(new URL("/client/settings?error=mailbox_not_set_up", request.url));

  const state = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
  const response = NextResponse.redirect(
    mailboxConsentUrl(config, mailboxRedirectUri(request.nextUrl.origin), state, gate.ctx.user.email),
  );
  response.cookies.set(MAILBOX_STATE_COOKIE, `${gate.ctx.actorId}.${state}`, {
    httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: MAILBOX_CALLBACK_PATH, maxAge: 600,
  });
  return response;
}
