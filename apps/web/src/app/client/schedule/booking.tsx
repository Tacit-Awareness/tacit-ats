"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { flushSync } from "react-dom";
import { Kbd, pillOption, pillTrack, textLink } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { Input, selectClass } from "@/components/ui/input";
import { parseYmd, SNAP_MINUTES, spanAt, todayIn, zoned, type Ymd } from "@/lib/client/schedule-layout";
import { prefill, type NextRound } from "@/lib/client/next-round-rules";
import type { ApplicationChoice, BookingChoices } from "@/lib/client/schedule-choices";
import { bookLines, changeLines, conflictLines, doneSentence } from "@/lib/client/schedule-copy";
import {
  COULD_NOT_FINISH, SCHEDULE_API, SIGNED_OUT,
  type BookRequest, type CancelRequest, type FoundTimes, type MoveRequest, type ScheduleAnswer, type ScheduleRequest,
} from "@/lib/client/schedule-requests";
import { cn } from "@/lib/utils";
import { bookingChoicesAction } from "./actions";
import { clock12, range12, zoneLong, zoneShort } from "./clock";

// The Calendar's book, move, cancel and Find a time as one native <dialog>,
// modal, so keys.ts stops every page and shell key behind it: Testbench's
// dialog (16px corners on the box surface, a Mona Sans title, the buttons right
// over a hairline) in the middle of the window, or, for a time picked on the
// grid (a book flow with an `anchor`), Google Calendar's quick-create beside
// that slot, in the same dress: a handle to move it and Close along the top,
// the candidate and step as its heading, then a row each, a small line icon in
// a column at the left, for when (the slot's time, which a click makes
// editable), the candidate, the interviewers, the step and where; More options
// (the whole form) and Book at the foot. The rows hold only what a booking
// saves. Both are the same form, so moving from one to the other keeps what
// was picked and the booking's one id. Nothing that changes a real calendar happens without its Confirm card:
// the card shows core's dry run, who holds the event and who hears from Google,
// and only its button sends `confirmed`. A clash found by the dry run, or by
// the write itself, turns the button into "anyway", pressed on purpose. All of
// it goes to the one route that can reach calendar grants (SCHEDULE_API); the
// choices are read when a dialog opens. Times are the browser's zone, as on the
// grid. A book flow with `next` is the Inbox's Next round: Find a time with the
// candidate and their plan's next step already picked (next-round-rules.ts).

export type CalendarEventRef = {
  id: string;
  applicationId: string;
  href: string;
  candidate: string;
  step: string;
  job: string;
  interviewers: string[];
  interviewerIds: string[];
  location: string | null;
  locationHref: string | null;
  eventLink: string | null;
  startsAt: string;
  endsAt: string;
};

/** Where a slot picked on the grid is on screen, so the quick popover can open beside it: the slot's box, and where across it it was pressed. */
export type Anchor = { left: number; right: number; top: number; bottom: number; x: number };

export type Flow =
  | {
      kind: "book";
      find: boolean;
      at?: { day: Ymd; minutes: number; length: number };
      /** The Inbox's Next round: who, and the step, picked once the choices are read. */
      next?: NextRound;
      /** A slot picked on the grid: the form opens as the quick popover beside it. */
      anchor?: Anchor;
    }
  | { kind: "event"; event: CalendarEventRef }
  | { kind: "move"; event: CalendarEventRef; to?: { startsAt: string; endsAt: string } }
  | { kind: "cancel"; event: CalendarEventRef };

const DURATIONS = [30, 45, 60, 90];
const DAY_MINUTES = 24 * 60;
const FIND_DAYS = 14;
/** Keeps a date field's year to four digits, as far as the browser will. `spanAt` holds the rest. */
const LAST_DAY = "2200-12-31";

/** Testbench's buttons: a raised face for the quiet ones, black for the one that goes ahead, red words for the one that undoes. */
const plain = buttonVariants({ variant: "outline" });
/** Until it can go ahead (Book before a candidate and an interviewer are picked), a flat grey face with faint words: plainly not ready, where a faded black reads as a grey button. */
const primary = cn(buttonVariants(), "disabled:bg-[color:var(--soft-strong)] disabled:text-faint disabled:opacity-100");
const danger = cn(buttonVariants({ variant: "outline" }), "text-[color:var(--red)]");
/** A row in a pick list, Testbench's `.menu-item`. */
const pickRow = "flex min-h-[34px] w-full items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-[color:var(--hover)]";
/** A pick list: a quiet framed box the rows scroll in. */
const pickList = "m-0 grid list-none grid-cols-[minmax(0,1fr)] overflow-y-auto rounded-[10px] bg-[color:var(--paper)] p-1 shadow-[inset_0_0_0_1px_var(--line)]";
const label = "grid gap-1.5 text-[12.5px] text-muted-foreground";
/** A card's sides: 24px in the dialog; in the quick popover the text column's, past the icons, 20px at the right. */
const sides = "px-6 group-data-[quick]/dlg:pr-5 group-data-[quick]/dlg:pl-14";
const legend = "mb-1.5 p-0 text-[12.5px] text-muted-foreground";
/** The two pick lists' heights, giving a little on a short window (1280x800), so the form fits it without scrolling. */
const appListH = "max-h-[clamp(112px,18vh,176px)]";
const peopleListH = "max-h-[clamp(96px,15vh,148px)]";
/** The quick popover's pick lists, under their row while it has focus. */
const quickListH = "max-h-[168px]";

/** A quiet bar standing in for a line of text while the choices are read; it breathes only for those who allow motion. */
const bone = "rounded-[4px] bg-[color:var(--soft-strong)] motion-safe:animate-pulse";

/**
 * The form's shape while the choices are read: each picker's label, search
 * field and list as quiet bars at the sizes they will have, so the dialog
 * paints at its full size and does not jump when the pickers arrive.
 */
function FormSkeleton() {
  const field = "h-9 rounded-[7px] bg-[color:var(--paper)] shadow-[inset_0_0_0_1px_var(--line)]";
  // A fieldset's legend sits outside its grid's gaps, so here the label's own line takes the gap's place.
  const picker = (listH: string) => (
    <div className="grid gap-1.5">
      <p className="m-0 text-[12.5px]">
        <span className={cn(bone, "inline-block h-3 w-20 align-middle")} />
      </p>
      <span className={field} />
      <div className={cn(pickList, "content-start", listH)}>
        {[0, 1, 2].map((i) => (
          <span key={i} className="flex min-h-[34px] items-center px-2.5">
            <span className={cn(bone, "h-3", i % 2 ? "w-28" : "w-36")} />
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <div aria-busy className="grid gap-4">
      {picker("h-[clamp(112px,18vh,176px)]")}
      {picker("h-[clamp(96px,15vh,148px)]")}
      {/* The length track, the date and time, and Where, at their sizes. */}
      <span className="h-[34px] w-[288px] rounded-[11px] bg-[color:var(--track)]" />
      <span className={cn(field, "w-[304px]")} />
      <div className="grid gap-1.5">
        <p className="m-0 text-[12.5px]">
          <span className={cn(bone, "inline-block h-3 w-12 align-middle")} />
        </p>
        <span className={field} />
      </div>
    </div>
  );
}

/**
 * The quick popover's row icons, in the sidebar's line style (shell-frame.tsx's
 * ICONS: a 16px grid, 1.35 strokes, round ends). The people and team icons are
 * the sidebar's own; the step is Interview Process's, where steps are made.
 */
const ROW_ICONS = {
  clock: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 4.8V8l2.2 1.5",
  people: "M8 8.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2M3 13.5c.5-2.5 2.5-3.8 5-3.8s4.5 1.3 5 3.8",
  team: "M6 7.5a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6M1.8 13c.4-2.3 2-3.6 4.2-3.6s3.8 1.3 4.2 3.6M11 3.2a2.2 2.2 0 0 1 0 4.1M12.6 9.8c1 .6 1.6 1.7 1.8 3.2",
  route: "M3 2.5h4v3.5H3ZM9 10h4v3.5H9ZM5 6v3a2 2 0 0 0 2 2h2",
  video: "M3.5 4.5H9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1ZM10 7l3.5-2v6L10 9",
  grip: "M4 6.5h8M4 9.5h8",
  close: "m4 4 8 8M12 4l-8 8",
  chevron: "m4.5 6.5 3.5 3.5 3.5-3.5",
} as const;

function RowIcon({ name, className }: { name: keyof typeof ROW_ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" className={cn("size-4 shrink-0", className)} aria-hidden>
      <path d={ROW_ICONS[name]} />
    </svg>
  );
}

/**
 * The quick popover's fields, Google Calendar's rows: no box at rest, a soft
 * fill on hover, and once focused Testbench's field (Input's white face, ink
 * edge and soft ring). `quietBox` is the same for a box holding a field and
 * more, such as the interviewers' chips, lit while focus is inside it.
 */
const quietField =
  "h-9 w-full min-w-0 rounded-[7px] border-0 bg-transparent px-2.5 text-[13px] text-foreground outline-none transition-[background-color,box-shadow] duration-150 placeholder:text-faint hover:bg-[color:var(--hover)] focus-visible:bg-[color:var(--paper)] focus-visible:shadow-[inset_0_0_0_1.5px_var(--ink),0_0_0_3px_rgba(34,35,38,0.12)]";
const quietBox =
  "rounded-[7px] transition-[background-color,box-shadow] duration-150 not-focus-within:hover:bg-[color:var(--hover)] focus-within:bg-[color:var(--paper)] focus-within:shadow-[inset_0_0_0_1.5px_var(--ink),0_0_0_3px_rgba(34,35,38,0.12)]";

/** A row of the quick popover: its icon faint in the left column, level with the row's first line. */
function QuickRow({ icon, label: name, children }: { icon: keyof typeof ROW_ICONS; label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={name} className="grid grid-cols-[36px_minmax(0,1fr)] items-start">
      <RowIcon name={icon} className="mt-2.5 text-faint" />
      {/* Out by a field's padding each side, so the text in a field lines up with the heading's. */}
      <div className="-mx-2.5 min-w-0">{children}</div>
    </div>
  );
}

/** A row that is open while focus is anywhere in it: its list shows under its field, and folds away when focus leaves. */
function useOpenWhileFocused() {
  const [open, setOpen] = React.useState(false);
  const row = {
    onFocus: () => setOpen(true),
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
    },
  };
  return [open, row] as const;
}

/** A press in a pick list keeps focus in the row's field, so the row stays open for the click to land. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

/** The quick popover's rows while the choices are read, at their sizes: the candidate's open list, then who interviews and where. */
function QuickSkeleton() {
  const line = (w: string) => (
    <span className="flex h-9 items-center px-2.5">
      <span className={cn(bone, "h-3", w)} />
    </span>
  );
  return (
    <div aria-busy className="grid gap-1">
      <QuickRow icon="people" label="Candidate">
        {line("w-32")}
        <div className={cn(pickList, "mt-1 h-[168px] content-start")}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex min-h-[34px] items-center px-2.5">
              <span className={cn(bone, "h-3", i % 2 ? "w-28" : "w-36")} />
            </span>
          ))}
        </div>
      </QuickRow>
      <QuickRow icon="team" label="Interviewers">
        {line("w-36")}
      </QuickRow>
      <QuickRow icon="video" label="Where">
        {line("w-44")}
      </QuickRow>
    </div>
  );
}
/** A line that warns or limits, on its own soft fill. */
const amberNote = "m-0 rounded-[8px] bg-[color:var(--amber-soft)] px-3 py-2 text-[12.5px] break-words";

async function ask(request: ScheduleRequest): Promise<ScheduleAnswer> {
  try {
    // Manual: a session that ended redirects to sign in, which a fetch cannot follow.
    const res = await fetch(SCHEDULE_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      redirect: "manual",
    });
    if (res.type === "opaqueredirect") return { ok: false, code: "signed_out", message: SIGNED_OUT };
    return (await res.json()) as ScheduleAnswer;
  } catch {
    return { ok: false, code: "failed", message: COULD_NOT_FINISH };
  }
}

const dateWords = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat(undefined, { timeZone, weekday: "long", month: "long", day: "numeric" }).format(new Date(iso));
/** "Thursday, November 12, 10 – 11 AM": the 12-hour clock, the period said once. */
const whenWords = (startsAt: string, endsAt: string, timeZone: string) => `${dateWords(startsAt, timeZone)}, ${range12(startsAt, endsAt, timeZone)}`;
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const minutesOf = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

function Err({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="m-0 rounded-[8px] bg-[color:var(--red-soft)] px-3 py-2 text-[13px] break-words text-[color:var(--red)]">
      {children}
    </p>
  );
}

/**
 * Testbench's `.dialog-foot`: the buttons right over a hairline, with no hint
 * line beside them (what a button does not do yet is its hover title). `lead`
 * is a way out of the dialog, on the left. The buttons keep together: short of
 * room they wrap as a group, never one of them alone.
 */
function Foot({ children, lead }: { children: React.ReactNode; lead?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-x-4 gap-y-2.5 border-t border-[color:var(--line)] py-3.5 group-data-[quick]/dlg:py-3", sides)}>
      {lead}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

/**
 * Testbench's `.dialog-head`: the title in Mona Sans and nothing under it; the
 * facts are the body's first lines. In the quick popover it sits under the
 * handle and Close, in the text column past the icons, as Google's title does.
 */
function Head({ title, id }: { title: string; id: string }) {
  return (
    <header className="pt-[22px] pr-14 pb-1.5 pl-6 group-data-[quick]/dlg:pt-0 group-data-[quick]/dlg:pr-5 group-data-[quick]/dlg:pb-2 group-data-[quick]/dlg:pl-14">
      <h2 id={id} className="m-0 font-sans text-[20px] leading-[26px] font-semibold tracking-[-0.015em] break-words">
        {title}
      </h2>
    </header>
  );
}

/** When an interview is, as the first fact of a card's body; in the quick popover with its clock in the icon column. */
function When({ children }: { children: React.ReactNode }) {
  return (
    <p className="relative m-0 font-medium break-words tabular-nums">
      <RowIcon name="clock" className="absolute top-0.5 -left-9 hidden text-faint group-data-[quick]/dlg:block" />
      {children}
    </p>
  );
}

/** The zone the times are in, small and faint, its full name on hover, as Google Calendar puts it by the hours. */
function Zone({ timeZone }: { timeZone: string }) {
  return (
    <span title={zoneLong(timeZone)} className="text-[12px] whitespace-nowrap text-faint">
      {zoneShort(timeZone)}
    </span>
  );
}

/**
 * The date and the start, then when it ends and the zone, on one line as
 * Google Calendar's editor has them: no "Date" or "Starts" over the fields,
 * which say it themselves (and to a screen reader, by their names).
 */
function WhenFields({ day, time, setDay, setTime, min, end, timeZone }: { day: Ymd; time: string; setDay: (d: Ymd) => void; setTime: (t: string) => void; min?: Ymd; end: string | null; timeZone: string }) {
  return (
    <div role="group" aria-label="When" className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
      <Input type="date" aria-label="Date" value={day} min={min} max={LAST_DAY} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-[164px] text-foreground" />
      <Input type="time" aria-label="Starts" title={`In ${zoneLong(timeZone)}`} step={SNAP_MINUTES * 60} value={time} onChange={(e) => e.target.value && setTime(e.target.value)} className="w-[132px] text-foreground" />
      {end ? <span className="text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">– {end}</span> : null}
      <Zone timeZone={timeZone} />
    </div>
  );
}

type Confirming = {
  request: BookRequest | MoveRequest | CancelRequest;
  title: string;
  when: string;
  lines: string[];
  /** Someone is busy, or the calendar cannot follow: pressing on is said out loud. */
  warned: string[];
  confirm: string;
  danger: boolean;
  /** Tacit's record only, offered when the calendar cannot follow. */
  recordOnly: boolean;
};

/** The one place a write is sent with `confirmed`. */
function ConfirmCard({ c, back, backLabel, done, setBusy, reread }: { c: Confirming; back: () => void; backLabel: string; done: (sentence: string) => void; setBusy: (b: boolean) => void; reread: () => void }) {
  const [state, setState] = React.useState(c);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const button_ = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => button_.current?.focus(), []);

  const send = async () => {
    if (pending) return;
    setPending(true);
    setBusy(true);
    setError(null);
    const request = { ...state.request, confirmed: true, ...(state.recordOnly ? { recordOnly: true } : {}) };
    const answer = await ask(request);
    setPending(false);
    setBusy(false);
    if (!answer.ok) {
      // The grid behind this card is out of date: what it shows is not what is there.
      if (answer.code === "stale" || answer.code === "not_found") reread();
      return setError(answer.message);
    }
    if (answer.kind === "conflicts") {
      setState((s) => ({
        ...s,
        warned: conflictLines(answer.conflicts),
        confirm: s.request.op === "move" ? "Move anyway" : "Book anyway",
        request: s.request.op === "cancel" ? s.request : { ...s.request, bookDespiteConflicts: true },
      }));
      return;
    }
    if (answer.kind === "booked" || answer.kind === "changed" || answer.kind === "unchanged" || answer.kind === "already_booked") done(doneSentence(answer));
  };

  return (
    <div
      className="flex min-h-0 flex-col"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          void send();
        }
      }}
    >
      <Head id="schedule-dialog-title" title={state.title} />
      <div className={cn("grid gap-2 overflow-y-auto pt-3 pb-5 text-[13px]", sides)}>
        <When>{state.when}</When>
        {state.lines.map((l) => (
          <p key={l} className="m-0 break-words">
            {l}
          </p>
        ))}
        {state.warned.map((l) => (
          <p key={l} className={cn(amberNote, "text-[13px] text-foreground")}>
            {l}
          </p>
        ))}
        {error ? <Err>{error}</Err> : null}
      </div>
      <Foot>
        <button type="button" onClick={back} disabled={pending} className={plain}>
          {backLabel}
        </button>
        <button ref={button_} type="button" onClick={() => void send()} disabled={pending} title={`${state.confirm} (⌘↵)`} className={state.danger ? danger : primary}>
          {pending ? "Working…" : state.confirm}
          {pending ? null : <Kbd>⌘↵</Kbd>}
        </button>
      </Foot>
    </div>
  );
}

/** A book's dry run as a card. */
function bookConfirm(request: BookRequest, answer: Extract<ScheduleAnswer, { kind: "book_preview" }>, app: ApplicationChoice, timeZone: string): Confirming {
  const { calendar, conflicts } = answer.preview;
  const writes = calendar.status === "would_invite";
  const warned = conflictLines(conflicts);
  const busy = conflicts.busy.length > 0;
  const expired = calendar.status === "not_sent" && calendar.reason === "connection_expired";
  return {
    request: { ...request, bookDespiteConflicts: busy },
    title: `${app.candidate}, ${request.step ?? "Interview"}`,
    when: whenWords(request.startsAt, request.endsAt, timeZone),
    lines: bookLines(calendar),
    warned,
    confirm: busy ? "Book anyway" : writes ? "Book and invite" : "Record in Tacit",
    danger: false,
    recordOnly: expired,
  };
}

/** A move's or a cancel's dry run as a card. */
function changeConfirm(request: MoveRequest | CancelRequest, answer: Extract<ScheduleAnswer, { kind: "change_preview" }>, event: CalendarEventRef, timeZone: string): Confirming {
  const { calendar, conflicts } = answer.preview;
  const moving = request.op === "move";
  const busy = conflicts.busy.length > 0;
  const blocked = calendar.status === "blocked";
  return {
    request: moving ? { ...request, bookDespiteConflicts: busy } : request,
    title: moving ? `Move ${event.candidate}'s ${event.step}` : `Cancel ${event.candidate}'s ${event.step}`,
    when: moving ? `${whenWords(event.startsAt, event.endsAt, timeZone)} → ${whenWords((request as MoveRequest).startsAt, (request as MoveRequest).endsAt, timeZone)}` : whenWords(event.startsAt, event.endsAt, timeZone),
    lines: changeLines(calendar),
    warned: conflictLines(conflicts),
    confirm: blocked ? "Change Tacit only" : moving ? (busy ? "Move anyway" : "Move interview") : "Cancel interview",
    danger: !moving,
    recordOnly: blocked,
  };
}

export function Slots({ found, timeZone, pick, picked }: { found: FoundTimes; timeZone: string; pick: (startsAt: string, endsAt: string) => void; picked?: string | null }) {
  // The times are in the browser's zone, as on the grid; the list's hover names it.
  return (
    <div className="grid gap-1.5">
      {found.unknown.map((u) => (
        <p key={u.name} className={amberNote}>
          Not checked: {u.name} {u.why}.
        </p>
      ))}
      {found.limited.map((l) => (
        <p key={l.name} className="m-0 rounded-[8px] bg-[color:var(--soft)] px-3 py-2 text-[12.5px] break-words shadow-[inset_0_0_0_1px_var(--line)]">
          Times left out: {l.name}, {l.why}.
        </p>
      ))}
      {found.slots.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">Nobody checked is free for that long in the next two weeks, in working hours.</p>
      ) : (
        <ul aria-label="Free times" title={`Times in ${zoneLong(timeZone)}`} className="m-0 grid max-h-[220px] list-none gap-1.5 overflow-y-auto p-0">
          {found.slots.map((s) => (
            <li key={s.startsAt}>
              <button
                type="button"
                onClick={() => pick(s.startsAt, s.endsAt)}
                aria-pressed={picked === s.startsAt}
                className={cn(
                  "flex min-h-10 w-full items-center gap-3 rounded-[8px] bg-[color:var(--paper)] px-3.5 py-2 text-left text-[13px] transition-[background-color,box-shadow] duration-150 hover:bg-[color:var(--hover)]",
                  picked === s.startsAt ? "shadow-[inset_0_0_0_1.5px_var(--ink)]" : "shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]",
                )}
              >
                <b className="flex-1 font-medium">{dateWords(s.startsAt, timeZone)}</b>
                <span className="text-muted-foreground tabular-nums">
                  {range12(s.startsAt, s.endsAt, timeZone)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BookForm({ flow, timeZone, now, confirm, setBusy, go }: { flow: Extract<Flow, { kind: "book" }>; timeZone: string; now: number; confirm: (c: Confirming) => void; setBusy: (b: boolean) => void; go: (f: Flow) => void }) {
  const [choices, setChoices] = React.useState<(BookingChoices & { failed: boolean }) | null>(null);
  const [appQ, setAppQ] = React.useState("");
  const [ivQ, setIvQ] = React.useState("");
  const [applicationId, setApplicationId] = React.useState<string | null>(null);
  const [interviewerIds, setInterviewerIds] = React.useState<string[]>([]);
  const [step, setStep] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [day, setDay] = React.useState<Ymd>(flow.at?.day ?? todayIn(timeZone, now));
  const [time, setTime] = React.useState(hhmm(flow.at?.minutes ?? 10 * 60));
  const [length, setLength] = React.useState(flow.at?.length ?? 60);
  const [found, setFound] = React.useState<FoundTimes | null>(null);
  const [pickedAt, setPickedAt] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** Next round asked for someone the choices don't have: said once, over the picker. */
  const [missing, setMissing] = React.useState(false);
  // One per dialog: a retry of a booking that went through finds it, rather than booking twice.
  const [interviewId] = React.useState(() => globalThis.crypto.randomUUID());
  const first = React.useRef<HTMLInputElement>(null);
  const ivSearch = React.useRef<HTMLInputElement>(null);
  const next = flow.next;
  // The quick popover's rows: the time turns into fields on a click; a picker's list shows while its row has focus.
  const [editWhen, setEditWhen] = React.useState(false);
  const dateField = React.useRef<HTMLInputElement>(null);
  const [appOpen, appRow] = useOpenWhileFocused();
  const [ivOpen, ivRow] = useOpenWhileFocused();

  React.useEffect(() => {
    let live = true;
    void bookingChoicesAction().then(
      (c) => {
        if (!live) return;
        // Next round's candidate and step, picked before the form shows, so the first thing left is who interviews.
        const p = prefill(c.applications, next);
        setApplicationId(p.applicationId);
        setStep(p.step);
        setMissing(p.missing);
        setChoices(c);
      },
      () => {
        if (live) setChoices({ applications: [], interviewers: [], truncated: false, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [next]);
  // Before paint, so the candidate's list is open in the first frame the choices show: the popover is drawn once at its size, not short and then tall.
  React.useLayoutEffect(() => (first.current ?? ivSearch.current)?.focus(), [choices]);
  React.useEffect(() => {
    if (editWhen) dateField.current?.focus();
  }, [editWhen]);

  const app = choices?.applications.find((a) => a.applicationId === applicationId) ?? null;
  const steps = app?.steps ?? [];
  const match = (text: string, q: string) => text.toLowerCase().includes(q.trim().toLowerCase());
  const apps = (choices?.applications ?? []).filter((a) => match(`${a.candidate} ${a.jobTitle}`, appQ)).slice(0, 50);
  const people = (choices?.interviewers ?? []).filter((p) => interviewerIds.includes(p.actorId) || match(p.name, ivQ)).slice(0, 50);

  const start = minutesOf(time);
  const at = spanAt(day, start, length, timeZone);
  const ready = !!app && interviewerIds.length > 0 && (!steps.length || !!step) && !!at && !!time;
  /** Opened from a slot on the grid: Google Calendar's quick-create beside it. */
  const quick = !!flow.anchor && !flow.find;
  /** From the popover to the dialog, the same form: what was picked, and the slot's time, come along. */
  const widen = () => go({ kind: "book", find: false, ...(flow.at ? { at: { day, minutes: start, length } } : {}), ...(next ? { next } : {}) });

  // The popover's slot stays drawn on the grid as its time is changed here, Google Calendar's way.
  React.useEffect(() => {
    if (!quick || !flow.at || !parseYmd(day)) return;
    if (flow.at.day === day && flow.at.minutes === start && flow.at.length === length) return;
    go({ ...flow, at: { day, minutes: start, length } });
  }, [quick, flow, day, start, length, go]);

  const onFind = async () => {
    if (pending || !ready || !app) return;
    setPending(true);
    setBusy(true);
    setError(null);
    const answer = await ask({
      op: "find",
      interviewerIds,
      durationMinutes: length,
      windowStart: new Date(now).toISOString(),
      windowEnd: new Date(now + FIND_DAYS * 86_400_000).toISOString(),
      timezone: timeZone,
      applicationId: app.applicationId,
    });
    setPending(false);
    setBusy(false);
    if (!answer.ok) return setError(answer.message);
    if (answer.kind === "times") setFound(answer.found);
  };

  const onReview = async (slot?: { startsAt: string; endsAt: string }) => {
    const when = slot ?? at;
    if (pending || !app || !when) return;
    setPending(true);
    setBusy(true);
    setError(null);
    const request: BookRequest = {
      op: "book",
      confirmed: false,
      interviewId,
      applicationId: app.applicationId,
      startsAt: when.startsAt,
      endsAt: when.endsAt,
      interviewerIds,
      step: step.trim() || null,
      locationOrLink: location.trim() || null,
      timezone: timeZone,
      bookDespiteConflicts: false,
      recordOnly: false,
    };
    const answer = await ask(request);
    setPending(false);
    setBusy(false);
    if (!answer.ok) return setError(answer.message);
    if (answer.kind === "book_preview") confirm(bookConfirm(request, answer, app, timeZone));
  };

  const pickSlot = (s: string, e: string) => {
    const local = zoned(s, timeZone);
    setDay(local.day);
    setTime(hhmm(local.minutes));
    setPickedAt(s);
    void onReview({ startsAt: s, endsAt: e });
  };

  const pickApp = (id: string | null) => {
    setApplicationId(id);
    setStep("");
    setFound(null);
  };
  const toggleInterviewer = (id: string) => {
    setFound(null);
    setInterviewerIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  if (quick) {
    const picked = interviewerIds.map((id) => choices?.interviewers.find((p) => p.actorId === id)).filter((p): p is NonNullable<typeof p> => !!p);
    const chosenStep = step.trim();
    return (
      <>
        {/* The interview as Google's title would read it: who, then which round once there is one. */}
        <Head id="schedule-dialog-title" title={app ? (chosenStep ? `${app.candidate}, ${chosenStep}` : app.candidate) : "New interview"} />
        <div className="grid gap-1 overflow-y-auto px-5 pt-1 pb-4">
          <QuickRow icon="clock" label="When">
            {editWhen || !at ? (
              // The start and the end, as Google's editor has them; a new end keeps the start and changes the length.
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 py-px">
                <Input ref={dateField} type="date" aria-label="Date" value={day} max={LAST_DAY} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-[140px] text-foreground" />
                <Input type="time" aria-label="Starts" title={`In ${zoneLong(timeZone)}`} step={SNAP_MINUTES * 60} value={time} onChange={(e) => e.target.value && setTime(e.target.value)} className="w-[128px] text-foreground" />
                <span aria-hidden className="text-muted-foreground">
                  –
                </span>
                <Input
                  type="time"
                  aria-label="Ends"
                  title={`In ${zoneLong(timeZone)}`}
                  step={SNAP_MINUTES * 60}
                  value={hhmm((start + length) % DAY_MINUTES)}
                  onChange={(e) => {
                    const minutes = e.target.value ? minutesOf(e.target.value) - start : 0;
                    if (minutes > 0) setLength(minutes);
                  }}
                  className="w-[128px] text-foreground"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditWhen(true)}
                title={`Change the date or time. Times in ${zoneLong(timeZone)}`}
                className="flex min-h-9 w-full flex-wrap items-center gap-x-3 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] tabular-nums transition-colors hover:bg-[color:var(--hover)]"
              >
                <span>{dateWords(at.startsAt, timeZone)}</span>
                <span>{range12(at.startsAt, at.endsAt, timeZone)}</span>
              </button>
            )}
          </QuickRow>
          {!choices ? (
            <QuickSkeleton />
          ) : choices.failed ? (
            <div className="pl-9">
              <Err>Could not read who can be booked. Try again.</Err>
            </div>
          ) : !choices.applications.length ? (
            <p className="m-0 py-2 pl-9 text-[13px] text-muted-foreground">Nobody in process on a job you schedule for.</p>
          ) : (
            <>
              <QuickRow icon="people" label="Candidate">
                {app ? (
                  <div className="flex min-h-9 items-center gap-2.5 py-0.5 pr-0.5 pl-2.5 text-[13px]">
                    <span className="flex min-w-0 flex-1 gap-2.5">
                      <span className="max-w-full shrink-0 truncate font-medium">{app.candidate}</span>
                      <span className="truncate text-muted-foreground">{app.jobTitle}</span>
                    </span>
                    <button
                      type="button"
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                      onClick={() => {
                        pickApp(null);
                        requestAnimationFrame(() => first.current?.focus());
                      }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div {...appRow}>
                    <input ref={first} value={appQ} onChange={(e) => setAppQ(e.target.value)} placeholder="Add candidate" aria-label="Search candidates" autoComplete="off" className={quietField} />
                    {appOpen ? (
                      <ul aria-label="Candidates" onMouseDown={keepFocus} title={choices.truncated ? "The most recently active candidates" : undefined} className={cn(pickList, "mt-1", quickListH)}>
                        {apps.map((a) => (
                          <li key={a.applicationId}>
                            <button
                              type="button"
                              className={pickRow}
                              onClick={() => {
                                pickApp(a.applicationId);
                                // Who interviews is what is left: its row opens.
                                ivSearch.current?.focus();
                              }}
                            >
                              <span className="flex min-w-0 flex-1 gap-2.5">
                                <span className="max-w-full shrink-0 truncate">{a.candidate}</span>
                                <span className="truncate text-muted-foreground">{a.jobTitle}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                        {!apps.length ? <li className="px-2.5 py-1.5 text-[13px] text-muted-foreground">{choices.truncated ? "No match among the most recently active candidates." : "No match."}</li> : null}
                      </ul>
                    ) : null}
                  </div>
                )}
              </QuickRow>

              <QuickRow icon="team" label="Interviewers">
                <div {...ivRow}>
                  {/* The picked as chips, then the search, in one box that lights as a field does; a press on its blank part goes to the search. */}
                  <div
                    onMouseDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      e.preventDefault();
                      ivSearch.current?.focus();
                    }}
                    className={cn(quietBox, "flex min-h-9 cursor-text flex-wrap items-center gap-1.5 py-1 px-2.5")}
                  >
                    {picked.map((p) => (
                      <span key={p.actorId} className="inline-flex h-7 items-center gap-0.5 rounded-[6px] bg-[color:var(--soft-strong)] pr-0.5 pl-2 text-[12.5px]">
                        {p.name}
                        <button type="button" onClick={() => toggleInterviewer(p.actorId)} aria-label={`Remove ${p.name}`} title="Remove" className="grid size-6 place-items-center rounded-[5px] text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground">
                          <RowIcon name="close" className="size-3" />
                        </button>
                      </span>
                    ))}
                    <input
                      ref={ivSearch}
                      value={ivQ}
                      onChange={(e) => setIvQ(e.target.value)}
                      placeholder={picked.length ? "Add another" : "Add interviewers"}
                      aria-label="Search teammates"
                      autoComplete="off"
                      className="h-7 min-w-[110px] flex-1 border-0 bg-transparent p-0 text-[13px] text-foreground outline-none placeholder:text-faint"
                    />
                  </div>
                  {ivOpen ? (
                    <ul aria-label="Interviewers" onMouseDown={keepFocus} className={cn(pickList, "mt-1", quickListH)}>
                      {people.map((p) => {
                        const on = interviewerIds.includes(p.actorId);
                        return (
                          <li key={p.actorId}>
                            <label className={cn(pickRow, "cursor-pointer")}>
                              <input type="checkbox" checked={on} disabled={!on && interviewerIds.length >= 10} onChange={() => toggleInterviewer(p.actorId)} />
                              <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            </label>
                          </li>
                        );
                      })}
                      {!people.length ? <li className="px-2.5 py-1.5 text-[13px] text-muted-foreground">No match.</li> : null}
                    </ul>
                  ) : null}
                </div>
              </QuickRow>

              {app ? (
                <QuickRow icon="route" label="Step">
                  {steps.length ? (
                    // Without the browser's own arrow and inset, so the words sit on the text column; the chevron is drawn in the row icons' line.
                    <div className="relative">
                      <select value={step} onChange={(e) => setStep(e.target.value)} aria-label="Step" className={cn(quietField, "cursor-pointer appearance-none pr-9", !step && "text-faint")}>
                        <option value="">Choose a step</option>
                        {steps.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <RowIcon name="chevron" className="pointer-events-none absolute top-2.5 right-2.5 text-faint" />
                    </div>
                  ) : (
                    <input value={step} onChange={(e) => setStep(e.target.value)} maxLength={120} placeholder="Add a step" aria-label="Step" className={quietField} />
                  )}
                </QuickRow>
              ) : null}

              <QuickRow icon="video" label="Where">
                <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={500} placeholder="Google Meet, or a room or link" aria-label="Where" title="Left empty, a calendar invite gets a Google Meet link" className={quietField} />
              </QuickRow>
            </>
          )}
          {error ? (
            <div className="pt-1 pl-9">
              <Err>{error}</Err>
            </div>
          ) : null}
        </div>
        <Foot>
          <button type="button" onClick={widen} disabled={pending} className={buttonVariants({ variant: "ghost" })}>
            More options
          </button>
          <button type="button" onClick={() => void onReview()} disabled={pending || !ready} title="Nothing is booked until you confirm" className={primary}>
            {pending ? "Checking…" : "Book"}
          </button>
        </Foot>
      </>
    );
  }

  return (
    <>
      <Head id="schedule-dialog-title" title={next ? (app ? `Next round for ${app.candidate}` : "Next round") : flow.find ? "Find a time" : "Book an interview"} />
      <div className={cn("grid gap-4 overflow-y-auto pt-3 pb-5", sides)}>
        {!choices ? (
          <FormSkeleton />
        ) : choices.failed ? (
          <Err>Could not read who can be booked. Try again.</Err>
        ) : !choices.applications.length ? (
          <p className="m-0 text-[13px] text-muted-foreground">Nobody in process on a job you schedule for.</p>
        ) : (
          <>
            {missing && !app ? (
              <p className={amberNote}>
                They aren&apos;t someone you can book for here: their application has closed, or you don&apos;t schedule for that job. Pick who to book.
              </p>
            ) : null}
            <fieldset className="m-0 grid gap-1.5 border-0 p-0">
              <legend className={legend}>Candidate</legend>
              {app ? (
                <div className="flex min-h-9 items-center gap-3 rounded-[8px] bg-[color:var(--paper)] py-1 pr-1.5 pl-3 text-[13px] shadow-[inset_0_0_0_1px_var(--line)]">
                  <span className="flex min-w-0 flex-1 gap-2.5">
                    <span className="max-w-full shrink-0 truncate font-medium">{app.candidate}</span>
                    <span className="truncate text-muted-foreground">{app.jobTitle}</span>
                  </span>
                  <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => pickApp(null)}>
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <Input ref={first} value={appQ} onChange={(e) => setAppQ(e.target.value)} placeholder="Search by name or job" aria-label="Search candidates" autoComplete="off" />
                  {/* A list cut short says so on hover, and when a search finds nobody, not in a line under it. */}
                  <ul aria-label="Candidates" title={choices.truncated ? "The most recently active candidates" : undefined} className={cn(pickList, appListH)}>
                    {apps.map((a) => (
                      <li key={a.applicationId}>
                        <button type="button" className={pickRow} onClick={() => pickApp(a.applicationId)}>
                          {/* The name whole; the job gives way first. */}
                          <span className="flex min-w-0 flex-1 gap-2.5">
                            <span className="max-w-full shrink-0 truncate">{a.candidate}</span>
                            <span className="truncate text-muted-foreground">{a.jobTitle}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                    {!apps.length ? <li className="px-2.5 py-1.5 text-[13px] text-muted-foreground">{choices.truncated ? "No match among the most recently active candidates." : "No match."}</li> : null}
                  </ul>
                </>
              )}
            </fieldset>

            <fieldset className="m-0 grid gap-1.5 border-0 p-0">
              <legend className={legend}>Interviewers</legend>
              <Input ref={ivSearch} value={ivQ} onChange={(e) => setIvQ(e.target.value)} placeholder="Search teammates" aria-label="Search teammates" autoComplete="off" />
              <ul aria-label="Interviewers" className={cn(pickList, peopleListH)}>
                {people.map((p) => {
                  const on = interviewerIds.includes(p.actorId);
                  return (
                    <li key={p.actorId}>
                      <label className={cn(pickRow, "cursor-pointer")}>
                        <input type="checkbox" checked={on} disabled={!on && interviewerIds.length >= 10} onChange={() => toggleInterviewer(p.actorId)} />
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>

            {app ? (
              <label className={label}>
                Step
                {steps.length ? (
                  <select value={step} onChange={(e) => setStep(e.target.value)} className={cn(selectClass, "text-foreground")}>
                    <option value="">Choose a step</option>
                    {steps.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input value={step} onChange={(e) => setStep(e.target.value)} maxLength={120} placeholder="Optional, such as Technical screen" className="text-foreground" />
                )}
              </label>
            ) : null}

            <div role="group" aria-label="Length" className={cn(pillTrack, "self-start")}>
              {[...new Set([...DURATIONS, length])].sort((a, b) => a - b).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={length === m}
                  onClick={() => {
                    setLength(m);
                    setFound(null);
                  }}
                  className={cn(pillOption(length === m), "h-7 font-mono text-[12.5px]")}
                >
                  {m} min
                </button>
              ))}
            </div>

            {flow.find ? (
              found ? (
                <Slots found={found} timeZone={timeZone} pick={pickSlot} picked={pickedAt} />
              ) : null
            ) : (
              <WhenFields day={day} time={time} setDay={setDay} setTime={setTime} end={at ? clock12(at.endsAt, timeZone) : null} timeZone={timeZone} />
            )}

            <label className={label}>
              Where
              <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={500} placeholder="A room or a link. Empty gets a Meet link" className="text-foreground" />
            </label>
          </>
        )}
        {error ? <Err>{error}</Err> : null}
      </div>
      <Foot>
        {flow.find ? (
          <button
            type="button"
            onClick={() => void onFind()}
            disabled={pending || !ready}
            title="Picks from the times every interviewer is free, in the next two weeks. Nothing is booked until you confirm."
            className={primary}
          >
            {pending ? "Reading calendars…" : found ? "Look again" : "Find times"}
          </button>
        ) : (
          <button type="button" onClick={() => void onReview()} disabled={pending || !ready} title="Nothing is booked until you confirm" className={primary}>
            {pending ? "Checking…" : "Review"}
          </button>
        )}
      </Foot>
    </>
  );
}

function EventCard({ event, timeZone, go }: { event: CalendarEventRef; timeZone: string; go: (f: Flow) => void }) {
  const open = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => open.current?.focus(), []);
  return (
    <>
      <Head id="schedule-dialog-title" title={`${event.candidate}, ${event.step}`} />
      <div className={cn("grid justify-items-start gap-2 pt-3 pb-5 text-[13px]", sides)}>
        <p className="m-0 flex flex-wrap items-baseline gap-x-2.5">
          <span className="font-medium break-words tabular-nums">{whenWords(event.startsAt, event.endsAt, timeZone)}</span>
          <Zone timeZone={timeZone} />
        </p>
        <p className="m-0 break-words text-muted-foreground">{event.job}</p>
        {event.interviewers.length ? <p className="m-0 break-words">With {event.interviewers.join(", ")}</p> : null}
        {event.location ? (
          event.locationHref ? (
            <a href={event.locationHref} target="_blank" rel="noopener noreferrer" className={cn(textLink, "text-[13px] break-all")}>
              {event.location}
            </a>
          ) : (
            <p className="m-0 break-words">{event.location}</p>
          )
        ) : null}
        {event.eventLink ? (
          <a href={event.eventLink} target="_blank" rel="noopener noreferrer" className={cn(textLink, "text-[13px]")}>
            Open in Google Calendar
          </a>
        ) : null}
      </div>
      <Foot
        lead={
          <Link href={event.href} className={plain}>
            Open interview
          </Link>
        }
      >
        <button type="button" onClick={() => go({ kind: "cancel", event })} className={plain}>
          Cancel interview
        </button>
        <button ref={open} type="button" onClick={() => go({ kind: "move", event })} className={primary}>
          Reschedule
        </button>
      </Foot>
    </>
  );
}

function MoveForm({ event, timeZone, now, confirm, back, setBusy }: { event: CalendarEventRef; timeZone: string; now: number; confirm: (c: Confirming) => void; back: () => void; setBusy: (b: boolean) => void }) {
  const was = zoned(event.startsAt, timeZone);
  const length = Math.round((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000);
  const [day, setDay] = React.useState<Ymd>(was.day);
  const [time, setTime] = React.useState(hhmm(was.minutes));
  const [found, setFound] = React.useState<FoundTimes | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const review = async (startsAt: string, endsAt: string) => {
    if (pending) return;
    setPending(true);
    setBusy(true);
    setError(null);
    const request: MoveRequest = { op: "move", confirmed: false, interviewId: event.id, startsAt, endsAt, timezone: timeZone, bookDespiteConflicts: false, recordOnly: false, was: event.startsAt };
    const answer = await ask(request);
    setPending(false);
    setBusy(false);
    if (!answer.ok) return setError(answer.message);
    if (answer.kind === "unchanged") return setError("That is when it already is.");
    if (answer.kind === "change_preview") confirm(changeConfirm(request, answer, event, timeZone));
  };

  const onFind = async () => {
    if (pending || !event.interviewerIds.length) return;
    setPending(true);
    setBusy(true);
    setError(null);
    const answer = await ask({
      op: "find",
      interviewerIds: event.interviewerIds,
      durationMinutes: length,
      windowStart: new Date(now).toISOString(),
      windowEnd: new Date(now + FIND_DAYS * 86_400_000).toISOString(),
      timezone: timeZone,
      applicationId: event.applicationId,
    });
    setPending(false);
    setBusy(false);
    if (!answer.ok) return setError(answer.message);
    if (answer.kind === "times") setFound(answer.found);
  };

  const at = spanAt(day, minutesOf(time), length, timeZone);
  return (
    <>
      <Head id="schedule-dialog-title" title="Reschedule" />
      <div className={cn("grid gap-4 overflow-y-auto pt-3 pb-5", sides)}>
        <div className="grid gap-1 text-[13px]">
          <When>
            {event.candidate}, {event.step}
          </When>
          <p className="m-0 break-words text-muted-foreground tabular-nums">Now {whenWords(event.startsAt, event.endsAt, timeZone)}</p>
        </div>
        <WhenFields day={day} time={time} setDay={setDay} setTime={setTime} min={todayIn(timeZone, now)} end={at ? clock12(at.endsAt, timeZone) : null} timeZone={timeZone} />
        {found ? <Slots found={found} timeZone={timeZone} pick={(s, e) => void review(s, e)} /> : null}
        {error ? <Err>{error}</Err> : null}
      </div>
      <Foot>
        <button type="button" onClick={back} disabled={pending} className={plain}>
          Back
        </button>
        {event.interviewerIds.length ? (
          <button type="button" onClick={() => void onFind()} disabled={pending} title="The times everyone on it is free, in the next two weeks" className={plain}>
            {found ? "Look again" : "Free times"}
          </button>
        ) : null}
        <button type="button" onClick={() => at && void review(at.startsAt, at.endsAt)} disabled={pending || !at} title="Nothing moves until you confirm" className={primary}>
          {pending ? "Checking…" : "Review"}
        </button>
      </Foot>
    </>
  );
}

/** Reads the dry run for a cancel, or a move a drag already picked, then hands over to the Confirm card. */
function Previewing({ request, event, timeZone, confirm, back, setBusy }: { request: MoveRequest | CancelRequest; event: CalendarEventRef; timeZone: string; confirm: (c: Confirming) => void; back: () => void; setBusy: (b: boolean) => void }) {
  const [error, setError] = React.useState<string | null>(null);
  // In a ref, so a parent's redraw does not read it twice.
  const asked = React.useRef(false);
  // Back is pressable while it reads: an answer after that opens no Confirm card.
  const here = React.useRef(true);
  React.useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);
  React.useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    setBusy(true);
    void ask(request).then((answer) => {
      setBusy(false);
      if (!here.current) return;
      if (!answer.ok) return setError(answer.message);
      if (answer.kind === "change_preview") return confirm(changeConfirm(request, answer, event, timeZone));
      setError("That is when it already is.");
    });
  }, [request, event, timeZone, confirm, setBusy]);
  return (
    <>
      <Head id="schedule-dialog-title" title={request.op === "move" ? `Move ${event.candidate}'s ${event.step}` : `Cancel ${event.candidate}'s ${event.step}`} />
      <div className={cn("pt-3 pb-5 text-[13px] text-muted-foreground", sides)}>{error ? <Err>{error}</Err> : <span aria-busy>Checking the calendars…</span>}</div>
      <Foot>
        <button type="button" onClick={back} className={plain}>
          Back
        </button>
      </Foot>
    </>
  );
}

/**
 * The Confirm card over a form. The form stays mounted behind it, hidden: Back
 * returns to what was filled in, and a booking keeps its one id, so a retry
 * after a lost answer finds the booking rather than making a second. First in
 * the tree, so the dialog's title is the card's while it shows.
 */
export function Panels({ card, form, other }: { card: React.ReactNode; form: React.ReactNode; other: React.ReactNode }) {
  return (
    <>
      {card}
      {form ? <div className={cn("min-h-0 flex-col", card ? "hidden" : "flex")}>{form}</div> : null}
      {card ? null : other}
    </>
  );
}

/** How far the quick popover keeps inside the app's box, and from its slot. */
const POP_EDGE = 12;
const POP_GAP = 10;
/** Over a day's wide slot, the room kept clear at its left, where the slot says "New interview" and its time on one line ("New interview 11:45 AM – 12:45 PM"). */
const POP_LABEL_ROOM = 260;

type Room = { left: number; top: number; right: number; bottom: number };
type Place = { left: number; top: number; maxHeight: number };

/**
 * The room the quick popover has: the app's rounded box (the shell's
 * `.tb-box`) less a margin, so it never hangs past the box into the sky, nor
 * past the window; the window itself where there is no box (a phone).
 */
function popRoom(): Room {
  const box = document.querySelector(".tb-box")?.getBoundingClientRect();
  const b = box && box.width > 0 && box.height > 0 ? box : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  return {
    left: Math.max(0, b.left) + POP_EDGE,
    top: Math.max(0, b.top) + POP_EDGE,
    right: Math.min(innerWidth, b.right) - POP_EDGE,
    bottom: Math.min(innerHeight, b.bottom) - POP_EDGE,
  };
}

const keepIn = (r: Room, p: { left: number; top: number }, w: number, h: number): Place => ({
  left: Math.max(r.left, Math.min(p.left, r.right - w)),
  top: Math.max(r.top, Math.min(p.top, r.bottom - h)),
  maxHeight: r.bottom - r.top,
});

/**
 * Which side of its slot the popover takes, Google Calendar's way: beside it,
 * to the right, else the left; a slot too wide for either (a day's column)
 * puts it below, else above; with no room anywhere clear of the slot, it sits
 * over the slot's right part, the slot's own words left in view.
 */
type Side = "right" | "left" | "below" | "above" | "over";
function sideFor(a: Anchor, w: number, h: number, r: Room): Side {
  if (a.right + POP_GAP + w <= r.right) return "right";
  if (a.left - POP_GAP - w >= r.left) return "left";
  if (a.bottom + POP_GAP + h <= r.bottom) return "below";
  if (a.top - POP_GAP - h >= r.top) return "above";
  return "over";
}

/** On its side, level with the slot's top beside it, centred on the press above or below it; then kept in the room. */
function placeOn(side: Side, a: Anchor, w: number, h: number, r: Room): Place {
  const level = a.top - 8;
  const centred = a.x - w / 2;
  const at =
    side === "right" ? { left: a.right + POP_GAP, top: level }
    : side === "left" ? { left: a.left - POP_GAP - w, top: level }
    : side === "below" ? { left: centred, top: a.bottom + POP_GAP }
    : side === "above" ? { left: centred, top: a.top - POP_GAP - h }
    : { left: Math.max(a.left + POP_LABEL_ROOM, a.x + POP_GAP), top: level };
  return keepIn(r, at, w, h);
}
const closeBtn = "grid size-8 place-items-center rounded-[8px] text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground";

/** The dialog: whichever card the flow is on, and its Confirm card once a dry run is back. */
export function ScheduleDialog({ flow, timeZone, now, go, close, done }: { flow: Flow; timeZone: string; now: number; go: (f: Flow) => void; close: () => void; done: (sentence: string) => void }) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [confirming, setConfirming] = React.useState<Confirming | null>(null);
  // Esc or the backdrop mid-write would hide a change that is still happening.
  const busy = React.useRef(false);
  const setBusy = React.useCallback((b: boolean) => {
    busy.current = b;
  }, []);

  // Opened before anything measures it, so the quick popover can be placed before it paints. Focus starts on the
  // box itself rather than on Close, which would light up while the form loads; each card then moves it to its
  // first field or button.
  React.useLayoutEffect(() => {
    const d = dialog.current;
    if (d && !d.open) {
      d.showModal();
      d.focus();
    }
  }, []);

  // A book flow from a slot on the grid opens beside it, Google Calendar's quick-create (sideFor, placeOn), kept
  // inside the app's box. The side is chosen once, as it opens, so the popover does not hop from one side to the
  // other as its lists open and close; it only slides to stay in the box. Moved by its handle, or once the
  // window changes size (the slot is elsewhere then), it stays where it is, still kept in the box.
  const anchor = flow.kind === "book" && !flow.find ? (flow.anchor ?? null) : null;
  const [place, setPlace] = React.useState<Place | null>(null);
  const moved = React.useRef(false);
  const side = React.useRef<Side | null>(null);
  React.useLayoutEffect(() => {
    const d = dialog.current;
    moved.current = false;
    side.current = null;
    if (!d || !anchor) {
      setPlace(null);
      return;
    }
    const fit = () => {
      const { offsetWidth: w, offsetHeight: h } = d;
      const r = popRoom();
      if (moved.current) return setPlace((was) => (was ? keepIn(r, was, w, h) : was));
      side.current ??= sideFor(anchor, w, h, r);
      setPlace(placeOn(side.current, anchor, w, h, r));
    };
    const resized = () => {
      moved.current = true;
      fit();
    };
    fit();
    // Its height changes as its lists open and close: placed again before that frame paints (flushSync), so no
    // frame shows it where the old height put it, past the box's edge.
    const seen = new ResizeObserver(() => flushSync(fit));
    seen.observe(d);
    window.addEventListener("resize", resized);
    return () => {
      seen.disconnect();
      window.removeEventListener("resize", resized);
    };
  }, [anchor]);
  /** The handle: the popover follows the pointer until it lifts, kept inside the app's box. */
  const drag = (down: React.PointerEvent<HTMLElement>) => {
    const d = dialog.current;
    if (down.button !== 0 || !d || !place) return;
    down.preventDefault();
    const from = { x: down.clientX, y: down.clientY, ...place };
    const r = popRoom();
    const onMove = (m: PointerEvent) => {
      moved.current = true;
      setPlace(keepIn(r, { left: from.left + m.clientX - from.x, top: from.top + m.clientY - from.y }, d.offsetWidth, d.offsetHeight));
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const finish = (sentence: string) => {
    done(sentence);
    close();
    router.refresh();
  };
  const dismiss = () => {
    if (!busy.current) close();
  };
  const backToEvent = "event" in flow ? () => (setConfirming(null), go({ kind: "event", event: flow.event })) : close;

  return (
    <dialog
      ref={dialog}
      aria-labelledby="schedule-dialog-title"
      tabIndex={-1}
      onClose={close}
      onCancel={(e) => {
        if (busy.current) e.preventDefault();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
      data-quick={anchor ? "" : undefined}
      style={anchor && place ? { margin: 0, left: place.left, top: place.top, right: "auto", bottom: "auto", maxHeight: place.maxHeight } : undefined}
      className={cn(
        "group/dlg relative overflow-hidden border-0 p-0 text-foreground outline-none open:flex open:flex-col",
        anchor
          ? // The quick-create: Testbench's dialog (16px corners, the box surface, its soft shadow) over the grid, with
            // no scrim, so the slot stays in view behind it. Wide enough for the date and both times on one line.
            "max-h-[calc(100vh-24px)] w-[min(480px,calc(100vw-24px))] rounded-[16px] bg-[color:var(--surface)] shadow-[var(--box-shadow)] backdrop:bg-transparent"
          : "m-auto max-h-[calc(100vh-40px)] w-[min(500px,calc(100vw-32px))] rounded-[16px] bg-[color:var(--surface)] shadow-[var(--box-shadow)] backdrop:bg-[color:var(--scrim)]",
      )}
    >
      {anchor ? (
        // Google's top line: the handle at the left, over the icon column, and Close at the right.
        <div className="flex h-11 flex-none items-center justify-between pr-3 pl-3">
          <span
            aria-hidden
            onPointerDown={drag}
            title="Drag to move"
            className="grid size-8 cursor-grab touch-none place-items-center rounded-[8px] text-faint transition-colors hover:bg-[color:var(--hover)] hover:text-muted-foreground active:cursor-grabbing"
          >
            <RowIcon name="grip" />
          </span>
          <button type="button" onClick={dismiss} aria-label="Close" title="Close (Esc)" className={closeBtn}>
            <RowIcon name="close" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={dismiss} aria-label="Close" title="Close (Esc)" className={cn(closeBtn, "absolute top-[18px] right-4 z-[1]")}>
          <RowIcon name="close" />
        </button>
      )}
      <Panels
        card={
          confirming ? (
            <ConfirmCard
              c={confirming}
              back={() => (flow.kind === "cancel" || (flow.kind === "move" && flow.to) ? backToEvent() : setConfirming(null))}
              backLabel={flow.kind === "cancel" ? "Keep it" : "Back"}
              done={finish}
              setBusy={setBusy}
              reread={() => router.refresh()}
            />
          ) : null
        }
        form={
          flow.kind === "book" ? (
            <BookForm flow={flow} timeZone={timeZone} now={now} confirm={setConfirming} setBusy={setBusy} go={go} />
          ) : flow.kind === "move" && !flow.to ? (
            <MoveForm event={flow.event} timeZone={timeZone} now={now} confirm={setConfirming} back={backToEvent} setBusy={setBusy} />
          ) : null
        }
        other={
          flow.kind === "event" ? (
            <EventCard event={flow.event} timeZone={timeZone} go={go} />
          ) : flow.kind === "cancel" || (flow.kind === "move" && flow.to) ? (
            <Previewing
              request={
                flow.kind === "move"
                  ? { op: "move", confirmed: false, interviewId: flow.event.id, startsAt: flow.to!.startsAt, endsAt: flow.to!.endsAt, timezone: timeZone, bookDespiteConflicts: false, recordOnly: false, was: flow.event.startsAt }
                  : { op: "cancel", confirmed: false, interviewId: flow.event.id, timezone: timeZone, recordOnly: false, was: flow.event.startsAt }
              }
              event={flow.event}
              timeZone={timeZone}
              confirm={setConfirming}
              back={backToEvent}
              setBusy={setBusy}
            />
          ) : null
        }
      />
    </dialog>
  );
}
