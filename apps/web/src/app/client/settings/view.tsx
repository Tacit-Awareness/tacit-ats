import Link from "next/link";
import { GoogleG, GranolaIcon } from "@/components/brand-icons";
import { FlashToast } from "@/components/flash-toast";
import { Banner } from "@/components/banner";
import { Notice, Page, PageBar, Section } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { disconnectCalendarAction } from "../calendar/actions";
import { CALENDAR_ERRORS, CALENDAR_NOTICES, isCalendarError, isCalendarNotice } from "../calendar/messages";
import { disconnectGranolaAction } from "../integrations/actions";
import { disconnectMailboxAction, disconnectWorkspaceAction, setMailboxSyncAction, verifyWorkspaceAction } from "../mailbox/actions";
import { MAILBOX_ERRORS, MAILBOX_NOTICES, isMailboxError, isMailboxNotice } from "../mailbox/messages";
import { BotSection, type CompanyBot } from "../integrations/bot";
import {
  BOT_ERRORS, BOT_NOTICES, INTEGRATION_ERRORS, INTEGRATION_NOTICES, isBotError, isBotNotice, isIntegrationError, isIntegrationNotice,
} from "../integrations/messages";
import type { CalendarDelegation } from "@/lib/client/workspace-calendar";
import { RoutingRules } from "./routing-rules";
import { ConnectedTag, SetRow } from "./rows";

// /client/settings, in Testbench's workspace settings (settings.css): soft
// white cards of 56px rows, the name on the left and its control on the right.
// First the rows that go where people, the process and (not for an
// interviewer) the email templates are set, then design/tats's Routing Rules,
// then one row per connector, Connect or its connected state. Both Connects
// run a sign-in on the provider's own page and come back here: Google's
// consent (/client/calendar/connect and, for Gmail, /client/mailbox/connect)
// and Granola's (/client/integrations/granola/connect).
// Props only, so page.tsx does every read.
export function SettingsView({
  calendar,
  granola,
  mailbox,
  calendarConfigured,
  throughWorkspace = null,
  calendarThroughWorkspace = null,
  workspace = null,
  bot,
  botConnected,
  orgName,
  botCallbackUrl,
  templates = false,
  notice,
  error,
}: {
  calendar: { accountEmail: string } | null;
  granola: { accountEmail: string | null } | null;
  /** The member's own Gmail for candidate email; undefined for an interviewer, who sends none. */
  mailbox?: { accountEmail: string; readsReplies: boolean } | null;
  calendarConfigured: boolean;
  /** The member's Gmail comes through their company's Google Workspace: nothing to connect, only their sync switch. */
  throughWorkspace?: { accountEmail: string; syncOn: boolean } | null;
  /** The company's Google Workspace books for this member (core's readCalendarConnections), as this address. */
  calendarThroughWorkspace?: { accountEmail: string } | null;
  /** For an admin: the company's Google Workspace setup. */
  workspace?: WorkspaceSetup | null;
  /** Null for anyone but an admin, who gets the company's bot section. */
  bot: { set: CompanyBot | null } | null;
  /** For everyone else: just whether the bot is connected (one-time, org-wide). */
  botConnected?: boolean;
  orgName: string;
  botCallbackUrl: string | null;
  /** Link Email templates: everyone but an interviewer, who doesn't email candidates. */
  templates?: boolean;
  notice?: string;
  error?: string;
}) {
  const noticeText = isIntegrationNotice(notice) ? INTEGRATION_NOTICES[notice]
    : isCalendarNotice(notice) ? CALENDAR_NOTICES[notice]
      : isMailboxNotice(notice) ? MAILBOX_NOTICES[notice]
        : isBotNotice(notice) ? BOT_NOTICES[notice] : null;
  const errorText = isIntegrationError(error) ? INTEGRATION_ERRORS[error]
    : isCalendarError(error) ? CALENDAR_ERRORS[error]
      : isMailboxError(error) ? MAILBOX_ERRORS[error]
        : isBotError(error) ? BOT_ERRORS[error] : null;

  return (
    <Page narrow className="set-page max-w-[880px]" bar={<PageBar title="Settings" />}>
      {errorText ? <Notice tone="error">{errorText}</Notice> : null}
      {noticeText ? <FlashToast text={noticeText} /> : null}

      {/* design/tats's `.set-link`s, as one card of rows that go where each is set; what each is for is on the row's hover and read out after its name */}
      <Section flush aria-label="Where it is set">
        <SetRow
          href="/client/onboarding/people"
          icon={<LinkIcon path={USERS} />}
          name="People & teams"
          hint="Add interviewers and their Grokbots, move people between teams, and set what each person interviews for"
        />
        <SetRow
          href="/client/onboarding/process"
          icon={<LinkIcon path={ROUTE} />}
          name="Interview process"
          hint="Draw the steps from applying to an offer, who runs each one and how long it takes. The Grokbots route by it"
        />
        {templates ? (
          <SetRow
            href="/client/settings/templates"
            icon={<LinkIcon path={MAIL} />}
            name="Email templates"
            hint="Your company's reusable emails to candidates. The reply box on New Applicants starts from them"
          />
        ) : null}
      </Section>

      <RoutingRules />

      <Section flush title="Integrations">
        <SetRow
          icon={<GoogleG className="size-[18px] bg-transparent p-0" />}
          name="Google Calendar"
          detail={
            calendarThroughWorkspace
              ? `Through your company's Google Workspace, as ${calendarThroughWorkspace.accountEmail}`
              : calendar
              ? `Interview scheduling, as ${calendar.accountEmail}`
              : calendarConfigured
                ? "Find times your interviewers are free and send them invites"
                : "Not set up on this Tacit deployment yet"
          }
          action={
            // Covered by the Workspace: nothing to connect; a connection of their own stays only as its fallback.
            calendarThroughWorkspace ? (
              calendar ? <Connected disconnect={disconnectCalendarAction} /> : null
            ) : calendar ? (
              <Connected disconnect={disconnectCalendarAction} manageHref={calendarConfigured ? "/client/calendar/connect" : undefined} />
            ) : calendarConfigured ? (
              <ActionLink href="/client/calendar/connect">Connect</ActionLink>
            ) : null
          }
        />
        {mailbox !== undefined ? (
          throughWorkspace ? (
            <SetRow
              id="gmail"
              icon={<GoogleG className="size-[18px] bg-transparent p-0" />}
              name="Gmail"
              detail={
                throughWorkspace.syncOn
                  ? `Through your company's Google Workspace, as ${throughWorkspace.accountEmail}. Your email with candidates syncs to their profiles`
                  : `Through your company's Google Workspace, as ${throughWorkspace.accountEmail}. Sync is off: only email you send from Tacit is kept`
              }
              action={
                <form action={setMailboxSyncAction}>
                  <input type="hidden" name="on" value={throughWorkspace.syncOn ? "0" : "1"} />
                  <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
                    {throughWorkspace.syncOn ? "Turn off sync" : "Turn on sync"}
                  </button>
                </form>
              }
            />
          ) : (
            <SetRow
              id="gmail"
              icon={<GoogleG className="size-[18px] bg-transparent p-0" />}
              name="Gmail"
              detail={
                mailbox
                  ? mailbox.readsReplies
                    ? `Candidate email goes out from ${mailbox.accountEmail}, and replies come back to the Inbox`
                    : `Candidate email goes out from ${mailbox.accountEmail}; replies stay in your Gmail`
                  : calendarConfigured
                    ? "Email candidates from your own address, and see their replies in the Inbox"
                    : "Not set up on this Tacit deployment yet"
              }
              action={
                mailbox ? (
                  <Connected disconnect={disconnectMailboxAction} manageHref={calendarConfigured ? "/client/mailbox/connect" : undefined} />
                ) : calendarConfigured ? (
                  <ActionLink href="/client/mailbox/connect">Connect</ActionLink>
                ) : null
              }
            />
          )
        ) : null}
        <SetRow
          id="granola"
          icon={<GranolaIcon className="size-[18px] rounded-[4px]" />}
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
      </Section>
      {workspace ? <WorkspaceSection setup={workspace} /> : null}
      {bot || botConnected !== undefined ? <BotSection bot={bot ? bot.set : null} connected={botConnected} callbackUrl={botCallbackUrl} /> : null}
    </Page>
  );
}

const USERS = "M6 7.5a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6M1.8 13c.4-2.3 2-3.6 4.2-3.6s3.8 1.3 4.2 3.6M11 3.2a2.2 2.2 0 0 1 0 4.1M12.6 9.8c1 .6 1.6 1.7 1.8 3.2";
const ROUTE = "M3 2.5h4v3.5H3ZM9 10h4v3.5H9ZM5 6v3a2 2 0 0 0 2 2h2";
const MAIL = "M2 3.5h12v9H2ZM2.5 4l5.5 4.5L13.5 4";

function LinkIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" className="size-4 text-faint" aria-hidden>
      <path d={path} />
    </svg>
  );
}

function ActionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
      {children}
    </a>
  );
}

const quiet = buttonVariants({ variant: "ghost", size: "sm" });
const danger = buttonVariants({ variant: "ghost", size: "sm", className: "hover:text-negative" });

function Connected({ disconnect, manageHref }: { disconnect: () => Promise<void>; manageHref?: string }) {
  return (
    <>
      <ConnectedTag />
      {manageHref ? (
        <a href={manageHref} className={quiet}>
          Reconnect
        </a>
      ) : null}
      <form action={disconnect}>
        <button type="submit" className={danger}>
          Disconnect
        </button>
      </form>
    </>
  );
}

export type WorkspaceSetup = {
  /** Whether Tacit's service account is set on this deployment. */
  configured: boolean;
  /** The service account's client ID, which the company's Google admin authorizes. */
  clientId: string | null;
  /** `calendar`: whether Google gives a calendar token as this admin (lib/client/workspace-calendar.ts). */
  connected: { domain: string; verifiedAt: string; calendar: CalendarDelegation } | null;
};

/** Gmail (send, and read for the sync) and Calendar (book, and busy times), as core's mailbox.ts and calendar.ts ask. */
const WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
].join(",");

/**
 * An admin connects the company's Google Workspace once, as in Ashby: their
 * Google admin authorizes Tacit's client ID for the four scopes under
 * domain-wide delegation, then Verify asks Google for a token as this admin.
 */
function WorkspaceSection({ setup }: { setup: WorkspaceSetup }) {
  const ready = setup.configured && !!setup.clientId;
  return (
    <Section flush title="Google Workspace" aside={setup.connected && ready ? <ConnectedTag /> : null}>
      <div id="workspace" className="grid scroll-mt-4 gap-4 px-5 pt-4 pb-5 text-[13px] leading-5 text-muted-foreground">
        {!ready ? (
          <p className="m-0 text-faint">Not set up on this Tacit deployment yet.</p>
        ) : setup.connected ? (
          <>
            <p className="m-0">
              Connected for <strong>{setup.connected.domain}</strong>. Everyone at {setup.connected.domain} sends candidate email from their own
              address, interviews are booked on their own Google Calendar, and their email with candidates syncs to Tacit. Each person can turn
              their own sync off under Gmail above.
            </p>
            {setup.connected.calendar === "missing" ? (
              <Banner
                status="warning"
                title="Calendar isn't delegated yet"
                desc={
                  <>
                    Google refused Tacit&apos;s calendar access, so interviews are booked only on calendars people connect themselves. Your Google
                    admin edits Tacit&apos;s entry under Manage Domain Wide Delegation (client ID{" "}
                    <code className="set-code">{setup.clientId}</code>) so its OAuth scopes read{" "}
                    <code className="set-code">{WORKSPACE_SCOPES}</code>, then Verify again.
                  </>
                }
              />
            ) : setup.connected.calendar === "unknown" ? (
              <p className="m-0 rounded-[10px] bg-[color:var(--soft)] px-4 py-3 shadow-[inset_0_0_0_1px_var(--line)]">
                Connected before Calendar was part of it? Your Google admin adds the calendar scopes to Tacit&apos;s entry (client ID{" "}
                <code className="set-code">{setup.clientId}</code>):{" "}
                <code className="set-code">{WORKSPACE_SCOPES}</code>. Then Verify again.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <form action={verifyWorkspaceAction}>
                <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>Verify again</button>
              </form>
              <form action={disconnectWorkspaceAction}>
                <button type="submit" className={danger}>
                  Disconnect
                </button>
              </form>
            </div>
          </>
        ) : (
          <>
            <p className="m-0">
              Connect once for the whole company: everyone at your domain sends candidate email from their own address and has interviews booked
              on their own Google Calendar, with nothing to connect themselves, and their email with candidates syncs to Tacit. Your Google Workspace admin does the first step.
            </p>
            {/* The two steps in order, in a recessed well; the order is the list's, not a number's. */}
            <ol className="m-0 grid list-none rounded-[10px] bg-[color:var(--soft)] p-0 shadow-[inset_0_0_0_1px_var(--line)]">
              <li className="px-4 py-3">
                In the{" "}
                <a href="https://admin.google.com/ac/owl/domainwidedelegation" className={inlineLink}>
                  Google Admin console
                </a>
                , open Security › Access and data control › API controls › Manage Domain Wide Delegation, and choose Add new. Client ID:{" "}
                <code className="set-code">{setup.clientId}</code>. OAuth scopes:{" "}
                <code className="set-code">{WORKSPACE_SCOPES}</code>. Authorize.
              </li>
              <li className="border-t border-[color:var(--line)] px-4 py-3">Come back here and verify. It can take a few minutes after authorizing.</li>
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <form action={verifyWorkspaceAction}>
                <button type="submit" className={buttonVariants({ size: "sm" })}>Verify</button>
              </form>
              <Link href="/client/docs/email" className={inlineLink}>
                What Tacit reads, and what it keeps
              </Link>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}

const inlineLink = "text-foreground underline decoration-[color:var(--line-strong)] underline-offset-[3px] transition-colors hover:decoration-current";
