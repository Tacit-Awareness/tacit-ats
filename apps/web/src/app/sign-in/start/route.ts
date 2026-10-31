import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { clientRedirectUri, clientSignInConfigured } from "@/lib/client/config";
import { METHOD_PROVIDER, parseMethod, safeNext, SIGN_IN_PATH } from "@/lib/sign-in/rules";

// Google, Microsoft and "Use email instead": the same authorization AuthKit's own
// page runs, so its state and PKCE cookie finish at /client/callback as ever.
// AuthKit's getSignInUrl always names its hosted page, so the provider is
// changed on the URL it builds. A plain form post, so it works with no script.
export async function POST(request: NextRequest): Promise<Response> {
  if (!clientSignInConfigured()) return new NextResponse(null, { status: 404 });
  const form = await request.formData();
  const method = parseMethod(form.get("method"));
  if (!method) return NextResponse.redirect(new URL(SIGN_IN_PATH, request.url), 303);

  const url = new URL(
    await getSignInUrl({
      redirectUri: clientRedirectUri(request.nextUrl.origin),
      returnTo: safeNext(form.get("next")),
    }),
  );
  url.searchParams.set("provider", METHOD_PROVIDER[method]);
  return NextResponse.redirect(url, 303);
}
