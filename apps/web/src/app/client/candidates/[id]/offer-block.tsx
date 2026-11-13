"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Empty, KeyValues, Notice, Pill } from "@/components/page";
import { showToast } from "@/components/toasts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  approvalLine,
  OFFER_DEFAULT_CURRENCY,
  OFFER_MOVE_COPY,
  OFFER_NOTES_MAX,
  OFFER_TERM_MAX,
  offerBoard,
  offerGate,
  offerMoves,
  offerStatusWord,
  offerTermLines,
  type Offer,
  type OfferMove,
} from "@/lib/client/offer-rules";
import { askOfferApprovalAction, moveOfferAction, saveOfferAction } from "./actions";
import { OFFER_ERRORS, OFFER_NOTICES, type OfferAnswer } from "./messages";

// One application's offer on the candidate page, and so in the Pipeline's and
// the Inbox's pop-ups, for whoever can manage the job (readOffers leaves the
// rest out). design/tats's offer drafts in Gmail from a note; a real one has
// terms, so this is the connector's lifecycle: draft, ask for approval where the
// job has a flow, extended, then accepted, declined or withdrawn. tATS sends
// nothing, so extended records that it went out. Nothing moves a stage.
//
// Everything answers in place, as these sit in pop-ups. Dialogs are native, so
// keys.ts leaves them alone, mounted only while open, and the form is submitted
// by hand: React resets a form when its action ends, and a refusal has to leave
// the terms they typed. Each change of status is confirmed, since none can be
// taken back. Drawn in Testbench's design: the open offer a recessed well with
// its terms as label and value pairs, the dialogs Testbench's `.dialog` (the
// title in Mona Sans, the body 24px in, the buttons right over a hairline).

type Target = { candidateId: string; applicationId: string; name: string };

const LABEL = "grid gap-1.5 text-[12.5px] text-muted-foreground";
/** Testbench's `.dialog-body` and `.dialog-foot`. */
const BODY = "grid gap-4 px-6 pt-3 pb-5";
const FOOT = "flex justify-end gap-2 border-t border-[color:var(--line)] px-6 py-3.5";

function Modal({ title, sub, busy, onClose, children }: { title: string; sub?: string; busy: boolean; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      // The browser lets a cancel be refused only once: a second Esc closes it anyway.
      onClose={() => (busy ? dialog.current?.showModal() : onClose())}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="m-auto w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-[16px] border-0 bg-[color:var(--surface)] p-0 text-foreground shadow-[var(--box-shadow)] backdrop:bg-[color:var(--scrim)]"
    >
      <div className="grid gap-1 px-6 pt-[22px] pb-1.5">
        <h2 className="m-0 text-[20px] leading-[26px] font-semibold tracking-[-0.015em]">{title}</h2>
        {sub ? <p className="m-0 text-[13px] leading-5 text-muted-foreground">{sub}</p> : null}
      </div>
      {children}
    </dialog>
  );
}

/** Runs one of the block's actions, keeping a refusal for the dialog to show. A dropped connection is `failed`, not silence. */
function useOfferWrite(onDone: () => void) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: (form: FormData) => Promise<OfferAnswer>, form: FormData) => {
    setError(null);
    start(async () => {
      let answer: OfferAnswer;
      try {
        answer = await action(form);
      } catch {
        answer = { ok: false, error: "failed" };
      }
      if (!answer.ok) return setError(OFFER_ERRORS[answer.error]);
      showToast({ text: OFFER_NOTICES[answer.notice] });
      onDone();
    });
  };
  return { pending, error, run };
}

function TermsDialog({ target, offer, onClose }: { target: Target; offer: Offer | null; onClose: () => void }) {
  const { pending, error, run } = useOfferWrite(onClose);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    run(saveOfferAction, new FormData(e.currentTarget));
  };
  const hasRequest = offer?.approval && offer.approval.status !== "not_requested";
  return (
    <Modal
      title={offer ? `Edit the offer for ${target.name}` : `Draft an offer for ${target.name}`}
      sub={hasRequest ? "Changing the terms means asking for approval again." : "This stays a draft. Nothing goes to the candidate, and their stage stays as it is."}
      busy={pending}
      onClose={onClose}
    >
      <form onSubmit={submit} className="grid">
        <input type="hidden" name="candidateId" value={target.candidateId} />
        <input type="hidden" name="applicationId" value={target.applicationId} />
        <input type="hidden" name="offerId" value={offer?.offerId ?? ""} />
        <div className={BODY}>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
            <label className={LABEL}>
              Salary a year
              <Input name="salary" inputMode="numeric" defaultValue={offer?.salary ?? ""} placeholder="185,000" autoFocus />
            </label>
            <label className={LABEL}>
              Currency
              <Input name="currency" required minLength={3} maxLength={3} defaultValue={offer?.currency ?? OFFER_DEFAULT_CURRENCY} className="uppercase" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              Bonus
              <Input name="bonus" maxLength={OFFER_TERM_MAX} defaultValue={offer?.bonus ?? ""} />
            </label>
            <label className={LABEL}>
              Equity
              <Input name="equity" maxLength={OFFER_TERM_MAX} defaultValue={offer?.equity ?? ""} />
            </label>
            <label className={LABEL}>
              Start date
              <Input name="startDate" type="date" defaultValue={offer?.startDate ?? ""} />
            </label>
            <label className={LABEL}>
              Expires
              <Input name="expiresOn" type="date" defaultValue={offer?.expiresOn ?? ""} />
            </label>
          </div>
          <label className={LABEL}>
            Notes for the team
            <Textarea name="notes" rows={3} maxLength={OFFER_NOTES_MAX} defaultValue={offer?.notes ?? ""} className="font-sans text-[14px] leading-[22px] text-foreground" />
          </label>
        </div>
        <div className={FOOT}>
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : offer ? "Save" : "Save draft"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Opens on Cancel, so a second Enter can't record what never happened. */
function MoveDialog({ target, offer, move, onClose }: { target: Target; offer: Offer; move: OfferMove; onClose: () => void }) {
  const { pending, error, run } = useOfferWrite(onClose);
  const copy = OFFER_MOVE_COPY[move];
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    run(moveOfferAction, new FormData(e.currentTarget));
  };
  return (
    <Modal title={copy.title(target.name)} busy={pending} onClose={onClose}>
      <form onSubmit={submit} className="grid">
        <input type="hidden" name="candidateId" value={target.candidateId} />
        <input type="hidden" name="offerId" value={offer.offerId} />
        <input type="hidden" name="from" value={offer.status} />
        <input type="hidden" name="status" value={move} />
        <div className={BODY}>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">{copy.body}</p>
        </div>
        <div className={FOOT}>
          <Button type="button" variant="ghost" autoFocus disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : copy.confirm}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Terms({ offer }: { offer: Offer }) {
  const lines = offerTermLines(offer);
  if (!lines.length) return <Empty className="m-0">No terms on this offer yet.</Empty>;
  return <KeyValues className="grid-cols-[96px_minmax(0,1fr)] gap-y-2" items={lines.map((l) => [l.label, <span className="min-w-0 break-words">{l.value}</span>])} />;
}

function OpenOffer({ target, offer }: { target: Target; offer: Offer }) {
  const [editing, setEditing] = useState(false);
  const [move, setMove] = useState<OfferMove | null>(null);
  const gate = offerGate(offer);
  const line = approvalLine(offer);
  const moves = offerMoves(offer);
  const ask = useOfferWrite(() => {});

  // Closing a dialog drops focus on the body, so it goes back to the block.
  const box = useRef<HTMLElement>(null);
  const closed = (then: () => void) => () => {
    then();
    box.current?.focus();
  };

  const askApproval = () => {
    const form = new FormData();
    form.set("candidateId", target.candidateId);
    form.set("offerId", offer.offerId);
    ask.run(askOfferApprovalAction, form);
  };

  return (
    <section ref={box} tabIndex={-1} aria-label="Open offer" className="grid gap-4 rounded-[10px] bg-[color:var(--soft)] p-4 shadow-[inset_0_0_0_1px_var(--line)] outline-none">
      <div className="flex items-center gap-3">
        <Pill tone={offer.status === "extended" ? "green" : "grey"}>{offerStatusWord(offer.status)}</Pill>
        {offer.createdBy ? <span className="truncate text-[12.5px] text-faint">by {offer.createdBy}</span> : null}
      </div>
      <Terms offer={offer} />
      {offer.notes ? <p className="m-0 font-sans text-[14px] leading-[22px] break-words whitespace-pre-wrap text-foreground/85">{offer.notes}</p> : null}
      {line ? <p className="m-0 text-[12.5px] text-muted-foreground">{line}</p> : null}
      {ask.error ? <Notice tone="error">{ask.error}</Notice> : null}
      <div className="flex flex-wrap items-center gap-2">
        {offer.status === "draft" && gate === "ask" ? (
          <Button type="button" size="sm" disabled={ask.pending} onClick={askApproval}>
            {ask.pending ? "Sending…" : "Ask for approval"}
          </Button>
        ) : null}
        {moves.map((m, i) => (
          <Button key={m} type="button" size="sm" variant={i === 0 && m !== "withdrawn" ? "default" : "outline"} onClick={() => setMove(m)}>
            {OFFER_MOVE_COPY[m].button}
          </Button>
        ))}
        {offer.status === "draft" ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit terms
          </Button>
        ) : null}
      </div>
      {editing ? <TermsDialog target={target} offer={offer} onClose={closed(() => setEditing(false))} /> : null}
      {move ? <MoveDialog target={target} offer={offer} move={move} onClose={closed(() => setMove(null))} /> : null}
    </section>
  );
}

/** An application's offers: the open one, a way to draft one, then the closed ones. */
export function OfferBlock({ target, stage, offers }: { target: Target; stage: string; offers: Offer[] }) {
  const [drafting, setDrafting] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const { open, closed, canDraft } = offerBoard(stage, offers);
  return (
    <div className="grid gap-2">
      {open ? <OpenOffer key={`${open.offerId}-${open.status}`} target={target} offer={open} /> : null}
      {canDraft ? (
        <div className="flex items-center gap-4">
          {!offers.length ? <Empty className="m-0 p-0">No offer yet.</Empty> : null}
          <Button ref={opener} type="button" size="sm" variant="outline" onClick={() => setDrafting(true)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
              <path d="M8 3.5v9M3.5 8h9" />
            </svg>
            Draft an offer
          </Button>
        </div>
      ) : null}
      {drafting ? (
        <TermsDialog
          target={target}
          offer={null}
          onClose={() => {
            setDrafting(false);
            opener.current?.focus();
          }}
        />
      ) : null}
      {closed.map((o) => (
        <details key={o.offerId} className="group border-t border-[color:var(--line)] pt-2">
          <summary className="-mx-2 flex h-9 cursor-pointer items-center gap-2.5 rounded-[8px] px-2 text-[13px] text-muted-foreground transition-colors select-none hover:bg-[color:var(--surface)] hover:text-foreground [&::-webkit-details-marker]:hidden">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-3 shrink-0 transition-transform duration-200 ease-[var(--ease-out)] group-open:rotate-90" aria-hidden>
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
            <Pill tone={o.status === "accepted" ? "green" : "grey"}>{offerStatusWord(o.status)}</Pill>
            <span className="truncate">{offerTermLines(o)[0]?.value ?? "No terms"}</span>
          </summary>
          <div className="mt-2 grid gap-3 pb-1 pl-[22px]">
            <Terms offer={o} />
            {o.notes ? <p className="m-0 font-sans text-[14px] leading-[22px] break-words whitespace-pre-wrap text-foreground/85">{o.notes}</p> : null}
          </div>
        </details>
      ))}
    </div>
  );
}
