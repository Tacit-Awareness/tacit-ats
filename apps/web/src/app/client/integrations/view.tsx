import { GoogleG, GranolaIcon } from "@/components/brand-icons";
import { FlashToast } from "@/components/flash-toast";
import { AppTile, Notice, Page, PageBar, Pill, Row, Rows, Section } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { disconnectCalendarAction } from "../calendar/actions";
import { CALENDAR_ERRORS, CALENDAR_NOTICES, isCalendarError, isCalendarNotice } from "../calendar/messages";
import { disconnectGranolaAction } from "./actions";
import { BotSection, type CompanyBot } from "./bot";
import {
  BOT_ERRORS, BOT_NOTICES, INTEGRATION_ERRORS, INTEGRATION_NOTICES, isBotError, isBotNotice, isIntegrationError, isIntegrationNotice,
} from "./messages";

// /client/integrations, design/tats's settings cards (`.cardbox` around
// `.lrow.pol`): one ruled row per connector, Connect or its connected state,
// the same page shape as Interviewers. Both Connects run a sign-in on
// the provider's own page and come back here: Google's consent
// (/client/calendar/connect) and Granola's (/client/integrations/granola/connect).
// Props only, so page.tsx does every read.
export function IntegrationsView({
  calendar,
  granola,
  calendarConfigured,
  bot,
  orgName,
  botCallbackUrl,
  notice,
  error,
}: {
  calendar: { accountEmail: string } | null;
  granola: { accountEmail: string | null } | null;
  calendarConfigured: boolean;
  /** Null for anyone but an admin, who gets the company's bot section. */
  bot: { set: CompanyBot | null } | null;
  orgName: string;
  botCallbackUrl: string | null;
  notice?: string;
  error?: string;
}) {
  const noticeText = isIntegrationNotice(notice) ? INTEGRATION_NOTICES[notice]
    : isCalendarNotice(notice) ? CALENDAR_NOTICES[notice]
      : isBotNotice(notice) ? BOT_NOTICES[notice] : null;
  const errorText = isIntegrationError(error) ? INTEGRATION_ERRORS[error]
    : isCalendarError(error) ? CALENDAR_ERRORS[error]
      : isBotError(error) ? BOT_ERRORS[error] : null;

  return (
    <Page bar={<PageBar title="Integrations" />}>
      {errorText ? <Notice tone="error">{errorText}</Notice> : null}
      {noticeText ? <FlashToast text={noticeText} /> : null}

      <Section flush title="Connectors">
        <Rows ruled>
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
          <div id="granola" className="grid scroll-mt-4">
            <ConnectorRow
              icon={<GranolaIcon className="size-[30px]" />}
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
      {bot ? <BotSection bot={bot.set} orgName={orgName} callbackUrl={botCallbackUrl} /> : null}
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
  return <Row icon={icon} title={name} sub={detail} meta={action} />;
}

function ActionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
      {children}
    </a>
  );
}

function Connected({ disconnect, manageHref }: { disconnect: () => Promise<void>; manageHref?: string }) {
  return (
    <>
      <Pill tone="green">Connected</Pill>
      {manageHref ? (
        <a href={manageHref} className={buttonVariants({ variant: "ghost", size: "sm", className: "text-muted-foreground" })}>
          Reconnect
        </a>
      ) : null}
      <form action={disconnect}>
        <button type="submit" className={buttonVariants({ variant: "ghost", size: "sm", className: "text-muted-foreground hover:text-negative" })}>
          Disconnect
        </button>
      </form>
    </>
  );
}
