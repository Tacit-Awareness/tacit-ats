import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { googleCalendarConfig } from "@/lib/client/google-calendar";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { connectGranolaAction, disconnectGranolaAction } from "./actions";
import { INTEGRATION_ERRORS, INTEGRATION_NOTICES, isIntegrationError, isIntegrationNotice } from "./messages";

const since = (at: string) => new Date(at).toLocaleDateString("en-US", { dateStyle: "medium" });

// The tools a member connects to Tacit, each their own. Both rows are read
// with the member's own token: the policies show each member only their row,
// and never the secret in it (a refresh token, an API key).
export default async function ClientIntegrations({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { notice, error } = await searchParams;
  const [calendar, granola] = await Promise.all([
    gate.ctx.db.from("calendar_connections").select("account_email, connected_at").maybeSingle(),
    gate.ctx.db.from("granola_connections").select("account_email, connected_at").maybeSingle(),
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

      <section className="glass space-y-4 px-5 py-5">
        <div>
          <h2 className="text-[21px] leading-[1.3]">Granola</h2>
          <p className="mt-1.5 text-[15px] text-muted-foreground">
            For interviewers who take notes in Granola. Connect it and Claude can read your own note from an interview you
            were on (Granola&apos;s summary, what you typed, and the transcript if you ask) to help you write your feedback.
            Only your notes are read, never a colleague&apos;s, and they are never shown to candidates.
          </p>
        </div>
        {granola.data ? (
          <>
            <p className="text-[15px]">
              Connected
              {granola.data.account_email ? (
                <>
                  {" "}as <span className="font-medium">{granola.data.account_email}</span>
                </>
              ) : null}
              <span className="text-muted-foreground"> since {since(granola.data.connected_at)}.</span>
            </p>
            <form action={disconnectGranolaAction}>
              <SubmitButton variant="outline" pendingLabel="Disconnecting…">
                Disconnect
              </SubmitButton>
            </form>
          </>
        ) : (
          <form action={connectGranolaAction} className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-[14px] text-muted-foreground">
              <li>Open the Granola app and go to Settings → Connectors → API keys.</li>
              <li>Create a key and copy it.</li>
              <li>Paste it below.</li>
            </ol>
            <label className="block max-w-md space-y-1.5 text-[13px] font-medium text-text">
              Granola API key
              <Input
                name="apiKey"
                type="password"
                required
                minLength={8}
                maxLength={512}
                autoComplete="off"
                spellCheck={false}
                placeholder="grn_…"
              />
            </label>
            <SubmitButton pendingLabel="Checking…">Connect Granola</SubmitButton>
            <p className="text-[13px] text-muted-foreground">
              API keys need a Granola Business or Enterprise plan. Tacit checks the key with Granola before saving it.
            </p>
          </form>
        )}
      </section>

      <section className="glass space-y-4 px-5 py-5">
        <div>
          <h2 className="text-[21px] leading-[1.3]">Google Calendar</h2>
          <p className="mt-1.5 text-[15px] text-muted-foreground">
            So Claude can find times your interviewers are free and send interview invitations from your calendar.
          </p>
        </div>
        {calendar.data ? (
          <p className="text-[15px]">
            Connected as <span className="font-medium">{calendar.data.account_email}</span>
            <span className="text-muted-foreground"> since {since(calendar.data.connected_at)}.</span>
          </p>
        ) : (
          <p className="text-[15px] text-muted-foreground">{calendarConfigured ? "Not connected." : "Not set up on this Tacit deployment yet."}</p>
        )}
        <Link href="/client/calendar" className="inline-link text-[14px]">
          {calendar.data ? "Manage" : "Set up"} Google Calendar →
        </Link>
      </section>
    </main>
  );
}
