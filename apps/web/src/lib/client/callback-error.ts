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

/**
 * Expires the session. The callback's refusal leaves the cookie as it was, so
 * someone who signed in before accepting an invitation would come back from
 * the link below on that older session, which has no company.
 */
const CLEAR_SESSION = "wos-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax";

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
<style>:root{color-scheme:light dark;--frame:#f7f8fa;--paper:#fdfdfe;--ink:#222326;--muted:#444548;--line:#eceef1}
@media (prefers-color-scheme:dark){:root{--frame:#151518;--paper:#222326;--ink:#f4f5f8;--muted:#bcbdc1;--line:rgba(244,245,248,.07)}}
body{font-family:Geist,ui-sans-serif,system-ui,sans-serif;margin:0;padding:16vh 1rem;background:var(--frame);color:var(--ink);-webkit-font-smoothing:antialiased}
main{max-width:26rem;margin:0 auto;padding:1.25rem 1.25rem 1.4rem;border:1px solid var(--line);background:var(--paper)}
h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-.02em}p{margin:.5rem 0 1.1rem;color:var(--muted);font-size:13.5px;line-height:1.6}
a{display:inline-flex;align-items:center;height:32px;padding:0 13px;border-radius:999px;background:var(--ink);color:var(--frame);font-size:13px;font-weight:500;text-decoration:none}a:hover{opacity:.88}</style>
</head><body><main><h1>${title}</h1><p>${body}</p><a href="${next}">${action}</a></main></body></html>`;
  return new Response(html, {
    status: startedElsewhere ? 200 : 400,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...(startedElsewhere ? { "set-cookie": CLEAR_SESSION } : {}),
    },
  });
}
