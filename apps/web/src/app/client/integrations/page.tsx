import { headers } from "next/headers";
import { googleCalendarConfig } from "@/lib/client/google-calendar";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { IntegrationsView } from "./view";

// The tools a member connects (view.tsx). Both rows are read with the
// member's own token: each member sees only their row, and never the secrets
// in it (refresh and access tokens). An admin also sees the company's bot.
export default async function ClientIntegrations({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { notice, error } = await searchParams;
  const admin = gate.ctx.accessLevel === "admin";
  const [calendar, granola, bot] = await Promise.all([
    gate.ctx.db.from("calendar_connections").select("account_email").maybeSingle(),
    gate.ctx.db.from("granola_connections").select("account_email").maybeSingle(),
    // The company's bot: only an admin's token reads the row (never its secret).
    admin
      ? gate.ctx.db.from("agent_destinations").select("url, enabled, verified_at").eq("channel", "grok_bot_webhook").maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (calendar.error) throw new Error(calendar.error.message);
  if (granola.error) throw new Error(granola.error.message);
  if (bot.error) throw new Error(bot.error.message);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";

  return (
    <IntegrationsView
      calendar={calendar.data ? { accountEmail: calendar.data.account_email } : null}
      granola={granola.data ? { accountEmail: granola.data.account_email } : null}
      calendarConfigured={googleCalendarConfig() !== null}
      bot={admin ? { set: bot.data ? { url: bot.data.url, enabled: bot.data.enabled, verifiedAt: bot.data.verified_at } : null } : null}
      orgName={gate.ctx.org.name}
      botCallbackUrl={host ? `${proto}://${host}/api/agents/interview-thread` : null}
      botTaskUrl={host ? `${proto}://${host}/api/agents/bot-task` : null}
      notice={notice}
      error={error}
    />
  );
}
