import { Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import type { ClientGate } from "@/lib/client/session";

// What a client-area page shows when resolveClient() turns the user away.

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

export function Refusal({ reason }: { reason: RefusalReason }) {
  const refusal = REFUSALS[reason];
  return (
    <main className="mx-auto mt-[12vh] grid w-full max-w-md gap-4">
      <span className="grid size-9 place-items-center bg-[color:var(--ink)]">
        <span className="tacit-mark size-[18px] bg-[color:var(--paper)]!" aria-hidden />
      </span>
      <Section>
        <h1 className="m-0 text-xl font-semibold tracking-[-0.02em]">{refusal.title}</h1>
        <p className="m-0 text-[13.5px] leading-relaxed text-muted-foreground">{refusal.body}</p>
        {/* A refused sign-in gets no sidebar, so this is its only way out of the session. "Signed out"
            can be a stale cookie (an account deleted since), which this clears too. */}
        {(
          <form action="/client/signout" method="post">
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        )}
      </Section>
    </main>
  );
}
