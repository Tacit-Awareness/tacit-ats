"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Avatar } from "@/components/page";
import { SNAP_MINUTES, spanAt, todayIn, zoned, type Ymd } from "@/lib/client/schedule-layout";
import type { ApplicationChoice, BookingChoices } from "@/lib/client/schedule-choices";
import { bookLines, changeLines, conflictLines, doneSentence } from "@/lib/client/schedule-copy";
import {
  COULD_NOT_FINISH, SCHEDULE_API, SIGNED_OUT,
  type BookRequest, type CancelRequest, type FoundTimes, type MoveRequest, type ScheduleAnswer, type ScheduleRequest,
} from "@/lib/client/schedule-requests";
import { cn } from "@/lib/utils";
import { bookingChoicesAction } from "./actions";

// The Calendar's book, move, cancel and Find a time, design/tats's popover as
// one native <dialog>, modal, so keys.ts stops every page and shell key behind
// it. Nothing that changes a real calendar happens without its Confirm card:
// the card shows core's dry run, who holds the event and who hears from Google,
// and only its button sends `confirmed`. A clash found by the dry run, or by
// the write itself, turns the button into "anyway", pressed on purpose. All of
// it goes to the one route that can reach calendar grants (SCHEDULE_API); the
// choices are read when a dialog opens. Times are the browser's zone, as on the
// grid.

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

export type Flow =
  | { kind: "book"; find: boolean; at?: { day: Ymd; minutes: number; length: number } }
  | { kind: "event"; event: CalendarEventRef }
  | { kind: "move"; event: CalendarEventRef; to?: { startsAt: string; endsAt: string } }
  | { kind: "cancel"; event: CalendarEventRef };

const DURATIONS = [30, 45, 60, 90];
const FIND_DAYS = 14;
/** Keeps a date field's year to four digits, as far as the browser will. `spanAt` holds the rest. */
const LAST_DAY = "2200-12-31";

const field =
  "w-full rounded-lg border border-[color:var(--line-strong)] bg-transparent px-2.5 py-1.5 text-[13px] text-foreground outline-none focus-visible:border-[color:var(--accent)] disabled:opacity-60";
const button = "inline-flex h-[34px] items-center justify-center gap-1.5 rounded-[17px] border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50";
const plain = "border-[color:var(--line-strong)] bg-[color:var(--paper)] text-foreground hover:bg-[color:var(--hover)]";
const primary = "border-transparent bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:brightness-105";
const danger = "border-[color:var(--red)] bg-[color:var(--red)] text-white hover:brightness-105";
const pickRow = "flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[color:var(--hover)]";

async function ask(request: ScheduleRequest): Promise<ScheduleAnswer> {
  try {
    // Manual: a session that ended redirects to WorkOS, which a fetch cannot follow.
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
const clockOf = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat(undefined, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const whenWords = (startsAt: string, endsAt: string, timeZone: string) =>
  `${dateWords(startsAt, timeZone)}, ${clockOf(startsAt, timeZone)} – ${clockOf(endsAt, timeZone)}`;
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const minutesOf = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

function Err({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="m-0 mt-3 rounded-lg bg-[color:var(--red-soft)] px-3 py-2 text-[13px] break-words text-[color:var(--red)]">
      {children}
    </p>
  );
}

function Foot({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-[color:var(--line)] bg-[color:var(--soft)] px-3.5 py-3">
      {note ? <span className="w-full text-[12px] text-faint">{note}</span> : null}
      {children}
    </div>
  );
}

function Head({ title, sub, id }: { title: string; sub?: string; id: string }) {
  return (
    <header className="pt-4 pr-11 pl-5">
      <h2 id={id} className="m-0 text-[17px] font-medium tracking-[-0.012em] break-words">
        {title}
      </h2>
      {sub ? <p className="m-0 mt-1 text-[13px] break-words text-muted-foreground">{sub}</p> : null}
    </header>
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
      <Head id="schedule-dialog-title" title={state.title} sub={state.when} />
      <div className="mt-3 grid gap-1.5 overflow-y-auto px-5 pb-4 text-[13px]">
        {state.lines.map((l) => (
          <p key={l} className="m-0 break-words">
            {l}
          </p>
        ))}
        {state.warned.map((l) => (
          <p key={l} className="m-0 rounded-lg bg-[color:var(--amber-soft)] px-3 py-2 break-words text-foreground">
            {l}
          </p>
        ))}
        {error ? <Err>{error}</Err> : null}
      </div>
      <Foot note="⌘↵ to confirm">
        <button type="button" onClick={back} disabled={pending} className={cn(button, plain)}>
          {backLabel}
        </button>
        <button ref={button_} type="button" onClick={() => void send()} disabled={pending} className={cn(button, state.danger ? danger : primary)}>
          {pending ? "Working…" : state.confirm}
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

function Slots({ found, timeZone, pick, picked }: { found: FoundTimes; timeZone: string; pick: (startsAt: string, endsAt: string) => void; picked?: string | null }) {
  return (
    <div className="grid gap-1.5">
      {found.unknown.map((u) => (
        <p key={u.name} className="m-0 rounded-lg bg-[color:var(--amber-soft)] px-3 py-2 text-[12.5px] break-words">
          Not checked: {u.name} {u.why}.
        </p>
      ))}
      {found.slots.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">Nobody checked is free for that long in the next two weeks, in working hours.</p>
      ) : (
        <ul aria-label="Free times" className="m-0 grid max-h-[220px] list-none gap-1.5 overflow-y-auto p-0">
          {found.slots.map((s) => (
            <li key={s.startsAt}>
              <button
                type="button"
                onClick={() => pick(s.startsAt, s.endsAt)}
                aria-pressed={picked === s.startsAt}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[10px] border px-3.5 py-2.5 text-left text-[13px] transition-colors hover:bg-[color:var(--soft)]",
                  picked === s.startsAt ? "border-[color:var(--accent)]" : "border-[color:var(--line)] hover:border-[color:var(--line-strong)]",
                )}
              >
                <b className="flex-1 font-medium">{dateWords(s.startsAt, timeZone)}</b>
                <span className="text-muted-foreground tabular-nums">
                  {clockOf(s.startsAt, timeZone)} – {clockOf(s.endsAt, timeZone)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BookForm({ flow, timeZone, now, confirm, setBusy }: { flow: Extract<Flow, { kind: "book" }>; timeZone: string; now: number; confirm: (c: Confirming) => void; setBusy: (b: boolean) => void }) {
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
  // One per dialog: a retry of a booking that went through finds it, rather than booking twice.
  const [interviewId] = React.useState(() => globalThis.crypto.randomUUID());
  const first = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    let live = true;
    void bookingChoicesAction().then(
      (c) => {
        if (live) setChoices(c);
      },
      () => {
        if (live) setChoices({ applications: [], interviewers: [], truncated: false, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  React.useEffect(() => first.current?.focus(), [choices]);

  const app = choices?.applications.find((a) => a.applicationId === applicationId) ?? null;
  const steps = app?.steps ?? [];
  const match = (text: string, q: string) => text.toLowerCase().includes(q.trim().toLowerCase());
  const apps = (choices?.applications ?? []).filter((a) => match(`${a.candidate} ${a.jobTitle}`, appQ)).slice(0, 50);
  const people = (choices?.interviewers ?? []).filter((p) => interviewerIds.includes(p.actorId) || match(p.name, ivQ)).slice(0, 50);

  const at = spanAt(day, minutesOf(time), length, timeZone);
  const ready = !!app && interviewerIds.length > 0 && (!steps.length || !!step) && !!at && !!time;

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

  return (
    <>
      <Head
        id="schedule-dialog-title"
        title={flow.find ? "Find a time" : "Book an interview"}
        sub={flow.find ? "Picks from the times every interviewer is free, in the next two weeks." : `Times are in ${timeZone.replace(/_/g, " ")}.`}
      />
      <div className="grid gap-3 overflow-y-auto px-5 pt-3 pb-4">
        {!choices ? (
          <p className="m-0 text-[13px] text-muted-foreground" aria-busy>
            Loading…
          </p>
        ) : choices.failed ? (
          <Err>Could not read who can be booked. Try again.</Err>
        ) : !choices.applications.length ? (
          <p className="m-0 text-[13px] text-muted-foreground">Nobody in process on a job you schedule for.</p>
        ) : (
          <>
            <fieldset className="m-0 grid gap-1.5 border-0 p-0">
              <legend className="mb-1 p-0 text-[12.5px] text-muted-foreground">Candidate</legend>
              {app ? (
                <div className="flex items-center gap-2.5 text-[13px]">
                  <Avatar name={app.candidate} candidate />
                  <span className="min-w-0 flex-1 truncate">
                    {app.candidate} <span className="text-muted-foreground">· {app.jobTitle}</span>
                  </span>
                  <button type="button" className="text-[12.5px] text-muted-foreground underline" onClick={() => { setApplicationId(null); setStep(""); setFound(null); }}>
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input ref={first} value={appQ} onChange={(e) => setAppQ(e.target.value)} placeholder="Search by name or job" aria-label="Search candidates" className={field} autoComplete="off" />
                  <ul aria-label="Candidates" className="m-0 grid max-h-[176px] list-none overflow-y-auto p-0">
                    {apps.map((a) => (
                      <li key={a.applicationId}>
                        <button type="button" className={pickRow} onClick={() => { setApplicationId(a.applicationId); setStep(""); setFound(null); }}>
                          <Avatar name={a.candidate} candidate />
                          <span className="min-w-0 flex-1 truncate">
                            {a.candidate} <span className="text-muted-foreground">· {a.jobTitle}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                    {!apps.length ? <li className="px-2 py-1.5 text-[13px] text-muted-foreground">No match.</li> : null}
                  </ul>
                  {choices.truncated ? <p className="m-0 text-[12px] text-faint">Showing the most recently active candidates.</p> : null}
                </>
              )}
            </fieldset>

            <fieldset className="m-0 grid gap-1.5 border-0 p-0">
              <legend className="mb-1 p-0 text-[12.5px] text-muted-foreground">Interviewers</legend>
              <input value={ivQ} onChange={(e) => setIvQ(e.target.value)} placeholder="Search teammates" aria-label="Search teammates" className={field} autoComplete="off" />
              <ul aria-label="Interviewers" className="m-0 grid max-h-[148px] list-none overflow-y-auto p-0">
                {people.map((p) => {
                  const on = interviewerIds.includes(p.actorId);
                  return (
                    <li key={p.actorId}>
                      <label className={cn(pickRow, "cursor-pointer")}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!on && interviewerIds.length >= 10}
                          onChange={() => {
                            setFound(null);
                            setInterviewerIds((ids) => (on ? ids.filter((id) => id !== p.actorId) : [...ids, p.actorId]));
                          }}
                        />
                        <Avatar name={p.name} />
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>

            {app ? (
              <label className="grid gap-1 text-[12.5px] text-muted-foreground">
                Step
                {steps.length ? (
                  <select value={step} onChange={(e) => setStep(e.target.value)} className={field}>
                    <option value="">Choose a step</option>
                    {steps.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={step} onChange={(e) => setStep(e.target.value)} maxLength={120} placeholder="Optional, such as Technical screen" className={field} />
                )}
              </label>
            ) : null}

            <div role="group" aria-label="Length" className="flex flex-wrap gap-1.5">
              {[...new Set([...DURATIONS, length])].sort((a, b) => a - b).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={length === m}
                  onClick={() => {
                    setLength(m);
                    setFound(null);
                  }}
                  className={cn("h-7 rounded-2xl border px-3 text-[12.5px]", length === m ? "border-transparent bg-[color:var(--soft-strong)] font-medium" : "border-[color:var(--line-strong)] hover:bg-[color:var(--hover)]")}
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
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[12.5px] text-muted-foreground">
                  Date
                  <input type="date" value={day} max={LAST_DAY} onChange={(e) => e.target.value && setDay(e.target.value)} className={field} />
                </label>
                <label className="grid gap-1 text-[12.5px] text-muted-foreground">
                  Starts
                  <input type="time" step={SNAP_MINUTES * 60} value={time} onChange={(e) => e.target.value && setTime(e.target.value)} className={field} />
                </label>
              </div>
            )}

            <label className="grid gap-1 text-[12.5px] text-muted-foreground">
              Where
              <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={500} placeholder="A room or a link. Empty gets a Meet link" className={field} />
            </label>
          </>
        )}
        {error ? <Err>{error}</Err> : null}
      </div>
      <Foot note="Nothing is booked until you confirm">
        {flow.find ? (
          <button type="button" onClick={() => void onFind()} disabled={pending || !ready} className={cn(button, primary)}>
            {pending ? "Reading calendars…" : found ? "Look again" : "Find times"}
          </button>
        ) : (
          <button type="button" onClick={() => void onReview()} disabled={pending || !ready} className={cn(button, primary)}>
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
      <Head id="schedule-dialog-title" title={`${event.candidate}, ${event.step}`} sub={whenWords(event.startsAt, event.endsAt, timeZone)} />
      <div className="grid gap-1.5 px-5 pt-2 pb-4 text-[13px]">
        <p className="m-0 break-words text-muted-foreground">{event.job}</p>
        {event.interviewers.length ? <p className="m-0 break-words">With {event.interviewers.join(", ")}</p> : null}
        {event.location ? (
          event.locationHref ? (
            <a href={event.locationHref} target="_blank" rel="noopener noreferrer" className="break-words text-[color:var(--accent)] hover:underline">
              {event.location}
            </a>
          ) : (
            <p className="m-0 break-words">{event.location}</p>
          )
        ) : null}
        {event.eventLink ? (
          <a href={event.eventLink} target="_blank" rel="noopener noreferrer" className="text-[color:var(--accent)] hover:underline">
            Open in Google Calendar
          </a>
        ) : null}
      </div>
      <Foot>
        <Link href={event.href} className={cn(button, plain, "mr-auto")}>
          Open interview
        </Link>
        <button type="button" onClick={() => go({ kind: "cancel", event })} className={cn(button, plain)}>
          Cancel interview
        </button>
        <button ref={open} type="button" onClick={() => go({ kind: "move", event })} className={cn(button, primary)}>
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
      <Head id="schedule-dialog-title" title="Reschedule" sub={`${event.candidate}, ${event.step}. Now ${whenWords(event.startsAt, event.endsAt, timeZone)}.`} />
      <div className="grid gap-3 overflow-y-auto px-5 pt-3 pb-4">
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-[12.5px] text-muted-foreground">
            Date
            <input type="date" value={day} min={todayIn(timeZone, now)} max={LAST_DAY} onChange={(e) => e.target.value && setDay(e.target.value)} className={field} />
          </label>
          <label className="grid gap-1 text-[12.5px] text-muted-foreground">
            Starts
            <input type="time" step={SNAP_MINUTES * 60} value={time} onChange={(e) => e.target.value && setTime(e.target.value)} className={field} />
          </label>
        </div>
        {found ? <Slots found={found} timeZone={timeZone} pick={(s, e) => void review(s, e)} /> : null}
        {error ? <Err>{error}</Err> : null}
      </div>
      <Foot note="Nothing moves until you confirm">
        <button type="button" onClick={back} disabled={pending} className={cn(button, plain)}>
          Back
        </button>
        {event.interviewerIds.length ? (
          <button type="button" onClick={() => void onFind()} disabled={pending} className={cn(button, plain)}>
            {found ? "Look again" : "Find a time"}
          </button>
        ) : null}
        <button type="button" onClick={() => at && void review(at.startsAt, at.endsAt)} disabled={pending || !at} className={cn(button, primary)}>
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
      <div className="px-5 pt-2 pb-4 text-[13px] text-muted-foreground">{error ? <Err>{error}</Err> : <span aria-busy>Checking the calendars…</span>}</div>
      <Foot>
        <button type="button" onClick={back} className={cn(button, plain)}>
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

  React.useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

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
      onClose={close}
      onCancel={(e) => {
        if (busy.current) e.preventDefault();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
      className="relative m-auto max-h-[calc(100dvh-32px)] w-[min(460px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-[color:var(--line-strong)] bg-raised p-0 text-foreground shadow-[var(--pop-shadow)] backdrop:bg-[color:var(--scrim)] open:flex open:flex-col"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Close"
        title="Close (Esc)"
        className="absolute top-3 right-3 z-[1] grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
      >
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden>
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
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
            <BookForm flow={flow} timeZone={timeZone} now={now} confirm={setConfirming} setBusy={setBusy} />
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
