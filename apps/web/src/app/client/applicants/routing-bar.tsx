"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { Kbd, useKeyHelp, useKeys } from "@/components/keys";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/components/ui/input";
import type { RejectReason } from "@/lib/client/applicants";
import { cn } from "@/lib/utils";
import { routeApplicantAction } from "./actions";

// The routing bar under an application, with design/tats's keys on its
// buttons: I interviews, S moves to screening, D declines. A key presses the
// button (the same server action, the same posted fields); D with no reason
// picked focuses the reason instead, since a decline needs one. design/tats's
// T (Testbench) and ⌘↵ (send the reply) are left out: nothing sends either.

export type Routing = { applicationId: string; next: string | null; reasons: RejectReason[] };

/** The keys, inside the form so a key does nothing while a route is in flight. */
function RoutingKeys({ press, decline }: { press: (route: "interview" | "screening") => void; decline: () => void }) {
  const { pending } = useFormStatus();
  useKeys({ i: () => press("interview"), s: () => press("screening"), d: decline }, !pending);
  useKeyHelp("Applicant Tickets", [
    { keys: "I", label: "Interview" },
    { keys: "S", label: "Move to screening" },
    { keys: "D", label: "Decline (pick a reason first)" },
  ]);
  return null;
}

export function RoutingBar({ routing }: { routing: Routing }) {
  const form = useRef<HTMLFormElement>(null);
  const reason = useRef<HTMLSelectElement>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const press = (route: string) => {
    const b = buttons.current[route];
    if (b) form.current?.requestSubmit(b);
  };
  const decline = () => (reason.current?.value ? press("decline") : reason.current?.focus());

  return (
    <form
      ref={form}
      action={routeApplicantAction}
      data-tour="route"
      className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-2 rounded-[12px] border border-[color:var(--line)] bg-card p-2.5 shadow-[var(--shadow)]"
    >
      <RoutingKeys press={press} decline={decline} />
      <input type="hidden" name="applicationId" value={routing.applicationId} />
      {routing.next ? <input type="hidden" name="next" value={routing.next} /> : null}
      <Button ref={(b) => void (buttons.current.interview = b)} type="submit" name="route" value="interview" aria-keyshortcuts="I">
        Interview <Kbd decorative className="border-current/35 text-current opacity-80">I</Kbd>
      </Button>
      <Button ref={(b) => void (buttons.current.screening = b)} type="submit" name="route" value="screening" variant="outline" aria-keyshortcuts="S">
        Move to screening <Kbd decorative>S</Kbd>
      </Button>
      <span className="ml-auto flex min-w-0 items-center gap-2">
        <label htmlFor="reasonId" className="sr-only">
          Rejection reason
        </label>
        <select ref={reason} id="reasonId" name="reasonId" defaultValue="" className={cn(selectClass, "w-[200px]")}>
          <option value="">Rejection reason…</option>
          {routing.reasons.map((r) => (
            <option key={r.reasonId} value={r.reasonId}>
              {r.name}
            </option>
          ))}
        </select>
        <Button ref={(b) => void (buttons.current.decline = b)} type="submit" name="route" value="decline" variant="outline" aria-keyshortcuts="D">
          Decline <Kbd decorative>D</Kbd>
        </Button>
      </span>
    </form>
  );
}
