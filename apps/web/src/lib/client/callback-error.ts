// What a client sees when the sign-in callback (app/client/callback) fails.
// Pure, so it is testable without AuthKit or Next.

import { CLIENT_PREFIX } from "./config";

/**
 * A sign-in that did not start here: accepting a WorkOS invitation, or
 * signing up from the email, ends at the callback without the PKCE cookie our
 * own sign-in sets, and AuthKit cannot verify it. The WorkOS account exists by
 * then, so the person only needs to sign in again from our side, which is one
 * click and usually no password. These are AuthKit's CallbackError codes.
 */
const STARTED_ELSEWHERE = new Set(["missing_auth_params", "missing_pkce_cookie", "oauth_state_mismatch"]);

/** AuthKit's CallbackError, recognised by shape so this module never imports AuthKit. */
function callbackCode(error: unknown): string {
  if (error && typeof error === "object" && (error as { name?: unknown }).name === "CallbackError") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "unknown";
}

export function callbackErrorResponse({ error, request }: { error?: unknown; request: Request }): Response {
  const code = callbackCode(error);
  const startedElsewhere = STARTED_ELSEWHERE.has(code);
  console.warn(`[client] sign-in callback refused: ${code}`);
  // A page with a link rather than a redirect: a browser that drops our
  // cookie would otherwise loop between here and the sign-in page.
  const next = new URL(CLIENT_PREFIX, request.url).toString();
  const [title, body, action] = startedElsewhere
    ? ["Your account is ready", "Sign in once more to open your company's workspace on Tacit.", "Continue to Tacit"]
    : ["Couldn't sign in", "Something went wrong signing you in. Try again, and if it keeps happening, tell your contact at Tacit.", "Try again"];
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Tacit</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:18vh auto;padding:0 1.5rem;color:#20201e;background:#f6f6f2}
h1{font-size:1.4rem;font-weight:550}p{color:#555;line-height:1.5}a{display:inline-block;margin-top:.5rem;padding:.6rem 1rem;border-radius:.4rem;background:#3049a4;color:#fff;text-decoration:none}</style>
</head><body><h1>${title}</h1><p>${body}</p><a href="${next}">${action}</a></body></html>`;
  return new Response(html, {
    status: startedElsewhere ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
