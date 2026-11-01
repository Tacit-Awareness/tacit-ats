"use client";

import { useState } from "react";
import type { ReplyKind } from "@/lib/client/reply-starters";
import { cn } from "@/lib/utils";
import { ReplyBox, type Reply } from "./reply-box";
import { RoutingBar, TeamField, pill, pillPrimary, type MoveKey, type Routing } from "./routing-bar";

// design/tats's `.composer2.cp`, the bottom of a ticket: the next step, the
// team, the drafted reply and a large Send, as one panel. It is still two
// writes. The prototype's one button routes and emails at once; here a reply
// can be refused while a route lands, and the reverse, and a member reads the
// stored draft before anything goes out, so routing-bar.tsx and reply-box.tsx
// keep their own forms. This holds the one thing they share: the picked move,
// which also picks the reply's starter. On a phone the panel scrolls with the
// page, or it would cover the application. Testbench has no backend yet, so its
// pick shows design/tats's message with Send off, and the reply stays mounted,
// hidden, keeping what was typed.

const STARTER: Record<Exclude<MoveKey, "testbench">, ReplyKind> = { interview: "interview", decline: "decline" };

/** design/tats's Testbench message and Send, as `.cp-main`, with nothing to post. */
function TestbenchPreview({ to, body }: { to: string | null; body: string }) {
  return (
    <section aria-label="Testbench message" className="grid grid-cols-[minmax(0,1fr)] items-stretch gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2 border border-[color:var(--line)] bg-[color:var(--raised)] px-4 py-3">
        {to ? <span className="min-w-0 truncate text-[12.5px] text-faint">To {to}</span> : null}
        <p className="m-0 line-clamp-3 text-[14px] leading-[1.55] break-words whitespace-pre-line">{body}</p>
      </div>
      <div className="grid content-end justify-items-stretch gap-2 md:w-[220px] md:justify-items-end md:text-right">
        <button type="button" disabled className={cn(pill, pillPrimary, "h-12 cursor-not-allowed justify-center px-[26px] text-[15px]")}>
          Send Testbench
        </button>
        <p role="status" className="m-0 text-[12px] text-faint">
          Testbench isn&apos;t connected yet, so nothing goes out.
        </p>
      </div>
    </section>
  );
}

export function ControlPanel({ routing, reply, team }: { routing: Routing | null; reply: Reply | null; team: string | null }) {
  const [move, setMove] = useState<MoveKey>("interview");
  const testbench = move === "testbench";
  return (
    <div
      data-tour="route"
      className="bottom-0 z-10 grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-[color:var(--line-strong)] bg-[color:var(--surface)] px-4 pt-4 pb-5 shadow-[0_-8px_20px_-16px_oklch(var(--ink-a)/0.25)] md:sticky md:px-6"
    >
      {routing ? (
        <RoutingBar routing={routing} team={team} move={move} onMove={setMove} lead={!reply?.enabled || !reply.to} />
      ) : team ? (
        <TeamField team={team} />
      ) : null}
      {/* A new draft is a new box, so a change or a refusal never outlives it. */}
      {reply ? (
        <div hidden={testbench}>
          <ReplyBox key={reply.draft?.draftId ?? ""} reply={reply} suggested={STARTER[testbench ? "interview" : move]} />
        </div>
      ) : null}
      {testbench && reply ? <TestbenchPreview to={reply.to} body={reply.starters.testbench} /> : null}
    </div>
  );
}
