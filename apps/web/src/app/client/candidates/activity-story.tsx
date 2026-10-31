import type { clientTools } from "@tacit-ats/core";
import { Avatar, Empty } from "@/components/page";
import { activityLine } from "@/lib/client/candidate-activity";
import { ago, until } from "@/lib/client/pipeline-columns";
import { cn } from "@/lib/utils";
import { LocalDay } from "./local-day";

// design/tats's activity `.story`, core's getActivity worded by
// lib/client/candidate-activity.ts: the candidate page's feed and the Inbox
// reader's. A note or a subject in it is plain text, never markup.

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const CLOSED = new Set(["rejected", "withdrawn"]);

type Mark = "done" | "fail" | "next" | "plain";

/** The story's status mark: ticked for a move forward, "!" for a close or a cancel, dashed accent for an interview still to come. */
function markOf(e: clientTools.ActivityEntry, now: number): Mark {
  if (e.kind === "interview.scheduled" && e.startsAt && Date.parse(e.startsAt) > now) return "next";
  if (e.kind === "interview.cancelled" || e.kind === "offer.declined" || e.kind === "offer.withdrawn" || e.kind === "approval.rejected") return "fail";
  if ((e.kind === "application.stage_changed" || e.kind === "application.added") && e.toStage && CLOSED.has(e.toStage)) return "fail";
  if (e.kind === "application.stage_changed" || e.kind === "application.added" || e.kind === "interview.done" || e.kind === "offer.accepted" || e.kind === "approval.approved")
    return "done";
  return "plain";
}

function StoryMark({ mark }: { mark: Mark }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-[9px] left-0 z-[1] grid size-[18px] place-items-center rounded-full text-[10px] leading-none font-bold",
        mark === "done"
          ? "bg-[color:var(--soft)] text-muted-foreground"
          : mark === "fail"
            ? "bg-[color:var(--red)] text-white"
            : mark === "next"
              ? "border border-dashed border-[color:var(--accent)] bg-[color:var(--paper)] text-[color:var(--accent)]"
              : "bg-[color:var(--paper)] text-faint shadow-[inset_0_0_0_1px_var(--line-strong)]",
      )}
    >
      {mark === "done" ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-2.5">
          <path d="m3.5 8.5 3 3 6-7" />
        </svg>
      ) : mark === "fail" ? (
        "!"
      ) : mark === "next" ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-2.5">
          <path d="M3 4h10v9H3ZM3 7h10M6 2.5v3M10 2.5v3" />
        </svg>
      ) : null}
    </span>
  );
}

/** design/tats's `.story`: a mark on a thread line, then who, what and the day. */
export function ActivityStory({ entries, now }: { entries: clientTools.ActivityEntry[]; now: number }) {
  if (entries.length === 0) return <Empty>Nothing yet.</Empty>;
  return (
    <ol className="relative m-0 mt-1 list-none p-0">
      {entries.map((e, i) => {
        const line = activityLine(e);
        const mark = markOf(e, now);
        const upcoming = mark === "next" && e.startsAt ? `Interview ${until(e.startsAt, now)}` : null;
        const first = i === 0;
        const last = i === entries.length - 1;
        return (
          <li key={`${e.kind}-${e.refId ?? ""}-${e.at}-${i}`} className="relative pl-7">
            {entries.length > 1 ? (
              <span
                aria-hidden
                className={cn("absolute left-[8.5px] w-px bg-[color:var(--line-strong)]", first ? "top-[18px]" : "top-0", last ? "h-[18px]" : "bottom-0")}
              />
            ) : null}
            <StoryMark mark={mark} />
            <div className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-2.5 px-2 pt-2 pb-[9px]">
              <span className="pt-px">{e.actor ? <Avatar name={e.actor} size="xs" /> : null}</span>
              <span className="grid min-w-0 gap-0.5">
                <span className={cn("text-[13.5px]", mark === "fail" ? "text-negative" : mark === "next" ? "text-[color:var(--accent)]" : "text-foreground")}>
                  {e.actor ? <b className="font-medium">{e.actor}</b> : null} {e.actor ? line.what : capital(line.what)}
                </span>
                {line.body ? <span className="text-[13px] leading-[1.45] break-words whitespace-pre-wrap text-muted-foreground">{line.body}</span> : null}
                {upcoming ? <span className="text-[13px] text-muted-foreground">{upcoming}</span> : null}
              </span>
              <span className="pt-0.5 text-[12px] whitespace-nowrap text-faint tabular-nums" title={e.at.slice(0, 10)}>
                <LocalDay iso={e.at} fallback={ago(e.at, now)} />
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
