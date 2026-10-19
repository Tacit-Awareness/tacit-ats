import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { googleCalendarConfig } from "@/lib/client/google-calendar";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { disconnectCalendarAction } from "./actions";
import { CALENDAR_ERRORS, CALENDAR_NOTICES, isCalendarError, isCalendarNotice } from "./messages";

// The member's own calendar connection, read with their own token: the
// policy shows each member only their row, and never the refresh token.
// Claude (the client connector) books interviews and reads busy times with it.
export default async function ClientCalendar({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { notice, error } = await searchParams;
  const { data: connection, error: readError } = await gate.ctx.db
    .from("calendar_connections").select("provider, account_email, connected_at").maybeSingle();
  if (readError) throw new Error(readError.message);
  const configured = googleCalendarConfig() !== null;

  return (
    <main className="max-w-3xl space-y-11">
      <div>
        <Link href="/client/integrations" className="text-[14px] text-muted-foreground transition-colors hover:text-foreground">
          ← Integrations
        </Link>
        <h1 className="mt-3 text-[34px] leading-[1.12] tracking-[-0.01em]">Calendar</h1>
        <p className="mt-3 text-[15px] text-muted-foreground">
          Connect your Google Calendar so Claude can find times your interviewers are free and send them interview
          invitations from your calendar. Tacit sees only when people are busy, never what their events are, and changes
          only the interview events it books. Candidates are never invited: Claude drafts their email for you to send.
        </p>
      </div>

      {isCalendarNotice(notice) ? <p className="notice">{CALENDAR_NOTICES[notice]}</p> : null}
      {isCalendarError(error) ? <p className="notice notice-error">{CALENDAR_ERRORS[error]}</p> : null}

      <section className="glass space-y-4 px-5 py-5">
        {connection ? (
          <>
            <p className="text-[15px]">
              Connected to Google as <span className="font-medium">{connection.account_email}</span>
              <span className="text-muted-foreground"> since {new Date(connection.connected_at).toLocaleDateString("en-US", { dateStyle: "medium" })}.</span>
            </p>
            <div className="flex flex-wrap items-center gap-4">
              {configured ? (
                <a href="/client/calendar/connect" className="inline-link text-[14px]">
                  Connect again
                </a>
              ) : null}
              <form action={disconnectCalendarAction}>
                <SubmitButton variant="outline" pendingLabel="Disconnecting…">
                  Disconnect
                </SubmitButton>
              </form>
            </div>
          </>
        ) : configured ? (
          <>
            <p className="text-[15px]">Not connected. Interviews you schedule are recorded in Tacit only, and nobody is invited.</p>
            <a href="/client/calendar/connect" className={buttonVariants()}>
              Connect Google Calendar
            </a>
          </>
        ) : (
          <p className="text-[15px] text-muted-foreground">{CALENDAR_ERRORS.not_set_up}</p>
        )}
        <p className="text-[13px] text-muted-foreground">Microsoft Outlook calendars are not supported yet.</p>
      </section>
    </main>
  );
}
