import type { clientTools } from "@tacit-ats/core";
import { Empty, StatusGlyph } from "@/components/page";
import { activityLine } from "@/lib/client/candidate-activity";
import { ago, until } from "@/lib/client/pipeline-columns";
import { LocalStamp } from "./local-day";

// design/tats's activity `.story`, core's getActivity worded by
// lib/client/candidate-activity.ts: the candidate page's feed and the Inbox
// reader's. A note or a subject in it is plain text, never markup. Calm, as
// Testbench's lists: each line a square (StatusGlyph) on a thread, the words in
// ink with who did it in 500, a note (or a source, a subject, who was invited)
// under it in muted grey, in the same Geist Mono, so an entry reads in one
// voice; when faint and right (the time for today's, in 12-hour form, else the
// day). No avatars; only the square takes colour, red for a close or a cancel,
// the accent for an interview still to come. The pop-ups' dashboard folds it
// after the latest few.

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const CLOSED = new Set(["rejected", "withdrawn"]);

type Mark = "done" | "fail" | "next" | "plain";

/** The story's status mark: a step taken, a close or a cancel, an interview still to come, or anything else (a note, a touch). */
function markOf(e: clientTools.ActivityEntry, now: number): Mark {
  if (e.kind === "interview.scheduled" && e.startsAt && Date.parse(e.startsAt) > now) return "next";
  if (e.kind === "interview.cancelled" || e.kind === "offer.declined" || e.kind === "offer.withdrawn" || e.kind === "approval.rejected") return "fail";
  if ((e.kind === "application.stage_changed" || e.kind === "application.added") && e.toStage && CLOSED.has(e.toStage)) return "fail";
  if (e.kind === "application.stage_changed" || e.kind === "application.added" || e.kind === "interview.done" || e.kind === "offer.accepted" || e.kind === "approval.approved")
    return "done";
  return "plain";
}

/**
 * Testbench's squares: a close or a cancel is the red alert, an interview to
 * come the live one, anything else the empty square. A step taken is the done
 * square in a quiet grey rather than its green, so a long story of ordinary
 * moves stays calm.
 */
function StoryMark({ mark }: { mark: Mark }) {
  const at = "absolute top-[11px] left-0";
  if (mark === "fail") return <StatusGlyph kind="alert" className={at} />;
  if (mark === "next") return <StatusGlyph kind="live" className={at} />;
  if (mark === "done") return <StatusGlyph kind="done" color="var(--ink-4)" className={at} />;
  return <StatusGlyph kind="empty" className={at} />;
}

/**
 * The thread's entries, one after another: a mark on a thread line, then who,
 * what and the day. `about`'s entries leave out "for <job>", as the card's head
 * names that job; a note that only repeats the entry's job (a posting's title
 * as its source) isn't said again under it.
 */
function Thread({ entries, now, about }: { entries: clientTools.ActivityEntry[]; now: number; about: string | null }) {
  return (
    <ol className="relative m-0 list-none p-0">
      {entries.map((e, i) => {
        const line = activityLine(about !== null && e.applicationId === about ? { ...e, jobTitle: null } : e);
        const body = line.body && line.body.trim() !== e.jobTitle?.trim() ? line.body : null;
        const mark = markOf(e, now);
        const upcoming = mark === "next" && e.startsAt ? `Interview ${until(e.startsAt, now)}` : null;
        const first = i === 0;
        const last = i === entries.length - 1;
        return (
          <li key={`${e.kind}-${e.refId ?? ""}-${e.at}-${i}`} className="relative pl-7">
            {/* The thread, in two pieces that stop short of the square, so it reads on any surface. */}
            {first ? null : <span aria-hidden className="absolute top-0 left-[6.5px] h-2 w-px bg-[color:var(--line-strong)]" />}
            {last ? null : <span aria-hidden className="absolute top-[28px] bottom-0 left-[6.5px] w-px bg-[color:var(--line-strong)]" />}
            <StoryMark mark={mark} />
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 py-2">
              <span className="grid min-w-0 gap-1">
                <span className="text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]">
                  {e.actor ? <b className="font-medium">{e.actor}</b> : null} {e.actor ? line.what : capital(line.what)}
                </span>
                {body ? <span className="text-[13px] leading-5 break-words whitespace-pre-wrap text-muted-foreground">{body}</span> : null}
                {upcoming ? <span className="text-[12.5px] text-[color:var(--accent)]">{upcoming}</span> : null}
              </span>
              <span className="pt-px text-[12px] leading-5 whitespace-nowrap text-faint tabular-nums" title={e.at.slice(0, 10)}>
                <LocalStamp iso={e.at} fallback={ago(e.at, now)} />
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const CHEVRON = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-[13px] shrink-0 transition-transform group-open:rotate-180" aria-hidden>
    <path d="M4 6l4 4 4-4" />
  </svg>
);

/**
 * design/tats's `.story`. With `fold`, only the latest that many show, the rest
 * under a "Show all" that opens in place (a native disclosure, so nothing here
 * changes anything): a long story reads calm until the whole of it is wanted.
 * Folding away only one or two is no calmer than showing them. `about` is the
 * application a card's head already names (the pop-ups' dashboard for someone
 * in one job): its entries don't name the job again.
 */
export function ActivityStory({ entries, now, fold, about = null }: { entries: clientTools.ActivityEntry[]; now: number; fold?: number; about?: string | null }) {
  if (entries.length === 0) return <Empty>Nothing yet.</Empty>;
  const shown = fold && entries.length > fold + 2 ? entries.slice(0, fold) : entries;
  const rest = entries.slice(shown.length);
  return (
    <>
      <Thread entries={shown} now={now} about={about} />
      {rest.length ? (
        <details className="group">
          <summary className="flex h-9 cursor-pointer list-none items-center gap-2 pl-7 text-[12.5px] text-muted-foreground transition-colors select-none hover:text-foreground focus-visible:rounded-[6px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)] [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show all {entries.length}</span>
            <span className="hidden group-open:inline">Show the latest {shown.length}</span>
            {CHEVRON}
          </summary>
          <Thread entries={rest} now={now} about={about} />
        </details>
      ) : null}
    </>
  );
}
