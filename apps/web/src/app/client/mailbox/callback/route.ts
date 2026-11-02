import { NextResponse, type NextRequest } from "next/server";
import { googleCalendarConfig } from "@/lib/client/google-calendar";
import {
  MAILBOX_CALLBACK_PATH, MAILBOX_STATE_COOKIE, MailboxConnectError, exchangeMailboxCode, mailboxRedirectUri,
} from "@/lib/client/google-mailbox";
import { resolveClient } from "@/lib/client/session";
import type { MailboxError, MailboxNotice } from "../messages";

// Google sends the browser back here. The state must match the cookie set by
// /connect for this same member, then the code is exchanged and the grant
// stored by client_connect_mailbox on the member's own token, which writes
// only the caller's row.
export async function GET(request: NextRequest): Promise<Response> {
  const back = (params: { notice?: MailboxNotice; error?: MailboxError }) => {
    const response = NextResponse.redirect(new URL(`/client/settings?${new URLSearchParams(params)}`, request.url));
    response.cookies.set(MAILBOX_STATE_COOKIE, "", { path: MAILBOX_CALLBACK_PATH, maxAge: 0 });
    return response;
  };

  const gate = await resolveClient();
  if (gate.status !== "ok") return NextResponse.redirect(new URL("/client", request.url));
  const config = googleCalendarConfig();
  if (!config) return back({ error: "mailbox_not_set_up" });

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back({ error: "mailbox_denied" });
  const expected = request.cookies.get(MAILBOX_STATE_COOKIE)?.value;
  const state = params.get("state");
  const code = params.get("code");
  if (!expected || !state || !code || expected !== `${gate.ctx.actorId}.${state}`) return back({ error: "mailbox_expired" });

  let readsReplies: boolean;
  try {
    const grant = await exchangeMailboxCode(config, mailboxRedirectUri(request.nextUrl.origin), code);
    const { error } = await gate.ctx.db.rpc("client_connect_mailbox", {
      p_provider: "google", p_account_email: grant.accountEmail, p_refresh_token: grant.refreshToken, p_scopes: grant.scopes,
    });
    if (error) {
      console.error("[client-mailbox] storing the grant failed:", error.message);
      return back({ error: "mailbox_failed" });
    }
    readsReplies = grant.readsReplies;
  } catch (err) {
    if (err instanceof MailboxConnectError) return back({ error: `mailbox_${err.code}` });
    console.error("[client-mailbox] connect failed:", err instanceof Error ? err.message : err);
    return back({ error: "mailbox_failed" });
  }
  return back({ notice: readsReplies ? "mailbox_connected" : "mailbox_connected_send_only" });
}
