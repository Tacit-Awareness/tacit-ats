import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_SIGN_IN_PATH, REFRESHED_COOKIE, safeClientNext } from "@/lib/client/config";
import { supabaseAuthClient } from "@/lib/client/supabase-auth";

// Re-issues the member's Supabase token so the access token hook reads their
// company again: after a first sign-in binds them, or after they choose a
// company. A server component can't write cookies, so lib/client/session.ts
// sends the browser here. The short-lived marker stops a token the hook still
// gives no company (the hook not registered) from looping.
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await supabaseAuthClient();
  const { error } = await auth.auth.refreshSession();
  if (error) return NextResponse.redirect(new URL(CLIENT_SIGN_IN_PATH, request.nextUrl.origin));
  const to = new URL(safeClientNext(request.nextUrl.searchParams.get("next")), request.nextUrl.origin);
  const response = NextResponse.redirect(to);
  response.cookies.set(REFRESHED_COOKIE, "1", { maxAge: 15, httpOnly: true, sameSite: "lax", path: "/client" });
  return response;
}
