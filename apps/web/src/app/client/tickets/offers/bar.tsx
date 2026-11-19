"use client";

import { useState } from "react";
import { Btn } from "@/components/tickets/kit";
import type { NextStep } from "@/lib/client/offer-page-rules";
import { offerMoves, type Offer, type OfferMove } from "@/lib/client/offer-rules";
import { askOfferApprovalAction } from "../../candidates/[id]/actions";
import { MoveDialog, TermsDialog, useOfferWrite, type OfferTarget } from "../../candidates/[id]/offer-block";
import { decideIssueAction } from "../../inbox/actions";

// The bar under an offer (design/tacit-tickets's Offers): where it stands and
// the one next step, on writes that already exist. Edit Terms, Mark As
// Extended, They Accepted / Declined and Withdraw are the candidate page's own
// dialogs and actions (candidates/[id]/offer-block.tsx: core's updateOffer,
// and the status changes each confirmed, since none can be taken back); Ask For
// Sign-Off is its requestApproval; Sign Off and Send Back are the Inbox's
// approval decision (inbox/actions.ts's decideIssueAction), which comes back
// here (lib/client/triage-return.ts).

export function OfferBar({ target, offer, next }: { target: OfferTarget; offer: Offer; next: NextStep }) {
  const [move, setMove] = useState<OfferMove | null>(null);
  const [editing, setEditing] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const ask = useOfferWrite(() => {});
  const moves = offerMoves(offer);
  const askForSignOff = () => {
    const form = new FormData();
    form.set("candidateId", target.candidateId);
    form.set("offerId", offer.offerId);
    ask.run(askOfferApprovalAction, form);
  };
  return (
    <div className="shrink-0 border-t border-line px-5 py-2.5">
      {ask.error && <p role="alert" className="mb-2 text-bad">{ask.error}</p>}
      {next.kind === "decide" && sendingBack ? (
        <form action={decideIssueAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="decision" value="reject" />
          <input type="hidden" name="requestId" value={next.requestId} />
          <input name="reason" maxLength={500} autoFocus placeholder="Why it goes back, for whoever asked" aria-label="Why it goes back" className="h-8 min-w-0 flex-1 rounded-lg border border-line-strong bg-transparent px-2.5 text-ink outline-none placeholder:text-dim focus:border-mute" />
          <Btn className="h-8 px-3" onClick={() => setSendingBack(false)}>
            Cancel
          </Btn>
          <Btn solid type="submit" className="h-8 px-3.5">
            Send Back
          </Btn>
        </form>
      ) : (
        <div className="flex min-h-9 flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 text-ink">{next.say}</span>
          {offer.status === "draft" && (
            <Btn className="h-8 border-transparent px-3 text-mute" onClick={() => setEditing(true)}>
              Edit Terms
            </Btn>
          )}
          {moves.includes("withdrawn") && (
            <Btn className="h-8 border-transparent px-3 text-mute" onClick={() => setMove("withdrawn")}>
              Withdraw
            </Btn>
          )}
          {next.kind === "decide" && (
            <>
              <Btn className="h-8 px-3" onClick={() => setSendingBack(true)}>
                Send Back
              </Btn>
              <form action={decideIssueAction}>
                <input type="hidden" name="decision" value="approve" />
                <input type="hidden" name="requestId" value={next.requestId} />
                <Btn solid type="submit" className="h-8 px-3.5">
                  Sign Off
                </Btn>
              </form>
            </>
          )}
          {next.kind === "ask" && (
            <Btn solid disabled={ask.pending} className="h-8 px-3.5" onClick={askForSignOff}>
              {ask.pending ? "Asking" : "Ask For Sign-Off"}
            </Btn>
          )}
          {next.kind === "extend" && (
            <Btn solid className="h-8 px-3.5" onClick={() => setMove("extended")}>
              Mark As Extended
            </Btn>
          )}
          {next.kind === "answer" && (
            <>
              <Btn className="h-8 px-3" onClick={() => setMove("declined")}>
                They Declined
              </Btn>
              <Btn solid className="h-8 px-3.5" onClick={() => setMove("accepted")}>
                They Accepted
              </Btn>
            </>
          )}
        </div>
      )}
      {editing && <TermsDialog target={target} offer={offer} onClose={() => setEditing(false)} />}
      {move && <MoveDialog target={target} offer={offer} move={move} onClose={() => setMove(null)} />}
    </div>
  );
}

/** Hy's New: draft an offer for someone in process who has none open, through the candidate page's terms dialog. */
export function NewOffer({ candidates }: { candidates: OfferTarget[] }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<OfferTarget | null>(null);
  if (!candidates.length) return null;
  return (
    <span className="relative inline-flex">
      <Btn onClick={() => setOpen(!open)}>New</Btn>
      {open && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <span role="menu" className="anim-rise scroll-quiet absolute top-full right-0 z-50 mt-1.5 flex max-h-[320px] w-[260px] flex-col overflow-y-auto rounded-xl border border-line-strong bg-panel p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.45)]">
            <span className="px-2.5 pt-1.5 pb-1 text-xs text-dim">Draft An Offer For</span>
            {candidates.slice(0, 12).map((c) => (
              <button
                key={c.applicationId}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setTarget(c);
                }}
                className="flex min-h-8 shrink-0 items-center rounded-lg px-2.5 py-1 text-left text-ink transition-colors hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
              </button>
            ))}
          </span>
        </>
      )}
      {target && <TermsDialog target={target} offer={null} onClose={() => setTarget(null)} />}
    </span>
  );
}
