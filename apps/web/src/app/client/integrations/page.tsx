import Link from "next/link";
import type { ReactNode } from "react";
import { SubmitButton } from "@/components/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { googleCalendarConfig } from "@/lib/client/google-calendar";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { disconnectGranolaAction } from "./actions";
import { INTEGRATION_ERRORS, INTEGRATION_NOTICES, isIntegrationError, isIntegrationNotice } from "./messages";

// The tools a member connects to Tacit, each their own: one row per tool, a
// Connect button that does the whole thing. Both rows are read with the
// member's own token: the policies show each member only their row, and never
// the secret in it (a refresh token, an access token).
export default async function ClientIntegrations({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { notice, error } = await searchParams;
  const [calendar, granola] = await Promise.all([
    gate.ctx.db.from("calendar_connections").select("account_email").maybeSingle(),
    gate.ctx.db.from("granola_connections").select("account_email").maybeSingle(),
  ]);
  if (calendar.error) throw new Error(calendar.error.message);
  if (granola.error) throw new Error(granola.error.message);
  const calendarConfigured = googleCalendarConfig() !== null;

  return (
    <main className="max-w-3xl space-y-11">
      <div>
        <Link href="/client" className="text-[14px] text-muted-foreground transition-colors hover:text-foreground">
          ← Home
        </Link>
        <h1 className="mt-3 text-[34px] leading-[1.12] tracking-[-0.01em]">Integrations</h1>
        <p className="mt-3 text-[15px] text-muted-foreground">
          Connect the tools you already use. Each connection is yours alone: nobody else on your team can see or use it.
        </p>
      </div>

      {isIntegrationNotice(notice) ? <p className="notice">{INTEGRATION_NOTICES[notice]}</p> : null}
      {isIntegrationError(error) ? <p className="notice notice-error">{INTEGRATION_ERRORS[error]}</p> : null}

      <ul className="border-y border-dotted border-border">
        <IntegrationRow
          icon={<GranolaIcon />}
          name="Granola"
          description="Read your meeting notes, transcripts, and AI summaries"
          connectedAs={granola.data ? (granola.data.account_email ?? "") : null}
        >
          {granola.data ? (
            <form action={disconnectGranolaAction}>
              <SubmitButton variant="outline" pendingLabel="Disconnecting…">
                Disconnect
              </SubmitButton>
            </form>
          ) : (
            <a href="/client/integrations/granola/connect" className={buttonVariants()}>
              Connect
            </a>
          )}
        </IntegrationRow>
        <IntegrationRow
          icon={<CalendarIcon />}
          name="Google Calendar"
          description="Find when interviewers are free and send interview invitations"
          connectedAs={calendar.data ? calendar.data.account_email : null}
        >
          {calendar.data ? (
            <Link href="/client/calendar" className={buttonVariants({ variant: "outline" })}>
              Manage
            </Link>
          ) : calendarConfigured ? (
            <a href="/client/calendar/connect" className={buttonVariants()}>
              Connect
            </a>
          ) : (
            <span className="text-[14px] text-muted-foreground">Not set up yet</span>
          )}
        </IntegrationRow>
      </ul>
    </main>
  );
}

function IntegrationRow({
  icon,
  name,
  description,
  connectedAs,
  children,
}: {
  icon: ReactNode;
  name: string;
  description: string;
  /** Null = not connected; "" = connected, account unknown. */
  connectedAs: string | null;
  children: ReactNode;
}) {
  return (
    <li className="flex items-center gap-5 border-b border-dotted border-border px-2 py-6 last:border-b-0 sm:px-4">
      <span className="flex size-10 shrink-0 items-center justify-center text-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-medium leading-snug">{name}</p>
        <p className="mt-0.5 text-[15px] text-muted-foreground">
          {connectedAs === null ? description : connectedAs ? `Connected as ${connectedAs}` : "Connected"}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  );
}

function GranolaIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden>
      <path d="M12.5 12.4a1.6 1.6 0 1 1-1.9-1.9 3.4 3.4 0 0 1 4.6 3.6 5.2 5.2 0 0 1-6.4 4.2A7 7 0 0 1 5 12a7.2 7.2 0 0 1 8.4-6.9 8.6 8.6 0 0 1 6.2 4.2" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}
