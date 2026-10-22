import { GoogleG, GranolaIcon } from "@/components/brand-icons";
import { AppTile, Live, Notice, Page, PageHeader, Row, Rows, Section, textLink } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { disconnectCalendarAction } from "../calendar/actions";
import { CALENDAR_ERRORS, CALENDAR_NOTICES, isCalendarError, isCalendarNotice } from "../calendar/messages";
import { disconnectGranolaAction } from "./actions";
import { INTEGRATION_ERRORS, INTEGRATION_NOTICES, isIntegrationError, isIntegrationNotice } from "./messages";

// /client/integrations, laid out like the Connectors card on Tacit's internal
// home (tacit-internal apps/internal (workspace)/page.tsx): one row per
// connector, Connect or its connected state. Both Connects run a sign-in on
// the provider's own page and come back here: Google's consent
// (/client/calendar/connect) and Granola's (/client/integrations/granola/connect).
// Props only, so page.tsx does every read.
export function IntegrationsView({
  calendar,
  granola,
  calendarConfigured,
  notice,
  error,
}: {
  calendar: { accountEmail: string } | null;
  granola: { accountEmail: string | null } | null;
  calendarConfigured: boolean;
  notice?: string;
  error?: string;
}) {
  const noticeText = isIntegrationNotice(notice) ? INTEGRATION_NOTICES[notice] : isCalendarNotice(notice) ? CALENDAR_NOTICES[notice] : null;
  const errorText = isIntegrationError(error) ? INTEGRATION_ERRORS[error] : isCalendarError(error) ? CALENDAR_ERRORS[error] : null;

  return (
    <Page narrow>
      <PageHeader title="Integrations" subtitle="Tools Tacit can use for you. Each connection is yours alone; your teammates connect their own." />
      {errorText ? <Notice tone="error">{errorText}</Notice> : null}
      {noticeText ? <Notice>{noticeText}</Notice> : null}

      <Section title="Connectors">
        <Rows>
          <ConnectorRow
            icon={
              <AppTile>
                <GoogleG className="size-4 bg-transparent" />
              </AppTile>
            }
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
          <div id="granola" className="grid">
            <ConnectorRow
              icon={<GranolaIcon className="size-[30px] rounded-lg" />}
              name="Granola"
              detail={
                granola
                  ? `Your interview notes and transcripts${granola.accountEmail ? `, as ${granola.accountEmail}` : ""}`
                  : "Your interview notes and transcripts, for writing feedback"
              }
              action={
                granola ? (
                  <Connected disconnect={disconnectGranolaAction} manageHref="/client/integrations/granola/connect" />
                ) : (
                  <ActionLink href="/client/integrations/granola/connect">Connect</ActionLink>
                )
              }
            />
          </div>
        </Rows>
      </Section>
    </Page>
  );
}

/** One connector: its tile, name, a detail line, and the action on the right. */
function ConnectorRow({
  icon,
  name,
  detail,
  action,
}: {
  icon: React.ReactNode;
  name: string;
  detail: React.ReactNode;
  action?: React.ReactNode;
}) {
  return <Row icon={icon} title={name} sub={detail} meta={action} className="py-2.5" />;
}

function ActionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className={buttonVariants({ size: "sm" })}>
      {children}
    </a>
  );
}

function Connected({ disconnect, manageHref }: { disconnect: () => Promise<void>; manageHref?: string }) {
  return (
    <>
      <Live>Connected</Live>
      {manageHref ? (
        <a href={manageHref} className={textLink}>
          Reconnect
        </a>
      ) : null}
      <form action={disconnect}>
        <button type="submit" className={`${textLink} cursor-pointer hover:text-negative`}>
          Disconnect
        </button>
      </form>
    </>
  );
}
