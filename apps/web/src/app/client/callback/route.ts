import { handleAuth } from "@workos-inc/authkit-nextjs";
import { CLIENT_PREFIX } from "@/lib/client/config";

// Where WorkOS returns a client user after sign-in. AuthKit verifies the
// state / PKCE pair, exchanges the code and seals the session cookie; the
// actor binding happens on the first page render (lib/client/session.ts), not
// here, so a refused user still lands on a page that says why.
export const GET = handleAuth({ returnPathname: CLIENT_PREFIX });
