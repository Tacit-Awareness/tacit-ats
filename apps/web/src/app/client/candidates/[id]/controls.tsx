import { NEXT_ACTION_MAX } from "@tacit/core";
import { Chip, MiniTitle } from "@/components/page";
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
      <SubmitButton variant="outline" size="sm" pendingLabel="Saving…" disabled={!reasons.length} className="justify-self-start">
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
    <div className="mx-2 mb-2 grid gap-3 rounded-[10px] border border-[color:var(--line)] bg-[color:var(--pane)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        {next ? (
          <form action={moveCandidateAction}>
            <Hidden e={e} />
            <input type="hidden" name="stage" value={next} />
            <SubmitButton size="sm" pendingLabel="Moving…">
              Move to {stageLabel(next).toLowerCase()} →
            </SubmitButton>
          </form>
        ) : null}
        <form action={moveCandidateAction} className="flex items-center gap-2">
          <Hidden e={e} />
          <label htmlFor={id("stage")} className="sr-only">
            Stage
          </label>
          <select id={id("stage")} name="stage" data-command="stage" defaultValue={closed ? "" : e.stage} required className={cn(selectClass, "h-7 w-[150px]")}>
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
          <SubmitButton variant="outline" size="sm" pendingLabel="Moving…">
            Move
          </SubmitButton>
        </form>
      </div>

      {!closed ? (
        <details className="group" data-command="close">
          <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">Reject or withdraw…</summary>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <CloseForm e={e} kind="rejected" />
            <CloseForm e={e} kind="withdrew" />
          </div>
        </details>
      ) : null}

      <div className="grid gap-3 border-t border-[color:var(--line)] pt-3 md:grid-cols-2">
        <form action={setOwnerAction} className="grid content-start gap-1.5">
          <Hidden e={e} stage={false} />
          <MiniTitle className="mt-0">
            <label htmlFor={id("owner")}>Owner</label>
          </MiniTitle>
          <div className="flex gap-2">
            <select id={id("owner")} name="ownerActorId" defaultValue={e.ownerActorId ?? ""} className={selectClass}>
              <option value="">No owner</option>
              {e.owners.map((o) => (
                <option key={o.actorId} value={o.actorId}>
                  {o.name || "Unnamed member"}
                </option>
              ))}
            </select>
            <SubmitButton variant="outline" size="sm" pendingLabel="Saving…" className="h-8">
              Save
            </SubmitButton>
          </div>
        </form>

        <form action={logTouchAction} className="grid content-start gap-1.5">
          <Hidden e={e} stage={false} />
          <MiniTitle className="mt-0">
            <label htmlFor={id("touch")}>Log a touch</label>
          </MiniTitle>
          <div className="flex gap-2">
            <Input id={id("touch")} name="note" maxLength={NOTE_MAX} placeholder="What happened (optional)" />
            <SubmitButton variant="outline" size="sm" pendingLabel="Logging…" className="h-8">
              Log
            </SubmitButton>
          </div>
        </form>

        <form action={setNextActionAction} className="grid content-start gap-1.5 md:col-span-2">
          <Hidden e={e} stage={false} />
          <MiniTitle className="mt-0">
            <label htmlFor={id("next")}>Next action</label>
          </MiniTitle>
          <div className="flex flex-wrap gap-2">
            <Input
              id={id("next")}
              name="nextAction"
              maxLength={NEXT_ACTION_MAX}
              defaultValue={e.nextAction ?? ""}
              placeholder="e.g. send the take-home"
              className="min-w-[180px] flex-1"
            />
            <label htmlFor={id("due")} className="sr-only">
              Due
            </label>
            <Input id={id("due")} type="date" name="due" defaultValue={e.nextActionDue?.slice(0, 10) ?? ""} className="w-[150px]" />
            <SubmitButton variant="outline" size="sm" pendingLabel="Saving…" className="h-8">
              Save
            </SubmitButton>
            {e.nextAction ? (
              <SubmitButton variant="ghost" size="sm" name="clear" value="1" pendingLabel="Clearing…" className="h-8" formNoValidate>
                Clear
              </SubmitButton>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
