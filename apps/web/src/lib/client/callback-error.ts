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
<style>@font-face{font-family:Neco;src:url(/fonts/Neco-Medium.woff2) format("woff2");font-weight:500;font-display:swap}
@font-face{font-family:Recoleta;src:url(/fonts/Recoleta-Regular.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:Recoleta;src:url(/fonts/Recoleta-Medium.woff2) format("woff2");font-weight:500;font-display:swap}
body{font-family:Recoleta,Georgia,serif;margin:0;padding:18vh 1.25rem;color:#18181b;-webkit-font-smoothing:antialiased;background:radial-gradient(620px 420px at 12% 4%,rgb(147 197 253/.24),transparent 70%),radial-gradient(640px 460px at 94% 20%,rgb(199 210 254/.3),transparent 70%),#fafaf9;background-attachment:fixed}
main{max-width:28rem;margin:0 auto;padding:2.25rem 2rem;border-radius:18px;background:rgb(255 255 255/.82);box-shadow:0 0 0 1px rgb(24 24 27/.07),0 1px 2px rgb(24 24 27/.03)}
h1{margin:0;font:500 28px/1.15 Neco,Georgia,serif;letter-spacing:-.01em}p{margin:.75rem 0 1.5rem;color:#6b6b70;font-size:15.5px;line-height:1.6}
a{display:inline-block;padding:8px 15px;border-radius:999px;background:#18181b;color:#fafafa;font-size:14px;font-weight:500;line-height:20px;text-decoration:none;box-shadow:0 0 0 1px #18181b}a:hover{background:#2e2e33}</style>
</head><body><main><h1>${title}</h1><p>${body}</p><a href="${next}">${action}</a></main></body></html>`;
  return new Response(html, {
    status: startedElsewhere ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
