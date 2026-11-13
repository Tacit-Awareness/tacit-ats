import { NextResponse, type NextRequest } from "next/server";
import { consentAction, pickCompanyAction, requestResetAction, setPasswordAction, signInAction, signOutAction, type AuthAnswer } from "@/lib/client/auth-ops";
import { sameOrigin } from "@/lib/client/schedule-requests";

// The sign-in screens' calls (lib/client/auth-ops.ts). A route, not server
// actions: these give a person a session, so they can't begin by checking for
// one, which every server action here must (src/client-area.test.ts). JSON
// from this origin only, as Next checks for an action, so another site can't
// sign anyone in or out through a form.
const OPS: Record<string, (body: Record<string, unknown>) => Promise<AuthAnswer>> = {
  "sign-in": (b) => signInAction({ email: b.email, password: b.password, next: b.next }),
  reset: (b) => requestResetAction({ email: b.email }),
  "set-password": (b) => setPasswordAction({ password: b.password }),
  "pick-company": (b) => pickCompanyAction({ orgId: b.orgId }),
  "sign-out": () => signOutAction(),
  consent: (b) => consentAction({ authorizationId: b.authorizationId, orgId: b.orgId, approve: b.approve, approved: b.approved }),
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ op: string }> }): Promise<Response> {
  const { op } = await params;
  const run = Object.hasOwn(OPS, op) ? OPS[op] : undefined;
  if (!run) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request.headers)) return new NextResponse(null, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return new NextResponse(null, { status: 415 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return new NextResponse(null, { status: 400 });
  return NextResponse.json(await run(body as Record<string, unknown>), { headers: { "cache-control": "no-store" } });
}
