import { StatusGlyph, type GlyphKind } from "@/components/page";
import { cn } from "@/lib/utils";
import { ReadThread, VerdictPill, type FeedbackCard } from "../interviews/view";

// What a ticket opened from the Inbox wants of the member, under its chips:
// design/tats's `.call-card` for a decision, the read and the buttons together,
// and its `.sit` for everything else, where it stands and what moves it on.
// Both are Testbench cards (`.peek`): a white card, a Mona Sans heading, data in
// Geist Mono, the buttons in a foot over a hairline. Props only. Everything a
// member or a candidate wrote renders as text.

const card = "grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[14px] bg-card shadow-[var(--shadow)]";
const foot = "flex flex-wrap items-center gap-2 border-t border-[color:var(--line)] bg-[color:var(--surface)] px-5 py-3.5";

/** design/tats's `.cc-head`: the interviewer and when they filed, the verdict right; then the rest of the read as its chat transcript. */
function Read({ feedback: f }: { feedback: FeedbackCard }) {
  return (
    <article className="grid gap-3">
      <header className="flex flex-wrap items-center gap-3">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <b className="font-sans text-[15px] leading-5 font-semibold break-words">{f.interviewer === "You" ? "Your read" : `${f.interviewer}'s read`}</b>
          <span className="flex flex-wrap gap-x-3 text-[12px] text-faint tabular-nums">
            {f.rating !== null ? <span>{f.rating} / 4 overall</span> : null}
            {f.submitted ? <span>{f.submitted}</span> : null}
          </span>
        </div>
        <VerdictPill verdict={f.verdict} label={f.recommendation} />
      </header>
      <ReadThread feedback={f} />
    </article>
  );
}

/**
 * The reads and the buttons in one card. With no read to show, `head` says what
 * is waiting; with reads, `fact` (what is so, "Interviewed 1d ago, nothing
 * booked next.", which the entry and the route say too) and `note` (whose read
 * stays hidden) are the card's hover and its screen-reader text, not grey lines
 * under the reads. How the buttons deal with it is their hover.
 */
export function CallCard({ reads, note, head, fact, children, actions }: { reads: FeedbackCard[]; note: string | null; head: React.ReactNode; fact: string; children?: React.ReactNode; actions: React.ReactNode }) {
  const aside = [note, reads.length ? fact : null].filter(Boolean).join(" ");
  return (
    <section aria-label={actions ? "Your call" : "The read"} title={aside || undefined} className={card}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 px-5 py-4">
        {/* Several reads keep apart with a hairline between them. */}
        {reads.length ? <div className="grid gap-4 divide-y divide-[color:var(--line)] [&>*+*]:pt-4">{reads.map((f) => <Read key={f.feedbackId} feedback={f} />)}</div> : head}
        {children}
        {aside ? <p className="sr-only">{aside}</p> : null}
      </div>
      {actions ? <div className={foot}>{actions}</div> : null}
    </section>
  );
}

/**
 * design/tats's `.sit`: what's happening and why, with who has it and how long
 * on the right, then what moves it on. `glyph` is the square its row wears in
 * the list; left out, past due is the red alert and anything else a wait. Only
 * the alert turns the age red: red means overdue. `note` is a why that would
 * only repeat what is around the card: the title's hover and screen-reader text.
 * A news entry's pop-up draws the same card for what happened (`label`), who
 * did it after its own word (`whoWord`), when, and Mark read.
 */
export function WhereItStands({
  who,
  title,
  why,
  age,
  late = false,
  glyph: given,
  note,
  label = "Where it stands",
  whoWord = "With",
  children,
  actions = null,
}: {
  who: string | null;
  title: React.ReactNode;
  why: string;
  note?: string;
  age: React.ReactNode;
  late?: boolean;
  glyph?: GlyphKind;
  label?: string;
  whoWord?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const glyph: GlyphKind = given ?? (late ? "alert" : "pending");
  const red = glyph === "alert";
  return (
    <section aria-label={label} className={card}>
      <div className="grid grid-cols-[14px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-5 py-4 sm:grid-cols-[14px_minmax(0,1fr)_auto]">
        <StatusGlyph kind={glyph} still className="mt-[3px]" />
        <div className="grid min-w-0 gap-1">
          <b title={note || undefined} className="font-sans text-[15px] leading-5 font-semibold break-words">
            {title}
            {note ? <span className="sr-only"> {note}</span> : null}
          </b>
          {why ? <span className="text-[13px] break-words text-muted-foreground">{why}</span> : null}
        </div>
        {who || age ? (
          <span className="col-start-2 flex flex-wrap gap-x-3 text-[12.5px] whitespace-nowrap text-faint tabular-nums sm:col-start-3 sm:justify-end sm:pt-px">
            {who ? (
              <span>
                {whoWord} {who}
              </span>
            ) : null}
            {age ? <span className={cn(red && "text-[color:var(--red)]")}>{age}</span> : null}
          </span>
        ) : null}
      </div>
      {children ? <div className="grid gap-3 border-t border-[color:var(--line)] px-5 py-4">{children}</div> : null}
      {actions ? (
        <div role="group" aria-label="To move it on" className={foot}>
          {actions}
        </div>
      ) : null}
    </section>
  );
}
