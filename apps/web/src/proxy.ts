// The auth gate. Every request that isn't the login page, the OAuth
// endpoints, a cron route (own bearer check), or a static asset must carry a
// valid tacit_session cookie; otherwise it's bounced to /login with the
// original path in ?next=. On success the *raw, already-verified* session
// token rides along to the page/action as the x-tacit-user header (see
// lib/auth.ts) — not the parsed claims. That way, even if this proxy is
// ever misconfigured or bypassed, a forged header can't be trusted: it has
// to be a token signed with SESSION_SECRET, which currentUser() re-verifies
// before trusting anything in it. A missing SESSION_SECRET fails closed:
// nothing verifies, everyone lands on /login.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, USER_HEADER, verifySession } from "@/lib/session";

export const config = {
  matcher: [
    // Everything except: Next internals, the routes that must stay
    // reachable signed-out, and static assets — which are only ever
    // top-level files (tacit-mark.png, favicon.ico…) or under fonts/, so a
    // dot elsewhere (e.g. a dynamic slug) must never be exempted.
    "/((?!_next/|login$|auth/|api/cron/|fonts/|[^/]+\\.[\\w]+$).*)",
  ],
};

export async function proxy(request: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  const user = secret ? await verifySession(token, secret) : null;

  if (!user) {
    const login = new URL("/login", request.url);
    const next = request.nextUrl.pathname + request.nextUrl.search;
    if (request.nextUrl.pathname !== "/") login.searchParams.set("next", next);
    const res = NextResponse.redirect(login);
    if (token) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(USER_HEADER); // never trust an inbound copy
  requestHeaders.set(USER_HEADER, token); // the signed token, not parsed claims
  return NextResponse.next({ request: { headers: requestHeaders } });
}
