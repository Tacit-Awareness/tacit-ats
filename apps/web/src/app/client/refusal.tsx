import { Section } from "@/components/page";
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
  no_org: {
    title: "No company on this sign-in",
    body: "You signed in without a company. Use the invitation link your admin sent you.",
  },
  unknown_org: {
    title: "This company isn't set up yet",
    body: "Your company doesn't have a Tacit workspace yet. Contact your Tacit partner.",
  },
  subject_mismatch: {
    title: "This email is linked to another sign-in",
    body: "Sign in the same way you did the first time, or ask your admin to re-send your invitation.",
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
      <span className="grid size-9 place-items-center rounded-[9px] bg-black shadow-[inset_0_0_0_0.5px_rgba(74,222,128,0.4)]">
        <span className="tacit-mark size-[18px] bg-[#4ade80]!" aria-hidden />
      </span>
      <Section>
        <h1 className="m-0 text-xl font-semibold tracking-[-0.02em]">{refusal.title}</h1>
        <p className="m-0 text-[13.5px] leading-relaxed text-muted-foreground">{refusal.body}</p>
      </Section>
    </main>
  );
}
