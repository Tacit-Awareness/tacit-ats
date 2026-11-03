import type { listPendingInvites } from "@tacit-ats/core";
import { Avatar, Pill } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { selectClass } from "@/components/ui/input";
import { levelName } from "@/lib/client/levels";
import { soleAdmin } from "@/lib/client/member-access";
import { cn } from "@/lib/utils";
import { AccessForm } from "../../interviewers/access-form";
import type { TeamMember } from "../../interviewers/team";
import { inviteAction, withdrawAction } from "../actions";
import { StepCard } from "../step-card";
import { TitleForm } from "./title-form";

// Onboarding's People step as design/tats-ui-update's `#setup~people`: one card,
// "Add your interviewers", a row per person (`.su-row`: the avatar, their name
// over their title and email, then what an admin can change), the invited in the
// same list with the prototype's "Invite sent" in amber and Re-send / Withdraw,
// and the add row under them (`.su-add`), which sends the invitation. Props only
// (page.tsx does the reads). The prototype's Grokbot toggles and Import from
// Slack are left out: nothing backs them. Hiding the forms from others, and the
// picker from the only admin, is presentation, not the control: the definer
// functions check the caller and the last admin again, and the policies decide
// a title.

type Pending = Awaited<ReturnType<typeof listPendingInvites>>;

const ROW = "grid min-w-0 grid-cols-[36px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-[color:var(--line)] py-3 first:border-t-0 md:grid-cols-[36px_minmax(0,1fr)_auto]";
const CLOCK = "M8 4.5V8l2.3 1.5M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z";

function Who({ name, sub, you = false }: { name: string; sub: string | null; you?: boolean }) {
  return (
    <span className="grid min-w-0">
      <b className="text-[14.5px] font-medium [overflow-wrap:anywhere]">
        {name}
        {you ? <Pill className="ml-2 align-[1px]">you</Pill> : null}
      </b>
      {sub ? <span className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{sub}</span> : null}
    </span>
  );
}

function Controls({ children }: { children: React.ReactNode }) {
  return <span className="col-start-2 flex min-w-0 flex-wrap items-center gap-2 md:col-start-3 md:justify-end">{children}</span>;
}

function AddRow() {
  return (
    <form action={inviteAction} className="grid min-w-0 gap-2 border-t border-[color:var(--line)] pt-4">
      <div className="grid min-w-0 gap-2 md:grid-cols-[1.2fr_1.2fr_1fr_auto]">
        <input name="displayName" required maxLength={120} autoComplete="off" placeholder="Full name" aria-label="Full name" className={cn(selectClass, "h-9 rounded-[8px]")} />
        <input name="email" type="email" required maxLength={254} autoComplete="off" placeholder="Work email" aria-label="Work email" className={cn(selectClass, "h-9 rounded-[8px]")} />
        <select name="accessLevel" defaultValue="limited" aria-label="Access" className={cn(selectClass, "h-9 rounded-[8px]")}>
          <option value="limited">Interviewer</option>
          <option value="elevated">Hiring team</option>
          <option value="admin">Admin</option>
        </select>
        <SubmitButton size="sm" pendingLabel="Sending…" className="h-9 justify-self-start">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" className="size-3" aria-hidden>
            <path d="M8 3v10M3 8h10" />
          </svg>
          Add person
        </SubmitButton>
      </div>
      <p className="m-0 text-xs text-faint">
        An interviewer sees only the people they interview, the hiring team the jobs they are added to, and an admin every job (not confidential ones) and the team. They get an email from WorkOS and sign in with this address.
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
              <Avatar name={m.display_name} size="ticket" />
              <Who name={m.display_name} you={m.id === actorId} sub={(editsTitle ? [m.email] : [title, m.email]).filter(Boolean).join(" · ") || null} />
              <Controls>
                {editsTitle ? <TitleForm key={`${m.id}:${title ?? ""}`} actorId={m.id} name={m.display_name} title={title} /> : null}
                {isAdmin && m.id !== onlyAdmin ? (
                  <AccessForm key={`${m.id}:${rendered}`} actorId={m.id} name={m.display_name} level={m.access_level} isSelf={m.id === actorId} />
                ) : (
                  <span className="text-[13px] text-muted-foreground" title={isAdmin ? "Your company needs an admin. Make someone else an admin to change this." : undefined}>
                    {levelName(m.access_level)}
                    {isAdmin ? " · only admin" : ""}
                  </span>
                )}
              </Controls>
            </div>
          );
        })}
        {isAdmin
          ? pending.map((p) => (
              <div key={p.actorId} className={ROW}>
                <Avatar name={p.displayName} size="ticket" />
                <Who name={p.displayName} sub={`${p.email} · ${levelName(p.accessLevel)}`} />
                <Controls>
                  <span className="inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap text-[color:var(--amber)]">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-[13px]" aria-hidden>
                      <path d={CLOCK} />
                    </svg>
                    Invite sent
                  </span>
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
      {membersTruncated ? <p className="m-0 text-xs text-muted-foreground">Showing the first {members.length.toLocaleString("en-US")}; there are more.</p> : null}
      {isAdmin ? <AddRow /> : null}
    </StepCard>
  );
}
