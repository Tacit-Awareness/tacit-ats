import Link from "next/link";
import { GoogleG, GranolaIcon } from "@/components/brand-icons";
import { FlashToast } from "@/components/flash-toast";
import { AppTile, Notice, Page, PageBar, Pill, Row, Rows, Section } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { disconnectCalendarAction } from "../calendar/actions";
import { CALENDAR_ERRORS, CALENDAR_NOTICES, isCalendarError, isCalendarNotice } from "../calendar/messages";
import { disconnectGranolaAction } from "../integrations/actions";
import { BotSection, type CompanyBot } from "../integrations/bot";
import {
  BOT_ERRORS, BOT_NOTICES, INTEGRATION_ERRORS, INTEGRATION_NOTICES, isBotError, isBotNotice, isIntegrationError, isIntegrationNotice,
} from "../integrations/messages";
import { RoutingRules } from "./routing-rules";

// /client/settings, design/tats's settings cards (`.cardbox` around
// `.lrow.pol`): one ruled row per connector, Connect or its connected state,
// the same page shape as Interviewers. Both Connects run a sign-in on
// the provider's own page and come back here: Google's consent
// (/client/calendar/connect) and Granola's (/client/integrations/granola/connect).
// Above them, design/tats's `.set-link`s to Onboarding and its Routing Rules.
// Props only, so page.tsx does every read.
export function SettingsView({
  calendar,
  granola,
  calendarConfigured,
  bot,
  botConnected,
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
  /** For everyone else: just whether the bot is connected (one-time, org-wide). */
  botConnected?: boolean;
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
    <Page narrow bar={<PageBar title="Settings" />}>
      {errorText ? <Notice tone="error">{errorText}</Notice> : null}
      {noticeText ? <FlashToast text={noticeText} /> : null}

      <SetLink
        href="/client/onboarding/people"
        icon={USERS}
        title="People & teams"
        sub="Add interviewers and their Grokbots, move people between teams, and set what each person interviews for"
      />
      <SetLink
        href="/client/onboarding/process"
        icon={ROUTE}
        title="Interview process"
        sub="Draw the steps from applying to an offer, who runs each one and how long it takes. The Grokbots route by it"
      />
      <RoutingRules />

      <Section flush title="Integrations">
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
      {bot || botConnected !== undefined ? <BotSection bot={bot ? bot.set : null} connected={botConnected} callbackUrl={botCallbackUrl} /> : null}
    </Page>
  );
}

const USERS = "M6 7.5a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6M1.8 13c.4-2.3 2-3.6 4.2-3.6s3.8 1.3 4.2 3.6M11 3.2a2.2 2.2 0 0 1 0 4.1M12.6 9.8c1 .6 1.6 1.7 1.8 3.2";
const ROUTE = "M3 2.5h4v3.5H3ZM9 10h4v3.5H9ZM5 6v3a2 2 0 0 0 2 2h2";
const ARROW = "M3 8h10M9 4l4 4-4 4";

function LinkIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" className="size-4 text-muted-foreground" aria-hidden>
      <path d={path} />
    </svg>
  );
}

/** design/tats's `.set-link`: a card that goes to the page where this is set. */
function SetLink({ href, icon, title, sub }: { href: string; icon: string; title: string; sub: string }) {
  return (
    <Link
      href={href}
      className="grid grid-cols-[20px_minmax(0,1fr)_16px] items-center gap-3 rounded-xl border border-[color:var(--line)] bg-[color:var(--raised)] p-4 transition-colors hover:border-[color:var(--line-strong)]"
    >
      <LinkIcon path={icon} />
      <span>
        <b className="block text-[14.5px] font-medium">{title}</b>
        <span className="text-[13px] text-muted-foreground">{sub}</span>
      </span>
      <LinkIcon path={ARROW} />
    </Link>
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
