"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useKeyHelp, useKeys } from "@/components/keys";
import { Kbd, pillOption, pillTrack } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { selectClass } from "@/components/ui/input";
import type { RejectReason } from "@/lib/client/applicants";
import { cn } from "@/lib/utils";
import { routeApplicantAction } from "./actions";

// The control panel's top row (design/tats's `.cp-top`): the next step on
// Testbench's segmented control, each option with its key inside, the team,
// and the button that moves them. Pressing an option only picks the move, as
// in the prototype, and picks the reply's starter with it; the button at the
// end of the row says the move and posts it. The keys pick too:
// I interviews, D declines, then that button takes focus, so Enter posts it and
// no single key moves anyone. D with no reason picked focuses the reason
// instead, since a decline needs one.
// T picks design/tats's Testbench, which only picks the reply's starter: it
// moves nobody, so it has no button here.
// The team is read-only: a route takes no team, the job already has one.
// Two steady lines, whatever the reader's width or the team's name: the move
// and its button on the first, the button always at its right end; the reason
// (once Decline is picked) and the team under them. In a narrow reader (a
// container query on the panel) the options' keys go to their hover.

export type Routing = {
  applicationId: string;
  next: string | null;
  reasons: RejectReason[];
  /** Drawn in Home's tab, so the post comes back there. */
  home?: boolean;
  /** Drawn in the Inbox's pop-up, at this digest range, so the post comes back there with the next applicant open. */
  inbox?: number;
};
export type MoveKey = "interview" | "testbench" | "decline";

const MOVES: { key: MoveKey; keyName: string; pick: string; act: string }[] = [
  { key: "interview", keyName: "I", pick: "Interview", act: "Move to interviewing" },
  { key: "testbench", keyName: "T", pick: "Testbench", act: "" },
  { key: "decline", keyName: "D", pick: "Decline", act: "Decline" },
];

/** The keys, inside the form so a key does nothing while a route is in flight. */
function RoutingKeys({ pick }: { pick: (route: MoveKey) => void }) {
  const { pending } = useFormStatus();
  useKeys({ i: () => pick("interview"), t: () => pick("testbench"), d: () => pick("decline") }, !pending);
  useKeyHelp("New Applicants", [
    { keys: "I", label: "Pick Interview" },
    { keys: "T", label: "Pick Testbench" },
    { keys: "D", label: "Pick Decline, then its reason" },
    { keys: "Enter", label: "Post the picked move" },
  ]);
  return null;
}

const label = "text-[12.5px] text-faint";

/** A next step on the segmented track (`.cp .cx-seg > *`): the picked one raised, as Testbench's `.seg`. */
function MovePill({ move, picked, onPick }: { move: (typeof MOVES)[number]; picked: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      aria-keyshortcuts={move.keyName}
      onClick={onPick}
      title={`${move.pick} (${move.keyName})`}
      className={cn(pillOption(picked), "gap-2 focus-visible:outline-offset-[-2px] @xl:px-3.5")}
    >
      {move.pick}
      <Kbd className="@max-xl:hidden">
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
    <button ref={refFn} type="submit" name="route" value={value} disabled={pending} onClick={onClick} className={buttonVariants({ variant: primary ? "default" : "outline" })}>
      {children}
    </button>
  );
}

/** The job's team: a fact here, not a choice, so plain text beside its label rather than anything that looks pressable. */
export function TeamField({ team }: { team: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className={label}>Team</span>
      <span title={team} className="inline-flex h-9 max-w-[260px] min-w-0 items-center text-[13px]">
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
    if (m !== "testbench" && (m !== "decline" || !noReason())) setKeyed({ move: m });
  };

  return (
    <form action={routeApplicantAction} className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
      <RoutingKeys pick={keyPick} />
      <input type="hidden" name="applicationId" value={routing.applicationId} />
      {routing.next ? <input type="hidden" name="next" value={routing.next} /> : null}
      {routing.home ? <input type="hidden" name="home" value="1" /> : null}
      {routing.inbox !== undefined ? <input type="hidden" name="inbox" value={routing.inbox} /> : null}
      <div className="flex max-w-full min-w-0 items-center gap-3">
        {/* The options say what they are; the label is the group's name for a screen reader. */}
        <span id="next-step" className="sr-only">
          Next step
        </span>
        <div role="group" aria-labelledby="next-step" className={pillTrack}>
          {MOVES.map((m) => (
            <MovePill key={m.key} move={m} picked={m.key === move} onPick={() => pick(m.key)} />
          ))}
        </div>
      </div>
      {/* The reason and the team, on a line under the move by `order` alone: Tab still goes option, reason, button. */}
      <span className={cn("order-3 flex min-w-0 basis-full flex-wrap items-center gap-x-5 gap-y-2.5", !team && move !== "decline" && "hidden")}>
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
            className={cn(selectClass, "w-[220px] max-w-full")}
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
      </span>
      <span className="order-2 ml-auto">
        {/* Only the picked one is in the form: Enter in the reason submits the form's first button, which must be this. */}
        {MOVES.filter((m) => m.key === move && m.act).map((m) => (
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
