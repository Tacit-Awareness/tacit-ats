"use client";

import { useState } from "react";
import { ReplyBox, type Reply } from "./reply-box";
import { RoutingBar, TeamField, type MoveKey, type Routing } from "./routing-bar";

// design/tats's `.composer2.cp`, the bottom of a ticket: the next step, the
// team, the drafted reply and a large Send, as one panel. It is still two
// writes. The prototype's one button routes and emails at once; here a reply
// can be refused while a route lands, and the reverse, and a member reads the
// stored draft before anything goes out, so routing-bar.tsx and reply-box.tsx
// keep their own forms. This holds the one thing they share: the picked move,
// which also picks the reply's starter. On a phone the panel scrolls with the
// page, or it would cover the application. Testbench is that reply with the
// invite link in it: it emails them and moves nobody.

export function ControlPanel({ routing, reply, team }: { routing: Routing | null; reply: Reply | null; team: string | null }) {
  const [move, setMove] = useState<MoveKey>("interview");
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
      {reply ? <ReplyBox key={reply.draft?.draftId ?? ""} reply={reply} suggested={move} /> : null}
    </div>
  );
}
