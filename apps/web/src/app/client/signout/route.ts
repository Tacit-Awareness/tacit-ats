import { signOut } from "@workos-inc/authkit-nextjs";
import { CLIENT_SIGN_IN_PATH, clientAuthProvider } from "@/lib/client/config";
import { supabaseAuthClient } from "@/lib/client/supabase-auth";

// Ends the session and clears the cookie. POST only, from the form in the
// client layout. With WorkOS, where the browser lands afterwards is the app's
// default Sign-out URI in the WorkOS dashboard; with Supabase, the sign-in page.
export async function POST(request: Request): Promise<Response> {
  if (clientAuthProvider() === "supabase") {
    const auth = await supabaseAuthClient();
    await auth.auth.signOut();
    return Response.redirect(new URL(CLIENT_SIGN_IN_PATH, request.url), 303);
  }
  // Redirects (by throwing) once the session is ended; the line after it is
  // only reached if there was no session to end.
  await signOut();
  return new Response(null, { status: 204 });
}
