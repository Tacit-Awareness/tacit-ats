import { Avatar } from "@/components/page";
import { cn } from "@/lib/utils";
import { FeedbackDetail, VerdictPill, type FeedbackCard } from "../interviews/view";

// What a ticket opened from the Inbox wants of the member, under its chips:
// design/tats's `.call-card` for a decision, the read and the buttons together,
// and its `.sit` for everything else, where it stands and what moves it on.
// Props only. Everything a member or a candidate wrote renders as text.

/** design/tats's `.cc-head`: the interviewer, when they filed, the verdict right. */
function Read({ feedback: f }: { feedback: FeedbackCard }) {
  return (
    <article className="grid gap-3">
      <header className="flex flex-wrap items-center gap-3">
        <Avatar name={f.interviewer} size="lg" />
        <div className="grid min-w-0 flex-1">
          <b className="text-[14px] font-semibold break-words">{f.interviewer === "You" ? "Your read" : `${f.interviewer}'s read`}</b>
          <span className="text-[13px] text-muted-foreground">{[f.rating !== null ? `${f.rating} / 4` : null, f.submitted].filter(Boolean).join(" · ")}</span>
        </div>
        <VerdictPill verdict={f.verdict} label={f.recommendation} />
      </header>
      <FeedbackDetail feedback={f} />
    </article>
  );
}

/** The reads and the buttons in one card. With no read to show, `head` says what is waiting. */
export function CallCard({ reads, note, head, hint, children, actions }: { reads: FeedbackCard[]; note: string | null; head: React.ReactNode; hint: string; children?: React.ReactNode; actions: React.ReactNode }) {
  return (
    <section aria-label={actions ? "Your call" : "The read"} className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-[10px] border border-[color:var(--line-strong)] bg-[color:var(--paper)] px-[18px] py-4">
      {reads.length ? reads.map((f) => <Read key={f.feedbackId} feedback={f} />) : head}
      {children}
      {note ? <p className="m-0 text-[12.5px] text-faint">{note}</p> : null}
      {actions ? <div className="pt-1">{actions}</div> : null}
      {reads.length && hint ? <p className="m-0 text-[12.5px] text-faint">{hint}</p> : null}
    </section>
  );
}

/** design/tats's `.sit`: who has it, what's happening, how long, then what moves it on. Past due it says so, in red. */
export function WhereItStands({
  who,
  title,
  why,
  age,
  late = false,
  children,
  actions = null,
}: {
  who: string | null;
  title: string;
  why: string;
  age: string | null;
  late?: boolean;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section
      aria-label="Where it stands"
      className={cn(
        "grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[10px] border bg-[color:var(--raised)]",
        late ? "border-[color:color-mix(in_oklch,var(--red)_45%,var(--line))] shadow-[inset_3px_0_0_var(--red)]" : "border-[color:var(--line)]",
      )}
    >
      <div className="flex items-start gap-3 px-5 py-4">
        {who ? <Avatar name={who} size="lg" /> : null}
        <div className="grid min-w-0 flex-1 gap-0.5">
          {who ? <span className="text-[12px] text-faint">With {who}</span> : null}
          <b className="text-[15px] font-semibold break-words">{title}</b>
          <span className="text-[13.5px] break-words text-muted-foreground">{why}</span>
        </div>
        {age ? <span className={cn("text-[13px] font-medium whitespace-nowrap tabular-nums", late && "text-[color:var(--red)]")}>{age}</span> : null}
      </div>
      {children ? <div className="grid gap-3 border-t border-[color:var(--line)] px-5 py-3">{children}</div> : null}
      {actions ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[color:var(--line)] bg-[color:var(--surface)] px-5 py-3">
          <span className="flex-none text-[12px] text-faint">To move it on</span>
          {actions}
        </div>
      ) : null}
    </section>
  );
}
