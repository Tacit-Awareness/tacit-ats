import { GoogleG, GranolaIcon } from "@/components/brand-icons";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { disconnectCalendarAction } from "../calendar/actions";
import { CALENDAR_ERRORS, CALENDAR_NOTICES, isCalendarError, isCalendarNotice } from "../calendar/messages";
import { connectGranolaAction, disconnectGranolaAction } from "./actions";
import { INTEGRATION_ERRORS, INTEGRATION_NOTICES, isIntegrationError, isIntegrationNotice } from "./messages";

// /client/integrations, laid out like Tacit's internal home (tacit-internal
// apps/internal (workspace)/page.tsx): one row per connector, Connect or its
// connected state. Google Calendar runs its consent flow and comes back here;
// Granola takes a pasted API key, so Connect opens its form under the row
// (?connect=granola). Props only, so page.tsx does every read.
export function IntegrationsView({
  calendar,
  granola,
  calendarConfigured,
  notice,
  error,
  connect,
}: {
  calendar: { accountEmail: string } | null;
  granola: { accountEmail: string | null } | null;
  calendarConfigured: boolean;
  notice?: string;
  error?: string;
  connect?: string;
}) {
  const noticeText = isIntegrationNotice(notice) ? INTEGRATION_NOTICES[notice] : isCalendarNotice(notice) ? CALENDAR_NOTICES[notice] : null;
  const errorText = isIntegrationError(error) ? INTEGRATION_ERRORS[error] : isCalendarError(error) ? CALENDAR_ERRORS[error] : null;
  const granolaFormOpen = !granola && (connect === "granola" || !!error?.startsWith("granola_"));

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHeading title="Integrations" sub="Tools Tacit can use for you" />
      {errorText ? <p role="alert" className="mt-4 text-sm text-destructive">{errorText}</p> : null}
      {noticeText ? <p role="status" className="mt-4 text-sm text-muted-foreground">{noticeText}</p> : null}

      <Row
        icon={<GoogleG className="size-9 bg-transparent" />}
        name="Google Calendar"
        detail={
          calendar
            ? `Interview scheduling, as ${calendar.accountEmail}`
            : calendarConfigured
              ? "Find times your interviewers are free and send them invites"
              : "Not set up on this Tacit deployment yet"
        }
        action={
          calendar ? (
            <Connected disconnect={disconnectCalendarAction} manageHref={calendarConfigured ? "/client/calendar/connect" : undefined} />
          ) : calendarConfigured ? (
            <ActionLink href="/client/calendar/connect">Connect</ActionLink>
          ) : null
        }
      />

      <div id="granola">
        <Row
          icon={<GranolaIcon className="size-11" />}
          name="Granola"
          detail={
            granola
              ? `Your interview notes and transcripts${granola.accountEmail ? `, as ${granola.accountEmail}` : ""}`
              : "Your interview notes and transcripts, for writing feedback"
          }
          action={
            granola ? (
              <Connected disconnect={disconnectGranolaAction} />
            ) : granolaFormOpen ? null : (
              <ActionLink href="/client/integrations?connect=granola#granola">Connect</ActionLink>
            )
          }
          below={
            granolaFormOpen ? (
              <form action={connectGranolaAction} className="space-y-3">
                <p className="text-[15px] text-muted-foreground">
                  In Granola, open Settings → Connectors → API keys, create a key, and paste it here. Needs a Business or
                  Enterprise plan.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    name="apiKey"
                    type="password"
                    required
                    minLength={8}
                    maxLength={512}
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    placeholder="grn_…"
                    aria-label="Granola API key"
                    className="h-11 w-full sm:max-w-sm sm:flex-1"
                  />
                  <SubmitButton pendingLabel="Checking…" className="h-11 rounded-lg px-6 text-[15px]">
                    Connect
                  </SubmitButton>
                  <a href="/client/integrations" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
                    Cancel
                  </a>
                </div>
              </form>
            ) : null
          }
        />
      </div>
    </div>
  );
}

function SectionHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="border-b-2 border-foreground pb-5">
      <h1 className="text-[34px] leading-tight font-[550] tracking-[-0.02em]">{title}</h1>
      <p className="mt-1 text-[15px] text-muted-foreground">{sub}</p>
    </div>
  );
}

/** One connector: icon, name, a detail line, the action on the right, and anything that opens beneath it. */
function Row({
  icon,
  name,
  detail,
  action,
  below,
}: {
  icon: React.ReactNode;
  name: string;
  detail: React.ReactNode;
  action?: React.ReactNode;
  below?: React.ReactNode;
}) {
  return (
    <div className="border-b border-dashed border-border py-6">
      {/* On a phone the action wraps under the text, lined up with it. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="flex size-11 shrink-0 items-center justify-center">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-[550]">{name}</p>
          <div className="mt-0.5 text-[15px] break-words text-muted-foreground">{detail}</div>
        </div>
        {action ? <div className="w-full pl-16 sm:w-auto sm:pl-0">{action}</div> : null}
      </div>
      {below ? <div className="mt-5 sm:pl-16">{below}</div> : null}
    </div>
  );
}

function ActionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex h-11 shrink-0 items-center rounded-lg bg-foreground px-6 text-[15px] font-[550] text-background transition-opacity hover:opacity-90"
    >
      {children}
    </a>
  );
}

function Connected({ disconnect, manageHref }: { disconnect: () => Promise<void>; manageHref?: string }) {
  const link = "text-muted-foreground underline underline-offset-4 hover:text-foreground";
  return (
    <span className="flex shrink-0 items-center gap-4 text-sm">
      <span className="inline-flex items-center gap-1.5 text-foreground">
        <span className="size-2 rounded-full bg-[#34c759]" aria-hidden />
        Connected
      </span>
      {manageHref ? (
        <a href={manageHref} className={link}>
          Reconnect
        </a>
      ) : null}
      <form action={disconnect}>
        <button type="submit" className={`${link} cursor-pointer`}>
          Disconnect
        </button>
      </form>
    </span>
  );
}
