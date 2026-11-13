import { NEXT_ACTION_MAX } from "@tacit/core";
import { Chip } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { Input, selectClass } from "@/components/ui/input";
import type { CloseReason, LabelChoices, OwnerChoice } from "@/lib/client/candidate-edits";
import { closeReasonKind, MOVABLE_STAGES, nextStage, NOTE_MAX } from "@/lib/client/candidate-edit-rules";
import { stageLabel } from "@/lib/client/crm-views";
import { cn } from "@/lib/utils";
import { logTouchAction, moveCandidateAction, setNextActionAction, setOwnerAction } from "./actions";
import { LabelMenu } from "./label-menu";

// One job's edit controls on the candidate page, shown only where the member
// may edit that job's pipeline (page.tsx asks can_on_role). Plain forms, no
// script: each posts to its own action in actions.ts. Every move carries the
// stage this page showed (`expectedStage`), so a move someone else made in
// the meantime is reported instead of overwritten. Rejecting and withdrawing
// are their own forms, each offering only the org's reasons of its kind.
// Drawn as a recessed well under the job's row, in Testbench's fields and
// buttons: 36px fields with a hard edge, the button beside a field as tall as
// it, the next stage as the one black button.
// Labels are the candidate's, not a job's: chips for anyone, and for whoever may
// change the record (`choices`, can_edit_person) the menu, label-menu.tsx, the one
// control here that needs script, so it can answer inside the Pipeline's pop-up.

export type JobEditing = {
  candidateId: string;
  applicationId: string;
  stage: string;
  ownerActorId: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
  owners: OwnerChoice[];
  reasons: CloseReason[];
};

/** A field's label, Testbench's: small and grey over the field. */
const LABEL = "text-[12.5px] text-muted-foreground";

function Hidden({ e, stage = true }: { e: JobEditing; stage?: boolean }) {
  return (
    <>
      <input type="hidden" name="candidateId" value={e.candidateId} />
      <input type="hidden" name="applicationId" value={e.applicationId} />
      {stage ? <input type="hidden" name="expectedStage" value={e.stage} /> : null}
    </>
  );
}

function CloseForm({ e, kind }: { e: JobEditing; kind: "rejected" | "withdrew" }) {
  const reasons = e.reasons.filter((r) => r.kind === kind);
  const stage = kind === "rejected" ? "rejected" : "withdrawn";
  const label = kind === "rejected" ? "Reject" : "Mark withdrawn";
  const fieldId = `${e.applicationId}-${kind}`;
  return (
    <form action={moveCandidateAction} className="grid content-start gap-2">
      <Hidden e={e} />
      <input type="hidden" name="stage" value={stage} />
      <label htmlFor={`${fieldId}-reason`} className="sr-only">
        {kind === "rejected" ? "Rejection reason" : "Withdrawal reason"}
      </label>
      <select id={`${fieldId}-reason`} name="reasonId" required defaultValue="" className={selectClass} disabled={!reasons.length}>
        <option value="" disabled>
          {reasons.length ? (kind === "rejected" ? "Why are they rejected?" : "Why did they withdraw?") : "No reasons set up"}
        </option>
        {reasons.map((r) => (
          <option key={r.reasonId} value={r.reasonId}>
            {r.name}
          </option>
        ))}
      </select>
      <label htmlFor={`${fieldId}-note`} className="sr-only">
        Note
      </label>
      <Input id={`${fieldId}-note`} name="note" maxLength={NOTE_MAX} placeholder="Note (optional)" />
      <SubmitButton variant="outline" pendingLabel="Saving…" disabled={!reasons.length} className={cn("justify-self-start", kind === "rejected" && "text-negative")}>
        {label}
      </SubmitButton>
    </form>
  );
}

/** Null `choices`: read-only, the chips and nothing else. */
export function CandidateLabels({ candidateId, labels, choices }: { candidateId: string; labels: string[]; choices: LabelChoices | null }) {
  if (choices?.length) return <LabelMenu candidateId={candidateId} labels={labels} options={choices} />;
  return labels.map((t) => <Chip key={`tag-${t}`}>{t}</Chip>);
}

export function JobControls({ e }: { e: JobEditing }) {
  const next = nextStage(e.stage);
  const closed = closeReasonKind(e.stage) !== null;
  const id = (k: string) => `${e.applicationId}-${k}`;
  return (
    <div className="mx-5 mb-4 grid gap-4 rounded-[10px] bg-[color:var(--soft)] p-4 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex flex-wrap items-center gap-2">
        {next ? (
          <form action={moveCandidateAction}>
            <Hidden e={e} />
            <input type="hidden" name="stage" value={next} />
            <SubmitButton pendingLabel="Moving…">Move to {stageLabel(next).toLowerCase()} →</SubmitButton>
          </form>
        ) : null}
        <form action={moveCandidateAction} className="flex items-center gap-2">
          <Hidden e={e} />
          <label htmlFor={id("stage")} className="sr-only">
            Stage
          </label>
          <select id={id("stage")} name="stage" data-command="stage" defaultValue={closed ? "" : e.stage} required className={cn(selectClass, "w-[170px]")}>
            {closed ? (
              <option value="" disabled>
                Reopen at…
              </option>
            ) : null}
            {MOVABLE_STAGES.map((s) => (
              <option key={s} value={s}>
                {stageLabel(s)}
              </option>
            ))}
          </select>
          <SubmitButton variant="outline" pendingLabel="Moving…">
            Move
          </SubmitButton>
        </form>
      </div>

      {!closed ? (
        <details className="group" data-command="close">
          <summary className="-ml-1.5 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[6px] px-1.5 text-[12.5px] text-muted-foreground transition-colors select-none hover:bg-[color:var(--hover)] hover:text-foreground [&::-webkit-details-marker]:hidden">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-3 shrink-0 transition-transform duration-200 ease-[var(--ease-out)] group-open:rotate-90" aria-hidden>
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
            Reject or withdraw…
          </summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <CloseForm e={e} kind="rejected" />
            <CloseForm e={e} kind="withdrew" />
          </div>
        </details>
      ) : null}

      <div className="grid gap-4 border-t border-[color:var(--line)] pt-4 md:grid-cols-2">
        <form action={setOwnerAction} className="grid content-start gap-1.5">
          <Hidden e={e} stage={false} />
          <label htmlFor={id("owner")} className={LABEL}>
            Owner
          </label>
          <div className="flex gap-2">
            <select id={id("owner")} name="ownerActorId" defaultValue={e.ownerActorId ?? ""} className={cn(selectClass, "min-w-0 flex-1")}>
              <option value="">No owner</option>
              {e.owners.map((o) => (
                <option key={o.actorId} value={o.actorId}>
                  {o.name || "Unnamed member"}
                </option>
              ))}
            </select>
            <SubmitButton variant="outline" pendingLabel="Saving…">
              Save
            </SubmitButton>
          </div>
        </form>

        <form action={logTouchAction} className="grid content-start gap-1.5">
          <Hidden e={e} stage={false} />
          <label htmlFor={id("touch")} className={LABEL}>
            Log a touch
          </label>
          <div className="flex gap-2">
            <Input id={id("touch")} name="note" maxLength={NOTE_MAX} placeholder="What happened (optional)" className="flex-1" />
            <SubmitButton variant="outline" pendingLabel="Logging…">
              Log
            </SubmitButton>
          </div>
        </form>

        <form action={setNextActionAction} className="grid content-start gap-1.5 md:col-span-2">
          <Hidden e={e} stage={false} />
          <label htmlFor={id("next")} className={LABEL}>
            Next action
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={id("next")}
              name="nextAction"
              maxLength={NEXT_ACTION_MAX}
              defaultValue={e.nextAction ?? ""}
              placeholder="e.g. send the take-home"
              className="w-auto min-w-[180px] flex-1"
            />
            <label htmlFor={id("due")} className="sr-only">
              Due
            </label>
            <Input id={id("due")} type="date" name="due" defaultValue={e.nextActionDue?.slice(0, 10) ?? ""} className="w-[156px]" />
            <SubmitButton variant="outline" pendingLabel="Saving…">
              Save
            </SubmitButton>
            {e.nextAction ? (
              <SubmitButton variant="ghost" name="clear" value="1" pendingLabel="Clearing…" formNoValidate>
                Clear
              </SubmitButton>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
