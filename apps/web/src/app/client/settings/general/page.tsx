import { heading } from "@/components/tickets/styles";
import { LEVELS } from "@/lib/client/levels";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../../refusal";
import { ThemeChoice } from "./theme";

// Settings' General (design/tacit-tickets's Settings, General): the workspace
// and who you are signed in as, and the theme. Read from the member's own
// session (resolveClient); the theme is the account menu's choice, kept in the
// `tacit-theme` cookie (lib/theme.ts).

function Line({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-12 items-center gap-3 border-b border-line px-1 py-2 last:border-b-0">{children}</div>;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9 first:mt-0">
      <div className="mb-2 flex items-baseline gap-3">
        <h3 className={heading}>{title}</h3>
      </div>
      <div className="rounded-xl border border-line-strong px-3">{children}</div>
    </section>
  );
}

export default async function SettingsGeneral() {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { org, user, accessLevel } = gate.ctx;
  return (
    <div className="anim-rise mx-auto max-w-[640px]">
      <h2 className="mb-7 text-[22px] font-semibold tracking-[-0.02em] text-ink">General</h2>
      <Group title="Workspace">
        <Line>
          <span className="flex-1 text-body">Name</span>
          <span className="text-ink">{org.name}</span>
        </Line>
        <Line>
          <span className="flex-1 text-body">Signed In As</span>
          <span className="flex min-w-0 items-center gap-2 text-ink">
            <span className="truncate">{user.name || user.email}</span>
            <span className="text-mute">{LEVELS[accessLevel]}</span>
          </span>
        </Line>
        <Line>
          <span className="flex-1 text-body">Email</span>
          <span className="truncate text-ink">{user.email}</span>
        </Line>
      </Group>
      <Group title="Appearance">
        <Line>
          <span className="flex-1 text-body">Theme</span>
          <ThemeChoice />
        </Line>
      </Group>
    </div>
  );
}
