"use client";

import { useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Kbd, useKeyHelp, useKeys } from "@/components/keys";
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

/** design/tats's `.cx-seg.sm` pill: 28px, radius 16, a strong hairline. */
const pill =
  "inline-flex h-7 items-center gap-2 rounded-2xl border border-[color:var(--line-strong)] px-3 text-[13.5px] font-[450] whitespace-nowrap text-foreground transition-colors hover:bg-[color:var(--hover)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]";

/** The buttons, disabled while a route is in flight. */
function Route({ value, keyName, primary = false, refFn, children }: { value: string; keyName: string; primary?: boolean; refFn: (b: HTMLButtonElement | null) => void; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      ref={refFn}
      type="submit"
      name="route"
      value={value}
      disabled={pending}
      aria-keyshortcuts={keyName}
      className={cn(pill, primary && "border-[color:var(--accent)] bg-[color:var(--accent)] font-medium text-[color:var(--accent-ink)] hover:bg-[color:var(--accent)] hover:brightness-106")}
    >
      {children}
      <Kbd decorative className={primary ? "border-transparent bg-white/20 text-current" : undefined}>
        {keyName}
      </Kbd>
    </button>
  );
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

  // design/tats's `.composer2` footer: full width under the page, ruled on top, on paper.
  return (
    <form
      data-tour="route"
      ref={form}
      action={routeApplicantAction}
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-1.5 border-t border-[color:var(--line)] bg-[color:var(--paper)] px-[18px] py-3"
    >
      <RoutingKeys press={press} decline={decline} />
      <input type="hidden" name="applicationId" value={routing.applicationId} />
      {routing.next ? <input type="hidden" name="next" value={routing.next} /> : null}
      <Route value="interview" keyName="I" primary refFn={(b) => void (buttons.current.interview = b)}>
        Interview
      </Route>
      <Route value="screening" keyName="S" refFn={(b) => void (buttons.current.screening = b)}>
        Move to screening
      </Route>
      <span className="ml-auto flex min-w-0 items-center gap-1.5">
        <label htmlFor="reasonId" className="sr-only">
          Rejection reason
        </label>
        <select
          ref={reason}
          id="reasonId"
          name="reasonId"
          defaultValue=""
          className={cn(pill, "w-[190px] bg-transparent pr-2 text-muted-foreground outline-none focus-visible:border-[color:var(--accent)]")}
        >
          <option value="">Rejection reason…</option>
          {routing.reasons.map((r) => (
            <option key={r.reasonId} value={r.reasonId}>
              {r.name}
            </option>
          ))}
        </select>
        <Route value="decline" keyName="D" refFn={(b) => void (buttons.current.decline = b)}>
          Decline
        </Route>
      </span>
    </form>
  );
}
