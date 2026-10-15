import Link from "next/link";
import { listPendingInvites } from "@tacit-ats/core";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { inviteAction, withdrawAction } from "./actions";
import { TEAM_ERRORS, TEAM_NOTICES, isTeamError, isTeamNotice } from "./messages";

// The org's team, read with the signed-in member's own token. Everyone sees
// who is on it; an admin also sees who has been invited and not signed in yet,
// and invites, re-sends and withdraws. Whether someone is an admin is the
// database's answer (current_access_level), and the invite functions check it
// again, so hiding the form from others is presentation, not the control.

const LEVELS = { limited: "Interviewer", elevated: "Hiring team", admin: "Admin" } as const;
const levelName = (v: string | null) => (v && v in LEVELS ? LEVELS[v as keyof typeof LEVELS] : "");

const selectClass = "field h-[38px] w-full pl-[11px] text-[14.5px] font-normal";

export default async function ClientTeam({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { notice, error } = await searchParams;
  const { db, accessLevel, actorId } = gate.ctx;
  const isAdmin = accessLevel === "admin";
  const [team, pending] = await Promise.all([
    db.from("org_members").select("id, display_name, email, access_level").order("display_name"),
    isAdmin ? listPendingInvites(db) : Promise.resolve([]),
  ]);
  if (team.error) throw new Error(team.error.message);
  const pendingIds = new Set(pending.map((p) => p.actorId));
  const members = (team.data ?? []).filter((m) => m.id && !pendingIds.has(m.id));

  return (
    <main className="max-w-3xl space-y-11">
      <div>
        <Link href="/client" className="text-[14px] text-muted-foreground transition-colors hover:text-foreground">
          ← Home
        </Link>
        <h1 className="mt-3 text-[34px] leading-[1.12] tracking-[-0.01em]">Team</h1>
      </div>

      {isTeamNotice(notice) ? <p className="notice">{TEAM_NOTICES[notice]}</p> : null}
      {isTeamError(error) ? <p className="notice notice-error">{TEAM_ERRORS[error]}</p> : null}

      <section>
        <h2 className="text-[21px] leading-[1.3]">Members</h2>
        <ul className="glass mt-3 divide-y divide-border overflow-hidden">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <span>
                <span className="text-[15px] font-medium">{m.display_name}</span>
                {m.id === actorId ? <Badge className="ml-2 align-[1px]">you</Badge> : null}
                {m.email ? <span className="block text-sm text-muted-foreground">{m.email}</span> : null}
              </span>
              <span className="shrink-0 text-[13px] text-muted-foreground">{levelName(m.access_level)}</span>
            </li>
          ))}
        </ul>
      </section>

      {isAdmin ? (
        <>
          <section>
            <h2 className="text-[21px] leading-[1.3]">Invited, not signed in yet</h2>
            {pending.length === 0 ? (
              <p className="glass mt-3 px-5 py-4 text-[15px] text-muted-foreground">Nobody is waiting on an invitation.</p>
            ) : (
              <ul className="glass mt-3 divide-y divide-border overflow-hidden">
                {pending.map((p) => (
                  <li key={p.actorId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                    <span>
                      <span className="text-[15px] font-medium">{p.displayName}</span>
                      <span className="ml-2 text-[13px] text-muted-foreground">{levelName(p.accessLevel)}</span>
                      <span className="block text-sm text-muted-foreground">{p.email}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <form action={inviteAction}>
                        <input type="hidden" name="email" value={p.email} />
                        <input type="hidden" name="displayName" value={p.displayName} />
                        <input type="hidden" name="accessLevel" value={p.accessLevel} />
                        <button type="submit" className="rounded-full px-2 py-1 text-[13px] text-primary transition-colors hover:bg-[rgb(29_111_165/0.07)]">
                          Re-send
                        </button>
                      </form>
                      <form action={withdrawAction}>
                        <input type="hidden" name="actorId" value={p.actorId} />
                        <button type="submit" className="rounded-full px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-negative-soft hover:text-negative">
                          Withdraw
                        </button>
                      </form>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="max-w-xl space-y-3">
            <h2 className="text-[21px] leading-[1.3]">Invite someone</h2>
            <form action={inviteAction} className="glass space-y-4 p-5">
              <label className="block space-y-1.5 text-[13px] font-medium text-text">
                Name
                <Input name="displayName" required maxLength={120} autoComplete="off" />
              </label>
              <label className="block space-y-1.5 text-[13px] font-medium text-text">
                Work email
                <Input name="email" type="email" required maxLength={254} autoComplete="off" />
              </label>
              <label className="block space-y-1.5 text-[13px] font-medium text-text">
                Access
                <select name="accessLevel" defaultValue="limited" className={selectClass}>
                  <option value="limited">Interviewer: only the people they interview</option>
                  <option value="elevated">Hiring team: the jobs they are added to</option>
                  <option value="admin">Admin: every job (not confidential ones) and the team</option>
                </select>
              </label>
              <SubmitButton pendingLabel="Sending…">
                Send invitation
              </SubmitButton>
              <p className="text-[13px] text-muted-foreground">
                They get an email from WorkOS and sign in with this address.
              </p>
            </form>
          </section>
        </>
      ) : null}
    </main>
  );
}
