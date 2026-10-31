"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Kbd, useKeyHelp, useKeys } from "@/components/keys";
import { pillOption, pillTrack } from "@/components/page";
import type { RejectReason } from "@/lib/client/applicants";
import { cn } from "@/lib/utils";
import { routeApplicantAction } from "./actions";

// The control panel's top row (design/tats's `.cp-top`): the next step as large
// pills, the team, and the button that moves them. Pressing a pill only picks
// the move, as in the prototype, and picks the reply's starter with it; the
// button at the end of the row says the move and posts it. The keys pick too:
// I interviews, S screening, D declines, then that button takes focus, so Enter
// posts it and no single key moves anyone. D with no reason picked focuses the
// reason instead, since a decline needs one.
// design/tats's T (Testbench) is left out: nothing sends one. The team is
// read-only: a route takes no team, the job already has one.

export type Routing = { applicationId: string; next: string | null; reasons: RejectReason[]; /** Drawn in Home's tab, so the post comes back there. */ home?: boolean };
export type MoveKey = "interview" | "screening" | "decline";

const MOVES: { key: MoveKey; keyName: string; pick: string; act: string }[] = [
  { key: "interview", keyName: "I", pick: "Interview", act: "Move to interviewing" },
  { key: "screening", keyName: "S", pick: "Screening", act: "Move to screening" },
  { key: "decline", keyName: "D", pick: "Decline", act: "Decline" },
];

/** The keys, inside the form so a key does nothing while a route is in flight. */
function RoutingKeys({ pick }: { pick: (route: MoveKey) => void }) {
  const { pending } = useFormStatus();
  useKeys({ i: () => pick("interview"), s: () => pick("screening"), d: () => pick("decline") }, !pending);
  useKeyHelp("Applicant Tickets", [
    { keys: "I", label: "Pick Interview" },
    { keys: "S", label: "Pick Screening" },
    { keys: "D", label: "Pick Decline, then its reason" },
    { keys: "Enter", label: "Post the picked move" },
  ]);
  return null;
}

/** design/tats's `.cx-seg.sm` pill: 28px, radius 16, a strong hairline. */
export const pill =
  "inline-flex h-7 items-center gap-2 rounded-full border border-[color:var(--line-strong)] px-3 text-[13.5px] font-[450] whitespace-nowrap text-foreground transition-colors hover:bg-[color:var(--hover)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]";

export const pillPrimary = "border-[color:var(--accent)] bg-[color:var(--accent)] font-medium text-[color:var(--accent-ink)] hover:bg-[color:var(--accent)] hover:brightness-106";

const label = "text-[13px] font-medium text-muted-foreground";
/** design/tats's `.cp .chip`: the panel's 36px. */
const control = "h-9 text-[14px]";

/** A next step on the pill track (`.cp .cx-seg > *`). The picked one keeps the hover highlight, as the README asks. */
function MovePill({ move, picked, onPick }: { move: (typeof MOVES)[number]; picked: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      aria-keyshortcuts={move.keyName}
      onClick={onPick}
      className={cn(
        pillOption(false),
        "h-9 px-3.5 text-[14px] hover:bg-foreground/[0.12] md:px-[18px] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--accent)]",
        picked && "bg-foreground/[0.12] text-foreground",
      )}
    >
      {move.pick}
      <Kbd decorative className="border-transparent bg-current/10 text-current max-md:hidden">
        {move.keyName}
      </Kbd>
    </button>
  );
}

/** The submit for the picked move, disabled while a route is in flight. */
function Route({
  value,
  primary,
  refFn,
  onClick,
  children,
}: {
  value: MoveKey;
  primary: boolean;
  refFn: (b: HTMLButtonElement | null) => void;
  onClick?: (e: MouseEvent) => void;
  children: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button ref={refFn} type="submit" name="route" value={value} disabled={pending} onClick={onClick} className={cn(pill, control, "px-4", primary && pillPrimary)}>
      {children}
    </button>
  );
}

/** The job's team: a fact here, not a choice. */
export function TeamField({ team }: { team: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className={label}>Team</span>
      <span title={team} className={cn("inline-flex max-w-[260px] min-w-0 items-center rounded-full border border-[color:var(--line)] bg-[color:var(--raised)] px-3.5", control)}>
        <span className="truncate">{team}</span>
      </span>
    </div>
  );
}

export function RoutingBar({
  routing,
  team,
  move,
  onMove,
  lead,
}: {
  routing: Routing;
  team: string | null;
  move: MoveKey;
  onMove: (move: MoveKey) => void;
  /** No reply can go out, so this is the panel's one action. */
  lead: boolean;
}) {
  const reason = useRef<HTMLSelectElement>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  // The reason only shows once Decline is picked, so focusing it waits for that render.
  const [askedForReason, setAskedForReason] = useState(0);
  useEffect(() => {
    if (askedForReason) reason.current?.focus();
  }, [askedForReason]);

  const noReason = () => !reason.current?.value;
  const askForReason = () => {
    onMove("decline");
    setAskedForReason((n) => n + 1);
  };
  const pick = (m: MoveKey) => (m === "decline" && noReason() ? askForReason() : onMove(m));
  // A key's pick hands focus to its button, so Enter posts it. Waits for the render that shows the button.
  const [keyed, setKeyed] = useState<{ move: MoveKey } | null>(null);
  useEffect(() => {
    if (keyed) buttons.current[keyed.move]?.focus();
  }, [keyed]);
  const keyPick = (m: MoveKey) => {
    pick(m);
    if (m !== "decline" || !noReason()) setKeyed({ move: m });
  };

  return (
    <form action={routeApplicantAction} className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <RoutingKeys pick={keyPick} />
      <input type="hidden" name="applicationId" value={routing.applicationId} />
      {routing.next ? <input type="hidden" name="next" value={routing.next} /> : null}
      {routing.home ? <input type="hidden" name="home" value="1" /> : null}
      <div className="flex max-w-full min-w-0 items-center gap-3">
        <span id="next-step" className={cn(label, "flex-none")}>
          Next step
        </span>
        <div role="group" aria-labelledby="next-step" className={pillTrack}>
          {MOVES.map((m) => (
            <MovePill key={m.key} move={m} picked={m.key === move} onPick={() => pick(m.key)} />
          ))}
        </div>
      </div>
      {/* Always in the form, showing or not, as it always was. */}
      <span className={cn("max-w-full min-w-0", move !== "decline" && "hidden")}>
        <label htmlFor="reasonId" className="sr-only">
          Rejection reason
        </label>
        <select
          ref={reason}
          id="reasonId"
          name="reasonId"
          // Esc leaves the select, so the page keys work again.
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          defaultValue=""
          className={cn(pill, control, "w-[200px] max-w-full bg-transparent pr-2 text-muted-foreground outline-none focus-visible:border-[color:var(--accent)]")}
        >
          <option value="">Rejection reason…</option>
          {routing.reasons.map((r) => (
            <option key={r.reasonId} value={r.reasonId}>
              {r.name}
            </option>
          ))}
        </select>
      </span>
      {team ? <TeamField team={team} /> : null}
      <span className="md:ml-auto">
        {/* Only the picked one is in the form: Enter in the reason submits the form's first button, which must be this. */}
        {MOVES.filter((m) => m.key === move).map((m) => (
          <Route
            key={m.key}
            value={m.key}
            primary={lead}
            refFn={(b) => void (buttons.current[m.key] = b)}
            onClick={
              m.key === "decline"
                ? (e) => {
                    if (!noReason()) return;
                    e.preventDefault();
                    reason.current?.focus();
                  }
                : undefined
            }
          >
            {m.act}
          </Route>
        ))}
      </span>
    </form>
  );
}
