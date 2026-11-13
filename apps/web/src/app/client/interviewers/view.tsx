import Link from "next/link";
import * as React from "react";
import { Empty, KeyValues, Page, PageBar, Pill, Section } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { hoverAttr } from "@/lib/hover-card";
import { CHANNEL_LABELS, PREFERENCE_LABELS, type StoredProfile } from "@/lib/client/interviewer-profile";
import { cn } from "@/lib/utils";
import { TitleForm } from "../onboarding/people/title-form";
import { FirstAndMore, SkillTags, Week, bookedTitle, feedbackDue, feedbackTitle, onTimeText, type Feedback, type PersonFacts } from "./facts";
import { OpenRow, PersonButton, ProfileEditor } from "./profile-editor";

// The Interviewers page's markup, props only (page.tsx does the reads): one
// Testbench card in the page's column, a grey band per department when there
// are any, a row per interviewer read left to right in the order a recruiter
// asks. Who they are (and a grey Away tag while they are away), the jobs they
// interview for (the first, then "and 2 more"), their skills when anyone has
// said theirs, how booked they are this week and next (against their weekly
// limit when they set one, "2 of 4" beside a short meter, grey while they are
// away; "1 interview" when not), and how much of their feedback in the last
// 30 days came in on time ("1 of 3 on time"). The only red on the page is what
// needs a recruiter: a week over the limit, and feedback not filed. Rows are
// alphabetical within a department (interviewer-load.ts), so a person stays
// where they were found while their week fills up. Everything else (every job
// and skill, the last 30 days, feedback filed late, whether they like
// interviewing, where to reach them) is in the cell's hover title or in the
// pop-up a click on the row opens, which is where the profile is edited too.
// Counts only: never what anyone wrote as feedback.

export type InterviewerViewRow = {
  actorId: string;
  name: string;
  thisWeek: number;
  nextWeek: number;
  last30: number;
  /** Null: nothing ended in the last 30 days that they owe feedback on. */
  feedback: Feedback | null;
  jobs: string[];
  profile: StoredProfile | null;
  /** "Away through Nov 14", computed by the page. Null when they are not away. */
  away: string | null;
  /** Their own row, or the member is an admin. Presentation: the policies decide the write. */
  editable: boolean;
  self: boolean;
};

/** `label` null: no departments, one list without bands. */
export type InterviewerViewGroup = { label: string | null; rows: InterviewerViewRow[] };

type Columns = { skills: boolean; feedback: boolean };

// One template for the head and every row, so each head sits over its column.
// Sized so the 1280px window's card holds every column with no sideways
// scroll: the name's column holds an "Away through Nov 18" tag, a job title
// wraps between words with its "and 1 more" kept whole, a skill such as
// "Infrastructure" fits whole, "Booked this week" has room before "Next week"
// and its count room for "12 of 20" beside the meter, next week's for "12
// interviews", "1 of 3 on time" fits on a line with "2 not filed" under it,
// and Edit fits its button. The wider window's room goes to the jobs and
// skills, so a job title stays on one line at 1440px and stands apart from the
// skill beside it. MIN_W is the template's narrowest, the table's floor, so a
// narrower window scrolls the table sideways, never squeezes it.
const GRID: Record<`${boolean}${boolean}`, string> = {
  truetrue: "grid-cols-[156px_minmax(148px,2fr)_minmax(116px,1fr)_124px_100px_128px_52px]",
  truefalse: "grid-cols-[156px_minmax(148px,2fr)_minmax(116px,1fr)_124px_100px_52px]",
  falsetrue: "grid-cols-[156px_minmax(148px,1fr)_124px_100px_128px_52px]",
  falsefalse: "grid-cols-[156px_minmax(148px,1fr)_124px_100px_52px]",
};
const MIN_W: Record<`${boolean}${boolean}`, string> = {
  truetrue: "min-w-[916px]",
  truefalse: "min-w-[778px]",
  falsetrue: "min-w-[790px]",
  falsefalse: "min-w-[652px]",
};
const gridOf = (c: Columns) => cn("grid items-center gap-x-2.5 px-4", GRID[`${c.skills}${c.feedback}`]);

/** How much of their feedback came in on time, "1 of 3 on time", then what is not filed in red, then what the member may not see. */
function FeedbackCell({ f }: { f: Feedback | null }) {
  if (!f) return <span className="text-faint">None due</span>;
  const due = feedbackDue(f);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 whitespace-nowrap tabular-nums" title={feedbackTitle(f)}>
      {due > 0 ? <span>{onTimeText(f)}</span> : null}
      {f.notFiled > 0 ? <span className="text-negative">{f.notFiled} not filed</span> : null}
      {f.notVisible > 0 ? <span className="text-faint">{f.notVisible} hidden</span> : null}
    </span>
  );
}

function Rows({ rows, columns }: { rows: InterviewerViewRow[]; columns: Columns }) {
  const grid = gridOf(columns);
  return rows.map((r) => {
    const cap = r.profile?.weeklyCap ?? null;
    // With no profile to read, the hover says nothing about a limit.
    const capSaid = r.profile ? cap : undefined;
    const facts: PersonFacts = {
      jobs: r.jobs,
      thisWeek: r.thisWeek,
      nextWeek: r.nextWeek,
      last30: r.last30,
      feedback: r.feedback,
      feedbackShown: columns.feedback,
      away: r.away,
    };
    return (
      <OpenRow
        key={r.actorId}
        className={cn(
          grid,
          "group/row min-h-12 cursor-pointer border-b border-[color:var(--line)] py-2.5 text-[13px] transition-colors duration-150 last:border-b-0 hover:bg-[color:var(--surface)]",
          // On the keyboard (the name's button, then Edit) the row lights as it would under the pointer.
          "has-[:focus-visible]:bg-[color:var(--surface)]",
        )}
      >
        <span role="cell" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <PersonButton
            actorId={r.actorId}
            name={r.name}
            self={r.self}
            profile={r.profile}
            facts={facts}
            editable={r.editable}
            hover={hoverAttr("member", r.actorId)}
          />
          {r.away ? <Pill>{r.away}</Pill> : null}
        </span>
        <span role="cell" className="min-w-0">
          {r.jobs.length ? <FirstAndMore items={r.jobs} /> : <span className="text-faint">No jobs</span>}
        </span>
        {columns.skills ? (
          <span role="cell" className="min-w-0 text-muted-foreground">
            <FirstAndMore items={r.profile?.focusAreas ?? []} />
          </span>
        ) : null}
        <span role="cell">
          <Week n={r.thisWeek} cap={cap} away={r.away !== null} title={bookedTitle(r.thisWeek, capSaid, "this week", r.away)} />
        </span>
        <span role="cell">
          <Week n={r.nextWeek} cap={cap} meter={false} title={bookedTitle(r.nextWeek, capSaid, "next week")} />
        </span>
        {columns.feedback ? (
          <span role="cell" className="min-w-0">
            <FeedbackCell f={r.feedback} />
          </span>
        ) : null}
        <span role="cell" className="justify-self-end">
          {/* Edit shows on the row under the pointer or the keyboard, so ten of them don't stand down the page; the pop-up has it too. */}
          {r.editable ? (
            <ProfileEditor
              actorId={r.actorId}
              name={r.name}
              self={r.self}
              profile={r.profile}
              className="opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100"
            />
          ) : null}
        </span>
      </OpenRow>
    );
  });
}

/**
 * Where the team and its invitations are, Onboarding's People step (the
 * sidebar's Team): the page's action, beside its title. For an admin it is how
 * someone is added; for the rest of the hiring team, where everyone is listed.
 */
export function OnboardingLink({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Link
      href="/client/onboarding/people"
      className={buttonVariants({ variant: "outline" })}
      title={isAdmin ? "Invite people, re-send or withdraw an invitation, and change someone's access in Onboarding" : "Everyone on your team, with their access and title, is in Onboarding"}
    >
      {isAdmin ? (
        <>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
            <path d="M8 3v10M3 8h10" />
          </svg>
          Invite people
        </>
      ) : (
        "See the team"
      )}
    </Link>
  );
}

/**
 * Where a member with no row on the table reads and edits their own, an interviewer always.
 * `title` undefined leaves it out: Onboarding's People step has it for them.
 */
export function OwnProfile({
  actorId,
  name,
  profile,
  away,
  title,
}: {
  actorId: string;
  name: string;
  profile: StoredProfile | null;
  away: string | null;
  title?: string | null;
}) {
  const notSaid = <span className="text-faint">Not said</span>;
  return (
    <Section title="Your interviewer profile" aside={<ProfileEditor actorId={actorId} name={name} self profile={profile} className="-my-1" />}>
      <KeyValues
        className="grid-cols-[136px_minmax(0,1fr)]"
        items={[
          ...(title === undefined ? [] : ([["Title", <TitleForm key={title ?? ""} actorId={actorId} name={name} title={title} />]] as [React.ReactNode, React.ReactNode][])),
          ["Skills", profile?.focusAreas.length ? <SkillTags areas={profile.focusAreas} /> : notSaid],
          ["Interviewing", profile?.preference ? PREFERENCE_LABELS[profile.preference] : notSaid],
          ["Reach on", profile?.channel ? CHANNEL_LABELS[profile.channel] : notSaid],
          ["Weekly limit", profile?.weeklyCap == null ? <span className="text-faint">No limit</span> : `${profile.weeklyCap} ${profile.weeklyCap === 1 ? "interview" : "interviews"}`],
          ["Availability", away ?? <span className="text-faint">Not away</span>],
        ]}
      />
    </Section>
  );
}

export function InterviewersView({
  groups,
  feedback,
  note,
  empty,
  actions,
  children,
}: {
  groups: InterviewerViewGroup[];
  /** Whether the feedback column is shown. */
  feedback: boolean;
  /** A line under the table, such as the read stopping short. */
  note: string | null;
  empty: string | null;
  /** Beside the title: the way to the team (OnboardingLink). */
  actions?: React.ReactNode;
  /** Their own profile, or the team for a member Onboarding turns away, under the table. */
  children?: React.ReactNode;
}) {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  // Skills get a column once anyone on the table has said theirs; until then it would be empty all the way down.
  const columns: Columns = { skills: groups.some((g) => g.rows.some((r) => r.profile?.focusAreas.length)), feedback };
  const grid = gridOf(columns);
  return (
    <Page
      bar={
        <PageBar title="Interviewers" count={empty ? undefined : `${total} ${total === 1 ? "interviewer" : "interviewers"}`}>
          {actions}
        </PageBar>
      }
    >
      {/* The page's title already names it, so the card's own heading is for a screen reader. */}
      <section aria-label="Interviewers" className="grid min-w-0 overflow-hidden rounded-[14px] bg-card shadow-[var(--shadow)]">
        <h2 className="sr-only">
          Interviewers, {total} {total === 1 ? "person" : "people"}
        </h2>
        {empty ? (
          <Empty className="px-5 py-4">{empty}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <div role="table" aria-label="Interviewers" className={cn("grid", MIN_W[`${columns.skills}${columns.feedback}`])}>
              <div role="row" className={cn(grid, "h-10 border-b border-[color:var(--line)] text-[12px] whitespace-nowrap text-faint")}>
                <span role="columnheader" title="Click someone for everything about them">
                  Interviewer
                </span>
                <span role="columnheader" title="Live jobs whose hiring team they're on, and jobs they've interviewed for">
                  Interviews for
                </span>
                {columns.skills ? (
                  <span role="columnheader" title="What they can interview on, as they or an admin wrote it">
                    Skills
                  </span>
                ) : null}
                <span role="columnheader" title="Interviews starting this week, Monday to Sunday (UTC), against their weekly limit when they set one">
                  Booked this week
                </span>
                <span role="columnheader" title="Interviews starting next week, Monday to Sunday (UTC)">
                  Next week
                </span>
                {columns.feedback ? (
                  <span role="columnheader" title="Interviews that ended in the last 30 days on jobs you manage: feedback within 24 hours of the end is on time">
                    Feedback
                  </span>
                ) : null}
                <span role="columnheader" className="sr-only">
                  Edit
                </span>
              </div>
              {groups.map((g) =>
                g.label === null ? (
                  <Rows key="all" rows={g.rows} columns={columns} />
                ) : (
                  <div role="rowgroup" key={g.label} aria-label={g.label} className="grid border-b border-[color:var(--line)] last:border-b-0">
                    {/* The band names the department; how many are in it is its hover, since the rows under it show as much. */}
                    <div
                      role="row"
                      title={`${g.rows.length} ${g.rows.length === 1 ? "interviewer" : "interviewers"}`}
                      className="flex h-10 items-center border-b border-[color:var(--line)] bg-[color:var(--band)] px-4 text-[13px] font-medium"
                    >
                      <span role="rowheader">
                        {g.label}
                        <span className="sr-only">, {g.rows.length}</span>
                      </span>
                    </div>
                    <Rows rows={g.rows} columns={columns} />
                  </div>
                ),
              )}
            </div>
          </div>
        )}
      </section>
      {note ? <p className="m-0 text-[12px] text-faint">{note}</p> : null}
      {children}
    </Page>
  );
}
