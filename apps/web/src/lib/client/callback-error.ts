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
  // Drawn as the client area's other pages outside the shell (app/client/refusal.tsx's
  // SkyPage, Testbench's sign-in): the sky, the Tacit mark top-left, the title on the sky,
  // one white card with the way on. Standalone, so its tokens are copied from globals.css
  // and the fonts fall back to the system's when the app's own aren't loaded.
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Tacit</title>
<style>:root{color-scheme:light dark;--sky-0:#8db5e4;--sky-1:#789ce5;--sky-2:#89a4e4;--sky-3:#c7d0e3;--sky-4:#f7f4e7;--sky-5:#f9f6e9;--sky-ink:#222326;--paper:#fff;--ink:#16171a;--muted:#4a4d55;--primary:#222326;--primary-hover:#34353b;--primary-ink:#fff;--box-shadow:0 0 0 1px rgba(22,23,26,.08),0 24px 60px -24px rgba(22,23,26,.35);--sans:"Mona Sans",ui-sans-serif,system-ui,sans-serif;--mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--sky-0:#0e1226;--sky-1:#161b3a;--sky-2:#242a5a;--sky-3:#3b3d75;--sky-4:#5a4c7a;--sky-5:#6e5a7e;--sky-ink:#f4f5f8;--paper:#1e1f23;--ink:#f4f5f8;--muted:#c9cbd2;--primary:#f4f5f8;--primary-hover:#dcdee3;--primary-ink:#16171a;--box-shadow:0 0 0 1px rgba(255,255,255,.08),0 24px 60px -24px rgba(0,0,0,.7)}}
body{margin:0;min-height:100vh;display:grid;grid-template-rows:64px 1fr 64px;font:400 13px/20px var(--mono);color:var(--sky-ink);background:var(--sky-5) linear-gradient(180deg,var(--sky-0) 0%,var(--sky-1) 20%,var(--sky-2) 40%,var(--sky-3) 60%,var(--sky-4) 80%,var(--sky-5) 100%) fixed;-webkit-font-smoothing:antialiased}
header{display:flex;align-items:center;gap:8px;padding:0 32px;font:600 19px/1 var(--sans);letter-spacing:-.03em}
header i{width:17px;height:17px;background:var(--sky-ink);-webkit-mask:url(/tacit-mark.svg) center/contain no-repeat;mask:url(/tacit-mark.svg) center/contain no-repeat}
main{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:0 16px 40px}
h1{margin:0;max-width:640px;font:600 36px/1.15 var(--sans);letter-spacing:-.02em;text-align:center}
.card{box-sizing:border-box;width:min(100%,440px);display:grid;gap:20px;padding:32px;border-radius:16px;background:var(--paper);box-shadow:var(--box-shadow);color:var(--ink)}
p{margin:0;font-size:14px;line-height:22px;color:var(--muted)}
a{display:flex;align-items:center;justify-content:center;height:44px;border-radius:7px;background:var(--primary);color:var(--primary-ink);font:500 14px/1 var(--mono);text-decoration:none}a:hover{background:var(--primary-hover)}
a:focus-visible{outline:2px solid #3f6fd8;outline-offset:2px}</style>
</head><body><header><i aria-hidden="true"></i>Tacit</header><main><h1>${title}</h1><div class="card"><p>${body}</p><a href="${next}">${action}</a></div></main></body></html>`;
  return new Response(html, {
    status: startedElsewhere ? 200 : 400,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...(startedElsewhere ? { "set-cookie": CLEAR_SESSION } : {}),
    },
  });
}
