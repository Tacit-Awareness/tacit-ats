import { signOut } from "@workos-inc/authkit-nextjs";

// Ends the WorkOS session and clears the cookie. POST only, from the form in
// the client layout. Where the browser lands afterwards is the app's default
// Sign-out URI in the WorkOS dashboard.
export async function POST(): Promise<Response> {
  // Redirects (by throwing) once the session is ended; the line after it is
  // only reached if there was no session to end.
  await signOut();
  return new Response(null, { status: 204 });
}
