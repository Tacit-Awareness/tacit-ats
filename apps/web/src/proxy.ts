// The auth gate. Every request that isn't the login page, the OAuth
// endpoints, a cron route (own bearer check), a Slack slash command (own
// signature check), tacit-bot's key minting (own bearer check), or a static asset must carry a valid tacit_session
// cookie; otherwise it's bounced to /login with the
// original path in ?next=. On success the *raw, already-verified* session
// token rides along to the page/action as the x-tacit-user header (see
// lib/auth.ts) — not the parsed claims. That way, even if this proxy is
// ever misconfigured or bypassed, a forged header can't be trusted: it has
// to be a token signed with SESSION_SECRET, which currentUser() re-verifies
// before trusting anything in it. A missing SESSION_SECRET fails closed:
// nothing verifies, everyone lands on /login.
//
// Two kinds of session, kept apart by path (2026-10-13). Tacit's own team
// signs in with Google and holds tacit_session; it is honoured everywhere
// EXCEPT under /client. A member of a client org signs in through WorkOS
// AuthKit; that session is honoured ONLY under /client. So a client session
// can never reach a staff page, route or action, whatever gets added later:
// there is no list to keep up to date. Under /client the staff header is
// stripped, and a staff cookie counts for nothing.
import { applyResponseHeaders, authkit, handleAuthkitHeaders, partitionAuthkitHeaders } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_CALLBACK_PATH, clientRedirectUri, clientSignInConfigured, isClientPath } from "@/lib/client/config";
import { SESSION_COOKIE, USER_HEADER, verifySession } from "@/lib/session";

export const config = {
  matcher: [
    // Everything except: Next internals, the routes that must stay
    // reachable signed-out, and static assets — which are only ever
    // top-level files (tacit-mark.png, favicon.ico…) or under fonts/, so a
    // dot elsewhere (e.g. a dynamic slug) must never be exempted.
    // api/slack/ is exempt for the same reason api/cron/ is: the caller is
    // a machine that carries no cookie and proves itself another way -- a
    // v0 HMAC over the raw body, checked in the route itself, which refuses
    // outright when SLACK_SIGNING_SECRET is unset. Exempting the prefix
    // without that check in place would publish the rolodex. api/tacit-bot/
    // likewise: a bearer check in the route, refusing when its secret is unset.
    // jobs/ and api/jobs/ are a client's public job posts and their form
    // (2026-10-16): public on purpose, they read no session and hold only
    // the publishable key with no token, so the database answers them as
    // anon (lib/public/jobs.ts; client-area.test.ts walks their imports).
    "/((?!_next/|login$|auth/|api/cron/|api/slack/|api/tacit-bot/|jobs/|api/jobs/|fonts/|[^/]+\\.[\\w]+$).*)",
  ],
};

/**
 * The client area. 404 until client sign-in is configured, so this ships
 * dormant. Otherwise AuthKit reads (and refreshes) the sealed session cookie;
 * no session means a redirect to WorkOS, except on the callback itself.
 */
async function clientProxy(request: NextRequest) {
  if (!clientSignInConfigured()) return new NextResponse(null, { status: 404 });

  const { session, headers, authorizationUrl } = await authkit(request, {
    redirectUri: clientRedirectUri(request.nextUrl.origin),
  });
  if (!session.user && request.nextUrl.pathname !== CLIENT_CALLBACK_PATH) {
    if (!authorizationUrl) return new NextResponse(null, { status: 404 });
    return handleAuthkitHeaders(request, headers, { redirect: authorizationUrl });
  }

  // AuthKit's own request headers go to the page (withAuth reads them) and
  // never to the browser. A staff identity never rides into the client area.
  const { requestHeaders, responseHeaders } = partitionAuthkitHeaders(request, headers);
  requestHeaders.delete(USER_HEADER);
  return applyResponseHeaders(NextResponse.next({ request: { headers: requestHeaders } }), responseHeaders);
}

export async function proxy(request: NextRequest) {
  if (isClientPath(request.nextUrl.pathname)) return clientProxy(request);

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
