import { listPendingInvites } from "@tacit-ats/core";
import { Avatar, Empty, Notice, Page, PageBar, Pill, Row, Rows, Section, Split } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { Input, selectClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { levelName } from "@/lib/client/levels";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { inviteAction, withdrawAction } from "./actions";
import { TEAM_ERRORS, TEAM_NOTICES, isTeamError, isTeamNotice } from "./messages";

// The org's team, read with the signed-in member's own token. Everyone sees
// who is on it; an admin also sees who has been invited and not signed in yet,
// and invites, re-sends and withdraws. Whether someone is an admin is the
// database's answer (current_access_level), and the invite functions check it
// again, so hiding the form from others is presentation, not the control.

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

  const membersSection = (
    <Section title="Members" count={members.length}>
      <Rows>
        {members.map((m) => (
          <Row
            key={m.id}
            icon={<Avatar name={m.display_name} />}
            title={
              <>
                {m.display_name}
                {m.id === actorId ? <Pill className="ml-2 align-[1px]">you</Pill> : null}
              </>
            }
            sub={m.email ?? undefined}
            meta={<span className="text-faint">{levelName(m.access_level)}</span>}
          />
        ))}
      </Rows>
    </Section>
  );

  return (
    <Page bar={<PageBar title="Team" />}>
      {isTeamNotice(notice) ? <Notice>{TEAM_NOTICES[notice]}</Notice> : null}
      {isTeamError(error) ? <Notice tone="error">{TEAM_ERRORS[error]}</Notice> : null}

      {isAdmin ? (
        <Split
          main={
            <>
              {membersSection}
              <Section title="Invited, not signed in yet" count={pending.length}>
                {pending.length === 0 ? (
                  <Empty>Nobody is waiting on an invitation.</Empty>
                ) : (
                  <Rows>
                    {pending.map((p) => (
                      <Row
                        key={p.actorId}
                        icon={<Avatar name={p.displayName} />}
                        title={p.displayName}
                        sub={`${p.email} · ${levelName(p.accessLevel)}`}
                        meta={
                          <>
                            <form action={inviteAction}>
                              <input type="hidden" name="email" value={p.email} />
                              <input type="hidden" name="displayName" value={p.displayName} />
                              <input type="hidden" name="accessLevel" value={p.accessLevel} />
                              <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
                                Re-send
                              </button>
                            </form>
                            <form action={withdrawAction}>
                              <input type="hidden" name="actorId" value={p.actorId} />
                              <button type="submit" className={buttonVariants({ variant: "ghost", size: "sm", className: "text-muted-foreground hover:text-negative" })}>
                                Withdraw
                              </button>
                            </form>
                          </>
                        }
                      />
                    ))}
                  </Rows>
                )}
              </Section>
            </>
          }
          side={
            <Section title="Invite someone">
              <form action={inviteAction} className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="displayName">Name</Label>
                  <Input id="displayName" name="displayName" required maxLength={120} autoComplete="off" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="email">Work email</Label>
                  <Input id="email" name="email" type="email" required maxLength={254} autoComplete="off" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="accessLevel">Access</Label>
                  <select id="accessLevel" name="accessLevel" defaultValue="limited" className={selectClass}>
                    <option value="limited">Interviewer: only the people they interview</option>
                    <option value="elevated">Hiring team: the jobs they are added to</option>
                    <option value="admin">Admin: every job (not confidential ones) and the team</option>
                  </select>
                </div>
                <SubmitButton pendingLabel="Sending…" className="justify-self-start">
                  Send invitation
                </SubmitButton>
                <p className="m-0 text-xs text-faint">They get an email from WorkOS and sign in with this address.</p>
              </form>
            </Section>
          }
        />
      ) : (
        membersSection
      )}
    </Page>
  );
}
