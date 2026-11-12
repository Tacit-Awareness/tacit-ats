// The auth gate. Members of a client org sign in through WorkOS AuthKit or,
// with CLIENT_AUTH_PROVIDER=supabase, Supabase Auth on this project; and
// everything they can reach lives under /client (lib/client/config.ts). There
// is no other session in this app: Tacit's own team works in tacit-internal's
// apps/internal, on another domain, and its session means nothing here.
import { applyResponseHeaders, authkit, handleAuthkitHeaders, partitionAuthkitHeaders } from "@workos-inc/authkit-nextjs";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  CLIENT_CALLBACK_PATH,
  CLIENT_SIGN_IN_PATH,
  clientAuthProvider,
  clientRedirectUri,
  clientSignInConfigured,
  isPublicClientPath,
} from "@/lib/client/config";

export const config = {
  matcher: ["/client", "/client/:path*"],
};

/**
 * 404 until client sign-in is configured. Otherwise the provider's session is
 * read (and refreshed); no session means a redirect to sign in, except on the
 * pages that sign you in.
 */
export async function proxy(request: NextRequest) {
  if (!clientSignInConfigured()) return new NextResponse(null, { status: 404 });
  return clientAuthProvider() === "supabase" ? supabaseGate(request) : workosGate(request);
}

async function workosGate(request: NextRequest) {
  const { session, headers, authorizationUrl } = await authkit(request, {
    redirectUri: clientRedirectUri(request.nextUrl.origin),
  });
  if (!session.user && request.nextUrl.pathname !== CLIENT_CALLBACK_PATH) {
    if (!authorizationUrl) return new NextResponse(null, { status: 404 });
    return handleAuthkitHeaders(request, headers, { redirect: authorizationUrl });
  }

  // AuthKit's own request headers go to the page (withAuth reads them) and
  // never to the browser.
  const { requestHeaders, responseHeaders } = partitionAuthkitHeaders(request, headers);
  return applyResponseHeaders(NextResponse.next({ request: { headers: requestHeaders } }), responseHeaders);
}

/**
 * Supabase's session lives in cookies the page can't rewrite, so this is
 * where an expiring access token is refreshed: getClaims() refreshes when it
 * must and verifies the JWT, and the new cookies go both on the request the
 * page reads and on the response.
 */
async function supabaseGate(request: NextRequest) {
  let response = NextResponse.next({ request });
  const auth = createServerClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PUBLISHABLE_KEY ?? "", {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (all) => {
        for (const { name, value } of all) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of all) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await auth.auth.getClaims();
  if (data?.claims?.sub || isPublicClientPath(request.nextUrl.pathname)) return response;

  const signIn = request.nextUrl.clone();
  signIn.pathname = CLIENT_SIGN_IN_PATH;
  signIn.search = "";
  const back = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (back !== "/client") signIn.searchParams.set("next", back);
  return NextResponse.redirect(signIn);
}
