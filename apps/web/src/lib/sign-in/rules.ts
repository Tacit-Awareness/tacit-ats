// The rules of our own sign-in screen (app/sign-in). Pure, so it is testable
// without AuthKit or Next.

import { CLIENT_CALLBACK_PATH, CLIENT_PREFIX, isClientPath } from "../client/config";

export const SIGN_IN_PATH = "/sign-in";

export type SignInMethod = "google" | "microsoft" | "hosted";

/** WorkOS's name for a method. Hosted is AuthKit's own page, every method it offers. */
export const METHOD_PROVIDER: Record<SignInMethod, string> = {
  google: "GoogleOAuth",
  microsoft: "MicrosoftOAuth",
  hosted: "authkit",
};

export function parseMethod(raw: unknown): SignInMethod | null {
  return raw === "google" || raw === "microsoft" || raw === "hosted" ? raw : null;
}

/**
 * Where to land after signing in: a page of the client area, or Home. The
 * value rides in a URL anyone can write, so nothing but a same-origin client
 * path gets through, and never the callback.
 */
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return CLIENT_PREFIX;
  const base = "https://tacit.invalid";
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return CLIENT_PREFIX;
  }
  if (url.origin !== base || !isClientPath(url.pathname) || url.pathname === CLIENT_CALLBACK_PATH) return CLIENT_PREFIX;
  return `${url.pathname}${url.search}`;
}

/** The sign-in screen's URL for someone turned away from `path`. */
export function signInHref(path: string, search: string): string {
  const next = safeNext(`${path}${search}`);
  return next === CLIENT_PREFIX ? SIGN_IN_PATH : `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`;
}
