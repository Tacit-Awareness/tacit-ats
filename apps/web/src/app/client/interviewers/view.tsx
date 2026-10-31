import Link from "next/link";
import * as React from "react";
import { Avatar, Count, Empty, KeyValues, Page, PageBar, Section, textLink } from "@/components/page";
import { hoverAttr } from "@/lib/hover-card";
import { CHANNEL_LABELS, PREFERENCE_LABELS, loadMeter, type StoredProfile } from "@/lib/client/interviewer-profile";
import { cn } from "@/lib/utils";
import { TitleForm } from "../onboarding/people/title-form";
import { ProfileEditor } from "./profile-editor";

// The Interviewers page's markup, props only (page.tsx does the reads):
// design/tats's interviewer table (`.cardbox` around `.ptable`), one card in
// the page's column, with a ruled subhead per department when there are any. A
// row is the person (and their jobs, faint under the name), whether they like
// interviewing, their interviews this week as a bar against their own limit or
// else the busiest on the team, whether they are away, next week and the last
// 30 days, what they know, where to reach them, and feedback on time / late /
// not filed (only for a member who may read it). Anything they have not said,
// or the member may not read, is an empty cell. Counts only: never what anyone
// wrote as feedback. Colour only for meaning: a positive "likes it", and
// feedback not filed and a week over the limit in red.

export type InterviewerViewRow = {
  actorId: string;
  name: string;
  thisWeek: number;
  nextWeek: number;
  last30: number;
  /** Null: nothing ended in the last 30 days that they owe feedback on. */
  feedback: { onTime: number; late: number; notFiled: number; notVisible: number } | null;
  jobs: string[];
  profile: StoredProfile | null;
  /** "Away through Nov 14", computed by the page. Null when they are not away. */
  away: string | null;
  /** Their own row, or the member is an admin. Presentation: the policies decide the write. */
  editable: boolean;
  self: boolean;
};

/** `label` null: no departments, one list without subheads. */
export type InterviewerViewGroup = { label: string | null; rows: InterviewerViewRow[] };

const gridOf = (feedback: boolean) =>
  cn(
    "grid items-center gap-3 px-3.5",
    feedback
      ? "grid-cols-[minmax(170px,1.3fr)_84px_146px_62px_72px_minmax(110px,1fr)_60px_minmax(170px,1fr)_44px]"
      : "grid-cols-[minmax(170px,1.3fr)_84px_146px_62px_72px_minmax(110px,1fr)_60px_44px]",
  );

/** design/tats's `.lbar` and its number: the bar is loadMeter's. */
function LoadBar({ n, cap, max, away }: { n: number; cap: number | null; max: number; away: string | null }) {
  const m = loadMeter(n, cap, max);
  return (
    <span className="grid gap-[3px]">
      <span className="flex items-center gap-2" title={m.title}>
        <span aria-hidden className="inline-flex gap-0.5">
          {Array.from({ length: m.pips }, (_, i) => (
            <i key={i} className={cn("h-3 w-[7px]", i < m.lit ? "bg-foreground opacity-70" : "bg-[color:var(--soft-strong)]")} />
          ))}
        </span>
        <span className={cn("whitespace-nowrap tabular-nums", m.over ? "text-negative" : n === 0 && "text-faint")}>{m.label}</span>
      </span>
      {away ? <small className="text-xs text-faint">{away}</small> : null}
    </span>
  );
}

/** design/tats's `.likes`: a positive pill for "Likes it", a quiet one otherwise. */
function Likes({ preference }: { preference: StoredProfile["preference"] }) {
  if (!preference) return null;
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center rounded-full px-2 text-xs whitespace-nowrap",
        preference === "loves" ? "bg-positive-soft text-positive" : "bg-[color:var(--soft)]",
        preference === "either" && "text-muted-foreground",
        preference === "avoids" && "text-faint",
      )}
    >
      {PREFERENCE_LABELS[preference]}
    </span>
  );
}

function Num({ n }: { n: number }) {
  return <span className={cn("tabular-nums", n === 0 && "text-faint")}>{n}</span>;
}

function FeedbackCell({ f }: { f: InterviewerViewRow["feedback"] }) {
  if (!f) return <span className="text-faint">None due</span>;
  const parts: React.ReactNode[] = [
    <span key="on">{f.onTime} on time</span>,
    <span key="late" className={cn(f.late === 0 && "text-faint")}>
      {f.late} late
    </span>,
    <span key="not" className={cn(f.notFiled > 0 ? "text-negative" : "text-faint")}>{f.notFiled} not filed</span>,
  ];
  if (f.notVisible > 0) {
    parts.push(
      <span key="hidden" className="text-faint" title="Whether they filed is hidden from you by your company's feedback setting">
        {f.notVisible} hidden
      </span>,
    );
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12.5px] tabular-nums">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 ? <span className="text-faint">·</span> : null}
          {p}
        </span>
      ))}
    </span>
  );
}

function Rows({ rows, feedback, max }: { rows: InterviewerViewRow[]; feedback: boolean; max: number }) {
  const grid = gridOf(feedback);
  return rows.map((r) => (
    <div role="row" key={r.actorId} className={cn(grid, "min-h-14 border-b border-[color:var(--line)] text-[13px] last:border-b-0")}>
      <span role="cell" className="flex min-w-0 items-center gap-2.5 py-2">
        <span data-hc={hoverAttr("member", r.actorId)}>
          <Avatar name={r.name} size="lg" />
        </span>
        <span className="grid min-w-0">
          <b data-hc={hoverAttr("member", r.actorId)} className="truncate font-medium">
            {r.name}
          </b>
          <span className="truncate text-xs text-faint" title={r.jobs.length > 1 ? r.jobs.join(", ") : undefined}>
            {r.jobs.length ? `${r.jobs[0]}${r.jobs.length > 1 ? ` +${r.jobs.length - 1}` : ""}` : "No jobs"}
          </span>
        </span>
      </span>
      <span role="cell">
        <Likes preference={r.profile?.preference ?? null} />
      </span>
      <span role="cell">
        <LoadBar n={r.thisWeek} cap={r.profile?.weeklyCap ?? null} max={max} away={r.away} />
      </span>
      <span role="cell">
        <Num n={r.nextWeek} />
      </span>
      <span role="cell">
        <Num n={r.last30} />
      </span>
      <span role="cell" className="min-w-0 truncate text-muted-foreground" title={r.profile?.focusAreas.join(", ") || undefined}>
        {r.profile?.focusAreas.join(", ")}
      </span>
      <span role="cell" className="text-muted-foreground">
        {r.profile?.channel ? CHANNEL_LABELS[r.profile.channel] : null}
      </span>
      {feedback ? (
        <span role="cell" className="min-w-0">
          <FeedbackCell f={r.feedback} />
        </span>
      ) : null}
      <span role="cell" className="justify-self-end">
        {r.editable ? <ProfileEditor actorId={r.actorId} name={r.name} self={r.self} profile={r.profile} /> : null}
      </span>
    </div>
  ));
}

/** The team and its invitations moved to Onboarding; every capability is still a click from here. */
export function OnboardingLink({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Section title="Members and invitations">
      <p className="m-0 text-[13px] text-muted-foreground">
        {isAdmin ? "Invite people, re-send or withdraw an invitation, and change someone's access in " : "Everyone on your team, with their access and title, is in "}
        <Link href="/client/onboarding/people" className={textLink}>
          Onboarding
        </Link>
        .
      </p>
    </Section>
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
  const said = (text: string | null | undefined) => text || <span className="text-faint">Not said</span>;
  return (
    <Section title="Your interviewer profile" aside={<ProfileEditor actorId={actorId} name={name} self profile={profile} />}>
      <KeyValues
        items={[
          ...(title === undefined ? [] : ([["Title", <TitleForm key={title ?? ""} actorId={actorId} name={name} title={title} />]] as [React.ReactNode, React.ReactNode][])),
          ["Interviewing", said(profile?.preference ? PREFERENCE_LABELS[profile.preference] : null)],
          ["Most a week", profile?.weeklyCap == null ? <span className="text-faint">No limit</span> : profile.weeklyCap],
          ["Knows", said(profile?.focusAreas.join(", "))],
          ["Reach", said(profile?.channel ? CHANNEL_LABELS[profile.channel] : null)],
          ["Away", away ?? <span className="text-faint">Not away</span>],
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
  children,
}: {
  groups: InterviewerViewGroup[];
  /** Whether the feedback column is shown. */
  feedback: boolean;
  /** A line under the table, such as the read stopping short. */
  note: string | null;
  empty: string | null;
  /** Their own profile, and the way to the team, under the table. */
  children?: React.ReactNode;
}) {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const max = Math.max(0, ...groups.flatMap((g) => g.rows.map((r) => r.thisWeek)));
  const grid = gridOf(feedback);
  return (
    <Page bar={<PageBar title="Interviewers" count={empty ? undefined : total} />}>
      <section aria-label="Interviewers" className="grid min-w-0 overflow-hidden border border-[color:var(--line)] bg-[color:var(--paper)]">
        <h2 className="m-0 flex min-h-10 items-center gap-2 border-b border-[color:var(--line-strong)] bg-[color:var(--surface)] px-3.5 text-[13.5px] font-medium">
          Interviewers
          {empty ? null : <Count>{total}</Count>}
        </h2>
        {empty ? (
          <Empty className="px-3.5 py-3">{empty}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <div role="table" aria-label="Interviewers" className={cn("grid", feedback ? "min-w-[1042px]" : "min-w-[860px]")}>
              <div role="row" className={cn(grid, "h-[34px] border-b border-[color:var(--line-strong)] bg-[color:var(--surface)] text-xs whitespace-nowrap text-faint")}>
                <span role="columnheader">Interviewer</span>
                <span role="columnheader" title="Whether they like interviewing, as they said">
                  Interviews
                </span>
                <span role="columnheader" title="Interviews starting this week, Monday to Sunday (UTC), against their weekly limit or else the busiest on the team">
                  This week
                </span>
                <span role="columnheader" title="Interviews starting next week, Monday to Sunday (UTC)">
                  Next week
                </span>
                <span role="columnheader" title="Interviews that started in the last 30 days">
                  Last 30 days
                </span>
                <span role="columnheader" title="What they can interview on, as they wrote it">
                  Knows
                </span>
                <span role="columnheader" title="Where they want to be reached about interviews">
                  Reach
                </span>
                {feedback ? (
                  <span role="columnheader" title="Interviews that ended in the last 30 days on jobs you manage: feedback within 24 hours is on time">
                    Feedback, 30 days
                  </span>
                ) : null}
                <span role="columnheader" className="sr-only">
                  Edit
                </span>
              </div>
              {groups.map((g) =>
                g.label === null ? (
                  <Rows key="all" rows={g.rows} feedback={feedback} max={max} />
                ) : (
                  <div role="rowgroup" key={g.label} aria-label={g.label} className="grid border-b border-[color:var(--line)] last:border-b-0">
                    <div role="row" className="flex h-9 items-center gap-2 border-b border-[color:var(--line)] bg-[color:var(--soft)] px-3.5 text-[12.5px] font-medium text-muted-foreground">
                      <span role="rowheader">{g.label}</span>
                      <Count>{g.rows.length}</Count>
                    </div>
                    <Rows rows={g.rows} feedback={feedback} max={max} />
                  </div>
                ),
              )}
            </div>
          </div>
        )}
      </section>
      {note ? <p className="m-0 text-xs text-faint">{note}</p> : null}
      {children}
    </Page>
  );
}
