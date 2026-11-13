// The auth gate. Members of a client org sign in through Supabase Auth on this
// project, and everything they can reach lives under /client (lib/client/config.ts). There
// is no other session in this app: Tacit's own team works in tacit-internal's
// apps/internal, on another domain, and its session means nothing here.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_SIGN_IN_PATH, clientSignInConfigured, isPublicClientPath } from "@/lib/client/config";
import { staffConsentRedirect } from "@/lib/client/staff-consent";

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
  // Tacit's staff connector: its consent is internal.tacitawareness.com's, before any sign-in here.
  const staff = await staffConsentRedirect(request.nextUrl);
  if (staff) return NextResponse.redirect(staff);
  return supabaseGate(request);
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
