import { headers } from "next/headers";
import { clientTools } from "@tacit-ats/core";
import { googleCalendarConfig } from "@/lib/client/google-calendar";
import { resolveClient } from "@/lib/client/session";
import { tacitDelegation } from "@/lib/google-delegation";
import { Refusal } from "../refusal";
import { SettingsView } from "./view";

// Settings: the tools a member connects (view.tsx). Both rows are read with the
// member's own token: each member sees only their row, and never the secrets
// in it (refresh and access tokens). An admin also sees the company's bot.
export default async function ClientSettings({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { notice, error } = await searchParams;
  const admin = gate.ctx.accessLevel === "admin";
  const [calendar, mailbox, workspace, syncOff, granola, bot, botConnected] = await Promise.all([
    gate.ctx.db.from("calendar_connections").select("account_email").maybeSingle(),
    gate.ctx.db.from("mailbox_connections").select("account_email, scopes").maybeSingle(),
    gate.ctx.db.from("google_workspace_connections").select("domain, verified_at").maybeSingle(),
    gate.ctx.db.from("mailbox_sync_optouts").select("actor_id").maybeSingle(),
    gate.ctx.db.from("granola_connections").select("account_email").maybeSingle(),
    // The company's bot: only an admin's token reads the row (never its secret).
    admin
      ? gate.ctx.db.from("agent_destinations").select("url, enabled, verified_at").eq("channel", "grok_bot_webhook").maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // Everyone else reads the boolean only (20261031010000's definer; the vendored
    // types pick it up on the next sync:tacit, so the name is cast for now).
    admin
      ? Promise.resolve({ data: null, error: null })
      : (gate.ctx.db.rpc as unknown as (fn: string) => Promise<{ data: boolean | null; error: { message: string } | null }>)(
          "bot_destination_connected",
        ).then((r) => ({ data: r.data, error: r.error })),
  ]);
  if (calendar.error) throw new Error(calendar.error.message);
  if (mailbox.error) throw new Error(mailbox.error.message);
  if (workspace.error) throw new Error(workspace.error.message);
  if (syncOff.error) throw new Error(syncOff.error.message);
  const myEmail = gate.ctx.user.email.trim().toLowerCase();
  const delegation = tacitDelegation();
  // As core's memberMailbox (and, for Calendar, readCalendarConnections) decides: the company's Workspace covers a member above interviewer at its domain.
  const throughWorkspace =
    !!delegation && !!workspace.data && gate.ctx.accessLevel !== "limited" && clientTools.domainOf(myEmail) === workspace.data.domain;
  if (granola.error) throw new Error(granola.error.message);
  if (bot.error) throw new Error(bot.error.message);
  if (botConnected.error) throw new Error(botConnected.error.message);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";

  return (
    <SettingsView
      calendar={calendar.data ? { accountEmail: calendar.data.account_email } : null}
      granola={granola.data ? { accountEmail: granola.data.account_email } : null}
      mailbox={
        // An interviewer doesn't email candidates, so has nothing to send from.
        gate.ctx.accessLevel === "limited"
          ? undefined
          : mailbox.data
            ? { accountEmail: mailbox.data.account_email, readsReplies: clientTools.grantsScope(mailbox.data, clientTools.GMAIL_READ_SCOPE) }
            : null
      }
      throughWorkspace={throughWorkspace ? { accountEmail: myEmail, syncOn: !syncOff.data } : null}
      // Booking needs the Google app as well (lib/member-calendar/grants.ts), so without it the Workspace books nothing.
      calendarThroughWorkspace={throughWorkspace && googleCalendarConfig() !== null ? { accountEmail: myEmail } : null}
      workspace={
        admin
          ? {
              configured: !!delegation,
              clientId: delegation?.clientId ?? null,
              connected: workspace.data ? { domain: workspace.data.domain, verifiedAt: workspace.data.verified_at } : null,
            }
          : null
      }
      calendarConfigured={googleCalendarConfig() !== null}
      bot={admin ? { set: bot.data ? { url: bot.data.url, enabled: bot.data.enabled, verifiedAt: bot.data.verified_at } : null } : null}
      botConnected={admin ? undefined : !!botConnected.data}
      orgName={gate.ctx.org.name}
      botCallbackUrl={host ? `${proto}://${host}/api/agents/interview-thread` : null}
      templates={gate.ctx.accessLevel !== "limited"}
      notice={notice}
      error={error}
    />
  );
}
