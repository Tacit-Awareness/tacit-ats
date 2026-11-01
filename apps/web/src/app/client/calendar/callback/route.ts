import { NextResponse, type NextRequest } from "next/server";
import {
  CALENDAR_CALLBACK_PATH, CALENDAR_STATE_COOKIE, CalendarConnectError, calendarRedirectUri, exchangeCalendarCode,
  googleCalendarConfig,
} from "@/lib/client/google-calendar";
import { resolveClient } from "@/lib/client/session";
import type { CalendarError, CalendarNotice } from "../messages";

// Google sends the browser back here. The state must match the cookie set by
// /connect for this same member, then the code is exchanged and the grant
// stored by client_connect_calendar on the member's own token, which writes
// only the caller's row.
export async function GET(request: NextRequest): Promise<Response> {
  const back = (params: { notice?: CalendarNotice; error?: CalendarError }) => {
    const response = NextResponse.redirect(new URL(`/client/settings?${new URLSearchParams(params)}`, request.url));
    response.cookies.set(CALENDAR_STATE_COOKIE, "", { path: CALENDAR_CALLBACK_PATH, maxAge: 0 });
    return response;
  };

  const gate = await resolveClient();
  if (gate.status !== "ok") return NextResponse.redirect(new URL("/client", request.url));
  const config = googleCalendarConfig();
  if (!config) return back({ error: "not_set_up" });

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back({ error: "denied" });
  const expected = request.cookies.get(CALENDAR_STATE_COOKIE)?.value;
  const state = params.get("state");
  const code = params.get("code");
  if (!expected || !state || !code || expected !== `${gate.ctx.actorId}.${state}`) return back({ error: "expired" });

  try {
    const grant = await exchangeCalendarCode(config, calendarRedirectUri(request.nextUrl.origin), code);
    const { error } = await gate.ctx.db.rpc("client_connect_calendar", {
      p_provider: "google", p_account_email: grant.accountEmail, p_refresh_token: grant.refreshToken, p_scopes: grant.scopes,
    });
    if (error) {
      console.error("[client-calendar] storing the grant failed:", error.message);
      return back({ error: "failed" });
    }
  } catch (err) {
    if (err instanceof CalendarConnectError) return back({ error: err.code });
    console.error("[client-calendar] connect failed:", err instanceof Error ? err.message : err);
    return back({ error: "failed" });
  }
  return back({ notice: "connected" });
}
