import { CLIENT_SIGN_IN_PATH } from "@/lib/client/config";
import { supabaseAuthClient } from "@/lib/client/supabase-auth";

// Ends the Supabase session and clears its cookies. POST only, from the form
// in the client layout and the refusal screen; lands on the sign-in page.
export async function POST(request: Request): Promise<Response> {
  const auth = await supabaseAuthClient();
  await auth.auth.signOut();
  return Response.redirect(new URL(CLIENT_SIGN_IN_PATH, request.url), 303);
}
