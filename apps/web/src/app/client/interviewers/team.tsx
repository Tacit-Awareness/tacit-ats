import type { listPendingInvites } from "@tacit-ats/core";
import { Empty, Pill, Row, Rows, Section } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { Input, selectClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { levelName } from "@/lib/client/levels";
import { soleAdmin } from "@/lib/client/member-access";
import { inviteAction, withdrawAction } from "../onboarding/actions";
import { TitleForm } from "../onboarding/people/title-form";
import { AccessForm } from "./access-form";

// Everyone on the team with their access and title; for an admin the picker that
// changes the access, who has been invited and not signed in yet, and the invite
// form; for anyone their own title. Onboarding's People step, and the Interviewers
// page for an external recruiter, whom Onboarding turns away. Props only (the pages
// do the reads). Hiding the forms from others, and the picker from the only admin,
// is presentation, not the control: the definer functions check the caller and
// the last admin again, and the policies decide a title. Names stand alone, with
// their facts spaced apart under them; who sees what at each access level is
// in the picker's options, and the sign-in email they get is the button's hover title.
// A card's count is for a screen reader only: its rows already show how many.

const EMAIL_HINT = "They get an email to choose a password and sign in with this address.";

/** Facts under a name, each its own span, spaced rather than dotted; nothing when there are none, so the row draws no empty line. */
function factLine(facts: (string | null)[]) {
  const shown = facts.filter((f): f is string => !!f);
  if (!shown.length) return undefined;
  return (
    <span className="inline-flex flex-wrap gap-x-3">
      {shown.map((f, i) => (
        <span key={i}>{f}</span>
      ))}
    </span>
  );
}

export type TeamMember = { id: string; display_name: string; email: string | null; access_level: string };

export function TeamSections({
  members,
  membersTruncated,
  pending,
  actorId,
  isAdmin,
  titles,
  rendered,
}: {
  members: TeamMember[];
  /** The read stopped at its cap, so the list may not hold every admin. */
  membersTruncated: boolean;
  pending: Awaited<ReturnType<typeof listPendingInvites>>;
  actorId: string;
  isAdmin: boolean;
  /** The titles the member may read, by member. */
  titles: Record<string, string>;
  /** When this request rendered: keys the pickers, so each comes back from an action showing the saved level. */
  rendered: number;
}) {
  const onlyAdmin = soleAdmin(members, membersTruncated);
  return (
    <>
      {/* How many is read out, not drawn beside the title: the rows show as much. */}
      <Section title={<>Members<span className="sr-only">, {members.length}</span></>} flush>
        {membersTruncated ? <p className="m-0 px-3.5 pt-2 text-xs text-muted-foreground">Showing the first {members.length.toLocaleString("en-US")}; there are more.</p> : null}
        <Rows ruled>
          {members.map((m) => {
            const editsTitle = isAdmin || m.id === actorId;
            const title = titles[m.id] ?? null;
            return (
              <Row
                key={m.id}
                title={
                  <>
                    {m.display_name}
                    {m.id === actorId ? <Pill className="ml-2 align-[1px]">You</Pill> : null}
                  </>
                }
                sub={factLine(editsTitle ? [m.email] : [title, m.email])}
                meta={
                  <>
                    {editsTitle ? <TitleForm key={`${m.id}:${title ?? ""}`} actorId={m.id} name={m.display_name} title={title} /> : null}
                    {isAdmin && m.id !== onlyAdmin ? (
                      <AccessForm key={`${m.id}:${rendered}`} actorId={m.id} name={m.display_name} level={m.access_level} isSelf={m.id === actorId} />
                    ) : (
                      <span className="inline-flex items-center gap-2 text-faint" title={isAdmin ? "Your company needs an admin. Make someone else an admin to change this." : undefined}>
                        {levelName(m.access_level)}
                        {isAdmin ? <Pill>Only admin</Pill> : null}
                      </span>
                    )}
                  </>
                }
              />
            );
          })}
        </Rows>
      </Section>

      {isAdmin ? (
        <>
          <Section title={<>Invited, not signed in yet<span className="sr-only">, {pending.length}</span></>} flush={pending.length > 0}>
            {pending.length === 0 ? (
              <Empty>Nobody is waiting on an invitation.</Empty>
            ) : (
              <Rows ruled>
                {pending.map((p) => (
                  <Row
                    key={p.actorId}
                    title={p.displayName}
                    sub={factLine([p.email, levelName(p.accessLevel)])}
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
              <SubmitButton pendingLabel="Sending…" title={EMAIL_HINT} aria-describedby="invite-email-hint" className="justify-self-start">
                Send invitation
              </SubmitButton>
              <p id="invite-email-hint" className="sr-only">
                {EMAIL_HINT}
              </p>
            </form>
          </Section>
        </>
      ) : null}
    </>
  );
}
