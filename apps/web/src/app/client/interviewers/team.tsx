import type { listPendingInvites } from "@tacit-ats/core";
import { Avatar, Empty, Pill, Row, Rows, Section } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { Input, selectClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { levelName } from "@/lib/client/levels";
import { inviteAction, withdrawAction } from "./actions";

// Under the interviewers: everyone on the team with their access, and for an
// admin who has been invited and not signed in yet, with the invite form.
// Props only (page.tsx does the reads). Hiding the forms from others is
// presentation, not the control: the invite functions check the caller again.

export type TeamMember = { id: string; display_name: string; email: string | null; access_level: string };

export function TeamSections({
  members,
  pending,
  actorId,
  isAdmin,
}: {
  members: TeamMember[];
  pending: Awaited<ReturnType<typeof listPendingInvites>>;
  actorId: string;
  isAdmin: boolean;
}) {
  return (
    <>
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

      {isAdmin ? (
        <>
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

          <Section title="Invite someone">
            <form action={inviteAction} className="grid max-w-[420px] gap-3">
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
        </>
      ) : null}
    </>
  );
}
