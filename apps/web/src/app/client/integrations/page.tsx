import { googleCalendarConfig } from "@/lib/client/google-calendar";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { IntegrationsView } from "./view";

// The tools a member connects (view.tsx). Both rows are read with the
// member's own token: each member sees only their row, and never the secret
// in it (a refresh token, an API key).
export default async function ClientIntegrations({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; connect?: string }>;
}) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { notice, error, connect } = await searchParams;
  const [calendar, granola] = await Promise.all([
    gate.ctx.db.from("calendar_connections").select("account_email").maybeSingle(),
    gate.ctx.db.from("granola_connections").select("account_email").maybeSingle(),
  ]);
  if (calendar.error) throw new Error(calendar.error.message);
  if (granola.error) throw new Error(granola.error.message);

  return (
    <IntegrationsView
      calendar={calendar.data ? { accountEmail: calendar.data.account_email } : null}
      granola={granola.data ? { accountEmail: granola.data.account_email } : null}
      calendarConfigured={googleCalendarConfig() !== null}
      notice={notice}
      error={error}
      connect={connect}
    />
  );
}
