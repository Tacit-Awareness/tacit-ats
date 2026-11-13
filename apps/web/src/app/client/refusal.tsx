import { Button } from "@/components/ui/button";
import type { ClientGate } from "@/lib/client/session";
import "./refusal.css";

// What a client-area page shows when resolveClient() turns the user away, and
// the frame every page outside the shell shares (SkyPage).

export type RefusalReason = Extract<ClientGate, { status: "forbidden" }>["reason"];

const REFUSALS: Record<RefusalReason, { title: string; body: string }> = {
  signed_out: { title: "You're signed out", body: "Sign in again to continue." },
  not_invited: {
    title: "You haven't been invited yet",
    body: "Ask an admin at your company to invite this email address, then sign in again.",
  },
  email_unverified: {
    title: "Verify your email first",
    body: "Your email address hasn't been verified. Check your inbox for a verification link, then sign in again.",
  },
  subject_mismatch: {
    title: "This email is linked to another sign-in",
    body: "Ask your admin to re-send your invitation, or contact your Tacit partner.",
  },
  token_rejected: {
    title: "We couldn't open your workspace",
    body: "Something on our side isn't configured for your sign-in. Contact your Tacit partner.",
  },
};

/**
 * A page outside the shell, as Testbench's sign-in: the bare sky, the Tacit
 * mark top-left, the title on the sky in Mona Sans, and one white card with
 * the message and its buttons (refusal.css). Caught under the sidebar instead
 * (a page that failed while the shell stands), the same title and card sit on
 * the box's surface, without the sky or the mark.
 */
export function SkyPage({ title, children, role }: { title: React.ReactNode; children: React.ReactNode; role?: "alert" }) {
  // An alert (a page that failed) can be drawn inside the shell's own <main>, so it is a div.
  const Frame = role === "alert" ? "div" : "main";
  return (
    <Frame className="sky-page" role={role}>
      <div className="sky-top">
        <span className="sky-brand">
          <span className="tacit-mark size-[17px] bg-[color:var(--sky-ink)]!" aria-hidden />
          Tacit
        </span>
      </div>
      <div className="sky-stage">
        <h1 className="sky-title">{title}</h1>
        <div className="sky-card">{children}</div>
      </div>
      <div className="sky-foot" aria-hidden />
    </Frame>
  );
}

export function Refusal({ reason }: { reason: RefusalReason }) {
  const refusal = REFUSALS[reason];
  return (
    <SkyPage title={refusal.title}>
      <p>{refusal.body}</p>
      {/* A refused sign-in gets no sidebar, so this is its only way out of the session. "Signed out"
          can be a stale cookie (an account deleted since), which this clears too. */}
      <form action="/client/signout" method="post">
        <Button type="submit" size="lg" className="w-full">
          Sign out
        </Button>
      </form>
    </SkyPage>
  );
}
