"use client";

import { useActionState, useRef } from "react";
import { useKeyHelp, useKeys } from "@/components/keys";
import { Notice } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { addNoteAction } from "./actions";
import { CANDIDATE_ERRORS, type NoteState } from "./messages";

// design/tats's `.composer`: a note for the team, in a box that stays on the
// page. The box is uncontrolled, so it works with no script, and React resets
// a form to its defaultValue once its action ends: empty after a save, the
// words back after a refusal. That reset would take anything typed while the
// save runs, so the box is read-only until it ends. ⌘↵ saves and C comes here,
// as in the prototype, and the button does the same without them.

const FIRST: NoteState = { added: 0 };

export function NoteComposer({ candidateId, max }: { candidateId: string; max: number }) {
  const [state, action, pending] = useActionState(addNoteAction, FIRST);
  const box = useRef<HTMLTextAreaElement>(null);
  const refused = "error" in state ? state : null;

  useKeys({ c: () => box.current?.focus() });
  useKeyHelp("Candidate", [
    { keys: "C", label: "Write a note" },
    { keys: "⌘↵", label: "Save the note" },
  ]);

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="candidateId" value={candidateId} />
      {refused ? <Notice tone="error">{CANDIDATE_ERRORS[refused.error]}</Notice> : null}
      <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--paper)] transition-colors focus-within:border-[color:var(--line-strong)] focus-within:shadow-[var(--shadow)]">
        <label htmlFor="candidate-note" className="sr-only">
          Add a note
        </label>
        <textarea
          ref={box}
          id="candidate-note"
          data-command="note"
          name="text"
          rows={2}
          required
          maxLength={max}
          defaultValue={refused?.text ?? ""}
          readOnly={pending}
          placeholder="Add a note…"
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
            e.preventDefault();
            if (!pending) e.currentTarget.form?.requestSubmit();
          }}
          className="block min-h-14 w-full resize-y border-0 bg-transparent px-3 pt-[11px] pb-1 text-[13.5px] leading-[1.5] outline-none placeholder:text-faint"
        />
        <div className="flex items-center justify-between gap-3 px-3 pt-1.5 pb-2">
          <span role="status" className="text-[12.5px] text-faint">
            {state.added > 0 && !refused ? "Note added." : "Your team can read notes. They can't be edited or deleted."}
          </span>
          <SubmitButton variant="outline" size="sm" pendingLabel="Adding…" title="Add note (⌘↵)" className="flex-none">
            Add note
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
