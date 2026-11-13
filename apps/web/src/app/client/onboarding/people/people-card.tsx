import type { listPendingInvites } from "@tacit-ats/core";
import { Pill } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { Input, selectClass } from "@/components/ui/input";
import { levelName } from "@/lib/client/levels";
import { soleAdmin } from "@/lib/client/member-access";
import { AccessForm } from "../../interviewers/access-form";
import type { TeamMember } from "../../interviewers/team";
import { inviteAction, withdrawAction } from "../actions";
import { StepCard } from "../step-card";
import { TitleForm } from "./title-form";

// Onboarding's People step as design/tats-ui-update's `#setup~people`: one card,
// "Add your interviewers", a row per person (`.su-row`: their name over their
// title and email, then what an admin can change), the invited in the same list
// with an amber "Invite sent" tag and Re-send / Withdraw, and the add row under
// them (`.su-add`), which sends the invitation. Who sees what at each access
// level is the access picker's hover title, not a caption under it. Props only
// (page.tsx does the reads). The prototype's Grokbot toggles and Import from
// Slack are left out: nothing backs them. Hiding the forms from others, and the
// picker from the only admin, is presentation, not the control: the definer
// functions check the caller and the last admin again, and the policies decide
// a title.

type Pending = Awaited<ReturnType<typeof listPendingInvites>>;

const ROW = "grid min-w-0 items-center gap-x-4 gap-y-2 border-t border-[color:var(--line)] py-3 first:border-t-0 md:min-h-16 md:grid-cols-[minmax(0,1fr)_auto]";
const CLOCK = "M8 4.5V8l2.3 1.5M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z";
const ACCESS_HINT = "An interviewer sees only the people they interview, the hiring team the jobs they are added to, and an admin every job (not confidential ones) and the team.";
const EMAIL_HINT = "They get an email to choose a password and sign in with this address.";

/** The name over its facts (title, email, access), each its own span, spaced rather than dotted. */
function Who({ name, facts, you = false }: { name: string; facts: (string | null)[]; you?: boolean }) {
  const shown = facts.filter((f): f is string => !!f);
  return (
    <span className="grid min-w-0 gap-0.5">
      <b className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] font-medium [overflow-wrap:anywhere]">
        {name}
        {you ? <Pill>You</Pill> : null}
      </b>
      {shown.length ? (
        <span className="flex min-w-0 flex-wrap gap-x-3 text-[12px] text-faint [overflow-wrap:anywhere]">
          {shown.map((f, i) => (
            <span key={i}>{f}</span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function Controls({ children }: { children: React.ReactNode }) {
  return <span className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">{children}</span>;
}

function AddRow() {
  return (
    <form action={inviteAction} aria-describedby="invite-hint" className="grid min-w-0 gap-2 border-t border-[color:var(--line)] pt-5">
      <div className="grid min-w-0 gap-2 md:grid-cols-[1.2fr_1.2fr_1fr_auto]">
        <Input name="displayName" required maxLength={120} autoComplete="off" placeholder="Full name" aria-label="Full name" />
        <Input name="email" type="email" required maxLength={254} autoComplete="off" placeholder="Work email" aria-label="Work email" title={EMAIL_HINT} />
        <select name="accessLevel" defaultValue="limited" aria-label="Access" title={ACCESS_HINT} className={selectClass}>
          <option value="limited">Interviewer</option>
          <option value="elevated">Hiring team</option>
          <option value="admin">Admin</option>
        </select>
        <SubmitButton pendingLabel="Sending…" title={EMAIL_HINT} className="justify-self-start">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
            <path d="M8 3v10M3 8h10" />
          </svg>
          Add person
        </SubmitButton>
      </div>
      <p id="invite-hint" className="sr-only">
        {ACCESS_HINT} {EMAIL_HINT}
      </p>
    </form>
  );
}

export function PeopleCard({
  members,
  membersTruncated,
  pending,
  actorId,
  isAdmin,
  titles,
  rendered,
  notice,
}: {
  members: TeamMember[];
  /** The read stopped at its cap, so the list may not hold every admin. */
  membersTruncated: boolean;
  pending: Pending;
  actorId: string;
  isAdmin: boolean;
  /** The titles the member may read, by member. */
  titles: Record<string, string>;
  /** When this request rendered: keys the pickers, so each comes back from an action showing the saved level. */
  rendered: number;
  /** A line above the list, such as "It's just you so far". */
  notice?: React.ReactNode;
}) {
  const onlyAdmin = soleAdmin(members, membersTruncated);
  return (
    <StepCard
      title={isAdmin ? "Add your interviewers" : "Your hiring team"}
      sub={
        isAdmin
          ? "Invite everyone who interviews, and anyone else who works on hiring. Give each a title and the access they need."
          : "Everyone at your company who works on hiring, with their title and access."
      }
    >
      {notice}
      <div className="grid min-w-0">
        {members.map((m) => {
          const editsTitle = isAdmin || m.id === actorId;
          const title = titles[m.id] ?? null;
          return (
            <div key={m.id} className={ROW}>
              <Who name={m.display_name} you={m.id === actorId} facts={editsTitle ? [m.email] : [title, m.email]} />
              <Controls>
                {editsTitle ? <TitleForm key={`${m.id}:${title ?? ""}`} actorId={m.id} name={m.display_name} title={title} /> : null}
                {isAdmin && m.id !== onlyAdmin ? (
                  <AccessForm key={`${m.id}:${rendered}`} actorId={m.id} name={m.display_name} level={m.access_level} isSelf={m.id === actorId} />
                ) : (
                  <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground" title={isAdmin ? "Your company needs an admin. Make someone else an admin to change this." : undefined}>
                    {levelName(m.access_level)}
                    {isAdmin ? <Pill>Only admin</Pill> : null}
                  </span>
                )}
              </Controls>
            </div>
          );
        })}
        {isAdmin
          ? pending.map((p) => (
              <div key={p.actorId} className={ROW}>
                <Who name={p.displayName} facts={[p.email, levelName(p.accessLevel)]} />
                <Controls>
                  <Pill tone="amber">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-[13px]" aria-hidden>
                      <path d={CLOCK} />
                    </svg>
                    Invite sent
                  </Pill>
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
                </Controls>
              </div>
            ))
          : null}
      </div>
      {membersTruncated ? <p className="m-0 text-xs text-faint">Showing the first {members.length.toLocaleString("en-US")}; there are more.</p> : null}
      {isAdmin ? <AddRow /> : null}
    </StepCard>
  );
}
