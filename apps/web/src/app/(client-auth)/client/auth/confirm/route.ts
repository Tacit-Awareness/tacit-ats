import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_LINK_EXPIRED_PATH, safeClientNext } from "@/lib/client/config";
import { supabaseAuthClient } from "@/lib/client/supabase-auth";

// Where an invitation or password email lands. The email links here with the
// token's hash (supabase/templates), not Supabase's own redirect, so it works
// in any browser, not only the one that asked: verifying it signs the person
// in, and they go on to choose a password.
const TYPES = new Set<EmailOtpType>(["invite", "recovery", "signup", "email", "magiclink"]);

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const origin = request.nextUrl.origin;
  if (tokenHash && type && TYPES.has(type)) {
    const auth = await supabaseAuthClient();
    const { error } = await auth.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      const to = new URL(safeClientNext(params.get("next")), origin);
      // Verifying signs them in, so the next page can't tell joining from resetting by itself.
      if (type === "invite") to.searchParams.set("welcome", "1");
      return NextResponse.redirect(to);
    }
  }
  return NextResponse.redirect(new URL(CLIENT_LINK_EXPIRED_PATH, origin));
}
