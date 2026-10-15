// The auth gate. Members of a client org sign in through WorkOS AuthKit, and
// everything they can reach lives under /client (lib/client/config.ts). There
// is no other session in this app: Tacit's own team works in Tacit-Awareness's
// apps/internal, on another domain, and its session means nothing here.
import { applyResponseHeaders, authkit, handleAuthkitHeaders, partitionAuthkitHeaders } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_CALLBACK_PATH, clientRedirectUri, clientSignInConfigured } from "@/lib/client/config";

export const config = {
  matcher: ["/client", "/client/:path*"],
};

/**
 * 404 until client sign-in is configured. Otherwise AuthKit reads (and
 * refreshes) the sealed session cookie; no session means a redirect to WorkOS,
 * except on the callback itself.
 */
export async function proxy(request: NextRequest) {
  if (!clientSignInConfigured()) return new NextResponse(null, { status: 404 });

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
